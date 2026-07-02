<p align="center">
  <h1 align="center">sigillum-js</h1>
  <p align="center">Web 会话录制。记录用户行为，回放操作，快速定位问题。</p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sigillum-js"><img src="https://img.shields.io/npm/v/sigillum-js.svg?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/sigillum-js"><img src="https://img.shields.io/npm/dm/sigillum-js.svg?style=flat-square" alt="npm downloads"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.0+-blue.svg?style=flat-square" alt="TypeScript"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/sigillum-js.svg?style=flat-square" alt="license"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> | <b>中文</b>
</p>

---

> [!IMPORTANT]
> **v1.6.0 将底层 rrweb 升级到正式版 `2.0.1`**（此前为 `2.0.0-alpha.4`），带来大量上游修复与改进：
> - 修复 `blockSelector` 在 Text 节点变更时崩溃的问题——**`blockSelector` 现在可以放心使用**（此前的临时补丁已移除）。
> - 修复全量快照阶段 `maskInputFn` 被忽略的隐私泄露问题。
> - 更小的体积（移除冗余 mutation 数据、移除内联 worker），以及更稳健的音视频回放。
>
> **你需要注意：**
> - sigillum-js 对外 API 未变——大多数用户升级只需 `npm update`，平滑无感。
> - 如果你使用 rrweb **插件**，注意 rrweb 2.0 已将插件拆分为独立包。例如 console 插件从 `rrweb` 迁移到了 `@rrweb/rrweb-plugin-console-record`，请单独安装并更新导入路径。
> - 升级后请在真实浏览器中冒烟测试一遍 **录制 → 上传 → 回放**。

## 它做什么

录制完整的用户会话，让你可以回放用户的每一步操作。数据自管理。

## 安装

```bash
npm install sigillum-js
```

<details>
<summary>yarn / pnpm</summary>

```bash
yarn add sigillum-js
# or
pnpm add sigillum-js
```
</details>

## 快速开始

```typescript
import { getRecorder } from 'sigillum-js';

const recorder = getRecorder({
  onUpload: async (data) => {
    await fetch('/api/recordings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return { success: true };
  },
});

recorder.start();

// 之后 — 停止并上传
await recorder.stop();
```

就这样。录制器自动捕获所有用户操作 —— 鼠标移动、滚动、输入和路由跳转。调用 `stop()` 后，数据通过你的 `onUpload` 回调上传。

### 纯本地模式（不上传）

适用于用户手动导出录制数据的调试场景：

```typescript
const recorder = getRecorder({ debug: true });

recorder.start();
// ... 用户复现 bug ...
await recorder.stop();

const data = recorder.exportRecording();
downloadAsJson(data); // 你的下载工具函数
```

## 框架集成

| 框架 | 导入路径 | 主要导出 |
|------|----------|----------|
| **原生 JS** | `sigillum-js` | `getRecorder()`, `resetRecorder()`, `isRecorderInitialized()` |
| **React** 16.8+ | `sigillum-js/react` | `useSessionRecorder()`, `useAutoRecord()` |
| **Vue** 3+ | `sigillum-js/vue` | `createSigillumPlugin()`, `useSessionRecorder()`, `useAutoRecord()` |

<details>
<summary><b>React 示例</b></summary>

```tsx
import { useAutoRecord } from 'sigillum-js/react';

function App() {
  const { status, sessionId, addTag, identify } = useAutoRecord({
    onUpload: async (data) => {
      await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
      return { success: true };
    },
  });

  identify('user-123', { plan: 'pro' });

  return <div>状态: {status}</div>;
}
```
</details>

<details>
<summary><b>Vue 3 示例</b></summary>

```ts
// main.ts
import { createApp } from 'vue';
import { createSigillumPlugin } from 'sigillum-js/vue';

const app = createApp(App);
app.use(createSigillumPlugin({
  onUpload: async (data) => {
    await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
    return { success: true };
  },
  autoStart: true,
}));
app.mount('#app');
```

```vue
<script setup>
import { inject, onUnmounted, ref } from 'vue';
import { useAutoRecord } from 'sigillum-js/vue';

const { status, sessionId, addTag } = useAutoRecord(inject, onUnmounted, { ref });
</script>

<template>
  <div>状态: {{ status.value }}</div>
</template>
```
</details>

