<p align="center">
  <h1 align="center">sigillum-js</h1>
  <p align="center">A lightweight session recording library based on rrweb for user behavior replay and bug reproduction.</p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sigillum-js"><img src="https://img.shields.io/npm/v/sigillum-js.svg?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/sigillum-js"><img src="https://img.shields.io/npm/dm/sigillum-js.svg?style=flat-square" alt="npm downloads"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.0+-blue.svg?style=flat-square" alt="TypeScript"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/sigillum-js.svg?style=flat-square" alt="license"></a>
</p>

<p align="center">
  <b>English</b> | <a href="./README.zh_CN.md">中文</a>
</p>

---

## Features

- **🎥 Full Recording** — Record all user actions (clicks, scrolls, inputs, etc.)
- **🎮 Manual Control** — start / stop / pause / resume / takeFullSnapshot
- **📊 Behavior Summary** — Auto-generated stats (clicks, inputs, scrolls, route changes, visited URLs) — understand user behavior without watching replay
- **🧭 SPA Route Tracking** — Auto-detect `pushState` / `replaceState` / `popstate` with timeline markers
- **🧬 Session Metadata** — Auto-collect title, referrer, language, timezone, connection, device info
- **📤 Chunked Upload** — Configurable interval-based chunked upload for long recordings
- **🔒 Privacy Protection** — Multi-layered: blockClass, blockSelector, maskText, maskInput (16 types), custom mask functions
- **📦 Size Optimization** — slimDOMOptions (reduce 20-40%) + packFn compression (reduce 60-80%)
- **🔌 Plugin System** — Full rrweb plugin passthrough (console, sequential-id, canvas-webrtc, custom)
- **📡 Event Callbacks** — onEventEmit, onError, onStatusChange for real-time monitoring
- **🔄 Field Mapping** — Custom backend data structures with bidirectional conversion
- **⚡ Conditional Enable** — Function-based control for flexible recording conditions
- **💾 Crash Recovery** — IndexedDB caching, recover data after page crashes
- **🛡️ Compatibility Check** — Silent handling when unsupported, no impact on business logic
- **♻️ Singleton Pattern** — Avoid React multi-instance issues
- **🌐 Framework Support** — Core is framework-agnostic; React Hooks + Vue 3 Plugin integrations
- **🖥️ Built-in UI** — Ready-to-use replay components (React)
- **🖼️ iframe Support** — Record cross-origin iframe content

## Installation

```bash
npm install sigillum-js rrweb
# rrweb is a required peer dependency
```

<details>
<summary>Optional peer dependencies</summary>

```bash
# For React hooks
npm install react

# For Vue 3 plugin
npm install vue

# For replay UI components
npm install rrweb-player
```
</details>

## Quick Start

### Basic Usage

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

// Start recording
recorder.start();

// Stop and upload
await recorder.stop();
```

### Field Mapping (Adapt to Backend)

```typescript
const recorder = getRecorder({
  fieldMapping: [
    ['sessionId', 'id'],
    ['events', 'content', JSON.stringify, JSON.parse],
    ['startTime', 'start_at'],
    ['duration', 'duration_ms'],
  ],
  beforeUpload: (data) => ({
    ...data,
    userId: getCurrentUserId(),
    deviceInfo: getDeviceInfo(),
  }),
  onUpload: async (data) => {
    await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
    return { success: true };
  },
});
```

### Conditional Enable

```typescript
const recorder = getRecorder({
  // Only record VIP users, or 10% of regular users
  enabled: () => user.isVIP || Math.random() < 0.1,
  onUpload: async (data) => { /* ... */ },
});
```

## Framework Integrations

| Framework | Import Path | Key Exports |
|-----------|-------------|-------------|
| **Vanilla JS** | `sigillum-js` | `getRecorder()`, `resetRecorder()` |
| **React** 16.8+ | `sigillum-js/react` | `useSessionRecorder()`, `useAutoRecord()` |
| **Vue** 3+ | `sigillum-js/vue` | `createSigillumPlugin()`, `useSessionRecorder()`, `useAutoRecord()` |

<details>
<summary><b>React Example</b></summary>

```tsx
import { useSessionRecorder, useAutoRecord } from 'sigillum-js/react';

