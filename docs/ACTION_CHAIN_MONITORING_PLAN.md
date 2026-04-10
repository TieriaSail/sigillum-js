# 行为链监控预设体系 + 自定义 Action 系统

## 现状分析

当前系统存在以下明显缺陷：

- **滚动方向写死为 `'down'`**：Taro 和 WeChat 适配器都硬编码了方向
- **滑动事件从未被自动采集**：`SwipeEventData` 类型已定义，但没有任何适配器发出该事件
- **拖拽事件被忽略**：`drag_start/move/end` 存在于类型定义中，但 `buildActionChain` 完全不处理，适配器也不采集
- **触摸事件未处理**：`touchstart/move/end/cancel` 在 `USER_INTERACTION_EVENTS` 集合中，但 `processAutoEvent` 没有对应的 case
- **无手势识别**：没有捏合、多指触摸、双击等手势
- **无滚动深度追踪**：只有原始 `scrollTop`，没有百分比
- **无性能/时序信息**：没有操作间隔时间、交互持续时长等

---

## 整体架构：三档预设 + 自定义规则

```
MonitoringConfig
       |
       v
  resolvePreset()
       |
       v
  合并后的规则集  <---- 自定义 ActionRule[]
       |
       v
  事件过滤器（适配器内）
       |
       v
  事件增强器
       |
       v
  EventRecorder
       |
       v
  buildActionChain()
```

---

## 1. 新增类型：MonitoringPreset 和 MonitoringConfig

添加到 `src/core/types.ts`：

```typescript
export type MonitoringPreset = 'lite' | 'standard' | 'full';

export interface ActionRule {
  /** 规则唯一名称，未提供 transform 时也作为 ActionType */
  name: string;
  /** 此规则匹配哪些原始事件类型 */
  eventTypes: TrackEventType[];
  /** 可选的细粒度过滤谓词 */
  match?: (event: TrackEvent) => boolean;
  /** 将原始事件转换为行为描述和详情 */
  transform?: (event: TrackEvent, context: ActionRuleContext) => {
    description: string;
    detail?: Record<string, unknown>;
    target?: ActionTarget;
  } | null;
  /** 是否合并连续同类事件 */
  merge?: boolean | ((prev: TrackEvent, next: TrackEvent) => boolean);
}

export interface ActionRuleContext {
  currentPage: string;
  sessionStartTime: number;
  lastAction?: ActionNode;
}

export interface MonitoringConfig {
  /** 以某个预设为基础（省略时默认 'standard'） */
  preset?: MonitoringPreset;

  /** 覆盖各事件类别的采集开关 */
  capture?: {
    touch?: boolean;         // 原始触摸流 touchstart/move/end
    tap?: boolean;
    longpress?: boolean;
    input?: boolean;
    scroll?: boolean;
    swipe?: boolean;         // 手势识别的滑动
    drag?: boolean;          // drag_start/move/end
    network?: boolean;
    error?: boolean;
    custom?: boolean;
    pageLifecycle?: boolean;
    session?: boolean;
  };

  /** 高频事件的节流间隔（毫秒） */
  throttle?: {
    scroll?: number;         // 默认 300（lite: 1000, full: 100）
    touchMove?: number;      // 默认 0（不采集）, full: 50
    drag?: number;           // 默认 100
  };

  /** 是否追踪滚动深度 */
  scrollDepth?: boolean;

  /** 自定义 Action 规则（追加在预设规则之后） */
  rules?: ActionRule[];

  /** 事件过滤器：返回 false 则丢弃该事件 */
  eventFilter?: (event: TrackEvent) => boolean;
}
```

---

## 2. 三档预设定义

新建 `src/core/presets.ts`：

### lite（轻量）— 最小数据量，适合生产环境全量开启

| 类别 | 是否采集 |
|------|---------|
| 会话生命周期 | YES |
| 页面进出 | YES |
| 点击 | YES |
| 长按 | NO |
| 输入 | NO |
| 滚动 | NO |
| 滑动手势 | NO |
| 拖拽 | NO |
| 触摸流 | NO |
| 网络请求 | NO |
| 错误 | YES |
| 自定义事件 | NO |
| 用户标识 | YES |

节流：scroll 1000ms（即使意外开启也不会爆量）

### standard（标准，默认）— 平衡采集量和信息量

| 类别 | 是否采集 |
|------|---------|
| 会话生命周期 | YES |
| 页面进出 | YES |
| 点击 | YES |
| 长按 | YES |
| 输入（聚焦/变更/失焦） | YES |
| 滚动 | YES |
| 滑动手势 | YES |
| 拖拽 | NO |
| 触摸流 | NO |
| 网络请求 | YES |
| 错误 | YES |
| 自定义事件 | YES |
| 用户标识 | YES |

