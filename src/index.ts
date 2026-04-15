/**
 * sigillum-js — session recording library.
 *
 * Record user behavior, replay it, debug faster.
 * - 内置回放 UI 组件
 *
 * @example
 * ```typescript
 * import { getRecorder } from 'sigillum-js';
 *
 * const recorder = getRecorder({
 *   onUpload: async (chunk) => {
 *     await fetch('/api/recordings', {
 *       method: 'POST',
 *       body: JSON.stringify(chunk),
 *     });
 *     return { success: true };
 *   },
 *   chunkedUpload: { enabled: true, interval: 60000 },
 * });
 *
 * recorder.start();
 * // ... 用户操作 ...
 * await recorder.stop();
 * ```
 */

// ==================== 核心 ====================
export {
  SessionRecorder,
  getRecorder,
  resetRecorder,
  isRecorderInitialized,
} from './SessionRecorder';

// ==================== 类型 ====================
export type {
  // 配置类型
  SessionRecorderOptions,
  CacheConfig,
  RrwebConfig,
  PrivacyConfig,
  SlimDOMConfig,
  ReplayConfig,
  RrwebRecordPlugin,

  // 数据类型
  RawRecordingData,
  EventWithTime,
  TagInfo,
  UploadResult,
  SessionMetadata,
  RecordingSummary,
  RecordingChunk,
  RouteChange,
  UserIdentity,

  // 字段映射
  FieldMapping,
  SimpleFieldMapping,
  TransformFieldMapping,

  // 状态
  RecordingStatus,

  // UI 组件属性
  ReplayPlayerProps,

  // 统一录制协议
  SigillumRecording,
  SigillumRecordingSource,
  DetectResult,
} from './types';

export {
  SIGILLUM_SCHEMA_VERSION,
  isSigillumRecording,
  unwrapRecording,
  detectRecordingSource,
  detectRecordingSourceWithReason,
  SDK_VERSION,
} from './types';

// ==================== 工具 ====================
export { FieldMapper, createFieldMapper, DEFAULT_FIELD_MAPPING } from './FieldMapper';
export { CacheManager } from './CacheManager';
export type { CachedChunk } from './CacheManager';
export { checkCompatibility, isBrowser } from './compatibility';
export type { CompatibilityResult } from './compatibility';

// ==================== 框架集成（独立入口，不打入主包） ====================
// React: import { useSessionRecorder, useAutoRecord } from 'sigillum-js/react';
// Vue 3: import { createSigillumPlugin, useSessionRecorder, useAutoRecord } from 'sigillum-js/vue';
// UI:    import { ReplayPlayer, SessionInfo, ReplayPage } from 'sigillum-js/ui';