## 回放 UI

内置 React 回放组件：

```tsx
import { ReplayPlayer, ReplayPage } from 'sigillum-js/ui';

<ReplayPlayer data={recordingData} />

// 完整页面（含会话信息）
<ReplayPage data={recordingData} showInfo={true} />
```

> **无需引入任何 CSS。** 播放器直接驱动 **rrweb 核心 `Replayer`**（自带轻量控制条：播放/暂停、可拖拽进度、时间、倍速），并自动注入回放所需的少量样式。你无需安装 `rrweb-player`，也无需 import 任何 `*.css`。
>
> 为什么不用 `rrweb-player`？它发布的 `2.0.0`/`2.0.1` 产物存在缺陷（Replayer 从未实例化 → 回放白屏，见 [rrweb-io/rrweb#1872](https://github.com/rrweb-io/rrweb/issues/1872)），因此 sigillum-js 已不再依赖它。

<details>
<summary><b>回放配置</b></summary>

通过 `config` 定制回放行为。常用的 rrweb Replayer 选项已作为一级字段提供；其他选项可通过 `replayerConfig` 透传。

```tsx
<ReplayPlayer
  data={recordingData}
  config={{
    speed: 2,
    autoPlay: true,
    showController: true,
    skipInactive: true,

    // rrweb Replayer 选项
    UNSAFE_replayCanvas: true,   // 录制时启用了 recordCanvas 则需要开启
    mouseTail: false,            // 隐藏鼠标轨迹
    pauseAnimation: true,        // 暂停时冻结 CSS 动画
    useVirtualDom: false,
    liveMode: false,
    triggerFocus: true,
    insertStyleRules: ['body { background: #fff; }'],
    unpackFn: (e) => e,          // 与录制端的 packFn 配对使用

    // 透传其他未列出的 rrweb Replayer 原生选项
    replayerConfig: {
      // 例如 blockClass、loadTimeout、showWarning 等
    },
  }}
/>
```

> **注意**：`events` 与回放挂载点（`root`）由组件内部管理，不可通过 `config` 或 `replayerConfig` 覆盖。播放器会自动等比缩放回放画面以适配容器，因此无需设置固定 `width`/`height`，只要给外层容器设定尺寸即可。

</details>

## API 参考

```typescript
const recorder = getRecorder(options);

// 生命周期
recorder.start();
await recorder.stop();
recorder.pause();
recorder.resume();

// 数据
recorder.exportRecording();     // 停止后导出（事件 + 元数据 + 行为摘要）
recorder.clearRecording();      // 释放内存

// 标记 & 用户身份
recorder.addTag(name, data);
recorder.identify(userId, traits?);

// 状态
recorder.getStatus();           // 'idle' | 'recording' | 'paused' | 'stopped'
recorder.getSessionId();
recorder.getEventCount();
recorder.getEstimatedSize();
recorder.getSummary();          // { clickCount, inputCount, scrollCount, routeChanges, ... }

// 销毁
recorder.destroy();
resetRecorder();
```

<details>
<summary><b>配置选项</b></summary>

```typescript
const recorder = getRecorder({
  // 上传（可选 — 不提供则为纯本地模式）
  onUpload: async (data) => { return { success: true }; },

  // 字段映射（适配后端数据结构）
  fieldMapping: [['sessionId', 'id'], ['events', 'content', JSON.stringify, JSON.parse]],
  beforeUpload: (data) => ({ ...data, userId: getCurrentUserId() }),

  // 启用条件
  enabled: () => user.isVIP || Math.random() < 0.1,

  // 防崩溃缓存
  cache: { enabled: true, saveInterval: 5000, maxItems: 10, maxAge: 604800000 },

  // 分段上传（长录制场景）
  chunkedUpload: {
    enabled: true,
    interval: 60000,
    // 每个分段上传成功后，从内存中裁剪已上传事件（默认 true）。
    // 长时间连续录制时把内存 events 稳定控制在「一个分段窗口」量级，
    // 避免单调增长（对移动端 WebView / iOS jetsam 尤其重要）。
    // 只裁剪「已确认写入崩溃恢复缓存」的事件，因此不影响崩溃恢复。
    // 若你依赖录制过程中 exportRecording() 返回完整事件流，可设为 false。
    trimEventsAfterUpload: true,
  },
  onChunkUpload: async (chunk) => { return { success: true }; },

  // 回调
  onEventEmit: (event, count) => {},
  onError: (error) => {},
  onStatusChange: (status, prev) => {},

  // 限制
  // 注意：开启 chunkedUpload + trimEventsAfterUpload 后，maxEvents 约束的是
  // 内存窗口大小（内存兜底），而非整段会话事件总数；请用 maxDuration 控制会话时长。
  maxEvents: 50000,
  maxDuration: 1800000,  // 30 分钟
  maxRetries: 3,

  // 隐私（遮盖输入、屏蔽元素等）
  rrwebConfig: {
    privacy: {
      blockClass: 'rr-block',
      blockSelector: '.sensitive', // rrweb 2.0.1 已修复（sigillum-js >= 1.6.0）
      ignoreClass: 'rr-ignore',
      ignoreSelector: '[data-ignore]', // ignoreClass 的选择器版（rrweb 2.0+）
      maskAllInputs: true,
    },
    slimDOMOptions: 'all',
    dataURLOptions: { type: 'image/webp', quality: 0.6 }, // 更小的 canvas 快照（rrweb 2.0+）
    recordAfter: 'load',          // 在指定生命周期事件后再开始录制（rrweb 2.0+）
    // errorHandler 默认已自动安装：rrweb 内部错误会转发到 onError。
    // 如需覆盖：
    // errorHandler: (err) => { report(err); return true; },
  },

  // 其他
  uploadOnUnload: true,          // pagehide 时尝试上传/缓存（推荐保持开启）
  saveOnVisibilityHidden: false, // 切后台时自动写缓存（移动端 WebView 建议开启）
  beaconUrl: '/api/beacon',
  debug: false,
});
```
</details>

## 页面生命周期与数据安全

sigillum-js 使用现代浏览器生命周期事件来保护录制数据：

| 事件 | 配置项 | 默认值 | 行为 |
|------|--------|--------|------|
| `pagehide` | `uploadOnUnload` | `true` | 页面即将卸载（导航离开、关闭标签页）。如配置了 `beaconUrl` 则尝试 `sendBeacon`，否则写入 IndexedDB 缓存。**比 `beforeunload` 在移动端 WebView 更可靠，且不阻止 bfcache。** |
| `visibilitychange` → hidden | `saveOnVisibilityHidden` | `false` | 页面切到后台（切标签页、按 Home 键、App 最小化）。立即将当前未上传事件写入 IndexedDB 缓存。 |

### 为什么用 `pagehide` 而不是 `beforeunload`？

- 移动端 WebView（iOS/Android）用户划走或系统杀进程时，**往往不触发** `beforeunload`。
- `beforeunload` 会**阻止 bfcache**（前进后退缓存），导致用户无法秒回页面。
- `pagehide` 在所有现代浏览器和移动端 WebView 中都能可靠触发，且兼容 bfcache。

### 何时启用 `saveOnVisibilityHidden`

如果你的用户主要在**移动端 WebView** 或**频繁切换标签页**的场景下使用，建议开启此选项。它能大幅降低系统后台杀页面时丢失录制数据的风险：

```typescript
const recorder = getRecorder({
  uploadOnUnload: true,
  saveOnVisibilityHidden: true, // 移动端 WebView 应用推荐开启
  beaconUrl: '/api/beacon',
});
```

> **注意**：`saveOnVisibilityHidden` 仅写入本地 IndexedDB，**不会触发网络请求**，性能开销极小。

## 上传配置指南

1.x 版本有 **两个独立的上传回调**，各自承担不同职责：

| 回调 | 触发时机 | 数据格式 | 字段映射 |
|------|----------|----------|----------|
| `onUpload` | 调用 `stop()` 时 | `Record<string, any>`（经 `FieldMapper` 转换） | `fieldMapping` + `beforeUpload` 生效 |
| `onChunkUpload` | 录制中定时触发 | `RecordingChunk`（原始格式） | **不经过** `fieldMapping` 转换 |

两个回调 **互不相通** —— `onUpload` 不会收到分段数据，`onChunkUpload` 不会经过 `fieldMapping` 转换。

### 推荐使用模式

<details>
<summary><b>模式 A：停止后一次性上传（简单场景）</b></summary>

适合短时间录制。`stop()` 时一次性上传全部数据。

```typescript
const recorder = getRecorder({
  onUpload: async (data) => {
    await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
    return { success: true };
  },
  fieldMapping: [['sessionId', 'id'], ['events', 'content', JSON.stringify, JSON.parse]],
});
```
</details>

<details>
<summary><b>模式 B：录制中分段上传（长录制场景）</b></summary>

适合可能持续数分钟的录制。录制过程中按间隔分段上传数据。

```typescript
const recorder = getRecorder({
  chunkedUpload: { enabled: true, interval: 60000 },
  onChunkUpload: async (chunk) => {
    await fetch('/api/recording-chunks', { method: 'POST', body: JSON.stringify(chunk) });
    return { success: true };
  },
});
```

> 注意：`fieldMapping` 对 `onChunkUpload` **不生效**。如需转换 `RecordingChunk` 数据格式，请自行处理。
</details>

<details>
<summary><b>模式 C：分段 + 停止兜底（最安全）</b></summary>

同时使用两者 —— 录制中分段上传，停止时再做一次完整上传作为兜底。后端需要能处理两种数据格式。

```typescript
const recorder = getRecorder({
  chunkedUpload: { enabled: true, interval: 60000 },
  onChunkUpload: async (chunk) => {
    await fetch('/api/recording-chunks', { method: 'POST', body: JSON.stringify(chunk) });
    return { success: true };
  },
  onUpload: async (data) => {
    await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
    return { success: true };
  },
  fieldMapping: [['sessionId', 'id']],
});
```
</details>

### 常见错误

| 错误配置 | 问题 |
|----------|------|
| 配了 `onUpload` + `chunkedUpload.enabled: true` 但没配 `onChunkUpload` | 分段数据无处可去，只有最终的 `onUpload` 会触发 |
| 配了 `onChunkUpload` 但 `chunkedUpload.enabled` 为 `false`/未设置 | `onChunkUpload` 永远不会被调用 |
| 期望 `fieldMapping` 对 `onChunkUpload` 生效 | `fieldMapping` 仅对 `onUpload` 生效 |

> **想要更简洁的 API？** 2.0 版本（beta）已将 `onUpload` 和 `onChunkUpload` 统一为单一的 `onUpload` 回调。可通过 `npm install sigillum-js@beta` 试用。

## 兼容性

| 浏览器 | 版本 |
|--------|------|
| Chrome | 64+ |
| Firefox | 69+ |
| Safari | 12+ |
| Edge | 79+（Chromium） |
| iOS Safari | 12+ |
| IE | 不支持 |

| 框架 | 版本 | 导入路径 |
|------|------|----------|
| **React** | 16.8+ | `sigillum-js/react` |
| **Vue** | 3.0+ | `sigillum-js/vue` |
| **Next.js** | 12+ | 通过 React 集成 |
| **Nuxt** | 3+ | 通过 Vue 集成 |

## 路线图

由 rrweb 2.0 升级带来、计划在后续版本落地的方向：

- **图片/字体资源捕获（Asset capture）。** rrweb 2.0 将 `inlineImages` / `inlineStylesheet` 标记为 deprecated，转向独立的资源捕获管线（独立的 `Asset` 事件类型）。跟进后可在保持回放保真的同时，把大体积二进制资源从主事件流中拆出，**显著减小分段上传体积**。
- **内置压缩（`@rrweb/packer`）。** rrweb 的 pack/unpack 已拆为独立包。目前已可通过 `rrwebConfig.packFn`（录制）+ `ReplayPlayer` 的 `unpackFn`（回放）接入；后续计划补充推荐用法文档，并考虑提供一等开关。

## 推荐搭配

如果你还需要 **错误追踪、日志管理和性能监控**，可以看看 [**aemeath-js**](https://github.com/TieriaSail/aemeath-js) —— 轻量级、插件化的前端日志 & 监控 SDK。

**sigillum-js**（会话录制）+ **aemeath-js**（日志 & 监控）= 完整的前端可观测性方案，所有数据都在你自己的服务器上。

## 反馈

欢迎提交 Issue 和功能建议！请到 [Issues](https://github.com/TieriaSail/sigillum-js/issues) 页面反馈。

## 许可证

[MIT](./LICENSE) © TieriaSail

---

> 本项目使用 AI 辅助开发。