节流：scroll 300ms

### full（完整）— 最大细节，适合调试和深度分析

| 类别 | 是否采集 |
|------|---------|
| 会话生命周期 | YES |
| 页面进出 | YES |
| 点击 | YES |
| 长按 | YES |
| 输入（聚焦/变更/失焦） | YES |
| 滚动 | YES |
| 滑动手势 | YES |
| 拖拽 | YES |
| 触摸流（touch_start/move/end） | YES |
| 网络请求 | YES |
| 错误 | YES |
| 自定义事件 | YES |
| 用户标识 | YES |
| 滚动深度追踪 | YES |

节流：scroll 100ms, touchMove 50ms, drag 100ms

预设本质上就是预填好的 `MonitoringConfig` 对象。`resolveMonitoringConfig(preset, overrides)` 负责合并。

---

## 3. 丰富事件采集数据

### 3.1 修复滚动方向 + 增强滚动数据

**当前问题**：`direction` 写死为 `'down'`。

**修复方案**：
- 适配器内部维护 `lastScrollTop` / `lastScrollLeft` 状态
- 通过前后差值计算真实方向
- `ScrollEventData` 新增可选字段：
  - `scrollHeight`（总可滚动高度）
  - `viewportHeight`（可视区高度）
  - 用于计算深度百分比

### 3.2 实现滑动手势识别

**当前问题**：`SwipeEventData` 类型存在但从未被发出。

**实现方案**：在适配器中利用 `touchstart` / `touchend` 进行手势识别：
- 记录 `touchstart` 的坐标和时间戳
- 在 `touchend` 时，若滑动距离 > 30px 且速度 > 0.3px/ms，则发出 `swipe` 事件
- `SwipeEventData` 新增字段：
  - `velocity`（速度 px/ms）
  - `distance`（距离 px）
  - `duration`（持续时间 ms）

### 3.3 原始触摸流（仅 full 预设）

新增事件类型：`touch_start`、`touch_move`、`touch_end`

新增数据接口：

```typescript
export interface TouchEventData {
  x: number;
  y: number;
  target: EventTarget;
  page: string;
  touchId?: number;      // 多指触摸标识
  touchCount?: number;   // 同时触摸点数
  force?: number;        // 压力值 0-1（如可用）
}
```

### 3.4 拖拽增强

`DragEventData` 新增：
- `deltaX`（相对上次的 X 偏移）
- `deltaY`（相对上次的 Y 偏移）

### 3.5 滚动深度追踪

新增派生事件 `scroll_depth`，在 `page_leave` 时发出一次：

```typescript
export interface ScrollDepthEventData {
  page: string;
  maxScrollTop: number;
  maxDepthPercent: number;  // 0-100
  scrollHeight: number;
  viewportHeight: number;
}
```

---

## 4. 更新平台适配器

### Taro 适配器 (`src/platform/miniapp/taro.ts`)

- 构造函数或 `createEventInterceptor` 接受 `MonitoringConfig`
- 根据 `config.capture.*` 开关过滤要处理的事件
- 实现 `touchstart/touchmove/touchend` 处理：用于滑动手势识别 + 原始触摸流
- 用 `lastScrollTop` 状态修复滚动方向计算
- 应用 `config.throttle.*` 节流
- 按页面追踪滚动深度

### WeChat 适配器 (`src/platform/miniapp/wechat.ts`)

- 同样的改动，适配声明式 `track()` API
- 新增 `track('touchstart', e)` 等支持

---

## 5. 更新行为链构建器 (`src/replay/ActionChain.ts`)

### 5.1 新增 ActionType

新增：`'touch_start'`、`'touch_move'`、`'touch_end'`、`'scroll_depth'`、`'drag_start'`、`'drag_move'`、`'drag_end'`

### 5.2 更丰富的描述文案

| 行为 | 当前描述 | 增强后描述 |
|------|---------|-----------|
| 点击 | `点击 <button#buy> "立即购买"` | `点击 <button#buy> "立即购买" (120, 340)` |
| 滚动 | `滚动 ↓ scrollTop=680` | `滚动 ↓ 到 45% (scrollTop=680)` |
| 滑动 | `滑动 right` | `滑动 → 距离 180px, 速度 0.6px/ms` |
| 触摸流 | （不存在） | `触摸移动 (120,340) → (250,380), 12 个采样点` |
| 拖拽 | （不存在） | `拖拽 <slider#vol> (100,200) → (300,200)` |
| 滚动深度 | （不存在） | `页面滚动深度 78%` |

### 5.3 自定义规则执行

