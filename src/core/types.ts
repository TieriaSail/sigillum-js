/**
 * 平台无关的事件类型体系
 *
 * 与 rrweb 的 EventWithTime 完全解耦，适用于小程序等非 DOM 环境。
 * 浏览器端继续使用 rrweb 的事件体系（SessionRecorder），本体系仅用于小程序追踪。
 */

// ==================== 事件类型 ====================

export type TrackEventType =
  | 'session_start'
  | 'session_end'
  | 'page_enter'
  | 'page_leave'
  | 'tap'
  | 'longpress'
  | 'input'
  | 'input_focus'
  | 'input_blur'
  | 'scroll'
  | 'scroll_depth'
  | 'swipe'
  | 'touch_start'
  | 'touch_move'
  | 'touch_end'
  | 'drag_start'
  | 'drag_move'
  | 'drag_end'
  | 'app_hide'
  | 'app_show'
  | 'network_request'
  | 'error'
  | 'custom'
  | 'identify';

/** 一条追踪事件 */
export interface TrackEvent<T = Record<string, unknown>> {
  type: TrackEventType;
  timestamp: number;
  data: T;
}

// ==================== 事件 data 结构 ====================

export interface EventTarget {
  id?: string;
  dataset?: Record<string, string>;
  tagName?: string;
  text?: string;
}

export interface TapEventData {
  x: number;
  y: number;
  target: EventTarget;
  page: string;
}

export interface LongpressEventData {
  x: number;
  y: number;
  target: EventTarget;
  page: string;
}

export interface ScrollEventData {
  scrollTop: number;
  scrollLeft: number;
  direction: 'up' | 'down' | 'left' | 'right';
  page: string;
  scrollHeight?: number;
  viewportHeight?: number;
}

export interface SwipeEventData {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  direction: 'up' | 'down' | 'left' | 'right';
  page: string;
  velocity?: number;
  distance?: number;
  duration?: number;
}

export interface InputEventData {
  value: string;
  target: EventTarget;
  page: string;
}

export interface InputFocusEventData {
  target: EventTarget;
  page: string;
}

export interface InputBlurEventData {
  target: EventTarget;
  page: string;
}

export interface DragEventData {
  x: number;
  y: number;
  target: EventTarget;
  page: string;
  deltaX?: number;
  deltaY?: number;
}

export interface PageEventData {
  page: string;
  from?: string;
  query?: Record<string, string>;
}

export interface NetworkRequestEventData {
  url: string;
  method: string;
  statusCode?: number;
  duration?: number;
  success?: boolean;
}

export interface ErrorEventData {
  message: string;
  stack?: string;
  page: string;
}

export interface IdentifyEventData {
  userId: string;
  traits?: Record<string, unknown>;
}

export interface CustomEventData {
  name: string;
  payload?: Record<string, unknown>;
}

export interface SessionStartEventData {
  platform: string;
  sdkVersion: string;
  appVersion?: string;
}

export interface SessionEndEventData {
  reason: 'manual' | 'max_duration' | 'buffer_full';
}

export interface TouchEventData {
  x: number;
  y: number;
  target: EventTarget;
  page: string;
  touchId?: number;
  touchCount?: number;
  force?: number;
}

export interface ScrollDepthEventData {
  page: string;
  maxScrollTop: number;
  maxDepthPercent: number;
  scrollHeight: number;
  viewportHeight: number;
}

// ==================== 监控配置 ====================

export type MonitoringPreset = 'lite' | 'standard' | 'full';

export interface CaptureConfig {
  touch?: boolean;
  tap?: boolean;
  longpress?: boolean;
  input?: boolean;
  scroll?: boolean;
  swipe?: boolean;
  drag?: boolean;
  network?: boolean;
  error?: boolean;
  custom?: boolean;
  pageLifecycle?: boolean;
  session?: boolean;
}

export interface ThrottleConfig {
  scroll?: number;
  touchMove?: number;
  drag?: number;
}

export interface ActionRule {
  name: string;
  eventTypes: TrackEventType[];
  match?: (event: TrackEvent) => boolean;
  transform?: (event: TrackEvent, context: ActionRuleContext) => {
    description: string;
    detail?: Record<string, unknown>;
    target?: { tag?: string; id?: string; text?: string; className?: string; src?: string; dataset?: Record<string, string> };
  } | null;
  merge?: boolean | ((prev: TrackEvent, next: TrackEvent) => boolean);
}

export interface ActionRuleContext {
  currentPage: string;
  sessionStartTime: number;
}

export interface MonitoringConfig {
  preset?: MonitoringPreset;
  capture?: CaptureConfig;
  throttle?: ThrottleConfig;
  scrollDepth?: boolean;
  rules?: ActionRule[];
  eventFilter?: (event: TrackEvent) => boolean;
}

// ==================== 会话相关 ====================

export type MiniAppRecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export interface MiniAppSessionMetadata {
  platform: string;
  sdkVersion: string;
  appVersion?: string;
  systemInfo?: Record<string, unknown>;
}

export interface MiniAppRecordingSummary {
  totalEvents: number;
  tapCount: number;
  inputCount: number;
  scrollCount: number;
  pageChangeCount: number;
  pageChanges: Array<{ from: string; to: string; timestamp: number }>;
  duration: number;
  visitedPages: string[];
}

