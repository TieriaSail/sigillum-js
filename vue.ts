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
import { isBrowser } from './compatibility';
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

/** Vue 3 ref 函数签名（用于可选响应式支持） */
type RefFn = <T>(value: T) => { value: T };

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
      if (!isBrowser()) return;

      const recorder = getRecorder(recorderOptions);
      app.provide(SIGILLUM_RECORDER_KEY, recorder);

      if (autoStart) {
        recorder.start();
      }

      // app 卸载时同步释放资源（destroy 不触发上传，避免 async 竞态）
      const originalUnmount = app.unmount.bind(app);
      app.unmount = () => {
        recorder.destroy();
        originalUnmount();
      };
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
  if (!isBrowser()) return null;

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

/** useAutoRecord 的配置 */
export interface UseAutoRecordVueOptions {
  /** 传入 Vue 的 ref 函数以获得响应式 status / sessionId */
  ref?: RefFn;
  /** 录制器配置（仅在未初始化时使用） */
  recorderOptions?: SessionRecorderOptions;
}

/**
 * 在 Vue 组件中自动管理录制生命周期
 *
 * - 组件挂载时自动开始录制（如果未在录制中）
 * - 组件卸载时自动停止录制
 * - 传入 `ref` 后 `status` 和 `sessionId` 变为响应式 Ref
 *
 * @param inject - Vue 的 inject 函数
 * @param onUnmounted - Vue 的 onUnmounted 函数
 * @param options - 配置项（包含可选的 ref 和 recorderOptions）
 *
 * @example
 * ```vue
 * <script setup>
 * import { inject, onUnmounted, ref } from 'vue';
 * import { useAutoRecord } from 'sigillum-js/vue';
 *
 * const { recorder, status, sessionId, addTag } = useAutoRecord(inject, onUnmounted, {
 *   ref, // 传入后 status / sessionId 自动成为 Ref<T>
 *   recorderOptions: {
 *     onUpload: async (data) => {
 *       await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
 *       return { success: true };
 *     },
 *   },
 * });
 *
 * // 模板中直接使用 {{ status }} {{ sessionId }}
 * addTag('page-loaded', { route: '/home' });
 * </script>
 * ```
 */
export function useAutoRecord(
  inject: InjectFn,
  onUnmounted: OnUnmountedFn,
  options?: SessionRecorderOptions | UseAutoRecordVueOptions,
) {
  // 兼容旧签名：第三个参数直接传 SessionRecorderOptions
  const isNewOptions = options && (
    ('ref' in options && typeof (options as any).ref === 'function') ||
    'recorderOptions' in options
  );
  const vueOptions = isNewOptions ? (options as UseAutoRecordVueOptions) : undefined;
  const recorderOptions = isNewOptions
    ? (options as UseAutoRecordVueOptions).recorderOptions
    : (options as SessionRecorderOptions | undefined);
  const refFn = vueOptions?.ref;

  let recorder = useSessionRecorder(inject);
  if (!recorder && recorderOptions) {
    recorder = getRecorder(recorderOptions);
  }

  if (recorder && recorder.getStatus() === 'idle') {
    recorder.start();
  }

  // 响应式状态（有 ref 时使用 Vue Ref，否则降级为 getter）
  const statusRef = refFn ? refFn<RecordingStatus>(recorder?.getStatus() || 'idle') : null;
  const sessionIdRef = refFn ? refFn<string>(recorder?.getSessionId() || '') : null;

  let origOnStatusChange: any;
  let didWrapOnStatusChange = false;
  if (recorder && refFn && statusRef && sessionIdRef) {
    didWrapOnStatusChange = true;
    origOnStatusChange = (recorder as any).options?.onStatusChange;
    (recorder as any).options.onStatusChange = (
      newStatus: RecordingStatus,
      prevStatus: RecordingStatus,
    ) => {
      statusRef.value = newStatus;
      sessionIdRef.value = recorder!.getSessionId();
      try { origOnStatusChange?.(newStatus, prevStatus); } catch { /* */ }
    };
  }

  onUnmounted(() => {
    if (recorder && didWrapOnStatusChange && (recorder as any).options) {
      (recorder as any).options.onStatusChange = origOnStatusChange;
    }
    if (recorder && (recorder.getStatus() === 'recording' || recorder.getStatus() === 'paused')) {
      recorder.stop().catch(() => {});
    }
  });

  const result: Record<string, any> = {
    recorder,
    addTag(name: string, data?: Record<string, any>) {
      recorder?.addTag(name, data);
    },
    identify(userId: string, traits?: Record<string, any>) {
      recorder?.identify(userId, traits);
    },
  };

  if (statusRef) {
    result.status = statusRef;
    result.sessionId = sessionIdRef!;
  } else {
    Object.defineProperty(result, 'status', {
      get(): RecordingStatus { return recorder?.getStatus() || 'idle'; },
      enumerable: true,
    });
    Object.defineProperty(result, 'sessionId', {
      get(): string { return recorder?.getSessionId() || ''; },
      enumerable: true,
    });
  }

  return result as any;
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

