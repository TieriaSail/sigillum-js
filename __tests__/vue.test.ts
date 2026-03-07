import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import {
  createSigillumPlugin,
  useSessionRecorder,
  useAutoRecord,
  SIGILLUM_RECORDER_KEY,
  getRecorder,
  resetRecorder,
  isRecorderInitialized,
} from '../src/vue';
import { SessionRecorder } from '../src/SessionRecorder';

describe('Vue 集成', () => {
  const defaultOptions = {
    onUpload: vi.fn().mockResolvedValue({ success: true }),
    cache: { enabled: false },
    debug: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmitFn = null;
    resetRecorder();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== 导出检查 ====================

  describe('导出检查', () => {
    it('应导出 createSigillumPlugin', () => {
      expect(typeof createSigillumPlugin).toBe('function');
    });

    it('应导出 useSessionRecorder', () => {
      expect(typeof useSessionRecorder).toBe('function');
    });

    it('应导出 useAutoRecord', () => {
      expect(typeof useAutoRecord).toBe('function');
    });

    it('应导出 SIGILLUM_RECORDER_KEY', () => {
      expect(typeof SIGILLUM_RECORDER_KEY).toBe('symbol');
    });

    it('应重新导出核心函数', () => {
      expect(typeof getRecorder).toBe('function');
      expect(typeof resetRecorder).toBe('function');
      expect(typeof isRecorderInitialized).toBe('function');
    });
  });

  // ==================== createSigillumPlugin ====================

  describe('createSigillumPlugin', () => {
    function createMockApp() {
      const provides = new Map<string | symbol, unknown>();
      return {
        provide: vi.fn((key: string | symbol, value: unknown) => {
          provides.set(key, value);
          return mockApp;
        }),
        unmount: vi.fn(),
        config: {},
        _provides: provides,
      };
      var mockApp: ReturnType<typeof createMockApp>;
    }

    it('应返回带 install 方法的插件对象', () => {
      const plugin = createSigillumPlugin(defaultOptions);
      expect(plugin).toHaveProperty('install');
      expect(typeof plugin.install).toBe('function');
    });

    it('install 应初始化 recorder 并 provide', () => {
      const plugin = createSigillumPlugin(defaultOptions);
      const app = createMockApp();
      plugin.install(app as any);

      expect(app.provide).toHaveBeenCalledWith(
        SIGILLUM_RECORDER_KEY,
        expect.any(SessionRecorder),
      );
    });

    it('autoStart=true（默认）应自动开始录制', () => {
      const plugin = createSigillumPlugin(defaultOptions);
      const app = createMockApp();
      plugin.install(app as any);

      // recorder 应已在录制状态
      const recorder = getRecorder()!;
      expect(recorder.getStatus()).toBe('recording');
    });

    it('autoStart=false 不应自动开始录制', () => {
      const plugin = createSigillumPlugin({
        ...defaultOptions,
        autoStart: false,
      });
      const app = createMockApp();
      plugin.install(app as any);

      const recorder = getRecorder()!;
      expect(recorder.getStatus()).toBe('idle');
    });

    it('应传递 fieldMapping 等选项给 recorder', () => {
      const fieldMapping: [string, string][] = [['sessionId', 'id']];
      const plugin = createSigillumPlugin({
        ...defaultOptions,
        fieldMapping,
        autoStart: false,
      });
      const app = createMockApp();
      plugin.install(app as any);

      // recorder 已创建
      expect(isRecorderInitialized()).toBe(true);
    });

    it('app.unmount 应销毁 recorder', () => {
      const plugin = createSigillumPlugin(defaultOptions);
      const app = createMockApp();
      const originalUnmount = app.unmount;
      plugin.install(app as any);

      const recorder = getRecorder()!;
      expect(recorder.getStatus()).toBe('recording');

      app.unmount();

      // destroy 后 disabled=true，start 不再生效
      recorder.start();
      expect(recorder.getStatus()).toBe('idle');
      expect(originalUnmount).toHaveBeenCalled();
    });

    it('app.unmount 不应抛出异常', () => {
      const plugin = createSigillumPlugin({
        ...defaultOptions,
        autoStart: false,
      });
      const app = createMockApp();
      plugin.install(app as any);
      expect(() => app.unmount()).not.toThrow();
    });
  });

  // ==================== useSessionRecorder ====================

  describe('useSessionRecorder', () => {
    it('通过 inject 获取 recorder 实例', () => {
      // 先初始化一个 recorder
      const recorder = getRecorder(defaultOptions);
      const mockInject = vi.fn((key: symbol) => {
        if (key === SIGILLUM_RECORDER_KEY) return recorder;
        return undefined;
      });

      const result = useSessionRecorder(mockInject);
      expect(result).toBe(recorder);
      expect(mockInject).toHaveBeenCalledWith(SIGILLUM_RECORDER_KEY);
    });

    it('inject 未找到时回退到全局单例', () => {
      const recorder = getRecorder(defaultOptions);
      const mockInject = vi.fn(() => undefined);

      const result = useSessionRecorder(mockInject);
      expect(result).toBe(recorder);
    });

    it('未初始化且 inject 为空时返回 null', () => {
      const mockInject = vi.fn(() => undefined);

      const result = useSessionRecorder(mockInject);
      expect(result).toBeNull();
    });

    it('inject 优先于全局单例', () => {
      // 创建全局单例
      const globalRecorder = getRecorder(defaultOptions);

      // 创建另一个 recorder 通过 inject 提供
      const localRecorder = new SessionRecorder(defaultOptions);
      const mockInject = vi.fn((key: symbol) => {
        if (key === SIGILLUM_RECORDER_KEY) return localRecorder;
        return undefined;
      });

      const result = useSessionRecorder(mockInject);
      expect(result).toBe(localRecorder);
      expect(result).not.toBe(globalRecorder);
    });
  });

  // ==================== useAutoRecord ====================

  describe('useAutoRecord', () => {
    it('应自动开始录制', () => {
      // 先初始化 recorder
      const recorder = getRecorder(defaultOptions);
      const mockInject = vi.fn((key: symbol) => {
        if (key === SIGILLUM_RECORDER_KEY) return recorder;
        return undefined;
      });
      const mockOnUnmounted = vi.fn();

      const result = useAutoRecord(mockInject, mockOnUnmounted);

      expect(recorder.getStatus()).toBe('recording');
      expect(result.status).toBe('recording');
    });

    it('应返回 sessionId', () => {
      const recorder = getRecorder(defaultOptions);
      const mockInject = vi.fn((key: symbol) => {
        if (key === SIGILLUM_RECORDER_KEY) return recorder;
        return undefined;
      });
      const mockOnUnmounted = vi.fn();

      const result = useAutoRecord(mockInject, mockOnUnmounted);

      expect(typeof result.sessionId).toBe('string');
      expect(result.sessionId.length).toBeGreaterThan(0);
    });

    it('应注册 onUnmounted 回调', () => {
      const recorder = getRecorder(defaultOptions);
      const mockInject = vi.fn((key: symbol) => {
        if (key === SIGILLUM_RECORDER_KEY) return recorder;
        return undefined;
      });
      const mockOnUnmounted = vi.fn();

      useAutoRecord(mockInject, mockOnUnmounted);

      expect(mockOnUnmounted).toHaveBeenCalledTimes(1);
      expect(typeof mockOnUnmounted.mock.calls[0][0]).toBe('function');
    });

    it('onUnmounted 回调应停止录制', async () => {
      const recorder = getRecorder(defaultOptions);
      const mockInject = vi.fn((key: symbol) => {
        if (key === SIGILLUM_RECORDER_KEY) return recorder;
        return undefined;
      });
      const mockOnUnmounted = vi.fn();

      useAutoRecord(mockInject, mockOnUnmounted);
      expect(recorder.getStatus()).toBe('recording');

      // 模拟组件卸载
      const unmountCallback = mockOnUnmounted.mock.calls[0][0];
      await unmountCallback();

      // stop 是异步的，但 status 会变
      expect(recorder.getStatus()).not.toBe('recording');
    });

    it('addTag 应正常工作', () => {
      const recorder = getRecorder(defaultOptions);
      const mockInject = vi.fn((key: symbol) => {
        if (key === SIGILLUM_RECORDER_KEY) return recorder;
        return undefined;
      });
      const mockOnUnmounted = vi.fn();

      const result = useAutoRecord(mockInject, mockOnUnmounted);

      // recorder 正在录制，addTag 应该有效
      result.addTag('test-tag', { foo: 'bar' });

      // 事件数应该增加（addTag 会添加一个自定义事件）
      expect(recorder.getEventCount()).toBeGreaterThan(0);
    });

    it('未初始化时传入 options 应自动创建 recorder', () => {
      const mockInject = vi.fn(() => undefined);
      const mockOnUnmounted = vi.fn();

      const result = useAutoRecord(mockInject, mockOnUnmounted, defaultOptions);

      expect(result.recorder).toBeInstanceOf(SessionRecorder);
      expect(result.status).toBe('recording');
    });

    it('已在录制中不应重复开始', () => {
      const recorder = getRecorder(defaultOptions);
      recorder.start(); // 手动先开始

      const mockInject = vi.fn((key: symbol) => {
        if (key === SIGILLUM_RECORDER_KEY) return recorder;
        return undefined;
      });
      const mockOnUnmounted = vi.fn();

      // useAutoRecord 检查 status !== 'idle' 时不会再次 start
      useAutoRecord(mockInject, mockOnUnmounted);

      expect(recorder.getStatus()).toBe('recording');
    });

    it('recorder 为 null 且无 options 时应安全返回', () => {
      const mockInject = vi.fn(() => undefined);
      const mockOnUnmounted = vi.fn();

      const result = useAutoRecord(mockInject, mockOnUnmounted);

      expect(result.recorder).toBeNull();
      expect(result.status).toBe('idle');
      expect(result.sessionId).toBe('');

      // addTag 不应报错
      expect(() => result.addTag('test')).not.toThrow();
    });
  });

  // ==================== 集成场景 ====================

  describe('完整集成场景', () => {
    it('Plugin + useSessionRecorder 完整流程', () => {
      // 1. 创建插件
      const plugin = createSigillumPlugin({
        ...defaultOptions,
        autoStart: false,
      });

      // 2. 模拟 app.use
      const provides = new Map<string | symbol, unknown>();
      const mockApp = {
        provide: vi.fn((key: string | symbol, value: unknown) => {
          provides.set(key, value);
          return mockApp;
        }),
        unmount: vi.fn(),
        config: {},
      };
      plugin.install(mockApp as any);

      // 3. 在组件中使用 useSessionRecorder
      const mockInject = vi.fn((key: symbol) => provides.get(key));
      const recorder = useSessionRecorder(mockInject);

      expect(recorder).toBeInstanceOf(SessionRecorder);
      expect(recorder!.getStatus()).toBe('idle');

      // 4. 手动控制
      recorder!.start();
      expect(recorder!.getStatus()).toBe('recording');

      recorder!.addTag('user-action', { action: 'click' });

      recorder!.pause();
      expect(recorder!.getStatus()).toBe('paused');
    });

    it('Plugin(autoStart) + useAutoRecord 完整流程', () => {
      // 1. 创建插件（autoStart）
      const plugin = createSigillumPlugin(defaultOptions);

      // 2. 模拟 app.use
      const provides = new Map<string | symbol, unknown>();
      const mockApp = {
        provide: vi.fn((key: string | symbol, value: unknown) => {
          provides.set(key, value);
          return mockApp;
        }),
        unmount: vi.fn(),
        config: {},
      };
      plugin.install(mockApp as any);

      // 3. 在组件中使用 useAutoRecord
      const mockInject = vi.fn((key: symbol) => provides.get(key));
      const mockOnUnmounted = vi.fn();

      const { status, sessionId, addTag } = useAutoRecord(mockInject, mockOnUnmounted);

      // 已经在录制中（plugin autoStart 了）
      expect(status).toBe('recording');
      expect(sessionId.length).toBeGreaterThan(0);

      // 添加标记
      addTag('page-view', { route: '/home' });
    });
  });
});

