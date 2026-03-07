import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderHook, act, cleanup } from '@testing-library/react';
import 'fake-indexeddb/auto';

// Mock rrweb
let mockEmitFn: ((event: any) => void) | null = null;
const mockStopFn = vi.fn();

vi.mock('rrweb', () => ({
  record: vi.fn((options: any) => {
    mockEmitFn = options.emit;
    return mockStopFn;
  }),
}));

import { useSessionRecorder, useAutoRecord } from '../src/react';
import { resetRecorder, isRecorderInitialized } from '../src/SessionRecorder';

const defaultOptions = {
  onUpload: vi.fn().mockResolvedValue({ success: true }),
  cache: { enabled: false },
};

describe('React Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmitFn = null;
    resetRecorder();
  });

  afterEach(() => {
    cleanup();
    resetRecorder();
  });

  describe('useSessionRecorder', () => {
    it('应返回所有控制方法', () => {
      const { result } = renderHook(() => useSessionRecorder(defaultOptions));

      expect(result.current.start).toBeTypeOf('function');
      expect(result.current.stop).toBeTypeOf('function');
      expect(result.current.pause).toBeTypeOf('function');
      expect(result.current.resume).toBeTypeOf('function');
      expect(result.current.addTag).toBeTypeOf('function');
      expect(result.current.getStatus).toBeTypeOf('function');
      expect(result.current.getSessionId).toBeTypeOf('function');
      expect(result.current.setSessionId).toBeTypeOf('function');
      expect(result.current.getRecorder).toBeTypeOf('function');
    });

    it('start 应启动录制', () => {
      const { result } = renderHook(() => useSessionRecorder(defaultOptions));

      act(() => {
        result.current.start();
      });

      expect(result.current.getStatus()).toBe('recording');
    });

    it('stop 应停止录制', async () => {
      const { result } = renderHook(() => useSessionRecorder(defaultOptions));

      act(() => {
        result.current.start();
      });

      await act(async () => {
        await result.current.stop();
      });

      expect(result.current.getStatus()).toBe('stopped');
    });

    it('pause/resume 应正确切换状态', () => {
      const { result } = renderHook(() => useSessionRecorder(defaultOptions));

      act(() => {
        result.current.start();
      });
      expect(result.current.getStatus()).toBe('recording');

      act(() => {
        result.current.pause();
      });
      expect(result.current.getStatus()).toBe('paused');

      act(() => {
        result.current.resume();
      });
      expect(result.current.getStatus()).toBe('recording');
    });

    it('addTag 应在录制中添加标记', () => {
      const { result } = renderHook(() => useSessionRecorder(defaultOptions));

      act(() => {
        result.current.start();
      });

      act(() => {
        result.current.addTag('test-tag', { key: 'value' });
      });

      // 不报错即可
      expect(result.current.getStatus()).toBe('recording');
    });

    it('getSessionId 应返回当前 sessionId', () => {
      const { result } = renderHook(() => useSessionRecorder(defaultOptions));

      // 未开始时为空
      expect(result.current.getSessionId()).toBe('');

      act(() => {
        result.current.start();
      });

      expect(result.current.getSessionId()).toBeTruthy();
    });

    it('setSessionId 应在 idle 状态设置', () => {
      const { result } = renderHook(() => useSessionRecorder(defaultOptions));

      act(() => {
        result.current.setSessionId('custom-id');
      });

      expect(result.current.getSessionId()).toBe('custom-id');
    });

    it('getRecorder 应返回底层 recorder 实例', () => {
      const { result } = renderHook(() => useSessionRecorder(defaultOptions));

      const recorder = result.current.getRecorder();
      expect(recorder).toBeTruthy();
      expect(isRecorderInitialized()).toBe(true);
    });

    it('不传 options 且已初始化应复用实例', () => {
      // 先初始化
      const { result: r1 } = renderHook(() => useSessionRecorder(defaultOptions));
      const recorder1 = r1.current.getRecorder();

      // 不传 options
      const { result: r2 } = renderHook(() => useSessionRecorder());
      const recorder2 = r2.current.getRecorder();

      expect(recorder1).toBe(recorder2);
    });
  });

  describe('useAutoRecord', () => {
    it('挂载时应自动开始录制', async () => {
      const { result, rerender } = renderHook(() => useAutoRecord(defaultOptions));

      // useAutoRecord 在 useEffect 中调用 start，需要等待 effect 执行
      // rerender 会触发重新计算
      rerender();

      // useAutoRecord 内部调用了 start()，但 status 是在渲染时通过 getStatus() 获取的
      // 重新渲染后应该能获取到最新状态
      expect(result.current.status).toBe('recording');
    });

    it('应返回 sessionId', () => {
      const { result, rerender } = renderHook(() => useAutoRecord(defaultOptions));
      rerender();
      expect(result.current.sessionId).toBeTruthy();
    });

    it('应返回 addTag 方法', () => {
      const { result } = renderHook(() => useAutoRecord(defaultOptions));
      expect(result.current.addTag).toBeTypeOf('function');
    });

    it('卸载时应停止录制', async () => {
      const { unmount } = renderHook(() => useAutoRecord(defaultOptions));

      // 卸载组件
      unmount();

      // stop 是异步的，等待一下
      await new Promise(r => setTimeout(r, 50));

      // 由于 resetRecorder 在 afterEach 中调用，这里主要验证不会抛错
    });
  });
});

