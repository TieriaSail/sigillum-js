<p align="center">
  <h1 align="center">sigillum-js</h1>
  <p align="center">基于 rrweb 的轻量级用户会话录制库，用于线上问题复现和调试。</p>
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

## 特性

- **🎥 完整录制** — 录制所有用户操作（点击、滚动、输入等）
- **🎮 手动控制** — start / stop / pause / resume / takeFullSnapshot
- **📊 行为摘要** — 自动生成统计（点击、输入、滚动、路由跳转、访问页面）—— 不看回放就能了解用户行为
- **🧭 SPA 路由追踪** — 自动检测 `pushState` / `replaceState` / `popstate`，自动标记时间线
- **🧬 会话元数据** — 自动采集页面标题、referrer、语言、时区、网络类型、设备信息
- **📤 分段上传** — 可配置的定时分段上传，适用于长时间录制场景
- **🔒 隐私保护** — 多层级：blockClass、blockSelector、maskText、maskInput（16 种类型）、自定义遮盖函数
- **📦 体积优化** — slimDOMOptions（减小 20-40%）+ packFn 压缩（减小 60-80%）
- **🔌 插件系统** — 完整透传 rrweb 插件（console、sequential-id、canvas-webrtc、自定义）
- **📡 事件回调** — onEventEmit、onError、onStatusChange 实时监控
- **🔄 字段映射** — 自定义后端数据结构，支持双向转换
- **⚡ 条件启用** — 基于函数的控制，灵活决定录制条件
- **💾 防崩溃** — IndexedDB 缓存，页面崩溃后恢复数据
- **🛡️ 兼容性检查** — 不兼容时静默处理，不影响业务逻辑
- **♻️ 单例模式** — 避免 React 多实例问题
- **🌐 框架支持** — 核心与框架无关；提供 React Hooks + Vue 3 Plugin 集成
- **🖥️ 内置 UI** — 开箱即用的回放组件（React）
- **🖼️ iframe 支持** — 录制跨域 iframe 内容

## 安装

```bash
npm install sigillum-js rrweb
# rrweb 是必需的 peer 依赖
```

<details>
<summary>可选的 peer 依赖</summary>

```bash
# React hooks 支持
npm install react

# Vue 3 插件支持
npm install vue

# 回放 UI 组件
npm install rrweb-player
```
</details>

## 快速开始

### 基础使用

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

// 开始录制
recorder.start();

// 停止录制并上传
await recorder.stop();
```

### 字段映射（适配后端）

```typescript
const recorder = getRecorder({
  // 字段映射：[原始字段, 后端字段, toServer转换, fromServer转换]
  fieldMapping: [
    ['sessionId', 'id'],
    ['events', 'content', JSON.stringify, JSON.parse],
    ['startTime', 'start_at'],
    ['duration', 'duration_ms'],
  ],
  // 上传前添加额外字段
  beforeUpload: (data) => ({
    ...data,
    userId: getCurrentUserId(),
    deviceInfo: getDeviceInfo(),
  }),
  onUpload: async (data) => {
    // data 已经是后端结构
    await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
    return { success: true };
  },
});
```

### 条件启用

```typescript
const recorder = getRecorder({
  // 只录制 VIP 用户，或 10% 的普通用户
  enabled: () => user.isVIP || Math.random() < 0.1,
  onUpload: async (data) => { /* ... */ },
});
```

## 框架集成

| 框架 | 导入路径 | 主要导出 |
|------|----------|----------|
| **原生 JS** | `sigillum-js` | `getRecorder()`, `resetRecorder()` |
| **React** 16.8+ | `sigillum-js/react` | `useSessionRecorder()`, `useAutoRecord()` |
| **Vue** 3+ | `sigillum-js/vue` | `createSigillumPlugin()`, `useSessionRecorder()`, `useAutoRecord()` |

<details>
<summary><b>React 示例</b></summary>

```tsx
import { useSessionRecorder, useAutoRecord } from 'sigillum-js/react';

// 方式一：手动控制
function MyPage() {
  const { start, stop, addTag, getSessionId } = useSessionRecorder({
    onUpload: async (data) => { /* ... */ },
  });

  useEffect(() => {
    start();
    return () => stop();
  }, []);

  return <div>录制中...</div>;
}

