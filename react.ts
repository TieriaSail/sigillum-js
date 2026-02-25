/**
 * React Hook 支持
 * 提供在 React 组件中使用 SessionRecorder 的便捷方式
 */

import { useEffect, useRef, useCallback } from 'react';
import {
  SessionRecorder,
  getRecorder,
  isRecorderInitialized,
} from './SessionRecorder';
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

  // 保持 options 引用最新
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // 获取或创建 recorder
  const getOrCreateRecorder = useCallback((): SessionRecorder | null => {
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

  const getStatus = useCallback((): RecordingStatus => {
    const recorder = getOrCreateRecorder();
    return recorder?.getStatus() || 'idle';
  }, [getOrCreateRecorder]);

  const getSessionId = useCallback((): string => {
    const recorder = getOrCreateRecorder();
    return recorder?.getSessionId() || '';
  }, [getOrCreateRecorder]);

  const setSessionId = useCallback((id: string) => {
    const recorder = getOrCreateRecorder();
    recorder?.setSessionId(id);
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

  return {
    start,
    stop,
    pause,
    resume,
    addTag,
    getStatus,
    getSessionId,
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
 *   const { sessionId, addTag } = useAutoRecord({
 *     onUpload: async (data) => { ... },
 *   });
 *
 *   return <div>SessionId: {sessionId}</div>;
 * }
 * ```
 */
export function useAutoRecord(options: SessionRecorderOptions) {
  const { start, stop, getSessionId, addTag, getStatus } = useSessionRecorder(options);

  useEffect(() => {
    start();
    return () => {
      stop();
    };
  }, [start, stop]);

  return {
    sessionId: getSessionId(),
    status: getStatus(),
    addTag,
  };
}

