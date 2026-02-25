/**
 * Vue 3 集成支持
 * 提供在 Vue 3 应用中使用 SessionRecorder 的便捷方式
 *
 * 特性：
 * - Vue 3 Plugin（自动在 app 级别管理录制生命周期）
 * - Composition API（useSessionRecorder / useAutoRecord）
 * - 不直接依赖 vue 包，通过接口类型兼容
 *
 * @example
 * ```ts
 * // main.ts
 * import { createApp } from 'vue';
 * import { createSigillumPlugin } from 'sigillum-js/vue';
 *
 * const app = createApp(App);
 * app.use(createSigillumPlugin({
 *   onUpload: async (data) => {
 *     await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
 *     return { success: true };
 *   },
 * }));
 * app.mount('#app');
 * ```
 */

import {
  SessionRecorder,
  getRecorder,
  isRecorderInitialized,
} from './SessionRecorder';
import type { SessionRecorderOptions, RecordingStatus } from './types';

// ==================== 类型定义（避免直接依赖 vue） ====================

/** Vue 3 App 接口 */
interface VueApp {
  provide: (key: string | symbol, value: unknown) => VueApp;
  unmount: () => void;
  config: Record<string, unknown>;
}

/** Vue 3 inject 函数签名 */
type InjectFn = <T>(key: symbol, defaultValue?: T) => T | undefined;

/** Vue 3 onUnmounted 函数签名 */
type OnUnmountedFn = (fn: () => void) => void;

// ==================== Injection Key ====================

/** Vue provide/inject 的 key */
export const SIGILLUM_RECORDER_KEY = Symbol('sigillum-recorder');

// ==================== Plugin 配置 ====================

/** Vue Plugin 配置 */
export interface SigillumPluginOptions extends SessionRecorderOptions {
  /**
   * 是否在 app.mount 时自动开始录制
   * @default true
   */
  autoStart?: boolean;
}

// ==================== Vue Plugin ====================

/**
 * 创建 Vue 3 Session Replay 插件
 *
 * 自动管理录制的生命周期：
 * - app 安装时初始化 recorder
 * - 可选自动开始录制
 * - 通过 provide/inject 在组件中使用
 *
 * @example
 * ```ts
 * import { createApp } from 'vue';
 * import { createSigillumPlugin } from 'sigillum-js/vue';
 *
 * const app = createApp(App);
 * app.use(createSigillumPlugin({
 *   onUpload: async (data) => {
 *     await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
 *     return { success: true };
 *   },
 *   autoStart: true, // 默认 true，自动开始录制
 *   fieldMapping: [
 *     ['sessionId', 'id'],
 *     ['events', 'content', JSON.stringify, JSON.parse],
 *   ],
 * }));
 * app.mount('#app');
 * ```
 */
export function createSigillumPlugin(options: SigillumPluginOptions) {
  const { autoStart = true, ...recorderOptions } = options;

  return {
    install(app: VueApp) {
      // 初始化 recorder（单例）
      const recorder = getRecorder(recorderOptions);

      // 通过 provide 注入，组件中可以通过 inject 获取
      app.provide(SIGILLUM_RECORDER_KEY, recorder);

      // 自动开始录制
      if (autoStart) {
        recorder.start();
      }
    },
  };
}

// ==================== Composition API ====================

/**
 * 在 Vue 组件中获取 SessionRecorder 实例
 *
 * 需要配合 Vue 的 inject 使用。如果在 Plugin 外使用，会尝试获取全局单例。
 *
 * @param inject - Vue 的 inject 函数
 * @returns SessionRecorder 实例或 null
 *
 * @example
 * ```vue
 * <script setup>
 * import { inject } from 'vue';
 * import { useSessionRecorder } from 'sigillum-js/vue';
 *
 * const recorder = useSessionRecorder(inject);
 *
 * // 手动控制
 * recorder?.start();
 * recorder?.addTag('user-action', { action: 'click-buy' });
 * await recorder?.stop();
 * </script>
 * ```
 */
export function useSessionRecorder(inject: InjectFn): SessionRecorder | null {
  // 优先从 provide/inject 获取
  const injected = inject<SessionRecorder>(SIGILLUM_RECORDER_KEY);
  if (injected) {
    return injected;
  }

  // 回退到全局单例
  if (isRecorderInitialized()) {
    return getRecorder();
  }

  return null;
}

/**
 * 在 Vue 组件中自动管理录制生命周期
 *
 * - 组件挂载时自动开始录制（如果未在录制中）
 * - 组件卸载时自动停止录制
 *
 * @param inject - Vue 的 inject 函数
 * @param onUnmounted - Vue 的 onUnmounted 函数
 * @param options - 可选的 recorder 配置（仅在未初始化时使用）
 *
 * @example
 * ```vue
 * <script setup>
 * import { inject, onUnmounted } from 'vue';
 * import { useAutoRecord } from 'sigillum-js/vue';
 *
 * const { recorder, status, sessionId, addTag } = useAutoRecord(inject, onUnmounted, {
 *   onUpload: async (data) => {
 *     await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
 *     return { success: true };
 *   },
 * });
 *
 * // 添加标记
 * addTag('page-loaded', { route: '/home' });
 * </script>
 * ```
 */
export function useAutoRecord(
  inject: InjectFn,
  onUnmounted: OnUnmountedFn,
  options?: SessionRecorderOptions,
) {
  // 获取或创建 recorder
  let recorder = useSessionRecorder(inject);

  if (!recorder && options) {
    recorder = getRecorder(options);
  }

  // 自动开始录制
  if (recorder && recorder.getStatus() === 'idle') {
    recorder.start();
  }

  // 组件卸载时停止
  onUnmounted(() => {
    if (recorder && (recorder.getStatus() === 'recording' || recorder.getStatus() === 'paused')) {
      recorder.stop();
    }
  });

  return {
    /** recorder 实例 */
    recorder,
    /** 获取当前状态 */
    get status(): RecordingStatus {
      return recorder?.getStatus() || 'idle';
    },
    /** 获取当前 sessionId */
    get sessionId(): string {
      return recorder?.getSessionId() || '';
    },
    /** 添加标记 */
    addTag(name: string, data?: Record<string, any>) {
      recorder?.addTag(name, data);
    },
  };
}

// ==================== 重新导出 ====================

export {
  SessionRecorder,
  getRecorder,
  resetRecorder,
  isRecorderInitialized,
} from './SessionRecorder';

export type {
  SessionRecorderOptions,
  RecordingStatus,
} from './types';