// Option 1: Manual control
function MyPage() {
  const { start, stop, addTag, getSessionId } = useSessionRecorder({
    onUpload: async (data) => { /* ... */ },
  });

  useEffect(() => {
    start();
    return () => stop();
  }, []);

  return <div>Recording...</div>;
}

// Option 2: Auto record (start on mount, stop on unmount)
function AutoRecordPage() {
  const { sessionId, addTag } = useAutoRecord({
    onUpload: async (data) => { /* ... */ },
  });

  return <div>SessionId: {sessionId}</div>;
}
```
</details>

<details>
<summary><b>Vue 3 Example</b></summary>

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

// Manual control
const recorder = useSessionRecorder(inject);
recorder?.addTag('page-view', { route: '/home' });

// Or auto record
const { status, sessionId, addTag } = useAutoRecord(inject, onUnmounted);
addTag('user-action', { action: 'click-buy' });
</script>
```
</details>

<details>
<summary><b>Vanilla JS / jQuery Example</b></summary>

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

## Replay UI

```tsx
import 'rrweb-player/dist/style.css';
import { ReplayPlayer, ReplayPage } from 'sigillum-js/ui';

// Simple player
<ReplayPlayer
  data={serverData}
  fieldMapping={[
    ['sessionId', 'id'],
    ['events', 'content', JSON.stringify, JSON.parse],
  ]}
/>

// Full page (with session info)
<ReplayPage data={serverData} fieldMapping={[...]} showInfo={true} />
```

## API Reference

### SessionRecorder

```typescript
const recorder = getRecorder(options);

// Lifecycle
recorder.start();              // Start recording
await recorder.stop();         // Stop and upload
recorder.pause();              // Pause (no upload)
recorder.resume();             // Resume

// Session
recorder.getSessionId();       // Get current sessionId
recorder.setSessionId(id);     // Set sessionId (link to external system)

// Tags
recorder.addTag(name, data);   // Add tag (uses rrweb native addCustomEvent)

// Snapshot
recorder.takeFullSnapshot();   // Manually trigger a full DOM snapshot

// Status & Insights
recorder.getStatus();          // 'idle' | 'recording' | 'paused' | 'stopped'
recorder.getEventCount();      // Current event count
recorder.getMetadata();        // Auto-collected session metadata
recorder.getSummary();         // Real-time behavior summary
recorder.getRouteChanges();    // SPA route change history

// Cleanup
recorder.destroy();
resetRecorder();               // Reset singleton
```

### Configuration

```typescript
interface SessionRecorderOptions {
  // Required
  onUpload: (data: Record<string, any>) => Promise<{ success: boolean }>;

  // Field mapping
  fieldMapping?: FieldMapping[];
  beforeUpload?: (data: Record<string, any>) => Record<string, any>;

  // Enable condition
  enabled?: boolean | (() => boolean);  // default: true

  // Cache (crash recovery)
  cache?: {
    enabled?: boolean;      // default: true
    saveInterval?: number;  // default: 5000ms
    maxItems?: number;      // default: 10
  };

  // Compatibility
  onUnsupported?: (reason: string) => void;

  // Event callbacks
  onEventEmit?: (event, eventCount) => void;        // Monitor events in real-time
  onError?: (error: Error) => void;                  // Capture recording/upload errors
  onStatusChange?: (status, prevStatus) => void;     // React to state changes

  // Chunked upload (for long recordings)
  chunkedUpload?: {
    enabled?: boolean;     // default: false
    interval?: number;     // default: 60000 (1min)
  };
  onChunkUpload?: (chunk: RecordingChunk) => Promise<UploadResult>;

  // rrweb config (see below)
  rrwebConfig?: RrwebConfig;

  // Other
  maxDuration?: number;     // default: 1800000 (30min)
  maxRetries?: number;      // default: 3
  uploadOnUnload?: boolean; // default: true
  debug?: boolean;          // default: false
}
```

### rrweb Config

