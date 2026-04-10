/**
 * sigillum-js 小程序入口
 *
 * import { createMiniAppRecorder, getSigillum } from 'sigillum-js/miniapp';
 *
 * 适用于微信原生小程序。声明式埋点模式：在事件处理函数中调用 sigillum.track() 采集事件。
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
import { WechatAdapter } from './platform/miniapp/wechat';
import type { MiniAppEventObject } from './platform/miniapp/types';
import type { Unsubscribe } from './platform/types';

export interface MiniAppRecorderInstance {
  start(): void;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
  destroy(): void;

  /** 声明式埋点：在事件处理函数中调用 */
  track(type: string, e: MiniAppEventObject): void;

  /** 关联用户 */
  identify(userId: string, traits?: Record<string, unknown>): void;

  getStatus(): MiniAppRecordingStatus;
  getSessionId(): string;
  getEventCount(): number;
  getSummary(): MiniAppRecordingSummary | null;
  getMetadata(): MiniAppSessionMetadata | null;
  exportRecording(): import('./core/types').SigillumRecording<MiniAppRawRecordingData> | null;
}

let globalInstance: MiniAppRecorderInstance | null = null;

export function createMiniAppRecorder(
  options: MiniAppRecorderOptions & { platform?: 'wechat'; appVersion?: string },
): MiniAppRecorderInstance {
  const adapter = new WechatAdapter({ monitoring: options.monitoring });
  const recorder = new EventRecorder(options);
  const interceptor = adapter.createEventInterceptor((event: TrackEvent) => {
    recorder.captureEvent(event);
  });

  const unsubscribers: Unsubscribe[] = [];

  const instance: MiniAppRecorderInstance = {
    start() {
      unsubscribers.forEach(unsub => unsub());
      unsubscribers.length = 0;

      recorder.start(adapter.platform, options.appVersion);
      interceptor.start();

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
      interceptor.start();
    },

    destroy() {
      interceptor.stop();
      unsubscribers.forEach(unsub => unsub());
      unsubscribers.length = 0;
      recorder.destroy();
      adapter.destroy();
      globalInstance = null;
    },

    track(type: string, e: MiniAppEventObject) {
      interceptor.track(type, e);
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

  globalInstance = instance;
  return instance;
}

/**
 * 获取全局小程序录制器实例
 */
export function getSigillum(): MiniAppRecorderInstance | null {
  return globalInstance;
}

// 重新导出类型
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

export type {
  MiniAppPlatformAdapter,
  PageInfo,
  EventInterceptor,
  PlatformStorage,
} from './platform/types';
