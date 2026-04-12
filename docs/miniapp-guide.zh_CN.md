# 小程序接入指南

<p align="center">
  <a href="./miniapp-guide.md">English</a> | <b>中文</b>
</p>

> **状态：Beta 测试中**
>
> 小程序支持目前处于 Beta 阶段（`sigillum-js@2.0.0-beta`）。当前仅支持**微信原生小程序**和 **Taro（3.0+）**。支付宝、抖音、百度、QQ 小程序适配器已规划但尚未实现。
>
> Beta 版本间的 API 可能会有调整。如遇问题请到 [GitHub Issues](https://github.com/TieriaSail/sigillum-js/issues) 反馈。

---

## 功能概述

sigillum-js v2.0 为小程序环境（无 HTML DOM，rrweb 无法工作）提供语义化用户行为追踪。

- **事件序列追踪** — 记录点击、输入、滚动、滑动、页面跳转等用户行为
- **三档监控预设** — `lite`、`standard`、`full`，控制数据采集粒度
- **自定义行为规则** — 定义业务专属的语义化行为
- **语义化行为链回放** — 人类可读的行为时间轴，支持按页面分组

> 浏览器端 rrweb 录制功能不受影响。小程序功能通过独立入口提供。

## 环境要求

| 平台 | 版本要求 | 说明 |
|------|---------|------|
| **微信小程序** | 基础库 >= 1.4.0 | 声明式埋点 `sigillum.track()` |
| **Taro** | >= 3.0.0 | 自动采集，monkey-patch `TaroElement.dispatchEvent`。已测试 3.0、3.6、4.x |
| **Node.js** | >= 16.0.0 | 构建和开发 |

> **推荐**：微信基础库 >= 2.1.0 以获得 `wx.onAppHide`/`wx.offAppHide` 等完整支持。

## 安装

```bash
npm install sigillum-js@beta
```

## 监控预设

选择预设来控制数据采集量：

| 预设 | 采集内容 | 适用场景 |
|------|---------|---------|
| `lite` | 会话、页面生命周期、点击、错误 | 生产环境，最低开销 |
| `standard` | + 长按、输入、滚动、滑动、自定义 | 默认推荐 |
| `full` | + 触摸流、滚动深度 | 开发调试 / 深度分析 |

> **规划中**：网络请求采集（`network`）和拖拽事件采集（`drag`）已在类型系统和预设中预留开关，但当前适配器尚未实现自动采集。将在后续版本中支持。

```javascript
createMiniAppRecorder({
  monitoring: { preset: 'full' },
  // ...
});
```

### 节流间隔

高频事件（scroll、touchmove、drag）内置节流，各预设默认值如下：

| 事件类型 | lite | standard | full | 说明 |
|----------|-----:|---------:|-----:|------|
| `scroll` | 1000ms | 300ms | 100ms | 滚动事件最小间隔 |
| `touchMove` | —（不采集） | —（不采集） | 50ms | touchmove 最小间隔 |
| `drag` | —（不采集） | —（不采集） | 100ms | 拖拽事件最小间隔（规划中） |

> 如果觉得 full 模式下滚动事件过于频繁，可以通过 `throttle` 覆盖：

```javascript
createMiniAppRecorder({
  monitoring: {
    preset: 'full',
    throttle: { scroll: 500 },  // 将滚动节流调整为 500ms
  },
});
```

单独覆盖其他配置：

```javascript
createMiniAppRecorder({
  monitoring: {
    preset: 'standard',
    capture: { swipe: true, touch: true },
    throttle: { scroll: 200 },
    scrollDepth: true,
  },
});
```

## 微信原生小程序

声明式埋点模式：在事件处理函数中调用 `sigillum.track()`。

### 初始化

```javascript
// app.js
import { createMiniAppRecorder } from 'sigillum-js/miniapp';

App({
  onLaunch() {
    const recorder = createMiniAppRecorder({
      monitoring: { preset: 'standard' },
      onUpload: async (data) => {
        const res = await new Promise((resolve, reject) => {
          wx.request({
            url: 'https://your-api.com/api/recordings',
            method: 'POST',
            data,
            success: resolve,
            fail: reject,
          });
        });
        return { success: res.statusCode === 200 };
      },
    });
    recorder.start();
  },
});
```

### 页面事件埋点

```javascript
// pages/index/index.js
import { getSigillum } from 'sigillum-js/miniapp';

Page({
  onTap(e) {
    getSigillum()?.track('tap', e);
  },
  onInput(e) {
    getSigillum()?.track('input', e);
  },
  onScroll(e) {
    getSigillum()?.track('scroll', e);
  },
});
```

### 捕获任意位置触摸（full 模式，可选）

在页面根元素绑定触摸事件，使 SDK 能捕获任意位置的触摸（包括空白区域）：

```xml
<!-- WXML -->
<view bindtouchstart="onTouchStart" bindtouchend="onTouchEnd">
  <!-- 页面内容 -->
</view>
```

```javascript
Page({
  onTouchStart(e) {
    getSigillum()?.track('touchstart', e);
  },
  onTouchEnd(e) {
    getSigillum()?.track('touchend', e);
  },
});
```

必须使用 `bind`（不能用 `catch`），否则会阻止事件冒泡。

> **事件粒度说明**：根 view 绑定 touch 后，点击一个同时绑了 `bindtap` 的子元素会产生 **3 个事件**：
>
> | 序号 | 事件 | 来源 |
> |:----:|------|------|
> | 1 | `touch_start` | 根 view 捕获（冒泡） |
> | 2 | `touch_end` | 根 view 捕获（冒泡） |
> | 3 | `tap` | 子元素 `track('tap', e)` |
>
> 这是**预期行为**——行为链分析器会从中还原完整的"触摸→点击"语义链。
>
> 如果不需要完整触摸链，可以**不绑定根 view 的 touch 事件**，此时每次 tap 只产生 1 个事件。根 view touch 绑定是可选增强，不是必须的。

### 关联用户（可选）

```javascript
getSigillum()?.identify('user-123', { name: 'Alice', vipLevel: 2 });
```

## Taro 框架

自动采集模式：monkey-patch `TaroElement.dispatchEvent`，零手动埋点。

### 初始化

```typescript
// app.tsx
import { useEffect, type ReactNode } from 'react';
import { createTaroRecorder } from 'sigillum-js/miniapp/taro';
import Taro from '@tarojs/taro';

const recorder = createTaroRecorder({
  autoCapture: true,
  appVersion: '1.0.0',
  monitoring: { preset: 'standard' },
  onUpload: async (data) => {
    const res = await Taro.request({
      url: 'https://your-api.com/api/recordings',
      method: 'POST',
      data,
    });
    return { success: res.statusCode === 200 };
  },
});

function App({ children }: { children: ReactNode }) {
  useEffect(() => {
    recorder.start();
    return () => { recorder.stop(); };
  }, []);
  return <>{children}</>;
}
export default App;
```

页面组件无需埋点代码 — 点击、滚动、输入事件自动采集。

### 捕获任意位置触摸（full 模式）

在页面根 `<View>` 上添加空触摸处理：

```tsx
<View onTouchStart={() => {}} onTouchEnd={() => {}}>
  {/* 页面内容 */}
</View>
```

### 自定义事件（可选）

```typescript
import { getTaroSigillum } from 'sigillum-js/miniapp/taro';

getTaroSigillum()?.trackEvent({
  type: 'custom',
  timestamp: Date.now(),
  data: { name: 'add_to_cart', payload: { productId: '123' } },
});
```

## Web 端回放

回放在浏览器端（管理后台）进行，不在小程序内部。

### ActionChainPlayer（React 组件）

```tsx
import { ActionChainPlayer } from 'sigillum-js/replay';

<ActionChainPlayer
  data={recordingData}
  style={{ width: 400 }}
  speed={1}
  autoPlay
/>
```

### 构建行为链（无 UI）

```typescript
import { buildActionChain, renderActionChainHTML } from 'sigillum-js/replay';

const chain = buildActionChain(recordingData);
console.log(chain.stats);
console.log(chain.pageGroups);

// 或渲染为独立 HTML
const html = renderActionChainHTML(chain);
```

### 自定义行为规则

```typescript
import { buildActionChain } from 'sigillum-js/replay';

const chain = buildActionChain(recordingData, {
  rules: [{
    name: 'purchase',
    eventTypes: ['custom'],
    match: (event) => event.data?.name === 'purchase',
    transform: (event, ctx) => ({
      description: `在 ${ctx.currentPage} 完成购买`,
      detail: event.data?.payload,
    }),
  }],
});
```

### TimelinePlayer（无 UI 事件播放）

```typescript
import { TimelinePlayer } from 'sigillum-js/replay';

const player = new TimelinePlayer({
  events: data.events,
  onEvent: (event, i) => console.log(event.type, event.data),
});
player.play();
```

## API 参考

### `sigillum-js/miniapp`

| API | 说明 |
|-----|------|
| `createMiniAppRecorder(options)` | 创建录制器实例 |
| `getSigillum()` | 获取全局录制器实例 |
| `recorder.start()` | 开始录制 |
| `recorder.stop()` | 停止录制（返回 Promise） |
| `recorder.pause()` / `resume()` | 暂停 / 恢复 |
| `recorder.destroy()` | 销毁录制器 |
| `recorder.track(type, event)` | 声明式埋点 |
| `recorder.identify(userId, traits?)` | 关联用户身份 |
| `recorder.getStatus()` | `'idle' \| 'recording' \| 'paused' \| 'stopped'` |
| `recorder.getSessionId()` | 当前会话 ID |
| `recorder.getEventCount()` | 事件数量 |
| `recorder.getSummary()` | 行为摘要 |
| `recorder.getMetadata()` | 会话元数据（platform、sdkVersion 等） |
| `recorder.exportRecording()` | 导出录制数据 |

### `sigillum-js/miniapp/taro`

包含上述所有 API，另有：

| API | 说明 |
|-----|------|
| `createTaroRecorder(options)` | 创建 Taro 录制器（支持 `autoCapture`） |
| `getTaroSigillum()` | 获取全局 Taro 录制器实例 |
| `recorder.trackEvent(event)` | 手动追踪事件 |

### `sigillum-js/replay`

| API | 说明 |
|-----|------|
| `<ActionChainPlayer>` | React 语义化行为链组件 |
| `buildActionChain(data, options?)` | 从录制数据构建语义化行为链 |
| `renderActionChainHTML(chain)` | 将行为链渲染为独立 HTML |
| `getActionChainCSS()` | HTML 渲染器的悬停/激活 CSS |
| `TimelinePlayer` | 无 UI 事件时间轴播放器 |

<details>
<summary><b>配置项</b></summary>

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `monitoring.preset` | `'lite' \| 'standard' \| 'full'` | `'standard'` | 监控粒度预设 |
| `monitoring.capture` | `CaptureConfig` | — | 逐事件类型覆盖采集开关 |
| `monitoring.throttle` | `ThrottleConfig` | — | 覆盖节流间隔（ms） |
| `monitoring.scrollDepth` | `boolean` | 预设默认值 | 是否追踪页面最大滚动深度 |
| `monitoring.rules` | `ActionRule[]` | `[]` | 自定义行为规则 |
| `monitoring.eventFilter` | `function` | — | 全局事件过滤器 |
| `onUpload` | `function` | — | 上传回调 |
| `onChunkUpload` | `function` | — | 分段上传回调 |
| `chunkedUpload.enabled` | `boolean` | `false` | 启用分段上传 |
| `chunkedUpload.interval` | `number` | `60000` | 分段间隔（ms） |
| `maskInputs` | `boolean` | `false` | 遮蔽输入值（参见[隐私保护](#隐私保护)） |
| `maxDuration` | `number` | `1800000` | 最大录制时长（ms） |
| `maxEvents` | `number` | `50000` | 最大事件数 |
| `maxRetries` | `number` | `3` | 上传重试次数 |
| `debug` | `boolean` | `false` | 调试模式 |

</details>

## 隐私保护

Web（rrweb）和小程序 SDK 默认**均不启用输入脱敏**（`maskInputs: false` / `maskAllInputs: false`）。这意味着用户输入值（文本框、搜索框等）默认以明文录制。

> **重要**：如果您的应用涉及敏感数据（密码、手机号、身份证号、支付信息、医疗记录等），**必须**在上线前启用输入脱敏。

### 小程序

```javascript
createMiniAppRecorder({
  maskInputs: true,   // 遮蔽所有输入值
  // ...
});
```

启用后的脱敏规则：
- 字符串值 → 等长的 `*`（如 `"secret123"` → `"*********"`）
- 非字符串、非空值（数字、布尔值） → 替换为 `"***"`
- `null` / `undefined` → 保持原样

脱敏在 `captureEvent` 内同步完成 — 原始值永远不会进入事件缓冲区或离开设备。

### Web（rrweb）

```javascript
getRecorder({
  rrwebConfig: {
    privacy: {
      maskAllInputs: true,

      maskInputOptions: {
        password: true,    // 始终建议开启
        email: true,
        tel: true,
        text: true,
      },

      blockClass: 'sensitive-area',
      blockSelector: '[data-private]',
      maskTextClass: 'mask-text',
      maskTextSelector: '.user-info',

      maskInputFn: (text, element) => {
        if (element.getAttribute('type') === 'tel') return text.replace(/\d/g, '*');
        return '*'.repeat(text.length);
      },
    },
  },
});
```

### 推荐的生产环境配置

| 场景 | 小程序 | Web |
|---|---|---|
| 通用应用 | `maskInputs: true` | `maskAllInputs: true` |
| 登录/支付页面 | `maskInputs: true` | `maskAllInputs: true` + `blockSelector: '[data-private]'` |
| 内部/调试 | `maskInputs: false` | `maskAllInputs: false` |

> **合规提示**：启用脱敏有助于满足 GDPR、CCPA 和中国《个人信息保护法》对会话回放的合规要求。具体请咨询您的法务/合规团队。

---

## 统一录制协议

从 v2.0 起，Web 和小程序的 `exportRecording()` 统一返回 **SigillumRecording 信封**，而非裸数据：

```json
{
  "sigillum": true,
  "schemaVersion": 1,
  "source": "miniapp",
  "sdkVersion": "2.0.0-beta.1",
  "exportedAt": 1712700000000,
  "recording": { /* MiniAppRawRecordingData 或 RawRecordingData */ }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `sigillum` | `true` | 魔术标记，标识信封格式 |
| `schemaVersion` | `number` | 协议版本（当前为 `1`） |
| `source` | `"web" \| "miniapp"` | 产生录制数据的平台 |
| `sdkVersion` | `string` | 导出数据时的 SDK 版本 |
| `exportedAt` | `number` | 导出时间戳（毫秒） |
| `recording` | `object` | 实际录制数据（平台相关） |

### 数据流向

| 场景 | 数据格式 |
|------|----------|
| 小程序 `onUpload` 回调 | `SigillumRecording<MiniAppRawRecordingData>` |
| 小程序 `exportRecording()` | `SigillumRecording<MiniAppRawRecordingData>` |
| Web `onUpload` 回调 | `Record<string, any>`（经 fieldMapper 转换） |
| Web `exportRecording()` | `SigillumRecording<RawRecordingData>` |

> Web 端的 `onUpload` 经过 `FieldMapper` 转换以适配后端字段，不使用信封格式。如需标准化输出，请使用 `exportRecording()`。

### 向后兼容

所有回放组件（`ReplayPlayer`、`ActionChainPlayer`）同时接受新信封格式和旧版裸数据。以下辅助函数也已导出：

```typescript
import {
  isSigillumRecording,  // 类型守卫
  unwrapRecording,       // 提取 recording + source
  detectRecordingSource, // 自动检测裸数据来源
} from 'sigillum-js';
```

### ReplayRouter 统一回放路由

`ReplayRouter` 自动识别数据来源，渲染对应的回放组件：

```tsx
import { ReplayRouter } from 'sigillum-js/ui';

<ReplayRouter
  data={jsonFromServer}
  replayConfig={{ speed: 2 }}
  speed={1.5}
  autoPlay
/>
```

它会根据 `source` 字段或自动检测，懒加载 `ReplayPlayer`（Web）或 `ActionChainPlayer`（小程序）。

## 常见问题

**Q: v2.0 会影响浏览器端功能吗？**
不会。浏览器录制仍使用 rrweb，v1.x API 不变。小程序功能通过独立入口（`sigillum-js/miniapp`）提供，不导入则不会打包。

**Q: Taro 自动采集对性能有影响吗？**
`dispatchEvent` 补丁仅增加一次函数调用 + 一次条件判断。不采集 DOM 快照，只有语义化事件数据通过管道。

**Q: 三档监控预设有什么区别？**
`lite` 仅采集点击和页面跳转（最小开销）。`standard` 增加输入、滚动、滑动、网络请求。`full` 增加原始触摸流、拖拽和滚动深度追踪。

**Q: `maskInputs` 是怎么脱敏的？**
默认关闭（`maskInputs: false`）。开启后（`maskInputs: true`），脱敏规则：
- 字符串值 → 等长的 `*`（如 `"secret123"` → `"*********"`）
- 非字符串非 null 值（数字、布尔等）→ `"***"`
- `null` / `undefined` → 保持原值

脱敏在 `captureEvent` 内同步执行，原始值不会进入事件缓冲区。

**Q: full 模式下滚动事件太多怎么办？**
full 模式的 scroll 节流默认为 100ms（最多 10 次/秒）。可通过 `monitoring.throttle.scroll` 覆盖，如设为 500ms 降低频率。详见上方"节流间隔"章节。

**Q: 绑了根 view touch 后，为什么点击按钮会产生 3 个事件？**
根 view 的 `bindtouchstart`/`bindtouchend` 会通过冒泡捕获所有触摸，加上子元素的 `track('tap')`，一次点击 = touch_start + touch_end + tap。这是预期行为，用于还原完整触摸语义链。不需要的话可以不绑根 view touch。

## 许可证

[MIT](../LICENSE) © TieriaSail