// 方式二：自动录制（组件挂载时开始，卸载时停止）
function AutoRecordPage() {
  const { sessionId, addTag } = useAutoRecord({
    onUpload: async (data) => { /* ... */ },
  });

  return <div>SessionId: {sessionId}</div>;
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
  autoStart: true, // 默认 true，自动开始录制
  fieldMapping: [
    ['sessionId', 'id'],
    ['events', 'content', JSON.stringify, JSON.parse],
  ],
}));
app.mount('#app');
```

```vue
<script setup>
import { inject, onUnmounted } from 'vue';
import { useSessionRecorder, useAutoRecord } from 'sigillum-js/vue';

// 手动获取 recorder
const recorder = useSessionRecorder(inject);
recorder?.addTag('page-view', { route: '/home' });

// 或自动录制
const { status, sessionId, addTag } = useAutoRecord(inject, onUnmounted);
addTag('user-action', { action: 'click-buy' });
</script>
```
</details>

<details>
<summary><b>原生 JS / jQuery 示例</b></summary>

```javascript
import { getRecorder, resetRecorder } from 'sigillum-js';

const recorder = getRecorder({
  onUpload: async (data) => {
    await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
    return { success: true };
  },
});

recorder.start();

document.getElementById('buyBtn').addEventListener('click', () => {
  recorder.addTag('click-buy', { productId: '123' });
});
```
</details>

## 回放 UI

```tsx
// 需要手动引入 rrweb-player 样式
import 'rrweb-player/dist/style.css';
import { ReplayPlayer, ReplayPage } from 'sigillum-js/ui';

// 简单播放器
<ReplayPlayer
  data={serverData}
  fieldMapping={[
    ['sessionId', 'id'],
    ['events', 'content', JSON.stringify, JSON.parse],
  ]}
/>

// 完整页面（包含会话信息）
<ReplayPage data={serverData} fieldMapping={[...]} showInfo={true} />
```

## API 参考

### SessionRecorder

```typescript
const recorder = getRecorder(options);

// 生命周期
recorder.start();              // 开始录制
await recorder.stop();         // 停止录制并上传
recorder.pause();              // 暂停录制（不上传）
recorder.resume();             // 恢复录制

// Session 管理
recorder.getSessionId();       // 获取当前 sessionId
recorder.setSessionId(id);     // 设置 sessionId（关联外部系统）

// 标记
recorder.addTag(name, data);   // 添加标记（使用 rrweb 原生 addCustomEvent）

// 快照
recorder.takeFullSnapshot();   // 手动触发全量 DOM 快照

// 状态 & 洞察
recorder.getStatus();          // 'idle' | 'recording' | 'paused' | 'stopped'
recorder.getEventCount();      // 当前事件数量
recorder.getMetadata();        // 自动采集的会话元数据
recorder.getSummary();         // 实时行为摘要
recorder.getRouteChanges();    // SPA 路由变化历史

// 销毁
recorder.destroy();
resetRecorder();               // 重置单例
```

### 配置选项

```typescript
interface SessionRecorderOptions {
  // ========== 必填 ==========
  onUpload: (data: Record<string, any>) => Promise<{ success: boolean }>;

  // ========== 字段映射 ==========
  fieldMapping?: FieldMapping[];
  beforeUpload?: (data: Record<string, any>) => Record<string, any>;

  // ========== 启用条件 ==========
  enabled?: boolean | (() => boolean);  // 默认: true

  // ========== 缓存配置（防崩溃）==========
  cache?: {
    enabled?: boolean;      // 默认: true
    saveInterval?: number;  // 默认: 5000ms
    maxItems?: number;      // 默认: 10
  };

  // ========== 兼容性 ==========
  onUnsupported?: (reason: string) => void;

  // ========== 事件回调 ==========
  onEventEmit?: (event, eventCount) => void;      // 实时监控每个录制事件
  onError?: (error: Error) => void;                // 捕获录制/上传错误
  onStatusChange?: (status, prevStatus) => void;   // 响应录制状态变化

  // ========== 分段上传（长录制场景）==========
  chunkedUpload?: {
    enabled?: boolean;     // 默认: false
    interval?: number;     // 默认: 60000 (1分钟)
  };
  onChunkUpload?: (chunk: RecordingChunk) => Promise<UploadResult>;

  // ========== rrweb 配置（详见下方）==========
  rrwebConfig?: RrwebConfig;

  // ========== 其他 ==========
  maxDuration?: number;     // 默认: 1800000 (30分钟)
  maxRetries?: number;      // 默认: 3
  uploadOnUnload?: boolean; // 默认: true
  debug?: boolean;          // 默认: false
}
```

### rrweb 配置

```typescript
interface RrwebConfig {
  // 采样
  recordMouseMove?: boolean;          // 默认: true
  mouseMoveInterval?: number;         // 默认: 50ms
  recordScroll?: boolean;             // 默认: true
  scrollInterval?: number;            // 默认: 150ms
  recordInput?: boolean;              // 默认: true
  recordMedia?: boolean;              // 默认: true
  recordCanvas?: boolean;             // 默认: false
  canvasFPS?: number;                 // 默认: 0

