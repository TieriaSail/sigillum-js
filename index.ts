/**
 * sigillum-js
 * 会话录制系统
 *
 * 特性：
 * - 基于 rrweb 的用户行为录制
 * - 手动控制录制（start/stop/pause/resume）
 * - 字段映射（适配自定义后端数据结构）
 * - IndexedDB 缓存（防止页面崩溃丢失数据）
 * - 兼容性检查（不兼容时静默处理）
 * - React Hook 支持
 * - Vue 3 Plugin + Composition API 支持
 * - 内置回放 UI 组件
 *
 * @example
 * ```typescript
 * import { getRecorder } from 'sigillum-js';
 *
 * const recorder = getRecorder({
 *   onUpload: async (data) => {
 *     await fetch('/api/recordings', {
 *       method: 'POST',
 *       body: JSON.stringify(data),
 *     });
 *     return { success: true };
 *   },
 *   fieldMapping: [
 *     ['sessionId', 'id'],
 *     ['events', 'content', JSON.stringify, JSON.parse],
 *   ],
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
} from './types';

// ==================== 工具 ====================
export { FieldMapper, createFieldMapper, DEFAULT_FIELD_MAPPING } from './FieldMapper';
export { CacheManager } from './CacheManager';
export { checkCompatibility, isBrowser } from './compatibility';
export type { CompatibilityResult } from './compatibility';

// ==================== 框架集成（独立入口，不打入主包） ====================
// React: import { useSessionRecorder, useAutoRecord } from 'sigillum-js/react';
// Vue 3: import { createSigillumPlugin, useSessionRecorder, useAutoRecord } from 'sigillum-js/vue';
// UI:    import { ReplayPlayer, SessionInfo, ReplayPage } from 'sigillum-js/ui';