export interface MiniAppRawRecordingData {
  sessionId: string;
  events: TrackEvent[];
  startTime: number;
  endTime: number;
  duration: number;
  metadata?: MiniAppSessionMetadata;
  summary?: MiniAppRecordingSummary;
}

/** 分段上传 chunk */
export interface MiniAppRecordingChunk {
  sessionId: string;
  chunkIndex: number;
  isFinal: boolean;
  events: TrackEvent[];
  startTime: number;
  endTime: number;
  summary: MiniAppRecordingSummary;
  metadata?: MiniAppSessionMetadata;
}

/** 上传结果（复用 v1 的定义语义） */
export interface MiniAppUploadResult {
  success: boolean;
  shouldRetry?: boolean;
  error?: string;
}

// ==================== 录制器配置 ====================

export interface MiniAppRecorderOptions {
  /** 上传回调（接收 SigillumRecording 信封格式，后端可通过 data.source 区分平台） */
  onUpload?: (data: SigillumRecording<MiniAppRawRecordingData>) => Promise<MiniAppUploadResult>;

  /** 分段上传 */
  chunkedUpload?: {
    enabled?: boolean;
    interval?: number;
  };
  onChunkUpload?: (chunk: MiniAppRecordingChunk) => Promise<MiniAppUploadResult>;

  /** 隐私：输入值是否脱敏 @default false */
  maskInputs?: boolean;

  /** 最大录制时长 (ms) @default 1800000 */
  maxDuration?: number;
  /** 最大事件数 @default 50000 */
  maxEvents?: number;
  /** 上传重试次数 @default 3 */
  maxRetries?: number;

  /** 调试模式 @default false */
  debug?: boolean;

  /** 监控配置 @default { preset: 'standard' } */
  monitoring?: MonitoringConfig;

  /** 状态变化回调 */
  onStatusChange?: (status: MiniAppRecordingStatus, prevStatus: MiniAppRecordingStatus) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 事件回调 */
  onEventEmit?: (event: TrackEvent, eventCount: number) => void;
}

/** SDK 版本常量（统一来源，构建时从 package.json 注入） */
export { SDK_VERSION as MINIAPP_SDK_VERSION } from '../version';

// ==================== 统一录制协议 ====================

export type SigillumRecordingSource = 'web' | 'miniapp';

/**
 * 统一录制数据信封
 *
 * 包裹 Web（RawRecordingData）或小程序（MiniAppRawRecordingData）的原始数据，
 * 提供格式版本、来源平台等元信息，使任意一份导出 JSON 都能被自动识别。
 */
export interface SigillumRecording<T = unknown> {
  sigillum: true;
  schemaVersion: number;
  source: SigillumRecordingSource;
  sdkVersion: string;
  exportedAt: number;
  recording: T;
}

export const SIGILLUM_SCHEMA_VERSION = 1;

/** 判断数据是否为 SigillumRecording 统一格式 */
export function isSigillumRecording(data: unknown): data is SigillumRecording {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as any).sigillum === true &&
    typeof (data as any).schemaVersion === 'number' &&
    typeof (data as any).source === 'string' &&
    'recording' in (data as Record<string, unknown>)
  );
}

/**
 * 解包录制数据：统一格式则提取 recording，否则原样返回。
 * 如果信封的 schemaVersion 高于当前 SDK 支持的版本，会通过 console.warn 提示。
 */
export function unwrapRecording(data: unknown): {
  recording: unknown;
  source: SigillumRecordingSource | null;
  schemaVersion: number | null;
} {
  if (isSigillumRecording(data)) {
    if (data.schemaVersion > SIGILLUM_SCHEMA_VERSION) {
      console.warn(
        `[sigillum] Recording schemaVersion ${data.schemaVersion} is newer than ` +
        `SDK supported version ${SIGILLUM_SCHEMA_VERSION}. Some features may not work correctly. ` +
        `Consider upgrading sigillum-js.`,
      );
    }
    return {
      recording: data.recording,
      source: data.source,
      schemaVersion: data.schemaVersion,
    };
  }
  return { recording: data, source: null, schemaVersion: null };
}

export type DetectResult = {
  source: SigillumRecordingSource;
  reason?: undefined;
} | {
  source: null;
  reason: string;
};

/**
 * 自动检测裸数据的来源平台（用于旧格式兼容）。
 * - events[0].type 为 number → Web (rrweb)
 * - events[0].type 为 string → MiniApp
 *
 * 返回 source 和可选的 reason（检测失败时描述原因）。
 */
export function detectRecordingSource(data: unknown): SigillumRecordingSource | null {
  return detectRecordingSourceWithReason(data).source;
}

export function detectRecordingSourceWithReason(data: unknown): DetectResult {
  if (typeof data !== 'object' || data === null) {
    return { source: null, reason: 'Data is not an object' };
  }
  const events = (data as any).events;
  if (!Array.isArray(events)) {
    return { source: null, reason: 'Data has no "events" array' };
  }
  if (events.length === 0) {
    return { source: null, reason: 'Events array is empty' };
  }
  const firstType = events[0]?.type;
  if (typeof firstType === 'number') return { source: 'web' };
  if (typeof firstType === 'string') return { source: 'miniapp' };
  return { source: null, reason: `Unexpected events[0].type: ${typeof firstType}` };
}