  // 快照
  checkoutEveryNms?: number;          // 默认: 300000 (5分钟)
  checkoutEveryNth?: number;          // 每 N 个事件做全量快照

  // 隐私保护（详见下方）
  privacy?: PrivacyConfig;

  // DOM 精简（减小录制体积 20-40%）
  slimDOMOptions?: SlimDOMConfig | 'all' | true;

  // 资源内联
  inlineStylesheet?: boolean;         // 默认: true
  inlineImages?: boolean;             // 默认: false
  collectFonts?: boolean;             // 默认: false

  // iframe 支持
  recordCrossOriginIframes?: boolean; // 默认: false

  // 数据压缩（减小传输体积 60-80%）
  packFn?: (event) => unknown;        // 例如 pako.deflate

  // rrweb 插件透传
  plugins?: RrwebRecordPlugin[];

  // 其他
  userTriggeredOnInput?: boolean;     // 默认: false
  ignoreCSSAttributes?: Set<string>;
}
```

## 隐私保护

sigillum-js 提供多层级隐私保护，完整透传 rrweb 的隐私选项：

```typescript
const recorder = getRecorder({
  rrwebConfig: {
    privacy: {
      // 完全屏蔽元素（不录制 DOM 变化）
      blockClass: 'private-block',
      blockSelector: '.credit-card-form, [data-private]',

      // 遮盖文本内容（替换为 *）
      maskTextClass: 'mask-text',
      maskTextSelector: '.user-email, .phone-number',
      maskTextFn: (text) => text.replace(/./g, '*'),

      // 遮盖输入（支持 16 种输入类型）
      maskAllInputs: false,
      maskInputOptions: { password: true, email: true, tel: true },
      maskInputFn: (text) => '***',

      // 忽略元素（不录制交互，但录制 DOM）
      ignoreClass: 'rr-ignore',
    },
    // DOM 精简，减小录制体积
    slimDOMOptions: 'all',
  },
  onUpload: async (data) => { /* ... */ },
});
```

```html
<!-- 完全屏蔽（不录制 DOM） -->
<div class="private-block">机密内容</div>

<!-- 文本遮盖（替换为 *） -->
<div class="mask-text">john@example.com</div>

<!-- 忽略交互 -->
<div class="rr-ignore">不录制此区域</div>
```

## 行为摘要 & 分段上传

### 行为摘要

每次录制自动包含行为摘要 —— 不看回放就能了解用户做了什么：

```typescript
const recorder = getRecorder({ onUpload: async (data) => {
  // data.summary 自动包含：
  // {
  //   totalEvents: 342,
  //   clickCount: 28,
  //   inputCount: 12,
  //   scrollCount: 156,
  //   routeChangeCount: 5,
  //   routeChanges: [{ from: '/home', to: '/products', timestamp: ... }, ...],
  //   visitedUrls: ['/home', '/products', '/cart', '/checkout'],
  //   tagCount: 3,
  //   duration: 185000,
  // }
  console.log('用户点击了', data.summary.clickCount, '次');
  console.log('访问页面:', data.summary.visitedUrls);
  return { success: true };
}});

