# Mini Program Integration Guide

<p align="center">
  <b>English</b> | <a href="./miniapp-guide.zh_CN.md">中文</a>
</p>

> **Status: Beta Testing**
>
> Mini program support is currently in beta (`sigillum-js@2.0.0-beta`). Only **WeChat native mini programs** and **Taro (3.0+)** are supported at this time. Alipay, TikTok, Baidu, and QQ mini program adapters are planned but not yet implemented.
>
> APIs may change between beta releases. Please report issues at [GitHub Issues](https://github.com/TieriaSail/sigillum-js/issues).

---

## What it does

sigillum-js v2.0 brings semantic user behavior tracking to mini program environments where rrweb cannot work (no HTML DOM).

- **Event sequence tracking** — records taps, inputs, scrolls, swipes, and page navigations
- **Three monitoring presets** — `lite`, `standard`, `full` for different data capture granularity
- **Custom action rules** — define your own semantic actions
- **Semantic action chain replay** — human-readable behavior timeline for reviewing sessions

> Browser-side rrweb functionality is completely unaffected. Mini program features are provided through separate entry points.

## Requirements

| Platform | Version | Rationale |
|----------|---------|-----------|
| **WeChat Mini Program** | Base library >= 1.4.0 | Declarative tracking via `sigillum.track()` |
| **Taro** | >= 3.0.0 | Auto-capture via `TaroElement.dispatchEvent` monkey-patching. Tested with 3.0, 3.6, and 4.x |
| **Node.js** | >= 16.0.0 | Build and development |

> **Recommended minimum**: WeChat base library >= 2.1.0 for `wx.onAppHide`/`wx.offAppHide`.

## Installation

```bash
npm install sigillum-js@beta
```

## Monitoring Presets

Choose a preset to control how much data is captured:

| Preset | Captures | Use case |
|--------|----------|----------|
| `lite` | Session, page lifecycle, tap, error | Production with minimal overhead |
| `standard` | + longpress, input, scroll, swipe, custom | Default — balanced coverage |
| `full` | + touch stream, scroll depth | Development / deep analysis |

> **Planned**: Network request capture (`network`) and drag event capture (`drag`) have reserved config flags in the type system and presets, but adapters do not yet emit these events. Support is planned for a future release.

```javascript
createMiniAppRecorder({
  monitoring: { preset: 'full' },
  // ...
});
```

### Throttle Intervals

High-frequency events (scroll, touchmove, drag) are throttled by default:

| Event | lite | standard | full | Description |
|-------|-----:|---------:|-----:|-------------|
| `scroll` | 1000ms | 300ms | 100ms | Min interval between scroll events |
| `touchMove` | — (not captured) | — (not captured) | 50ms | Min interval between touchmove events |
| `drag` | — (not captured) | — (not captured) | 100ms | Min interval between drag events (planned) |

> If scroll events feel too frequent in full mode, override via `throttle`:

```javascript
createMiniAppRecorder({
  monitoring: {
    preset: 'full',
    throttle: { scroll: 500 },  // Reduce scroll frequency to 2/sec
  },
});
```

Override other individual settings:

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

## WeChat Native Mini Program

Declarative tracking mode: add `sigillum.track()` in your event handlers.

### Initialize

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

### Track events in pages

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

### Capture all touch events (full mode, optional)

To capture touch interactions anywhere on the page (including blank areas), bind touch handlers to the root element:

```xml
<!-- WXML -->
<view bindtouchstart="onTouchStart" bindtouchend="onTouchEnd">
  <!-- page content -->
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

Use `bind` (not `catch`) to avoid blocking event bubbling.

> **Event granularity note**: With root-level touch binding, tapping a child element that also has `bindtap` will produce **3 events**:
>
> | # | Event | Source |
> |:-:|-------|--------|
> | 1 | `touch_start` | Root view (bubbled) |
> | 2 | `touch_end` | Root view (bubbled) |
> | 3 | `tap` | Child element `track('tap', e)` |
>
> This is **expected behavior** — the action chain analyzer uses the full touch→tap sequence to reconstruct complete interaction semantics.
>
> If you don't need the full touch chain, simply **don't bind touch events on the root view** — each tap will then produce only 1 event. Root-level touch binding is an optional enhancement, not a requirement.

### Identify user (optional)

```javascript
getSigillum()?.identify('user-123', { name: 'Alice', vipLevel: 2 });
```

## Taro Framework

Auto-capture mode: monkey-patches `TaroElement.dispatchEvent` to capture all interactions automatically. Zero manual tracking.

### Initialize

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

No tracking code needed in page components — tap, scroll, input events are captured automatically.

### Capture all touch events (full mode)

Add empty touch handlers to the page root `<View>` so the SDK can capture touch events everywhere:

```tsx
<View onTouchStart={() => {}} onTouchEnd={() => {}}>
  {/* page content */}
</View>
```

### Custom events (optional)

```typescript
import { getTaroSigillum } from 'sigillum-js/miniapp/taro';

getTaroSigillum()?.trackEvent({
  type: 'custom',
  timestamp: Date.now(),
  data: { name: 'add_to_cart', payload: { productId: '123' } },
});
```

## Web Replay

Replay happens in the browser (admin dashboard), not inside the mini program.

### ActionChainPlayer (React)

```tsx
import { ActionChainPlayer } from 'sigillum-js/replay';

<ActionChainPlayer
  data={recordingData}
  style={{ width: 400 }}
  speed={1}
  autoPlay
/>
```

### Build action chain (headless)

```typescript
import { buildActionChain, renderActionChainHTML } from 'sigillum-js/replay';

const chain = buildActionChain(recordingData);
console.log(chain.stats);
console.log(chain.pageGroups);

// Or render as standalone HTML
const html = renderActionChainHTML(chain);
```

### Custom action rules

```typescript
import { buildActionChain } from 'sigillum-js/replay';

const chain = buildActionChain(recordingData, {
  rules: [{
    name: 'purchase',
    eventTypes: ['custom'],
    match: (event) => event.data?.name === 'purchase',
    transform: (event, ctx) => ({
      description: `Purchase completed on ${ctx.currentPage}`,
      detail: event.data?.payload,
    }),
  }],
});
```

### TimelinePlayer (headless event playback)

```typescript
import { TimelinePlayer } from 'sigillum-js/replay';

const player = new TimelinePlayer({
  events: data.events,
  onEvent: (event, i) => console.log(event.type, event.data),
});
player.play();
```

## API Reference

### `sigillum-js/miniapp`

| API | Description |
|-----|-------------|
| `createMiniAppRecorder(options)` | Create recorder instance |
| `getSigillum()` | Get global recorder instance |
| `recorder.start()` | Start recording |
| `recorder.stop()` | Stop recording (returns Promise) |
| `recorder.pause()` / `resume()` | Pause / resume |
| `recorder.destroy()` | Destroy recorder |
| `recorder.track(type, event)` | Declarative tracking |
| `recorder.identify(userId, traits?)` | Associate user identity |
| `recorder.getStatus()` | `'idle' \| 'recording' \| 'paused' \| 'stopped'` |
| `recorder.getSessionId()` | Current session ID |
| `recorder.getEventCount()` | Event count |
| `recorder.getSummary()` | Behavior summary |
| `recorder.getMetadata()` | Session metadata (platform, sdkVersion, etc.) |
| `recorder.exportRecording()` | Export recording data |

### `sigillum-js/miniapp/taro`

Same as above, plus:

| API | Description |
|-----|-------------|
| `createTaroRecorder(options)` | Create Taro recorder (supports `autoCapture`) |
| `getTaroSigillum()` | Get global Taro recorder instance |
| `recorder.trackEvent(event)` | Manual event tracking |

### `sigillum-js/replay`

| API | Description |
|-----|-------------|
| `<ActionChainPlayer>` | React semantic action chain component |
| `buildActionChain(data, options?)` | Build semantic action chain from recording |
| `renderActionChainHTML(chain)` | Render action chain as standalone HTML |
| `getActionChainCSS()` | Hover/active CSS for HTML renderer |
| `TimelinePlayer` | Headless event timeline player |

<details>
<summary><b>Configuration</b></summary>

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `monitoring.preset` | `'lite' \| 'standard' \| 'full'` | `'standard'` | Monitoring granularity preset |
| `monitoring.capture` | `CaptureConfig` | — | Override capture flags per event type |
| `monitoring.throttle` | `ThrottleConfig` | — | Override throttle intervals (ms) |
| `monitoring.scrollDepth` | `boolean` | preset default | Track max scroll depth per page |
| `monitoring.rules` | `ActionRule[]` | `[]` | Custom action rules |
| `monitoring.eventFilter` | `function` | — | Global event filter |
| `onUpload` | `function` | — | Unified upload callback (handles timed chunks, final upload, and crash recovery) |
| `onChunkUpload` | `function` | — | **Deprecated** — use `onUpload` instead. Will be removed in the next major version. |
| `chunkedUpload.enabled` | `boolean` | `false` | Enable chunked upload |
| `chunkedUpload.interval` | `number` | `60000` | Chunk interval (ms) |
| `maskInputs` | `boolean` | `false` | Mask input values (see [Privacy Protection](#privacy-protection)) |
| `maxDuration` | `number` | `1800000` | Max recording duration (ms) |
| `maxEvents` | `number` | `50000` | Max events |
| `maxRetries` | `number` | `3` | Upload retry count |
| `debug` | `boolean` | `false` | Debug mode |

</details>

## Privacy Protection

Both Web (rrweb) and MiniApp SDKs default to **no input masking** (`maskInputs: false` / `maskAllInputs: false`). This means user input values (text fields, search boxes, etc.) are recorded in plaintext by default.

> **Important**: If your application handles sensitive data (passwords, phone numbers, ID numbers, payment info, medical records, etc.), you **must** enable input masking before going to production.

### MiniApp

```javascript
createMiniAppRecorder({
  maskInputs: true,   // Mask all input values
  // ...
});
```

When enabled, masking rules are:
- String values → replaced with equal-length `*` (e.g. `"secret123"` → `"*********"`)
- Non-string, non-null values (numbers, booleans) → replaced with `"***"`
- `null` / `undefined` → kept as-is

Masking is applied synchronously inside `captureEvent` — raw values never enter the event buffer or leave the device.

### Web (rrweb)

```javascript
getRecorder({
  rrwebConfig: {
    privacy: {
      maskAllInputs: true,

      maskInputOptions: {
        password: true,    // Always recommended
        email: true,
        tel: true,
        text: true,
      },

      blockClass: 'sensitive-area',
      // ⚠️ blockSelector has a known bug — use blockClass instead.
      // See: https://github.com/rrweb-io/rrweb/issues/1486
      // blockSelector: '[data-private]',
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

### Recommended Production Configuration

| Scenario | MiniApp | Web |
|---|---|---|
| General app | `maskInputs: true` | `maskAllInputs: true` |
| Login / payment pages | `maskInputs: true` | `maskAllInputs: true` + `blockClass: 'rr-block'` |
| Internal / debug | `maskInputs: false` | `maskAllInputs: false` |

> **Compliance note**: Enabling masking helps meet GDPR, CCPA, and China's Personal Information Protection Law (PIPL) requirements for session replay. Always consult your legal/compliance team for specific guidance.

---

## Unified Recording Protocol

Starting from v2.0, `exportRecording()` on both Web and MiniApp returns a **SigillumRecording envelope** instead of raw data:

```json
{
  "sigillum": true,
  "schemaVersion": 1,
  "source": "miniapp",
  "sdkVersion": "2.0.0-beta.1",
  "exportedAt": 1712700000000,
  "recording": { /* MiniAppRawRecordingData or RawRecordingData */ }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sigillum` | `true` | Magic marker — identifies the envelope format |
| `schemaVersion` | `number` | Protocol version (currently `1`) |
| `source` | `"web" \| "miniapp"` | Which platform produced this recording |
| `sdkVersion` | `string` | SDK version that exported the data |
| `exportedAt` | `number` | Unix timestamp (ms) of the export |
| `recording` | `object` | The actual recording data (platform-specific) |

### Data flow

| Scenario | Data format |
|----------|-------------|
| MiniApp `onUpload` callback | `SigillumRecording<MiniAppRawRecordingData>` |
| MiniApp `exportRecording()` | `SigillumRecording<MiniAppRawRecordingData>` |
| Web `onUpload` callback | `RecordingChunk` (unified chunk format with `sessionId`, `chunkIndex`, `isFinal`, `events`, etc.) |
| Web `exportRecording()` | `SigillumRecording<RawRecordingData>` |

> Web's `onUpload` now receives a `RecordingChunk` directly — the same format for timed chunks, final upload, and crash recovery. Use `exportRecording()` for the full envelope format.

### Backward compatibility

All replay components (`ReplayPlayer`, `ActionChainPlayer`) accept **both** the new envelope format and legacy raw data. The helper functions below are also exported:

```typescript
import {
  isSigillumRecording,  // type guard
  unwrapRecording,       // extract recording + source
  detectRecordingSource, // auto-detect raw data source
} from 'sigillum-js';
```

### ReplayRouter

`ReplayRouter` automatically detects the data source and renders the correct player:

```tsx
import { ReplayRouter } from 'sigillum-js/ui';

<ReplayRouter
  data={jsonFromServer}
  replayConfig={{ speed: 2 }}
  speed={1.5}
  autoPlay
/>
```

It lazy-loads `ReplayPlayer` (Web) or `ActionChainPlayer` (MiniApp) based on the `source` field or auto-detection.

## FAQ

**Q: Does v2.0 affect browser-side functionality?**
No. Browser recording still uses rrweb. All v1.x APIs are unchanged. Mini program features are provided through separate entry points (`sigillum-js/miniapp`) and won't be bundled unless imported.

**Q: How does Taro auto-capture impact performance?**
The `dispatchEvent` patch adds one function call + one conditional check per event. No DOM snapshots are collected — only semantic event data flows through the pipeline.

**Q: What's the difference between monitoring presets?**
`lite` captures only taps and page navigation (minimal overhead). `standard` adds input, scroll, swipe, and network events. `full` adds raw touch streams, drag events, and scroll depth tracking.

**Q: How does `maskInputs` work?**
Disabled by default (`maskInputs: false`). When enabled (`maskInputs: true`), masking rules:
- String values → replaced with equal-length `*` (e.g. `"secret123"` → `"*********"`)
- Non-string, non-null values (numbers, booleans, etc.) → replaced with `"***"`
- `null` / `undefined` → kept as-is

Masking is applied synchronously inside `captureEvent` — raw values never enter the event buffer.

**Q: Too many scroll events in full mode?**
Full mode throttles scroll at 100ms (max 10/sec). Override via `monitoring.throttle.scroll`, e.g. set to 500ms for lower frequency. See the "Throttle Intervals" section above.

**Q: Why does tapping a button produce 3 events with root-level touch binding?**
Root-level `bindtouchstart`/`bindtouchend` captures all touches via bubbling, plus the child's `track('tap')` adds the semantic event: touch_start + touch_end + tap = 3. This is by design for full touch chain reconstruction. If not needed, simply don't bind touch on the root view.

## License

[MIT](../LICENSE) © TieriaSail
