<p align="center">
  <h1 align="center">sigillum-js</h1>
  <p align="center">Session recording for the web. Record user behavior, replay it, debug faster.</p>
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

## What it does

Records the entire user session so you can replay every step of user behavior. Data stays on your own servers.

## Installation

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

## Quick Start

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

// Later — stop and upload
await recorder.stop();
```

That's it. The recorder captures everything automatically — mouse movement, scrolling, inputs, and route changes. When `stop()` is called, data is uploaded via your `onUpload` callback.

### Local-only mode (no upload)

For debugging workflows where users export recordings manually:

```typescript
const recorder = getRecorder({ debug: true });

recorder.start();
// ... user reproduces the bug ...
await recorder.stop();

const data = recorder.exportRecording();
downloadAsJson(data); // your download helper
```

## Framework Integrations

| Framework | Import Path | Key Exports |
|-----------|-------------|-------------|
| **Vanilla JS** | `sigillum-js` | `getRecorder()`, `resetRecorder()`, `isRecorderInitialized()` |
| **React** 16.8+ | `sigillum-js/react` | `useSessionRecorder()`, `useAutoRecord()` |
| **Vue** 3+ | `sigillum-js/vue` | `createSigillumPlugin()`, `useSessionRecorder()`, `useAutoRecord()` |

<details>
<summary><b>React Example</b></summary>

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

  return <div>Status: {status}</div>;
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
  <div>Status: {{ status.value }}</div>
</template>
```
</details>

## Replay UI

Built-in React components for replaying recordings:

```tsx
import { ReplayPlayer, ReplayPage } from 'sigillum-js/ui';

<ReplayPlayer data={recordingData} />

// Full page with session info
<ReplayPage data={recordingData} showInfo={true} />
```

<details>
<summary><b>Replay Config</b></summary>

Pass `config` to customize replay behavior. Common rrweb Replayer options are available as first-class fields; for anything else, use the `replayerConfig` passthrough.

```tsx
<ReplayPlayer
  data={recordingData}
  config={{
    speed: 2,
    autoPlay: true,
    showController: true,
    skipInactive: true,

    // rrweb Replayer options
    UNSAFE_replayCanvas: true,   // Required when recordCanvas was enabled
    mouseTail: false,            // Hide mouse trail
    pauseAnimation: true,        // Pause CSS animations during pause
    useVirtualDom: false,
    liveMode: false,
    triggerFocus: true,
    insertStyleRules: ['body { background: #fff; }'],
    unpackFn: (e) => e,          // Paired with packFn during recording

    // Passthrough for any other rrweb Replayer option not listed above
    replayerConfig: {
      // e.g. blockClass, loadTimeout, showWarning, etc.
    },
  }}
/>
```

> **Note**: `events`, `width`, and `height` are managed internally and cannot be overridden via `config` or `replayerConfig`.

</details>

## API Reference

```typescript
const recorder = getRecorder(options);

// Lifecycle
recorder.start();
await recorder.stop();
recorder.pause();
recorder.resume();

// Data
recorder.exportRecording();     // Export after stop (events + metadata + summary)
recorder.clearRecording();      // Free memory

// Tags & Identity
recorder.addTag(name, data);
recorder.identify(userId, traits?);

// Status
recorder.getStatus();           // 'idle' | 'recording' | 'paused' | 'stopped'
recorder.getSessionId();
recorder.getEventCount();
recorder.getEstimatedSize();
recorder.getSummary();          // { clickCount, inputCount, scrollCount, routeChanges, ... }

// Cleanup
recorder.destroy();
resetRecorder();
```

<details>
<summary><b>Configuration</b></summary>

