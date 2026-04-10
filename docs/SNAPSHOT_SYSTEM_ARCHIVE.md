# 快照系统归档文档

> **废弃版本**: v2.0.0-beta.1  
> **废弃日期**: 2026-04-09  
> **废弃理由**: 小程序环境下 UI 快照无法像素级还原，回放效果远不如语义化行为链（ActionChain）清晰。快照系统的核心价值——"看到用户在做什么"——被行为链更好地替代了。  
> **替代方案**: `ActionChain` + `ActionChainPlayer`（语义化行为链，基于事件序列直接生成人类可读的操作描述）

---

## 目录

1. [系统概述](#1-系统概述)
2. [架构设计](#2-架构设计)
3. [核心类型定义](#3-核心类型定义)
4. [采集端实现](#4-采集端实现)
   - 4.1 [SnapshotCollector](#41-snapshotcollector)
   - 4.2 [Taro 适配器快照采集](#42-taro-适配器快照采集)
   - 4.3 [WeChat 适配器快照采集](#43-wechat-适配器快照采集)
5. [回放端实现](#5-回放端实现)
   - 5.1 [SnapshotViewer（纯函数 HTML 渲染器）](#51-snapshotviewer)
   - 5.2 [HybridPlayer（React 组件）](#52-hybridplayer)
   - 5.3 [TimelinePlayer（事件+快照时间轴）](#53-timelineplayer)
6. [数据流管道](#6-数据流管道)
7. [入口文件集成](#7-入口文件集成)
8. [测试用例](#8-测试用例)
9. [废弃理由详述](#9-废弃理由详述)
10. [复原指南](#10-复原指南)

---

## 1. 系统概述

快照系统的目标是在小程序环境中定期采集页面 UI 结构（节点树 + 位置 + 样式），在 Web 端回放时将其渲染为简化的 HTML 布局图，配合事件时间轴实现"看到用户在做什么"的效果。

**核心挑战**：
- 小程序没有 DOM、没有 `MutationObserver`、没有 `getComputedStyle`
- Taro 环境只有 VDOM，无法获取真实坐标（`rect` 全为 0）
- WeChat 原生环境通过 `SelectorQuery` 可获取坐标，但标签语义会丢失
- 页面截图 API 受限，且数据量大

**两种渲染模式**：
- **绝对定位模式**（WeChat 原生）：节点有精确 `rect`，按坐标绝对定位
- **流式布局模式**（Taro VDOM）：`rect` 全为 0，按节点类型和 className 启发式推断 CSS

---

## 2. 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    采集端（小程序运行时）                    │
│                                                         │
│  EventInterceptor ──→ EventRecorder.captureEvent()      │
│       │                      │                          │
│       └──→ SnapshotCollector.onEvent()                  │
│                 │                                       │
│                 ├──→ adapter.captureSnapshot()           │
│                 │        (Taro: walkVDOM)                │
│                 │        (WeChat: SelectorQuery)         │
│                 │                                       │
│                 ├──→ adapter.captureScreenshot() [可选]   │
│                 │                                       │
│                 └──→ EventRecorder.captureSnapshot()     │
│                           │                             │
│                           ├──→ EventBuffer.pushSnapshot()│
│                           └──→ emit TrackEvent('snapshot')│
│                                                         │
│  exportRecording() → { events, snapshots, ... }         │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    回放端（Web 浏览器）                     │
│                                                         │
│  MiniAppRawRecordingData                                │
│       │                                                 │
│       ├──→ TimelinePlayer (events + snapshots 时间轴)    │
│       │         │                                       │
│       │         ├──→ onSnapshot(UISnapshot)              │
│       │         └──→ onEvent(TrackEvent)                 │
│       │                                                 │
│       └──→ HybridPlayer (React)                         │
│                 │                                       │
│                 ├──→ SnapshotViewer.renderSnapshot()     │
│                 ├──→ SnapshotViewer.renderEventOverlay() │
│                 └──→ SnapshotViewer.highlightTarget...() │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 核心类型定义

**文件**: `src/core/types.ts`

```typescript
// ==================== UI 快照数据结构 ====================

export interface UINodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UINode {
  id?: string;
  tag: string;
  rect: UINodeRect;
  text?: string;
  src?: string;
  children?: UINode[];
  dataset?: Record<string, string>;
  className?: string;
  visible?: boolean;
  /** 采集到的内联/计算样式（Taro: props.style, WeChat: computedStyle） */
  style?: Record<string, string | number>;
}

export interface UISnapshot {
  timestamp: number;
  trigger: 'page_enter' | 'tap' | 'scroll_end' | 'interval' | 'manual';
  page: string;
  viewport: { width: number; height: number };
  nodes: UINode[];
  /** 页面截图 base64（可选，由平台适配器提供） */
  screenshotBase64?: string;
}

// ==================== 快照事件 data ====================

export interface SnapshotEventData {
  trigger: 'page_enter' | 'tap' | 'scroll_end' | 'interval' | 'manual';
  nodes: UINode[];
  viewport: { width: number; height: number };
  page: string;
}

// ==================== 录制器配置 ====================

export interface SnapshotConfig {
  enabled?: boolean;
  triggers?: Array<'page_enter' | 'tap' | 'scroll_end' | 'interval'>;
  /** 定时快照间隔 (ms) @default 10000 */
  interval?: number;
  /** 事件触发后延迟采集 (ms) @default 300 */
  delay?: number;
  /** 节点数硬上限 @default 500 */
  maxNodes?: number;
  /** 是否采集页面截图 @default false（会增加数据量） */
  captureScreenshot?: boolean;
  /** 是否采集节点样式 @default true */
  captureStyle?: boolean;
}

// TrackEventType 中包含 'snapshot'
// MiniAppRecorderOptions 中包含 snapshot?: SnapshotConfig
// MiniAppRawRecordingData 中包含 snapshots: UISnapshot[]
// MiniAppRecordingChunk 中包含 snapshots: UISnapshot[]
// MiniAppRecordingSummary 中包含 snapshotCount: number
```

**平台适配器接口** (`src/platform/types.ts`):

```typescript
export interface MiniAppPlatformAdapter {
  // ... 其他方法 ...

  /** 采集 UI 快照 */
  captureSnapshot(pageContext?: unknown): Promise<UINode[]>;

  /** 获取视口尺寸 */
  getViewportSize(): { width: number; height: number };

  /** 截取当前页面截图（可选实现，返回 base64 编码的图片数据） */
  captureScreenshot?(): Promise<string | null>;
}
```

---

## 4. 采集端实现

### 4.1 SnapshotCollector

**文件**: `src/snapshot/collector.ts`

核心职责：在可配置的时机触发 UI 快照采集，控制采集频率、延迟和节点数上限。

```typescript
import type { UISnapshot, SnapshotConfig, TrackEventType } from '../core/types';
import type { MiniAppPlatformAdapter } from '../platform/types';

const DEFAULT_SNAPSHOT_CONFIG: Required<SnapshotConfig> = {
  enabled: true,
  triggers: ['page_enter', 'tap'],
  interval: 10000,
  delay: 300,
  maxNodes: 500,
  captureScreenshot: false,
  captureStyle: true,
};

export class SnapshotCollector {
  private config: Required<SnapshotConfig>;
  private adapter: MiniAppPlatformAdapter;
  private onSnapshot: (snapshot: UISnapshot) => void;

  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private lastCaptureTime = 0;
  private lastImmediateCaptureTime = 0;

  /** 两次快照之间的最短间隔 (ms)，防止短时间内过多采集 */
  private minCaptureGap = 500;

  constructor(
    adapter: MiniAppPlatformAdapter,
    onSnapshot: (snapshot: UISnapshot) => void,
    config?: SnapshotConfig,
  ) {
    this.adapter = adapter;
    this.onSnapshot = onSnapshot;
    this.config = { ...DEFAULT_SNAPSHOT_CONFIG, ...config };
  }

  start(): void {
    if (this.active) return;
    this.active = true;

    if (this.config.triggers.includes('interval') && this.config.interval > 0) {
      this.intervalTimer = setInterval(() => {
        this.capture('interval');
      }, this.config.interval);
    }
  }

  stop(): void {
    this.active = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /**
   * 当事件发生时调用，根据配置决定是否触发快照采集。
   *
   * 对于 tap/longpress：立即采集一次"事件前快照"（无延迟），
   * 确保回放时点击发生的瞬间已有对应的 UI 上下文。
   * 延迟快照仍然会在 delay ms 后采集（捕获 UI 响应后的状态）。
   */
  onEvent(eventType: TrackEventType): void {
    if (!this.active || !this.config.enabled) return;

    type TriggerType = 'page_enter' | 'tap' | 'scroll_end' | 'interval';
    const triggerMap: Record<string, TriggerType> = {
      page_enter: 'page_enter',
      tap: 'tap',
      longpress: 'tap',
    };

    const trigger = triggerMap[eventType];
    if (!trigger || !this.config.triggers.includes(trigger)) return;

    if (eventType === 'tap' || eventType === 'longpress') {
      this.captureImmediate(trigger as UISnapshot['trigger']);
    }

    this.scheduleCapture(trigger as UISnapshot['trigger']);
  }

  captureNow(trigger: UISnapshot['trigger'] = 'manual'): void {
    this.capture(trigger);
  }

  /**
   * 立即采集快照（不经过 delay），用于在事件发生的瞬间捕获当前 UI 状态。
   * 使用独立的节流计时器，不影响延迟快照的采集。
   */
  private captureImmediate(trigger: UISnapshot['trigger']): void {
    const now = Date.now();
    if (now - this.lastImmediateCaptureTime < this.minCaptureGap) return;
    this.lastImmediateCaptureTime = now;
    this.doCapture(trigger);
  }

  private scheduleCapture(trigger: UISnapshot['trigger']): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = setTimeout(() => {
      this.capture(trigger);
      this.pendingTimer = null;
    }, this.config.delay);
  }

  private async capture(trigger: UISnapshot['trigger']): Promise<void> {
    if (!this.active) return;

    const now = Date.now();
    if (now - this.lastCaptureTime < this.minCaptureGap) return;
    this.lastCaptureTime = now;

    return this.doCapture(trigger);
  }

  private async doCapture(trigger: UISnapshot['trigger']): Promise<void> {
    if (!this.active) return;

    try {
      let nodes = await this.adapter.captureSnapshot();

      if (nodes.length > this.config.maxNodes) {
        nodes = nodes.slice(0, this.config.maxNodes);
      }

      if (!this.config.captureStyle) {
        nodes = nodes.map(n => {
          if (n.style) {
            const { style: _, ...rest } = n;
            return rest;
          }
          return n;
        });
      }

      const viewport = this.adapter.getViewportSize();
      const page = this.adapter.getCurrentPage().path;

      let screenshotBase64: string | undefined;
      if (this.config.captureScreenshot && this.adapter.captureScreenshot) {
        const result = await this.adapter.captureScreenshot();
        if (result) screenshotBase64 = result;
      }

      const snapshot: UISnapshot = {
        timestamp: Date.now(),
        trigger,
        page,
        viewport,
        nodes,
        ...(screenshotBase64 ? { screenshotBase64 } : {}),
      };

      this.onSnapshot(snapshot);
    } catch {
      // silent
    }
  }
}
```

**关键设计决策**：
- **双节流机制**：`lastImmediateCaptureTime` 和 `lastCaptureTime` 独立，确保 tap 的"立即快照"和"延迟快照"不互相节流
- **tap 双快照**：tap 事件触发时立即采集一次（捕获点击前的 UI），延迟后再采集一次（捕获 UI 响应后的状态）
- **minCaptureGap = 500ms**：防止短时间内过多采集

### 4.2 Taro 适配器快照采集

**文件**: `src/platform/miniapp/taro.ts`

Taro 环境无法使用 `SelectorQuery`（Taro 将页面编译为微信自定义组件，异步上下文中 `SelectorQuery` 无法关联正确的组件作用域），因此直接遍历 Taro 的虚拟 DOM 树。

```typescript
// TaroAdapter 中的快照相关方法

/**
 * UI 快照采集 — 遍历 Taro VDOM
 *
 * document 获取策略（兼容 Taro 3.0 ~ 4.x）：
 *   1. runtime.document — Taro 3.0+ 直接导出
 *   2. runtime.env?.document — Taro 3.6+ env 对象
 * 判断有效 document：必须包含 .body 属性
 */
async captureSnapshot(_pageContext?: unknown): Promise<UINode[]> {
  try {
    const runtime = this.getRuntime();
    if (!runtime) return [];

    const doc = this.getTaroDocument(runtime);
    if (!doc) return [];

    const root = this.findCurrentPageRoot(doc);
    if (!root) return [];

    const nodes: UINode[] = [];
    this.walkVDOM(root, nodes, 0, 500);
    return nodes;
  } catch {
    return [];
  }
}

private getTaroDocument(runtime: any): any | null {
  const candidates = [runtime.document, runtime.env?.document];
  for (const doc of candidates) {
    if (doc && doc.body) return doc;
  }
  return null;
}

/**
 * 在 VDOM 树中定位当前页面的根节点。
 *
 * 真实结构：document → html → body → container → app → [pageRoot, pageRoot, ...]
 * 先找到 app 节点，再在其直接子节点里选当前页（路由匹配或取最后一个）
 */
private findCurrentPageRoot(doc: any): any { /* ... */ }

private readonly SNAPSHOT_TAGS = new Set([
  'view', 'text', 'image', 'button', 'input', 'textarea',
  'scroll-view', 'swiper', 'navigator', 'icon', 'video',
  'canvas', 'map', 'picker', 'slider', 'switch', 'radio',
  'checkbox', 'label', 'form',
]);

/**
 * 递归遍历 Taro VDOM 树，收集可见 UI 节点。
 *
 * 兼容性：
 *   - uid: Taro 3.0 前缀 `_n_`，3.3+ 前缀 `_`
 *   - sid: Taro 3.3+ 新增
 *   - dataset: Taro 3.0 默认为 EMPTY_OBJ
 */
private walkVDOM(node: any, result: UINode[], depth: number, maxNodes: number): void {
  if (!node || result.length >= maxNodes) return;

  const tag = node.nodeName?.toLowerCase?.();

  if (tag && this.SNAPSHOT_TAGS.has(tag) && (node.uid || node.sid)) {
    const textContent = this.getVDOMText(node);
    const ds = node.dataset;
    const hasDataset = ds && typeof ds === 'object' && Object.keys(ds).length > 0;
    const inlineStyle = this.extractInlineStyle(node);
    result.push({
      id: node.uid || node.sid || undefined,
      tag,
      rect: { x: 0, y: 0, w: 0, h: 0 },  // VDOM 无真实坐标
      text: textContent?.slice(0, 50) || undefined,
      className: node.props?.class || node.className || undefined,
      dataset: hasDataset ? ds : undefined,
      src: node.props?.src || undefined,
      visible: true,
      style: inlineStyle,
    });
  }

  if (depth > 20) return;

  const children = node.childNodes || node.children;
  if (children?.length) {
    for (let i = 0; i < children.length && result.length < maxNodes; i++) {
      this.walkVDOM(children[i], result, depth + 1, maxNodes);
    }
  }
}

/**
 * 从 TaroElement.props.style 提取内联样式。
 * camelCase → kebab-case，数值自动追加 'px'（unitless 属性除外）
 */
private extractInlineStyle(node: any): Record<string, string | number> | undefined {
  try {
    const raw = node.props?.style;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

    const UNITLESS = new Set([
      'opacity', 'zIndex', 'z-index', 'flex', 'flexGrow', 'flex-grow',
      'flexShrink', 'flex-shrink', 'fontWeight', 'font-weight',
      'lineHeight', 'line-height', 'order', 'orphans', 'widows',
      'columnCount', 'column-count', 'fillOpacity', 'fill-opacity',
      'strokeOpacity', 'stroke-opacity',
    ]);

    const result: Record<string, string | number> = {};
    let count = 0;
    for (const key of Object.keys(raw)) {
      if (count >= 30) break;
      const val = raw[key];
      if (val == null || val === '') continue;
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      if (typeof val === 'number') {
        result[cssKey] = UNITLESS.has(cssKey) || UNITLESS.has(key) ? val : `${val}px`;
      } else if (typeof val === 'string') {
        result[cssKey] = val;
      }
      count++;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}
```

**关键限制**：Taro VDOM 无法获取真实布局坐标，所有节点的 `rect` 都是 `{0,0,0,0}`，回放时只能用启发式 CSS 推断布局。

### 4.3 WeChat 适配器快照采集

**文件**: `src/platform/miniapp/wechat.ts`

WeChat 原生环境通过 `SelectorQuery` 采集，可获取真实坐标。

```typescript
// WechatAdapter 中的快照相关方法

async captureSnapshot(pageContext?: any): Promise<UINode[]> {
  const ctx = pageContext || this.getPageInstance();

  return new Promise((resolve) => {
    try {
      const query = wx.createSelectorQuery();
      if (ctx) query.in(ctx);

      const selectors = ['view', 'text', 'image', 'button', 'input', 'textarea',
                         'scroll-view', 'swiper', 'navigator'] as const;
      const STYLE_PROPS = [
        'backgroundColor', 'color', 'fontSize', 'fontWeight',
        'borderRadius', 'borderColor', 'borderWidth',
        'padding', 'margin', 'opacity', 'display',
        'flexDirection', 'justifyContent', 'alignItems',
      ];
      let pending = selectors.length;
      const allNodes: UINode[] = [];

      // 每个标签单独查询，确保 tag 正确
      for (const tagName of selectors) {
        const q = wx.createSelectorQuery();
        if (ctx) q.in(ctx);
        q.selectAll(tagName)
          .fields({
            id: true,
            dataset: true,
            rect: true,
            size: true,
            node: false,
            properties: ['src', 'className'],
            computedStyle: STYLE_PROPS,
          })
          .exec((results: any[]) => {
            if (results?.[0]) {
              for (const item of results[0]) {
                if (item && item.width > 0 && item.height > 0) {
                  const style = this.extractComputedStyle(item, STYLE_PROPS);
                  allNodes.push({
                    id: item.id || undefined,
                    tag: tagName,
                    rect: {
                      x: item.left || 0,
                      y: item.top || 0,
                      w: item.width || 0,
                      h: item.height || 0,
                    },
                    dataset: item.dataset || undefined,
                    className: item.className || undefined,
                    src: item.src || undefined,
                    visible: true,
                    style,
                  });
                }
              }
            }
            pending--;
            if (pending === 0) {
              allNodes.sort((a, b) => {
                if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y;
                return a.rect.x - b.rect.x;
              });
              resolve(allNodes);
            }
          });
      }
    } catch {
      resolve([]);
    }
  });
}

private extractComputedStyle(
  item: any,
  props: string[],
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  let count = 0;
  const SKIP_VALUES = new Set([
    '', 'auto', 'none', 'normal', 'transparent',
    'rgba(0, 0, 0, 0)', 'rgb(0, 0, 0)',
    '0px', '0px 0px 0px 0px',
  ]);

  for (const prop of props) {
    const val = item[prop];
    if (typeof val !== 'string' || !val || SKIP_VALUES.has(val)) continue;
    const cssKey = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
    result[cssKey] = val;
    count++;
    if (count >= 20) break;
  }
  return count > 0 ? result : undefined;
}

/**
 * 截取当前页面截图（canvas → tempFile → base64）
 */
async captureScreenshot(): Promise<string | null> {
  try {
    if (!wx.canvasToTempFilePath) return null;
    const page = this.getPageInstance();
    if (!page) return null;

    return new Promise((resolve) => {
      try {
        wx.createSelectorQuery()
          .in(page)
          .select('.page')
          .fields({ node: true, size: true })
          .exec((res: any[]) => {
            if (!res?.[0]?.node) {
              resolve(null);
              return;
            }
            const canvas = res[0].node;
            wx.canvasToTempFilePath({
              canvas,
              fileType: 'jpg',
              quality: 0.6,
              success: (tmpRes: any) => {
                try {
                  const fs = wx.getFileSystemManager();
                  const base64 = fs.readFileSync(tmpRes.tempFilePath, 'base64');
                  resolve(`data:image/jpeg;base64,${base64}`);
                } catch {
                  resolve(null);
                }
              },
              fail: () => resolve(null),
            });
          });
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}
```

**关键设计决策**：
- 每个标签类型单独 `selectAll`，避免统一查询时丢失标签语义
- `computedStyle` 只采集视觉相关属性（14 个），减少数据量
- 截图使用 `canvasToTempFilePath` → `readFileSync(base64)`，quality=0.6

---

## 5. 回放端实现

### 5.1 SnapshotViewer

**文件**: `src/replay/SnapshotViewer.ts`

纯函数实现，不依赖 React/Vue。

**导出 API**:
- `renderSnapshotToHTML(nodes, options)` — 自动检测渲染模式（绝对定位 vs 流式布局）
- `renderSnapshot(snapshot, containerSize, options)` — 渲染完整容器（含截图背景）
- `renderEventOverlay(eventType, x, y, options)` — 事件叠加层（涟漪/箭头）
- `getReplayCSS()` — CSS 动画样式
- `isFlowLayoutSnapshot(snapshot)` — 检测是否为流式布局
- `formatInteractionTargetSummary(target)` — 生成目标摘要文本
- `highlightTargetInSnapshotRoot(root, target)` — DOM 高亮

完整代码见 `src/replay/SnapshotViewer.ts`（403 行），核心包含：

- **TAG_COLORS**: 节点类型对应的默认颜色映射
- **STYLE_WHITELIST**: 安全白名单（防止 CSS 注入）
- **serializeNodeStyle()**: 将 style 对象序列化为 CSS 字符串
- **getFlowStyle()**: 根据 tag + className 启发式推断 CSS（VDOM 模式核心）
- **wrapFlowRow()**: 流式布局每行包装（含 `data-sigillum-id` 用于高亮）
- **renderNodeFlow()**: 流式布局单节点渲染
- **sigillum-target-pulse**: 点击高亮脉冲动画
- **sigillum-target-hit::before**: "👆 点击" 文本标签

### 5.2 HybridPlayer

**文件**: `src/replay/HybridPlayer.tsx`（322 行）

React 组件，结合事件时间轴和 UI 快照。

核心功能：
- 使用 `TimelinePlayer` 驱动事件和快照的时间同步
- `renderSnapshot()` 渲染当前快照为 HTML
- `renderEventOverlay()` 在快照上叠加事件效果
- `highlightTargetInSnapshotRoot()` 在 VDOM 模式下高亮点击目标
- 播放/暂停/跳转/倍速控制
- 事件流列表

### 5.3 TimelinePlayer

**文件**: `src/replay/TimelinePlayer.ts`（220 行）

纯逻辑时间轴播放器，不依赖 DOM。

快照相关功能：
- `snapshots` 数组按时间排序
- `currentSnapshotIndex` 追踪当前快照位置
- `onSnapshot` 回调在 `tick()` 中触发（先快照后事件）
- `getSnapshotAtTime(timeMs)` 获取指定时间点的快照
- `seekTo()` 同时更新事件和快照索引

---

## 6. 数据流管道

**EventRecorder** (`src/core/EventRecorder.ts`):

```typescript
captureSnapshot(snapshot: UISnapshot): void {
  if (this.status !== 'recording') return;

  this.buffer.pushSnapshot(snapshot);
  this.snapshotCount++;

  // 同时作为 TrackEvent 记录（snapshot 数据在 events 和 snapshots 中各存一份）
  this.captureEvent({
    type: 'snapshot',
    timestamp: snapshot.timestamp,
    data: {
      trigger: snapshot.trigger,
      nodes: snapshot.nodes,
      viewport: snapshot.viewport,
      page: snapshot.page,
    },
  });
}
```

**EventBuffer** (`src/core/EventBuffer.ts`):

```typescript
private snapshots: UISnapshot[] = [];

pushSnapshot(snapshot: UISnapshot): void {
  this.snapshots.push(snapshot);
}

getSnapshots(): UISnapshot[] {
  return this.snapshots;
}

getSnapshotCount(): number {
  return this.snapshots.length;
}

getSnapshotsSince(fromIndex: number): UISnapshot[] {
  return this.snapshots.slice(fromIndex);
}
```

**SessionManager** (`src/core/SessionManager.ts`):

```typescript
buildRecordingData(events, snapshots, summary): MiniAppRawRecordingData {
  return {
    sessionId: this.sessionId,
    events: [...events],
    snapshots: [...snapshots],  // 快照独立存储
    startTime: this.startTime,
    endTime: this.endTime || Date.now(),
    duration: (this.endTime || Date.now()) - this.startTime,
    metadata: this.metadata || undefined,
    summary,
  };
}

// uploadChunk 中也包含 snapshots 分段逻辑
// lastChunkSnapshotIndex 追踪分段上传进度
```

---

## 7. 入口文件集成

**`src/miniapp.ts`** (WeChat 原生入口):

```typescript
import { SnapshotCollector } from './snapshot/collector';

// 在 createMiniAppRecorder 中：
let snapshotCollector: SnapshotCollector | null = null;
if (options.snapshot?.enabled !== false) {
  snapshotCollector = new SnapshotCollector(
    adapter,
    (snapshot) => recorder.captureSnapshot(snapshot),
    options.snapshot,
  );
}

// 事件拦截器中联动：
const interceptor = adapter.createEventInterceptor((event: TrackEvent) => {
  recorder.captureEvent(event);
  snapshotCollector?.onEvent(event.type);
});

// 页面进入时也触发：
adapter.onPageShow((page) => {
  // ...
  snapshotCollector?.onEvent('page_enter');
});

// 公开 API：
captureSnapshot() {
  snapshotCollector?.captureNow('manual');
}
```

**`src/miniapp-taro.ts`** (Taro 入口): 同上模式。

---

## 8. 测试用例

### `__tests__/snapshot/collector.test.ts` (10 tests)

- start/stop 应控制采集状态
- onEvent(page_enter) 应在延迟后触发快照
- onEvent(tap) 应立即采集一次并在延迟后再采集一次
- 未配置 trigger 的事件不应触发快照
- enabled=false 时不应触发快照
- interval trigger 应定时采集
- maxNodes 应截断节点列表
- captureNow 应立即触发快照（绕过延迟）
- stop 后不应再触发快照
- 短时间内多次触发应去重（minCaptureGap）

### `__tests__/replay/snapshotViewer.test.ts` (28 tests)

- renderSnapshotToHTML: 空节点、div 生成、标签显示、文本显示、零尺寸跳过、坐标缩放、HTML 转义、长文本截断、子节点渲染、data-id、VDOM 流式布局
- formatInteractionTargetSummary: tagName/id/text 拼接
- highlightTargetInSnapshotRoot: data-sigillum-id 高亮
- renderEventOverlay: tap 涟漪、longpress 涟漪、scroll 箭头、未知类型、坐标缩放、流式布局跳过
- isFlowLayoutSnapshot: VDOM/有效rect/空节点
- getReplayCSS: ripple 动画、高亮样式、脉冲动画
- renderSnapshot: 完整容器、空快照

### `__tests__/replay/hybridPlayer.test.tsx` (7 tests)

- HybridPlayer 渲染和快照交互测试

### `__tests__/replay/timelinePlayer.test.ts` (19 tests)

- 包含 UISnapshot fixtures、onSnapshot、getSnapshotAtTime

### `__tests__/platform/taroAdapter.test.ts` (30 tests)

- 包含 adapter.captureSnapshot() 和 UINode 断言

---

## 9. 废弃理由详述

### 根本问题

小程序环境的 UI 快照永远无法达到浏览器端 `rrweb` 的还原度：

1. **Taro VDOM 无坐标**：只能拿到节点树结构，`rect` 全为 0，回放时只能靠 className 启发式推断布局，效果粗糙
2. **WeChat SelectorQuery 有限**：只能拿到可见节点的 rect + 有限 computedStyle，无法还原完整 CSS
3. **截图方案数据量大**：base64 截图每张几十 KB，对上传和存储都是负担
4. **"在空气上点击"**：由于快照时序和坐标精度问题，点击位置经常与 UI 元素对不上

### 行为链的优势

语义化行为链（ActionChain）直接跳过了 UI 还原，把重点放在"用户做了什么"：

- **零 UI 还原成本**：不需要 `captureSnapshot`、不需要 `SelectorQuery`、不需要 VDOM 遍历
- **信息密度更高**：一行文字 `👆 点击 <button#buy> "立即购买"` 比一个粗糙的 UI 骨架更清晰
- **数据量极小**：只依赖 `events[]`，不需要额外的 `snapshots[]`
- **完整因果链**：点击 → 请求 → 跳转 → 输入，一目了然

---

## 10. 复原指南

如果未来需要重新启用快照系统：

### 步骤 1: 恢复类型定义

在 `src/core/types.ts` 中恢复：
- `UINodeRect`, `UINode`, `UISnapshot` 接口
- `SnapshotEventData` 接口
- `SnapshotConfig` 接口
- `TrackEventType` 中添加 `'snapshot'`
- `MiniAppRecorderOptions` 中添加 `snapshot?: SnapshotConfig`
- `MiniAppRawRecordingData` 中添加 `snapshots: UISnapshot[]`
- `MiniAppRecordingChunk` 中添加 `snapshots: UISnapshot[]`
- `MiniAppRecordingSummary` 中添加 `snapshotCount: number`

### 步骤 2: 恢复平台适配器接口

在 `src/platform/types.ts` 的 `MiniAppPlatformAdapter` 中添加：
- `captureSnapshot(pageContext?: unknown): Promise<UINode[]>`
- `captureScreenshot?(): Promise<string | null>`

### 步骤 3: 恢复采集端

- 恢复 `src/snapshot/collector.ts`（本文档第 4.1 节完整代码）
- 在 Taro 适配器中恢复 `captureSnapshot()` + `walkVDOM()` + `extractInlineStyle()`
- 在 WeChat 适配器中恢复 `captureSnapshot()` + `extractComputedStyle()` + `captureScreenshot()`

### 步骤 4: 恢复数据管道

- `EventBuffer`: 恢复 `snapshots` 数组和相关方法
- `EventRecorder`: 恢复 `captureSnapshot()` 方法和 `snapshotCount`
- `SessionManager`: 恢复 `buildRecordingData` 和 `uploadChunk` 中的 snapshots 参数

### 步骤 5: 恢复回放端

- 恢复 `src/replay/SnapshotViewer.ts`（本文档第 5.1 节）
- 恢复 `src/replay/HybridPlayer.tsx`（本文档第 5.2 节）
- 恢复 `TimelinePlayer` 中的 snapshots 相关逻辑

### 步骤 6: 恢复入口集成

- 在 `miniapp.ts` 和 `miniapp-taro.ts` 中恢复 `SnapshotCollector` 的创建和联动

### 步骤 7: 恢复测试

- 恢复 `__tests__/snapshot/collector.test.ts`
- 恢复 `__tests__/replay/snapshotViewer.test.ts`
- 恢复其他测试中的 snapshot 相关用例

---

> 本文档包含了快照系统的完整实现代码和设计决策。配合 git 历史（v2.0.0-beta.1 之前的提交），可以完整复原整个快照系统。