在 `buildActionChain` 中，内置 `switch` 处理完毕后，遍历 `config.rules` 并执行匹配的规则。自定义规则可以覆盖内置行为或添加全新的 Action 类型。

### 5.4 增强统计信息

`ActionChainStats` 新增字段：
- `swipeCount`（滑动次数）
- `touchCount`（原始触摸事件数）
- `dragCount`（拖拽次数）
- `maxScrollDepth`（所有页面中最大滚动深度 %）
- `avgPageDuration`（平均页面停留时长）

---

## 6. 更新渲染器

### `renderActionChainHTML` 和 `ActionChainPlayer`

- 为新 Action 类型添加图标和颜色
- 行内显示触摸坐标标注
- 页面分组头部显示滚动深度进度条
- 统计栏新增：滑动次数、最大滚动深度

---

## 7. 更新入口文件

### `src/miniapp.ts` 和 `src/miniapp-taro.ts`

- 选项中新增 `monitoring?: MonitoringConfig`
- 将解析后的配置传递给适配器和事件过滤器
- 默认使用 `'standard'` 预设

---

## 8. 公开 API 使用示例

```typescript
// 轻量模式：最小数据量
createTaroRecorder({ monitoring: { preset: 'lite' } });

// 标准模式（默认）：平衡
createTaroRecorder({});

// 完整模式：最大细节
createTaroRecorder({ monitoring: { preset: 'full' } });

// 自定义：标准 + 原始触摸 + 业务规则
createTaroRecorder({
  monitoring: {
    preset: 'standard',
    capture: { touch: true },
    rules: [{
      name: 'cart_add',
      eventTypes: ['tap'],
      match: (e) => (e.data as any).target?.id === 'add-to-cart',
      transform: (e) => ({
        description: '加入购物车',
        detail: { productId: (e.data as any).target?.dataset?.productId },
      }),
    }],
  },
});
```

---

## 9. 更新 replay-preview.html

- 头部显示当前监控预设级别
- 渲染增强后的行为描述
- 每个页面分组添加滚动深度可视化

---

## 10. 测试

- `resolveMonitoringConfig` 预设合并的单元测试
- 滑动手势识别的单元测试
- 滚动方向修复的单元测试
- `buildActionChain` 新 Action 类型和增强描述的测试
- 适配器配置驱动的过滤和节流测试

---

## 最佳实践：捕获任意位置的触摸

### 问题

小程序的事件系统是冒泡模型——只有当元素或其祖先绑定了事件处理函数时，事件才会被派发。
如果用户点击了没有任何事件绑定的空白区域，SDK 无法捕获该触摸。

这与浏览器端不同（浏览器可以在 `document` 上监听全局 `click`），是小程序平台的根本限制。

### 解决方案

在页面根元素上绑定空的 `onTouchStart` / `onTouchEnd`（Taro）或 `bindtouchstart` / `bindtouchend`（微信原生）。

**关键**：必须使用 `bind`（Taro 的 `on`），**不能**使用 `catch`。
- `bind` / `on`：不阻止冒泡，对业务逻辑无影响
- `catch`：会吞掉事件，导致子元素的 tap、scroll 等行为失效

### Taro 示例

```tsx
function IndexPage() {
  return (
    <View onTouchStart={() => {}} onTouchEnd={() => {}}>
      {/* 页面内容 */}
    </View>
  );
}
```

### 微信原生示例

WXML：
```xml
<view bindtouchstart="onTouchStart" bindtouchend="onTouchEnd">
  <!-- 页面内容 -->
</view>
```

JS：
```js
Page({
  onTouchStart(e) {
    getSigillum()?.track('touchstart', e);
  },
  onTouchEnd(e) {
    getSigillum()?.track('touchend', e);
  },
});
```

### 效果

- full 模式下，所有触摸位置都会被记录为 `touch_start` / `touch_end` 事件
- 滑动手势识别（swipe）也会因此覆盖到全页面范围
- 性能开销可忽略（仅多一层空函数调用 + 事件冒泡）

### 注意事项

- 这不是 SDK 能自动完成的，需要接入方在页面根元素上添加绑定
- 建议在 full 模式下使用，lite/standard 模式默认不采集 touch 事件，加了也不会产生数据
- 如果只需要捕获有意义的交互（点击按钮、输入框等），不加也完全没问题

---

## 实现顺序

1. 定义类型（types.ts）
2. 实现预设（presets.ts）
3. 修复滚动 + 增强适配器
4. 实现滑动手势识别
5. 添加原始触摸流采集
6. 将配置接入适配器
7. 升级行为链构建器
8. 升级渲染器
9. 更新入口文件
10. 更新 replay-preview.html
11. 编写测试