```typescript
const recorder = getRecorder({
  // Upload (optional — without it, runs in local-only mode)
  onUpload: async (data) => { return { success: true }; },

  // Field mapping (adapt to your backend schema)
  fieldMapping: [['sessionId', 'id'], ['events', 'content', JSON.stringify, JSON.parse]],
  beforeUpload: (data) => ({ ...data, userId: getCurrentUserId() }),

  // Enable condition
  enabled: () => user.isVIP || Math.random() < 0.1,

  // Crash recovery cache
  cache: { enabled: true, saveInterval: 5000, maxItems: 10, maxAge: 604800000 },

  // Chunked upload (for long recordings)
  chunkedUpload: { enabled: true, interval: 60000 },
  onChunkUpload: async (chunk) => { return { success: true }; },

  // Callbacks
  onEventEmit: (event, count) => {},
  onError: (error) => {},
  onStatusChange: (status, prev) => {},

  // Limits
  maxEvents: 50000,
  maxDuration: 1800000,  // 30 min
  maxRetries: 3,

  // Privacy (mask inputs, block elements, etc.)
  rrwebConfig: {
    privacy: {
      // ⚠️ Use blockClass instead of blockSelector.
      // blockSelector has a known bug in rrweb 2.0.0-alpha.4 that silently
      // breaks recording when Text nodes change. See:
      // https://github.com/rrweb-io/rrweb/issues/1486
      blockClass: 'rr-block',
      maskAllInputs: true,
    },
    slimDOMOptions: 'all',
  },

  // Misc
  uploadOnUnload: true,
  beaconUrl: '/api/beacon',
  debug: false,
});
```
</details>

## Upload Configuration Guide

In 1.x, there are **two independent upload callbacks** serving different purposes:

| Callback | Trigger | Data Format | Field Mapping |
|----------|---------|-------------|---------------|
| `onUpload` | `stop()` is called | `Record<string, any>` (via `FieldMapper`) | `fieldMapping` + `beforeUpload` applied |
| `onChunkUpload` | Timer interval during recording | `RecordingChunk` (raw) | **Not** processed by `fieldMapping` |

The two callbacks are **independent** — `onUpload` never receives chunked data, and `onChunkUpload` never goes through `fieldMapping`.

### Recommended Patterns

<details>
<summary><b>Pattern A: Upload on stop (simple)</b></summary>

Best for short recordings. All data is uploaded at once when `stop()` is called.

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
<summary><b>Pattern B: Chunked upload (long recordings)</b></summary>

Best for recordings that may last minutes. Data is streamed in chunks during recording.

```typescript
const recorder = getRecorder({
  chunkedUpload: { enabled: true, interval: 60000 },
  onChunkUpload: async (chunk) => {
    await fetch('/api/recording-chunks', { method: 'POST', body: JSON.stringify(chunk) });
    return { success: true };
  },
});
```

> Note: `fieldMapping` does **not** apply to `onChunkUpload`. Transform the `RecordingChunk` yourself if needed.
</details>

<details>
<summary><b>Pattern C: Chunked + stop fallback (safest)</b></summary>

Combines both — chunks are uploaded during recording, and a full upload happens on stop as a safety net. Your backend must handle both data formats.

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

### Common Mistakes

| Mistake | Problem |
|---------|---------|
| `onUpload` set + `chunkedUpload.enabled: true` but no `onChunkUpload` | Chunks have nowhere to go — only the final `onUpload` fires |
| `onChunkUpload` set but `chunkedUpload.enabled` is `false`/missing | `onChunkUpload` is never called |
| Expecting `fieldMapping` to apply to `onChunkUpload` | `fieldMapping` only applies to `onUpload` |

> **Looking for a simpler API?** In 2.0 (beta), `onUpload` and `onChunkUpload` have been unified into a single `onUpload` callback. Try it with `npm install sigillum-js@beta`.

## Compatibility

| Browser | Version |
|---------|---------|
| Chrome | 64+ |
| Firefox | 69+ |
| Safari | 12+ |
| Edge | 79+ (Chromium) |
| iOS Safari | 12+ |
| IE | Not supported |

| Framework | Version | Import Path |
|-----------|---------|-------------|
| **React** | 16.8+ | `sigillum-js/react` |
| **Vue** | 3.0+ | `sigillum-js/vue` |
| **Next.js** | 12+ | Via React integration |
| **Nuxt** | 3+ | Via Vue integration |

## Also Check Out

If you need **error tracking, log management, and performance monitoring**, check out [**aemeath-js**](https://github.com/TieriaSail/aemeath-js) — a lightweight, plugin-based frontend logging & monitoring SDK.

Together, **sigillum-js** (session replay) + **aemeath-js** (logging & monitoring) provide a complete frontend observability solution — all data stays on your own servers.

## Contributing

Issues and feature requests are welcome! Feel free to [open an issue](https://github.com/TieriaSail/sigillum-js/issues).

## License

[MIT](./LICENSE) © TieriaSail

---

> Built with AI assistance.
