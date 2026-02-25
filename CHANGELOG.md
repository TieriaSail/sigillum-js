# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-02-25

### Added
- **Metadata**: Auto-collect session metadata — page title, referrer, language, timezone, connection type, device memory, hardware concurrency, touch support, device pixel ratio
- **SPA Routing**: Automatic SPA route change tracking — intercepts `pushState`, `replaceState`, `popstate` events; route changes are also recorded as rrweb custom events for accurate replay timeline
- **Summary**: Recording behavior summary — click count, input count, scroll count, route change count, visited URLs, duration; available in real-time via `getSummary()` and included in upload data
- **Chunked Upload**: Chunked upload support for long recordings — configurable interval, each chunk contains only new events since last upload, first chunk includes metadata, final chunk marked with `isFinal`
- **API**: `getMetadata()` — get auto-collected session metadata
- **API**: `getSummary()` — get real-time behavior summary during recording
- **API**: `getRouteChanges()` — get route change history
- **React**: `useSessionRecorder` hook now exposes `getSummary`, `getMetadata`, `getRouteChanges`
- **FieldMapper**: Default mapping now includes `metadata` and `summary` fields

### Changed
- Test count increased from 138 to 168 (30 new tests for all new features)
- Upload data now automatically includes `metadata` and `summary` fields
- Route changes are recorded both internally and as rrweb custom events (`sigillum-route-change`)

## [1.1.0] - 2026-02-25

### Added
- **Privacy**: Full rrweb privacy passthrough — `blockClass`, `blockSelector`, `maskTextClass`, `maskTextSelector`, `maskInputOptions` (16 input types), `maskInputFn`, `maskTextFn`
- **Performance**: `slimDOMOptions` — slim down DOM snapshots (remove scripts, comments, meta tags) to reduce recording size by 20-40%
- **Performance**: `packFn` — data compression support (e.g. pako/gzip) to reduce transfer size by 60-80%
- **Plugins**: `plugins` — passthrough rrweb plugin system (console, sequential-id, canvas-webrtc, custom plugins)
- **Callbacks**: `onEventEmit(event, count)` — monitor events in real-time, implement chunked upload
- **Callbacks**: `onError(error)` — capture recording/upload errors
- **Callbacks**: `onStatusChange(status, prevStatus)` — react to recording state changes
- **Recording**: `takeFullSnapshot()` — manually trigger a full DOM snapshot during long recordings
- **Recording**: `recordCrossOriginIframes` — record cross-origin iframe content
- **Recording**: `checkoutEveryNth` — full snapshot every N events (in addition to Nms)
- **Recording**: `inlineImages`, `collectFonts`, `inlineStylesheet` — control resource inlining for accurate replay
- **Recording**: `userTriggeredOnInput`, `ignoreCSSAttributes` — fine-grained recording control

### Fixed
- **addTag**: Now uses rrweb native `record.addCustomEvent()` for accurate timeline synchronization during replay (previously used manual event push which could cause timestamp drift)

### Changed
- Test count increased from 114 to 138 (24 new tests for all new features)
- `PrivacyConfig` expanded from 4 options to 11 options
- `RrwebConfig` expanded from 11 options to 21 options

## [1.0.0] - 2026-02-11

### Added
- **Core**: SessionRecorder with manual control (start/stop/pause/resume)
- **Core**: Framework-agnostic design, works with vanilla JS / jQuery / any framework
- **Core**: Field mapping for custom backend data structures (bidirectional conversion)
- **Core**: IndexedDB caching for crash recovery
- **Core**: Browser compatibility checking (silent fallback)
- **Core**: Singleton pattern to avoid multi-instance issues
- **React**: `useSessionRecorder` hook for manual control
- **React**: `useAutoRecord` hook for automatic lifecycle management
- **Vue 3**: `createSigillumPlugin()` - Vue 3 Plugin with auto-start support
- **Vue 3**: `useSessionRecorder(inject)` - Composition API for manual control
- **Vue 3**: `useAutoRecord(inject, onUnmounted)` - Composition API for automatic lifecycle
- **UI**: `ReplayPlayer` component with rrweb-player integration
- **UI**: `SessionInfo` component for displaying session metadata
- **UI**: `ReplayPage` component combining player and session info
- **Privacy**: Mask inputs, ignore elements, custom selectors
- **Config**: Conditional enable (function-based), sampling support
- **Config**: Max duration, retry with exponential backoff, upload on unload
- Full TypeScript support with complete type declarations
- 114 unit tests across 7 test files