```typescript
interface RrwebConfig {
  // Sampling
  recordMouseMove?: boolean;          // default: true
  mouseMoveInterval?: number;         // default: 50ms
  recordScroll?: boolean;             // default: true
  scrollInterval?: number;            // default: 150ms
  recordInput?: boolean;              // default: true
  recordMedia?: boolean;              // default: true
  recordCanvas?: boolean;             // default: false
  canvasFPS?: number;                 // default: 0

  // Snapshot
  checkoutEveryNms?: number;          // default: 300000 (5min)
  checkoutEveryNth?: number;          // full snapshot every N events

  // Privacy (see Privacy section below)
  privacy?: PrivacyConfig;

  // DOM slimming (reduce recording size by 20-40%)
  slimDOMOptions?: SlimDOMConfig | 'all' | true;

  // Resource inlining
  inlineStylesheet?: boolean;         // default: true
  inlineImages?: boolean;             // default: false
  collectFonts?: boolean;             // default: false

  // iframe
  recordCrossOriginIframes?: boolean; // default: false

  // Data compression (reduce transfer size by 60-80%)
  packFn?: (event) => unknown;        // e.g. pako.deflate

  // rrweb plugins passthrough
  plugins?: RrwebRecordPlugin[];

  // Other
  userTriggeredOnInput?: boolean;     // default: false
  ignoreCSSAttributes?: Set<string>;
}
```

## Privacy

sigillum-js provides multi-layered privacy protection, fully passing through rrweb's privacy options:

```typescript
const recorder = getRecorder({
  rrwebConfig: {
    privacy: {
      // Block elements entirely (not recorded at all)
      blockClass: 'private-block',
      blockSelector: '.credit-card-form, [data-private]',

      // Mask text content (replaced with *)
      maskTextClass: 'mask-text',
      maskTextSelector: '.user-email, .phone-number',
      maskTextFn: (text) => text.replace(/./g, '*'),

      // Mask inputs (16 types: password, email, tel, text, etc.)
      maskAllInputs: false,
      maskInputOptions: { password: true, email: true, tel: true },
      maskInputFn: (text) => '***',

      // Ignore elements (interactions not recorded, but DOM is)
      ignoreClass: 'rr-ignore',
    },
    // Slim DOM to reduce recording size
    slimDOMOptions: 'all',
  },
  onUpload: async (data) => { /* ... */ },
});
```

```html
<!-- Completely blocked (no DOM recording) -->
<div class="private-block">Secret content</div>

<!-- Text masked (replaced with *) -->
<div class="mask-text">john@example.com</div>

<!-- Interactions ignored -->
<div class="rr-ignore">Private area</div>
```

## Behavior Summary & Chunked Upload

### Behavior Summary

Every recording automatically includes a behavior summary — no need to watch the replay to understand what happened:

```typescript
const recorder = getRecorder({ onUpload: async (data) => {
  // data.summary is auto-included:
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
  console.log('User clicked', data.summary.clickCount, 'times');
  console.log('Visited pages:', data.summary.visitedUrls);
  return { success: true };
}});

// Real-time access during recording
recorder.start();
// ... later ...
const summary = recorder.getSummary();
const routes = recorder.getRouteChanges();
const metadata = recorder.getMetadata(); // title, referrer, timezone, connection, etc.
```

### Chunked Upload (Long Recordings)

For long recording sessions, use chunked upload to avoid a single large upload:

```typescript
const recorder = getRecorder({
  chunkedUpload: {
    enabled: true,
    interval: 60000, // Upload every 60 seconds
  },
  onChunkUpload: async (chunk) => {
    // chunk.chunkIndex: 0, 1, 2, ...
    // chunk.isFinal: true on the last chunk
    // chunk.events: only new events since last chunk
    // chunk.summary: cumulative behavior summary
    // chunk.metadata: only in the first chunk (index 0)
    await fetch('/api/recording-chunks', {
      method: 'POST',
      body: JSON.stringify(chunk),
    });
    return { success: true };
  },
  onUpload: async (data) => {
    // Still called on stop() with the complete recording
    await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
    return { success: true };
  },
});
```