// 录制过程中实时获取
recorder.start();
// ... 一段时间后 ...
const summary = recorder.getSummary();       // 实时行为摘要
const routes = recorder.getRouteChanges();   // 路由变化历史
const metadata = recorder.getMetadata();     // 页面标题、referrer、时区、网络类型等
```

### 分段上传（长录制场景）

对于长时间录制，使用分段上传避免一次性上传大量数据：

```typescript
const recorder = getRecorder({
  chunkedUpload: {
    enabled: true,
    interval: 60000, // 每 60 秒上传一个分段
  },
  onChunkUpload: async (chunk) => {
    // chunk.chunkIndex: 0, 1, 2, ...
    // chunk.isFinal: 最后一个分段为 true
    // chunk.events: 仅包含该分段内的新事件
    // chunk.summary: 累计行为摘要
    // chunk.metadata: 仅在第一个分段中包含（index 0）
    await fetch('/api/recording-chunks', {
      method: 'POST',
      body: JSON.stringify(chunk),
    });
    return { success: true };
  },
  onUpload: async (data) => {
    // stop() 时仍会调用，上传完整录制
    await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
    return { success: true };
  },
});
```

## 常见问题

**Q: 录制会影响性能吗？**
A: rrweb 经过高度优化，正常情况下性能影响很小（< 1% CPU）。可以通过 `enabled` 条件控制、增加采样间隔、关闭 Canvas 录制来进一步优化。

**Q: 录制数据会很大吗？**
A: 取决于页面复杂度：每分钟约 50-200KB，10 分钟约 500KB-2MB。使用 `slimDOMOptions: 'all'` 可减小 20-40%，配合 `packFn` gzip 压缩可减小 60-80%。

**Q: 页面崩溃会丢失数据吗？**
A: 不会。默认启用 IndexedDB 缓存，每 5 秒暂存一次。页面重新打开时会自动恢复并上传。

**Q: 不兼容的浏览器会报错吗？**
A: 不会。不兼容时会静默处理，只是不录制，不影响业务。可以通过 `onUnsupported` 回调记录日志。

## 兼容性

### 浏览器

| 环境 | 最低版本 | 说明 |
|------|---------|------|
| Chrome | 64+ | 完整支持 |
| Firefox | 69+ | 完整支持 |
| Safari | 12+ | 完整支持 |
| Edge | 79+（Chromium） | 完整支持 |
| iOS Safari | 12+ | 完整支持 |
| Android WebView | 64+ | 完整支持 |
| IE | ❌ 不支持 | 缺少 MutationObserver、Proxy |

> 构建目标为 **ES2020**。需要浏览器支持 `MutationObserver`、`Proxy`、`WeakMap`、`requestAnimationFrame`。不兼容的浏览器会静默处理 —— 只是不录制，不影响业务。

### 运行时依赖

| API | 是否必需 | 用途 |
|-----|---------|------|
| `MutationObserver` | ✅ 必需 | DOM 变化录制（rrweb 核心） |
| `Proxy` | ✅ 必需 | rrweb 内部状态追踪 |
| `WeakMap` | ✅ 必需 | rrweb 节点映射 |
| `requestAnimationFrame` | ✅ 必需 | 动画帧录制 |
| `IndexedDB` | 可选 | 崩溃恢复缓存（优雅降级） |
| `History API` | 可选 | SPA 路由追踪（优雅降级） |
| `Navigator.connection` | 可选 | 网络类型元数据（优雅降级） |

### Node.js

| 用途 | 支持 | 说明 |
|------|------|------|
| 核心 / 录制 | ❌ 仅浏览器 | 依赖 `window`、`document`、DOM API |
| 类型导入 | Node 16+ | `import type { ... } from 'sigillum-js'` |

### 框架

| 框架 | 支持版本 | 集成方式 |
|------|---------|----------|
| **React** | 16.8+（Hooks） | `sigillum-js/react` — `useSessionRecorder`、`useAutoRecord` |
| **Vue** | 3.0+ | `sigillum-js/vue` — `createSigillumPlugin`、Composables |
| **Next.js** | 12+ | 通过 React 集成（仅客户端） |
| **Nuxt** | 3+ | 通过 Vue 集成（仅客户端） |
| **原生 JS / jQuery** | 任意 | 核心 API，无需额外导入 |

### Peer 依赖

| 包名 | 版本 | 是否必需 |
|------|------|---------|
| `rrweb` | ≥ 2.0.0-alpha.4 | ✅ 必需 |
| `react` | ≥ 16.8.0 | 可选（React Hooks） |
| `react-dom` | ≥ 16.8.0 | 可选（React Hooks） |
| `vue` | ≥ 3.0.0 | 可选（Vue 插件） |
| `rrweb-player` | ≥ 1.0.0-alpha.4 | 可选（回放 UI） |

### 模块格式

| 格式 | 文件 | 用途 |
|------|------|------|
| **ESM** | `dist/index.js` | `import` — 现代打包工具 |
| **CJS** | `dist/index.cjs` | `require()` — 旧版打包工具 |

## 推荐搭配

如果你还需要 **错误追踪、日志管理和性能监控**，可以看看 [**aemeath-js**](https://github.com/TieriaSail/aemeath-js) —— 轻量级、插件化的前端日志 & 监控 SDK。

**sigillum-js**（会话录制）+ **aemeath-js**（日志 & 监控）= 完整的前端可观测性方案，所有数据都在你自己的服务器上。

## 反馈

欢迎提交 Issue 和功能建议！请到 [Issues](https://github.com/TieriaSail/sigillum-js/issues) 页面反馈。

## 许可证

[MIT](./LICENSE) © SigillumJs Team

