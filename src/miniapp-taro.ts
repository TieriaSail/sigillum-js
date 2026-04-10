/**
 * sigillum-js Taro 专用入口
 *
 * import { createTaroRecorder } from 'sigillum-js/miniapp/taro';
 *
 * 自动采集模式：monkey-patch TaroElement.dispatchEvent，零手动埋点。
 *
 * 最低要求：Taro >= 3.0.0
 */

import type {
  MiniAppRecorderOptions,
  TrackEvent,
  MiniAppRecordingStatus,
  MiniAppRecordingSummary,
  MiniAppRawRecordingData,
  MiniAppSessionMetadata,
} from './core/types';
import { EventRecorder } from './core/EventRecorder';
import { TaroAdapter } from './platform/miniapp/taro';
import type { Unsubscribe } from './platform/types';

export interface TaroRecorderOptions extends MiniAppRecorderOptions {
  /** 是否启用自动采集（monkey-patch dispatchEvent）@default true */
  autoCapture?: boolean;
  /** 应用版本号 */
  appVersion?: string;
}

export interface TaroRecorderInstance {
  start(): void;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
  destroy(): void;

  /** 手动追踪事件（autoCapture=false 时使用） */
  trackEvent(event: TrackEvent): void;

  /** 关联用户 */
  identify(userId: string, traits?: Record<string, unknown>): void;

  getStatus(): MiniAppRecordingStatus;
  getSessionId(): string;
  getEventCount(): number;
  getSummary(): MiniAppRecordingSummary | null;
  getMetadata(): MiniAppSessionMetadata | null;
  exportRecording(): import('./core/types').SigillumRecording<MiniAppRawRecordingData> | null;
}

let globalTaroInstance: TaroRecorderInstance | null = null;

export function createTaroRecorder(options: TaroRecorderOptions): TaroRecorderInstance {
  const adapter = new TaroAdapter({ monitoring: options.monitoring });
  const recorder = new EventRecorder(options);
  const autoCapture = options.autoCapture !== false;

  const interceptor = adapter.createEventInterceptor((event: TrackEvent) => {
    recorder.captureEvent(event);
  });

  const unsubscribers: Unsubscribe[] = [];

  const instance: TaroRecorderInstance = {
    start() {
      unsubscribers.forEach(unsub => unsub());
      unsubscribers.length = 0;

      recorder.start('taro', options.appVersion);
      if (autoCapture) {
        interceptor.start();
      }

      unsubscribers.push(
        adapter.onPageShow((page) => {
          const from = recorder.getCurrentPage();
          recorder.setCurrentPage(page.path);
          recorder.captureEvent({
            type: 'page_enter',
            timestamp: Date.now(),
            data: { page: page.path, from, query: page.query },
          });
        }),
      );

      unsubscribers.push(
        adapter.onPageHide((page) => {
          adapter.emitScrollDepth((e) => recorder.captureEvent(e), page.path);
          recorder.captureEvent({
            type: 'page_leave',
            timestamp: Date.now(),
            data: { page: page.path },
          });
        }),
      );

      unsubscribers.push(
        adapter.onAppHide(() => {
          recorder.captureEvent({
            type: 'app_hide',
            timestamp: Date.now(),
            data: {},
          });
          instance.pause();
        }),
      );

      unsubscribers.push(
        adapter.onAppShow(() => {
          instance.resume();
          recorder.captureEvent({
            type: 'app_show',
            timestamp: Date.now(),
            data: {},
          });
        }),
      );
    },

    async stop() {
      interceptor.stop();
      unsubscribers.forEach(unsub => unsub());
      unsubscribers.length = 0;
      await recorder.stop();
    },

    pause() {
      interceptor.stop();
      recorder.pause();
    },

    resume() {
      recorder.resume();
      if (autoCapture) {
        interceptor.start();
      }
    },

    destroy() {
      interceptor.stop();
      unsubscribers.forEach(unsub => unsub());
      unsubscribers.length = 0;
      recorder.destroy();
      adapter.destroy();
      globalTaroInstance = null;
    },

    trackEvent(event: TrackEvent) {
      recorder.captureEvent(event);
    },

    identify(userId: string, traits?: Record<string, unknown>) {
      recorder.captureEvent({
        type: 'identify',
        timestamp: Date.now(),
        data: { userId, traits },
      });
    },

    getStatus: () => recorder.getStatus(),
    getSessionId: () => recorder.getSessionId(),
    getEventCount: () => recorder.getEventCount(),
    getSummary: () => recorder.getSummary(),
    getMetadata: () => recorder.getMetadata(),
    exportRecording: () => recorder.exportRecording(),
  };

  globalTaroInstance = instance;
  return instance;
}

/**
 * 获取全局 Taro 录制器实例
 */
export function getTaroSigillum(): TaroRecorderInstance | null {
  return globalTaroInstance;
}

// 重新导出核心类型
export type {
  MiniAppRecorderOptions,
  TrackEvent,
  TrackEventType,
  MiniAppRecordingStatus,
  MiniAppRecordingSummary,
  MiniAppRawRecordingData,
  MiniAppSessionMetadata,
  MiniAppRecordingChunk,
  MiniAppUploadResult,
  MonitoringConfig,
  MonitoringPreset,
  CaptureConfig,
  ThrottleConfig,
  ActionRule,
  ActionRuleContext,
  SigillumRecording,
  SigillumRecordingSource,
} from './core/types';

export {
  SIGILLUM_SCHEMA_VERSION,
  MINIAPP_SDK_VERSION,
  isSigillumRecording,
  unwrapRecording,
  detectRecordingSource,
  detectRecordingSourceWithReason,
} from './core/types';