## FAQ

**Q: Does recording affect performance?**
A: rrweb is highly optimized, impact is minimal (< 1% CPU). Optimize further with `enabled` conditions, sampling intervals, and `recordCanvas: false`.

**Q: How large is the recording data?**
A: Depends on page complexity: ~50-200KB per minute, ~500KB-2MB for 10 minutes. Use `slimDOMOptions: 'all'` to reduce 20-40%, and `packFn` with gzip to reduce 60-80%.

**Q: Will data be lost on page crash?**
A: No. IndexedDB caching is enabled by default (saves every 5s). Data auto-recovers on next page load.

**Q: Will unsupported browsers throw errors?**
A: No. Unsupported browsers are silently handled — recording simply doesn't start, with zero impact on your app.

## Compatibility

### Browser

| Environment | Minimum Version | Notes |
|-------------|----------------|-------|
| Chrome | 64+ | Full support |
| Firefox | 69+ | Full support |
| Safari | 12+ | Full support |
| Edge | 79+ (Chromium) | Full support |
| iOS Safari | 12+ | Full support |
| Android WebView | 64+ | Full support |
| IE | ❌ Not supported | Missing MutationObserver, Proxy |

> Build target is **ES2020**. Requires `MutationObserver`, `Proxy`, `WeakMap`, and `requestAnimationFrame`. Unsupported browsers are silently handled — recording simply doesn't start.

### Runtime Requirements

| API | Required | Used For |
|-----|----------|----------|
| `MutationObserver` | ✅ Yes | DOM change recording (rrweb core) |
| `Proxy` | ✅ Yes | rrweb internal state tracking |
| `WeakMap` | ✅ Yes | rrweb node mapping |
| `requestAnimationFrame` | ✅ Yes | Animation frame recording |
| `IndexedDB` | Optional | Crash recovery cache (graceful fallback) |
| `History API` | Optional | SPA route tracking (graceful fallback) |
| `Navigator.connection` | Optional | Network type metadata (graceful fallback) |

### Node.js

| Usage | Support | Notes |
|-------|---------|-------|
| Core / Recording | ❌ Browser only | Requires `window`, `document`, DOM APIs |
| Type imports | Node 16+ | `import type { ... } from 'sigillum-js'` |

### Frameworks

| Framework | Supported Versions | Integration |
|-----------|-------------------|-------------|
| **React** | 16.8+ (Hooks) | `sigillum-js/react` — `useSessionRecorder`, `useAutoRecord` |
| **Vue** | 3.0+ | `sigillum-js/vue` — `createSigillumPlugin`, composables |
| **Next.js** | 12+ | Works with React integration (client-side only) |
| **Nuxt** | 3+ | Works with Vue integration (client-side only) |
| **Vanilla JS / jQuery** | Any | Core API, no extra imports |

### Peer Dependencies

| Package | Version | Required |
|---------|---------|----------|
| `rrweb` | ≥ 2.0.0-alpha.4 | ✅ Yes |
| `react` | ≥ 16.8.0 | Optional (for React hooks) |
| `react-dom` | ≥ 16.8.0 | Optional (for React hooks) |
| `vue` | ≥ 3.0.0 | Optional (for Vue plugin) |
| `rrweb-player` | ≥ 1.0.0-alpha.4 | Optional (for replay UI) |

### Module Formats

| Format | File | Usage |
|--------|------|-------|
| **ESM** | `dist/index.js` | `import` — modern bundlers |
| **CJS** | `dist/index.cjs` | `require()` — older bundlers |

## Also Check Out

If you need **error tracking, log management, and performance monitoring**, check out [**aemeath-js**](https://github.com/TieriaSail/aemeath-js) — a lightweight, plugin-based frontend logging & monitoring SDK.

Together, **sigillum-js** (session replay) + **aemeath-js** (logging & monitoring) provide a complete frontend observability solution — all data stays on your own servers.

## Contributing

Issues and feature requests are welcome! Feel free to [open an issue](https://github.com/TieriaSail/sigillum-js/issues).

## License

[MIT](./LICENSE) © TieriaSail
