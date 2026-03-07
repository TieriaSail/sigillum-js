/**
 * React Hook 支持
 * 提供在 React 组件中使用 SessionRecorder 的便捷方式
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  SessionRecorder,
  getRecorder,
  isRecorderInitialized,
} from './SessionRecorder';
import { isBrowser } from './compatibility';
import type { SessionRecorderOptions, RecordingStatus, RecordingSummary, SessionMetadata, RouteChange } from './types';

/**
 * useSessionRecorder Hook
 *
 * @example
 * ```tsx
 * function MyPage() {
 *   const { start, stop, status, sessionId } = useSessionRecorder({
 *     onUpload: async (data) => {
 *       await fetch('/api/recordings', { method: 'POST', body: JSON.stringify(data) });
 *       return { success: true };
 *     },
 *   });
 *
 *   useEffect(() => {
 *     start();
 *     return () => stop();
 *   }, []);
 *
 *   return <div>Recording: {status}</div>;
 * }
 * ```
 */
export function useSessionRecorder(options?: SessionRecorderOptions) {
  const recorderRef = useRef<SessionRecorder | null>(null);
  const optionsRef = useRef(options);
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [sessionId, setSessionIdState] = useState<string>('');

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const getOrCreateRecorder = useCallback((): SessionRecorder | null => {
    if (!isBrowser()) return null;

    if (recorderRef.current) {
      return recorderRef.current;
    }

    if (isRecorderInitialized()) {
      recorderRef.current = getRecorder();
      return recorderRef.current;
    }

    if (optionsRef.current) {
      recorderRef.current = getRecorder(optionsRef.current);
      return recorderRef.current;
    }

    return null;
  }, []);

  // 订阅 recorder 的状态变化以驱动 React re-render
  useEffect(() => {
    const recorder = getOrCreateRecorder();
    if (!recorder) return;

    // 同步初始值
    setStatus(recorder.getStatus());
    setSessionIdState(recorder.getSessionId());

    const origCallback = (recorder as any).options?.onStatusChange;
    const wrappedOnStatusChange = (newStatus: RecordingStatus, prevStatus: RecordingStatus) => {
      setStatus(newStatus);
      setSessionIdState(recorder.getSessionId());
      try { optionsRef.current?.onStatusChange?.(newStatus, prevStatus); } catch { /* */ }
    };

    // 注入包装后的回调（通过内部 options 引用）
    (recorder as any).options.onStatusChange = wrappedOnStatusChange;

    return () => {
      if ((recorder as any).options) {
        (recorder as any).options.onStatusChange = origCallback;
      }
    };
  }, [getOrCreateRecorder]);

  const start = useCallback(() => {
    const recorder = getOrCreateRecorder();
    recorder?.start();
  }, [getOrCreateRecorder]);

  const stop = useCallback(async () => {
    const recorder = getOrCreateRecorder();
    await recorder?.stop();
  }, [getOrCreateRecorder]);

  const pause = useCallback(() => {
    const recorder = getOrCreateRecorder();
    recorder?.pause();
  }, [getOrCreateRecorder]);

  const resume = useCallback(() => {
    const recorder = getOrCreateRecorder();
    recorder?.resume();
  }, [getOrCreateRecorder]);

  const addTag = useCallback((name: string, data?: Record<string, any>) => {
    const recorder = getOrCreateRecorder();
    recorder?.addTag(name, data);
  }, [getOrCreateRecorder]);

  const getStatusFn = useCallback((): RecordingStatus => {
    const recorder = getOrCreateRecorder();
    return recorder?.getStatus() || 'idle';
  }, [getOrCreateRecorder]);

  const getSessionIdFn = useCallback((): string => {
    const recorder = getOrCreateRecorder();
    return recorder?.getSessionId() || '';
  }, [getOrCreateRecorder]);

  const setSessionId = useCallback((id: string) => {
    const recorder = getOrCreateRecorder();
    recorder?.setSessionId(id);
    setSessionIdState(id);
  }, [getOrCreateRecorder]);

  const getSummary = useCallback((): RecordingSummary | null => {
    const recorder = getOrCreateRecorder();
    return recorder?.getSummary() || null;
  }, [getOrCreateRecorder]);

  const getMetadata = useCallback((): SessionMetadata | null => {
    const recorder = getOrCreateRecorder();
    return recorder?.getMetadata() || null;
  }, [getOrCreateRecorder]);

  const getRouteChanges = useCallback((): RouteChange[] => {
    const recorder = getOrCreateRecorder();
    return recorder?.getRouteChanges() || [];
  }, [getOrCreateRecorder]);

  const identify = useCallback((userId: string, traits?: Record<string, any>) => {
    const recorder = getOrCreateRecorder();
    recorder?.identify(userId, traits);
  }, [getOrCreateRecorder]);

  return {
    start,
    stop,
    pause,
    resume,
    addTag,
    identify,
    /** 响应式状态，随录制状态变化自动更新 */
    status,
    /** 响应式 sessionId，随录制生命周期自动更新 */
    sessionId,
    /** 命令式获取状态（非响应式） */
    getStatus: getStatusFn,
    /** 命令式获取 sessionId（非响应式） */
    getSessionId: getSessionIdFn,
    setSessionId,
    getSummary,
    getMetadata,
    getRouteChanges,
    /** 获取底层 recorder 实例（高级用法） */
    getRecorder: getOrCreateRecorder,
  };
}

/**
 * useAutoRecord Hook
 * 自动在组件挂载时开始录制，卸载时停止
 *
 * @example
 * ```tsx
 * function MyPage() {
 *   const { sessionId, status, addTag } = useAutoRecord({
 *     onUpload: async (data) => { ... },
 *   });
 *
 *   return <div>Status: {status}, SessionId: {sessionId}</div>;
 * }
 * ```
 */
export function useAutoRecord(options: SessionRecorderOptions) {
  const { start, stop, status, sessionId, addTag, identify } = useSessionRecorder(options);

  useEffect(() => {
    start();
    return () => {
      stop().catch(() => {});
    };
  }, [start, stop]);

  return {
    /** 响应式状态 */
    status,
    /** 响应式 sessionId */
    sessionId,
    addTag,
    identify,
  };
}
