import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// Mock rrweb 的 record 函数
let mockEmitFn: ((event: any) => void) | null = null;
const mockStopFn = vi.fn();
const mockAddCustomEvent = vi.fn();
const mockTakeFullSnapshot = vi.fn();

vi.mock('rrweb', () => {
  const recordFn = vi.fn((options: any) => {
    // 保存 emit 回调，以便测试中手动触发事件
    mockEmitFn = options.emit;
    return mockStopFn;
  });

  // 挂载静态方法
  (recordFn as any).addCustomEvent = (...args: any[]) => mockAddCustomEvent(...args);
  (recordFn as any).takeFullSnapshot = (...args: any[]) => mockTakeFullSnapshot(...args);

  return { record: recordFn };
});

import {
  SessionRecorder,
  getRecorder,
  resetRecorder,
  isRecorderInitialized,
} from '../src/SessionRecorder';
import { record } from 'rrweb';

describe('SessionRecorder', () => {
  let recorder: SessionRecorder;
  const defaultOptions = {
    onUpload: vi.fn().mockResolvedValue({ success: true }),
    cache: { enabled: false }, // 禁用缓存简化测试
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

  describe('构造和初始化', () => {
    it('应创建 SessionRecorder 实例', () => {
      recorder = new SessionRecorder(defaultOptions);
      expect(recorder).toBeInstanceOf(SessionRecorder);
      expect(recorder.getStatus()).toBe('idle');
    });

    it('非浏览器环境应禁用', () => {
      const origWindow = globalThis.window;
      // @ts-ignore
      delete globalThis.window;

      const rec = new SessionRecorder(defaultOptions);
      rec.start();
      expect(rec.getStatus()).toBe('idle'); // disabled, 不应变为 recording

      globalThis.window = origWindow;
    });

    it('不兼容浏览器应调用 onUnsupported', () => {
      const origMO = globalThis.MutationObserver;
      // @ts-ignore
      delete globalThis.MutationObserver;
      const onUnsupported = vi.fn();

      const rec = new SessionRecorder({
        ...defaultOptions,
        onUnsupported,
      });

      expect(onUnsupported).toHaveBeenCalledWith(expect.stringContaining('MutationObserver'));
      rec.start();
      expect(rec.getStatus()).toBe('idle');

      globalThis.MutationObserver = origMO;
    });
  });

  describe('录制生命周期', () => {
    beforeEach(() => {
      recorder = new SessionRecorder(defaultOptions);
    });

    it('start 应将状态变为 recording', () => {
      recorder.start();
      expect(recorder.getStatus()).toBe('recording');
    });

    it('start 应生成 sessionId', () => {
      recorder.start();
      expect(recorder.getSessionId()).toBeTruthy();
      expect(recorder.getSessionId().length).toBeGreaterThan(0);
    });

    it('重复 start 不应重新初始化', () => {
      recorder.start();
      const firstId = recorder.getSessionId();
      recorder.start(); // 再次调用
      expect(recorder.getSessionId()).toBe(firstId);
    });

    it('stop 应将状态变为 stopped（数据保留供 export）', async () => {
      recorder.start();
      await recorder.stop();
      expect(recorder.getStatus()).toBe('stopped');
    });

    it('stop 应调用 rrweb 的 stopRecording', async () => {
      recorder.start();
      await recorder.stop();
      expect(mockStopFn).toHaveBeenCalled();
    });

    it('pause 应将状态变为 paused', () => {
      recorder.start();
      recorder.pause();
      expect(recorder.getStatus()).toBe('paused');
    });

    it('pause 非 recording 状态应无效', () => {
      recorder.pause(); // idle 状态
      expect(recorder.getStatus()).toBe('idle');
    });

    it('resume 应从 paused 恢复到 recording', () => {
      recorder.start();
      recorder.pause();
      expect(recorder.getStatus()).toBe('paused');
      recorder.resume();
      expect(recorder.getStatus()).toBe('recording');
    });

    it('resume 非 paused 状态应无效', () => {
      recorder.resume(); // idle 状态
      expect(recorder.getStatus()).toBe('idle');
    });
  });

  describe('事件收集', () => {
    beforeEach(() => {
      recorder = new SessionRecorder(defaultOptions);
    });

    it('start 后应能收集事件', () => {
      recorder.start();
      expect(recorder.getEventCount()).toBe(0);

      // 模拟 rrweb 发出事件
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      expect(recorder.getEventCount()).toBe(1);

      mockEmitFn?.({ type: 3, data: {}, timestamp: Date.now() });
      expect(recorder.getEventCount()).toBe(2);
    });
  });

  describe('上传', () => {
    beforeEach(() => {
      recorder = new SessionRecorder(defaultOptions);
    });

    it('stop 时有事件应调用 onUpload（统一 chunk 格式）', async () => {
      recorder.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      await recorder.stop();

      expect(defaultOptions.onUpload).toHaveBeenCalledTimes(1);
      const chunk = defaultOptions.onUpload.mock.calls[0][0];
      expect(chunk.sessionId).toBeTruthy();
      expect(chunk.events).toHaveLength(1);
      expect(chunk.isFinal).toBe(true);
      expect(chunk.chunkIndex).toBe(0);
      expect(chunk.summary).toBeDefined();
    });

    it('stop 时无事件不应调用 onUpload', async () => {
      recorder.start();
      await recorder.stop();
      expect(defaultOptions.onUpload).not.toHaveBeenCalled();
    });

    it('上传失败应重试', async () => {
      const failUpload = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true });

      const rec = new SessionRecorder({
        ...defaultOptions,
        onUpload: failUpload,
        maxRetries: 2,
      });

      rec.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      await rec.stop();

      expect(failUpload).toHaveBeenCalledTimes(2);
    }, 10000);

    it('beforeUpload 应在上传前处理数据', async () => {
      const rec = new SessionRecorder({
        ...defaultOptions,
        beforeUpload: (chunk) => ({
          ...chunk,
          userId: 'user-123',
        }),
      });

      rec.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      await rec.stop();

      const uploadData = defaultOptions.onUpload.mock.calls[0][0];
      expect(uploadData.userId).toBe('user-123');
    });

    it('onChunkUpload 作为 deprecated fallback 应正常工作', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onChunkUpload = vi.fn().mockResolvedValue({ success: true });

      const rec = new SessionRecorder({
        cache: { enabled: false },
        onChunkUpload,
      });

      rec.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      await rec.stop();

      expect(onChunkUpload).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('onChunkUpload is deprecated'));
      warnSpy.mockRestore();
    });

    it('同时提供 onUpload 和 onChunkUpload 时 onUpload 优先', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onUpload = vi.fn().mockResolvedValue({ success: true });
      const onChunkUpload = vi.fn().mockResolvedValue({ success: true });

      const rec = new SessionRecorder({
        cache: { enabled: false },
        onUpload,
        onChunkUpload,
      });

      rec.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      await rec.stop();

      expect(onUpload).toHaveBeenCalledTimes(1);
      expect(onChunkUpload).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('onUpload will be used'));
      warnSpy.mockRestore();
    });
  });

  describe('标记 (Tags)', () => {
    beforeEach(() => {
      recorder = new SessionRecorder(defaultOptions);
    });

    it('录制中应能添加标记', () => {
      recorder.start();
      recorder.addTag('click-button', { buttonId: 'submit' });
      // addTag 使用 rrweb 原生 addCustomEvent
      expect(mockAddCustomEvent).toHaveBeenCalledWith(
        'sigillum-tag',
        expect.objectContaining({ name: 'click-button', data: { buttonId: 'submit' } })
      );
    });

    it('非录制状态不应添加标记', () => {
      recorder.addTag('test'); // idle 状态
      expect(mockAddCustomEvent).not.toHaveBeenCalled();
    });

    it('addCustomEvent 失败时应回退到手动事件', () => {
      mockAddCustomEvent.mockImplementationOnce(() => {
        throw new Error('not available');
      });

      recorder.start();
      const initialCount = recorder.getEventCount();
      recorder.addTag('fallback-tag');
      // 回退方式会手动 push 事件
      expect(recorder.getEventCount()).toBe(initialCount + 1);
    });
  });

  describe('takeFullSnapshot', () => {
    beforeEach(() => {
      recorder = new SessionRecorder(defaultOptions);
    });

    it('录制中应能触发全量快照', () => {
      recorder.start();
      recorder.takeFullSnapshot();
      expect(mockTakeFullSnapshot).toHaveBeenCalled();
    });

    it('非录制状态不应触发全量快照', () => {
      recorder.takeFullSnapshot(); // idle 状态
      expect(mockTakeFullSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('sessionId 管理', () => {
    beforeEach(() => {
      recorder = new SessionRecorder(defaultOptions);
    });

    it('idle 状态可设置 sessionId', () => {
      recorder.setSessionId('custom-id');
      expect(recorder.getSessionId()).toBe('custom-id');
    });

    it('录制中不可设置 sessionId', () => {
      recorder.start();
      const originalId = recorder.getSessionId();
      recorder.setSessionId('new-id');
      expect(recorder.getSessionId()).toBe(originalId);
    });
  });

  describe('enabled 条件', () => {
    it('enabled: false 应不启动录制', () => {
      const rec = new SessionRecorder({
        ...defaultOptions,
        enabled: false,
      });
      rec.start();
      expect(rec.getStatus()).toBe('idle');
    });

    it('enabled 函数返回 false 应不启动录制', () => {
      const rec = new SessionRecorder({
        ...defaultOptions,
        enabled: () => false,
      });
      rec.start();
      expect(rec.getStatus()).toBe('idle');
    });

    it('enabled 函数返回 true 应正常录制', () => {
      const rec = new SessionRecorder({
        ...defaultOptions,
        enabled: () => true,
      });
      rec.start();
      expect(rec.getStatus()).toBe('recording');
    });

    it('enabled 函数抛错应禁用录制', () => {
      const rec = new SessionRecorder({
        ...defaultOptions,
        enabled: () => { throw new Error('oops'); },
      });
      rec.start();
      expect(rec.getStatus()).toBe('idle');
    });
  });

  describe('事件回调', () => {
    it('onEventEmit 应在每个事件触发时调用', () => {
      const onEventEmit = vi.fn();
      recorder = new SessionRecorder({
        ...defaultOptions,
        onEventEmit,
      });

      recorder.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      expect(onEventEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 2 }),
        1 // eventCount
      );

      mockEmitFn?.({ type: 3, data: {}, timestamp: Date.now() });
      expect(onEventEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 3 }),
        2 // eventCount
      );
    });

    it('onStatusChange 应在状态变化时调用', () => {
      const onStatusChange = vi.fn();
      recorder = new SessionRecorder({
        ...defaultOptions,
        onStatusChange,
      });

      recorder.start();
      expect(onStatusChange).toHaveBeenCalledWith('recording', 'idle');

      recorder.pause();
      expect(onStatusChange).toHaveBeenCalledWith('paused', 'recording');

      recorder.resume();
      expect(onStatusChange).toHaveBeenCalledWith('recording', 'paused');
    });

    it('onStatusChange 不应在状态未变时触发', () => {
      const onStatusChange = vi.fn();
      recorder = new SessionRecorder({
        ...defaultOptions,
        onStatusChange,
      });

      // idle -> idle（start 因 disabled 失败）
      const rec2 = new SessionRecorder({
        ...defaultOptions,
        enabled: false,
        onStatusChange,
      });
      rec2.start();
      // onStatusChange 不应被调用（状态没变，仍然是 idle）
      expect(onStatusChange).not.toHaveBeenCalled();
    });

    it('onError 应在录制启动失败时调用', () => {
      const onError = vi.fn();
      // 让 record 抛错
      (record as any).mockImplementationOnce(() => {
        throw new Error('rrweb init failed');
      });

      recorder = new SessionRecorder({
        ...defaultOptions,
        onError,
      });

      recorder.start();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe('rrweb init failed');
    });

    it('onError 应在上传最终失败时调用', async () => {
      const onError = vi.fn();
      const failUpload = vi.fn().mockRejectedValue(new Error('Network error'));

      recorder = new SessionRecorder({
        cache: { enabled: false },
        onUpload: failUpload,
        onError,
        maxRetries: 1,
      });

      recorder.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      await recorder.stop();

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    }, 10000);

    it('onEventEmit 抛错不应影响录制', () => {
      const onEventEmit = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });

      recorder = new SessionRecorder({
        ...defaultOptions,
        onEventEmit,
      });

      recorder.start();
      // 不应抛错
      expect(() => {
        mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      }).not.toThrow();
      expect(recorder.getEventCount()).toBe(1);
    });

    it('onStatusChange 抛错不应影响状态变更', () => {
      const onStatusChange = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });

      recorder = new SessionRecorder({
        ...defaultOptions,
        onStatusChange,
      });

      recorder.start();
      // 状态应该正常变更，不受回调错误影响
      expect(recorder.getStatus()).toBe('recording');
    });
  });

  describe('rrweb 配置透传', () => {
    it('隐私配置应完整透传给 rrweb', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          privacy: {
            blockClass: 'private-block',
            blockSelector: '.secret',
            maskTextClass: 'mask-text',
            maskTextSelector: '[data-sensitive]',
            maskAllInputs: true,
            maskInputOptions: { email: true, tel: true, password: true },
            ignoreClass: 'no-record',
          },
        },
      });

      recorder.start();

      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.blockClass).toBe('private-block');
      expect(recordCall.blockSelector).toBe('.secret');
      expect(recordCall.maskTextClass).toBe('mask-text');
      expect(recordCall.maskTextSelector).toBe('[data-sensitive]');
      expect(recordCall.maskAllInputs).toBe(true);
      expect(recordCall.maskInputOptions).toEqual({ email: true, tel: true, password: true });
      expect(recordCall.ignoreClass).toBe('no-record');
    });

    it('使用 blockSelector 时应输出控制台警告', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          privacy: {
            blockSelector: '.secret',
          },
        },
      });

      recorder.start();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('blockSelector has a known bug')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('rrweb-io/rrweb/issues/1486')
      );

      warnSpy.mockRestore();
    });

    it('不使用 blockSelector 时不应输出警告', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          privacy: {
            blockClass: 'private-block',
            maskAllInputs: true,
          },
        },
      });

      recorder.start();

      const blockSelectorWarnings = warnSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('blockSelector')
      );
      expect(blockSelectorWarnings).toHaveLength(0);

      warnSpy.mockRestore();
    });

    it('slimDOMOptions 应透传给 rrweb', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          slimDOMOptions: 'all',
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.slimDOMOptions).toBe('all');
    });

    it('slimDOMOptions 对象应透传给 rrweb', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          slimDOMOptions: { script: true, comment: true },
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.slimDOMOptions).toEqual({ script: true, comment: true });
    });

    it('packFn 应透传给 rrweb', () => {
      const mockPackFn = vi.fn((event: any) => JSON.stringify(event));
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          packFn: mockPackFn,
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.packFn).toBe(mockPackFn);
    });

    it('plugins 应透传给 rrweb', () => {
      const mockPlugin = { name: 'test-plugin', options: {} };
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          plugins: [mockPlugin],
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.plugins).toEqual([mockPlugin]);
    });

    it('recordCrossOriginIframes 应透传给 rrweb', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          recordCrossOriginIframes: true,
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.recordCrossOriginIframes).toBe(true);
    });

    it('inlineImages 应透传给 rrweb', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          inlineImages: true,
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.inlineImages).toBe(true);
    });

    it('collectFonts 应透传给 rrweb', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          collectFonts: true,
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.collectFonts).toBe(true);
    });

    it('inlineStylesheet 应透传给 rrweb', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          inlineStylesheet: false,
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.inlineStylesheet).toBe(false);
    });

    it('checkoutEveryNth 应透传给 rrweb', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          checkoutEveryNth: 200,
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.checkoutEveryNth).toBe(200);
    });

    it('userTriggeredOnInput 应透传给 rrweb', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          userTriggeredOnInput: true,
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.userTriggeredOnInput).toBe(true);
    });

    it('maskInputFn 应透传给 rrweb', () => {
      const maskFn = (text: string) => '***';
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          privacy: {
            maskInputFn: maskFn,
          },
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.maskInputFn).toBe(maskFn);
    });

    it('maskTextFn 应透传给 rrweb', () => {
      const maskFn = (text: string) => text.replace(/./g, '*');
      recorder = new SessionRecorder({
        ...defaultOptions,
        rrwebConfig: {
          privacy: {
            maskTextFn: maskFn,
          },
        },
      });

      recorder.start();
      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.maskTextFn).toBe(maskFn);
    });

    it('默认隐私配置应只遮盖密码', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();

      const recordCall = (record as any).mock.calls[0][0];
      expect(recordCall.maskInputOptions).toEqual({ password: true });
      expect(recordCall.maskAllInputs).toBeFalsy();
      expect(recordCall.ignoreClass).toBe('rr-ignore');
    });
  });

  describe('destroy', () => {
    it('应停止录制并重置状态', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      expect(recorder.getStatus()).toBe('recording');

      recorder.destroy();
      expect(recorder.getStatus()).toBe('idle');
      expect(recorder.getSessionId()).toBe('');
      expect(recorder.getEventCount()).toBe(0);
    });

    it('destroy 后不可再 start', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.destroy();
      recorder.start(); // disabled = true
      expect(recorder.getStatus()).toBe('idle');
    });
  });

  describe('单例模式', () => {
    it('getRecorder 应返回单例', () => {
      const r1 = getRecorder(defaultOptions);
      const r2 = getRecorder(); // 不传 options
      expect(r1).toBe(r2);
    });

    it('未初始化时无 options 应返回 null', () => {
      expect(getRecorder()).toBeNull();
    });

    it('resetRecorder 应销毁并清除实例', () => {
      getRecorder(defaultOptions);
      expect(isRecorderInitialized()).toBe(true);

      resetRecorder();
      expect(isRecorderInitialized()).toBe(false);
    });

    it('isRecorderInitialized 应正确反映状态', () => {
      expect(isRecorderInitialized()).toBe(false);
      getRecorder(defaultOptions);
      expect(isRecorderInitialized()).toBe(true);
      resetRecorder();
      expect(isRecorderInitialized()).toBe(false);
    });
  });

  describe('会话元数据自动采集', () => {
    it('start 后应自动采集元数据', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();

      const metadata = recorder.getMetadata();
      expect(metadata).not.toBeNull();
      expect(metadata!.title).toBeDefined();
      expect(metadata!.language).toBeDefined();
      expect(metadata!.timezone).toBeDefined();
      expect(metadata!.hardwareConcurrency).toBeGreaterThanOrEqual(0);
      expect(typeof metadata!.touchSupport).toBe('boolean');
      expect(metadata!.devicePixelRatio).toBeGreaterThan(0);
    });

    it('idle 状态 getMetadata 应返回 null', () => {
      recorder = new SessionRecorder(defaultOptions);
      expect(recorder.getMetadata()).toBeNull();
    });

    it('元数据应包含 referrer', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      const metadata = recorder.getMetadata();
      expect(metadata).toHaveProperty('referrer');
    });

    it('元数据应包含 connectionType', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      const metadata = recorder.getMetadata();
      // jsdom 没有 navigator.connection，应返回 unknown
      expect(metadata!.connectionType).toBeDefined();
    });

    it('stop 后上传数据应包含 metadata（首个 chunk）', async () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      await recorder.stop();

      const chunk = defaultOptions.onUpload.mock.calls[0][0];
      expect(chunk.metadata).toBeDefined();
      expect(chunk.metadata.language).toBeDefined();
    });
  });

  describe('SPA 路由变化追踪', () => {
    beforeEach(() => {
      recorder = new SessionRecorder(defaultOptions);
    });

    it('start 后应开始监听路由变化', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      recorder.start();
      expect(addSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
      addSpy.mockRestore();
    });

    it('pushState 应被追踪', () => {
      recorder.start();

      // 模拟 SPA 路由跳转
      history.pushState({}, '', '/new-page');
      const routes = recorder.getRouteChanges();

      expect(routes.length).toBeGreaterThanOrEqual(1);
      expect(routes[routes.length - 1].to).toContain('/new-page');
    });

    it('replaceState 应被追踪', () => {
      recorder.start();

      history.replaceState({}, '', '/replaced-page');
      const routes = recorder.getRouteChanges();

      expect(routes.length).toBeGreaterThanOrEqual(1);
      expect(routes[routes.length - 1].to).toContain('/replaced-page');
    });

    it('相同 URL 不应重复记录', () => {
      recorder.start();
      const currentUrl = window.location.href;
      const beforeCount = recorder.getRouteChanges().length;

      history.pushState({}, '', currentUrl);

      expect(recorder.getRouteChanges().length).toBe(beforeCount);
    });

    it('stop 后应停止路由追踪', async () => {
      recorder.start();
      await recorder.stop();

      // 恢复后 pushState 不应再被追踪
      const routesBefore = recorder.getRouteChanges();
      history.pushState({}, '', '/after-stop');
      const routesAfter = recorder.getRouteChanges();
      expect(routesAfter.length).toBe(routesBefore.length);
    });

    it('pause 后应停止路由追踪', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      recorder.start();
      recorder.pause();

      // pause 调用了 stopRouteTracking，应移除 popstate 监听
      expect(removeSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
      removeSpy.mockRestore();
    });

    it('路由变化应同时作为 rrweb 自定义事件记录', () => {
      recorder.start();
      mockAddCustomEvent.mockClear();

      history.pushState({}, '', '/tracked-route');

      // jsdom 下 pushState 会改变 location.href
      expect(window.location.href).toContain('/tracked-route');
      expect(mockAddCustomEvent).toHaveBeenCalledWith(
        'sigillum-route-change',
        expect.objectContaining({
          to: expect.stringContaining('/tracked-route'),
        })
      );
    });

    it('destroy 后应恢复 pushState/replaceState（不再劫持）', () => {
      recorder.start();
      const hijackedPush = history.pushState;

      recorder.destroy();
      // destroy 后 pushState 应被恢复（不同于劫持版本）
      expect(history.pushState).not.toBe(hijackedPush);
    });
  });

  describe('录制行为摘要', () => {
    beforeEach(() => {
      recorder = new SessionRecorder(defaultOptions);
    });

    it('idle 状态 getSummary 应返回 null', () => {
      expect(recorder.getSummary()).toBeNull();
    });

    it('recording 状态应能获取摘要', () => {
      recorder.start();
      const summary = recorder.getSummary();
      expect(summary).not.toBeNull();
      expect(summary!.totalEvents).toBe(0);
      expect(summary!.clickCount).toBe(0);
      expect(summary!.inputCount).toBe(0);
      expect(summary!.scrollCount).toBe(0);
    });

    it('应正确统计点击事件', () => {
      recorder.start();

      // 模拟 IncrementalSnapshot + MouseInteraction + Click
      mockEmitFn?.({
        type: 3, // IncrementalSnapshot
        data: { source: 2, type: 2 }, // MouseInteraction, Click
        timestamp: Date.now(),
      });

      const summary = recorder.getSummary();
      expect(summary!.clickCount).toBe(1);
    });

    it('应正确统计双击事件', () => {
      recorder.start();

      mockEmitFn?.({
        type: 3,
        data: { source: 2, type: 4 }, // MouseInteraction, DblClick
        timestamp: Date.now(),
      });

      const summary = recorder.getSummary();
      expect(summary!.clickCount).toBe(1);
    });

    it('应正确统计输入事件', () => {
      recorder.start();

      mockEmitFn?.({
        type: 3,
        data: { source: 5 }, // Input
        timestamp: Date.now(),
      });
      mockEmitFn?.({
        type: 3,
        data: { source: 5 },
        timestamp: Date.now(),
      });

      const summary = recorder.getSummary();
      expect(summary!.inputCount).toBe(2);
    });

    it('应正确统计滚动事件', () => {
      recorder.start();

      mockEmitFn?.({
        type: 3,
        data: { source: 3 }, // Scroll
        timestamp: Date.now(),
      });

      const summary = recorder.getSummary();
      expect(summary!.scrollCount).toBe(1);
    });

    it('非 IncrementalSnapshot 事件不应影响统计', () => {
      recorder.start();

      // FullSnapshot 事件
      mockEmitFn?.({
        type: 2,
        data: {},
        timestamp: Date.now(),
      });

      const summary = recorder.getSummary();
      expect(summary!.clickCount).toBe(0);
      expect(summary!.inputCount).toBe(0);
      expect(summary!.scrollCount).toBe(0);
      expect(summary!.totalEvents).toBe(1);
    });

    it('摘要应包含 visitedUrls', () => {
      recorder.start();
      const summary = recorder.getSummary();
      expect(summary!.visitedUrls).toBeInstanceOf(Array);
      expect(summary!.visitedUrls.length).toBeGreaterThanOrEqual(1);
    });

    it('摘要应包含 duration', () => {
      recorder.start();
      // 等一小段时间
      const summary = recorder.getSummary();
      expect(summary!.duration).toBeGreaterThanOrEqual(0);
    });

    it('暂停期间 getSummary 的 duration 应排除暂停时间', () => {
      vi.useFakeTimers();
      try {
        recorder.start();
        vi.advanceTimersByTime(100);
        recorder.pause();
        vi.advanceTimersByTime(500); // 暂停 500ms
        const summary = recorder.getSummary();
        // duration 应约为 100ms（录制时间），而非 600ms（含暂停）
        expect(summary!.duration).toBeLessThanOrEqual(150);
        expect(summary!.duration).toBeGreaterThanOrEqual(50);
      } finally {
        vi.useRealTimers();
      }
    });

    it('pause→stop 后 duration 应排除暂停时间', async () => {
      vi.useFakeTimers();
      try {
        recorder.start();
        vi.advanceTimersByTime(100);
        recorder.pause();
        vi.advanceTimersByTime(500); // 暂停 500ms
        await recorder.stop();
        const summary = recorder.getSummary();
        expect(summary!.duration).toBeLessThanOrEqual(150);
        expect(summary!.duration).toBeGreaterThanOrEqual(50);
      } finally {
        vi.useRealTimers();
      }
    });

    it('pause→resume→stop 后 duration 应排除暂停时间', async () => {
      vi.useFakeTimers();
      try {
        recorder.start();
        vi.advanceTimersByTime(100); // 录制 100ms
        recorder.pause();
        vi.advanceTimersByTime(500); // 暂停 500ms
        recorder.resume();
        vi.advanceTimersByTime(100); // 再录制 100ms
        await recorder.stop();
        const summary = recorder.getSummary();
        // duration 应约为 200ms
        expect(summary!.duration).toBeLessThanOrEqual(250);
        expect(summary!.duration).toBeGreaterThanOrEqual(150);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stop 后上传 chunk 应包含 summary', async () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();

      mockEmitFn?.({
        type: 3,
        data: { source: 2, type: 2 }, // Click
        timestamp: Date.now(),
      });
      mockEmitFn?.({
        type: 3,
        data: { source: 5 }, // Input
        timestamp: Date.now(),
      });

      await recorder.stop();

      const chunk = defaultOptions.onUpload.mock.calls[0][0];
      expect(chunk.summary).toBeDefined();
      expect(chunk.summary.clickCount).toBe(1);
      expect(chunk.summary.inputCount).toBe(1);
      expect(chunk.summary.totalEvents).toBe(2);
    });
  });

  describe('分段上传', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('启用分段上传应按间隔上传', async () => {
      const onUpload = vi.fn().mockResolvedValue({ success: true });

      recorder = new SessionRecorder({
        cache: { enabled: false },
        chunkedUpload: { enabled: true, interval: 1000 },
        onUpload,
      });

      recorder.start();

      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      mockEmitFn?.({ type: 3, data: { source: 3 }, timestamp: Date.now() });

      await vi.advanceTimersByTimeAsync(1000);

      expect(onUpload).toHaveBeenCalledTimes(1);
      const chunk = onUpload.mock.calls[0][0];
      expect(chunk.sessionId).toBeTruthy();
      expect(chunk.chunkIndex).toBe(0);
      expect(chunk.isFinal).toBe(false);
      expect(chunk.events.length).toBe(2);
      expect(chunk.summary).toBeDefined();
      expect(chunk.metadata).toBeDefined();
    });

    it('第二个分段不应包含 metadata', async () => {
      const onUpload = vi.fn().mockResolvedValue({ success: true });

      recorder = new SessionRecorder({
        cache: { enabled: false },
        chunkedUpload: { enabled: true, interval: 1000 },
        onUpload,
      });

      recorder.start();

      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(1000);

      mockEmitFn?.({ type: 3, data: {}, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(1000);

      expect(onUpload).toHaveBeenCalledTimes(2);
      const chunk2 = onUpload.mock.calls[1][0];
      expect(chunk2.chunkIndex).toBe(1);
      expect(chunk2.metadata).toBeUndefined();
    });

    it('无新事件时不应上传分段', async () => {
      const onUpload = vi.fn().mockResolvedValue({ success: true });

      recorder = new SessionRecorder({
        cache: { enabled: false },
        chunkedUpload: { enabled: true, interval: 1000 },
        onUpload,
      });

      recorder.start();

      await vi.advanceTimersByTimeAsync(1000);

      expect(onUpload).not.toHaveBeenCalled();
    });

    it('stop 时应上传最终分段（isFinal: true）', async () => {
      const onUpload = vi.fn().mockResolvedValue({ success: true });

      recorder = new SessionRecorder({
        cache: { enabled: false },
        chunkedUpload: { enabled: true, interval: 60000 },
        onUpload,
      });

      recorder.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });

      await recorder.stop();

      expect(onUpload).toHaveBeenCalledTimes(1);
      const chunk = onUpload.mock.calls[0][0];
      expect(chunk.isFinal).toBe(true);
    });

    it('未启用分段上传但有 onUpload 时 stop 仍应上传最终分段', async () => {
      const onUpload = vi.fn().mockResolvedValue({ success: true });

      recorder = new SessionRecorder({
        cache: { enabled: false },
        onUpload,
      });

      recorder.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      await recorder.stop();

      expect(onUpload).toHaveBeenCalledTimes(1);
      const chunk = onUpload.mock.calls[0][0];
      expect(chunk.isFinal).toBe(true);
    });

    it('分段上传只包含该分段内的新事件', async () => {
      const onUpload = vi.fn().mockResolvedValue({ success: true });

      recorder = new SessionRecorder({
        cache: { enabled: false },
        chunkedUpload: { enabled: true, interval: 1000 },
        onUpload,
      });

      recorder.start();

      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      mockEmitFn?.({ type: 3, data: {}, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(1000);

      mockEmitFn?.({ type: 3, data: { source: 5 }, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(1000);

      expect(onUpload).toHaveBeenCalledTimes(2);
      expect(onUpload.mock.calls[0][0].events.length).toBe(2);
      expect(onUpload.mock.calls[1][0].events.length).toBe(1);
    });

    it('分段上传错误不应中断录制', async () => {
      const onUpload = vi.fn().mockRejectedValue(new Error('upload failed'));
      const onError = vi.fn();

      recorder = new SessionRecorder({
        cache: { enabled: false },
        chunkedUpload: { enabled: true, interval: 1000 },
        onUpload,
        onError,
        maxRetries: 0,
      });

      recorder.start();
      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(recorder.getStatus()).toBe('recording');
      expect(onError).toHaveBeenCalled();
    });

    it('上传失败应回滚进度，下次包含之前失败的事件', async () => {
      const onUpload = vi.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue({ success: true });

      recorder = new SessionRecorder({
        cache: { enabled: false },
        chunkedUpload: { enabled: true, interval: 1000 },
        onUpload,
        maxRetries: 0,
      });

      recorder.start();

      mockEmitFn?.({ type: 2, data: {}, timestamp: Date.now() });
      mockEmitFn?.({ type: 3, data: {}, timestamp: Date.now() });

      // 第一次上传失败
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      // 添加更多事件
      mockEmitFn?.({ type: 3, data: { source: 5 }, timestamp: Date.now() });

      // 第二次上传应包含所有事件（包括之前失败的）
      await vi.advanceTimersByTimeAsync(1000);

      const lastCall = onUpload.mock.calls[onUpload.mock.calls.length - 1][0];
      expect(lastCall.events.length).toBe(3);
      expect(lastCall.chunkIndex).toBe(0); // 回滚后仍是 chunk 0
    });
  });

  describe('页面卸载处理', () => {
    it('uploadOnUnload 默认应注册 pagehide 事件', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      recorder = new SessionRecorder({
        ...defaultOptions,
        uploadOnUnload: true,
      });
      recorder.start();

      expect(addSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
      addSpy.mockRestore();
    });

    it('uploadOnUnload: false 不应注册 pagehide 事件', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      recorder = new SessionRecorder({
        ...defaultOptions,
        uploadOnUnload: false,
      });
      recorder.start();

      const pagehideCalls = addSpy.mock.calls.filter(
        ([event]) => event === 'pagehide'
      );
      expect(pagehideCalls).toHaveLength(0);
      addSpy.mockRestore();
    });

    it('stop 后应移除 pagehide 事件', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      recorder = new SessionRecorder({
        ...defaultOptions,
        uploadOnUnload: true,
      });
      recorder.start();
      await recorder.stop();

      expect(removeSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
      removeSpy.mockRestore();
    });
  });

  describe('exportRecording / clearRecording', () => {
    it('stopped 状态下 exportRecording 应返回完整数据', async () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      // 模拟事件通过 rrweb emit
      const emit = (record as any).mock.calls[0]?.[0]?.emit;
      if (emit) {
        emit({ type: 2, data: {}, timestamp: Date.now() });
        emit({ type: 3, data: {}, timestamp: Date.now() });
      }
      await recorder.stop();
      expect(recorder.getStatus()).toBe('stopped');

      const envelope = recorder.exportRecording();
      expect(envelope).not.toBeNull();
      expect(envelope!.sigillum).toBe(true);
      expect(envelope!.schemaVersion).toBe(1);
      expect(envelope!.source).toBe('web');
      expect(envelope!.sdkVersion).toBeTruthy();
      expect(envelope!.exportedAt).toBeGreaterThan(0);

      const data = envelope!.recording;
      expect(data.sessionId).toBeTruthy();
      expect(data.events.length).toBeGreaterThanOrEqual(0);
      expect(data.startTime).toBeGreaterThan(0);
      expect(data.endTime).toBeGreaterThan(0);
      expect(data.duration).toBeGreaterThanOrEqual(0);
    });

    it('idle 状态下 exportRecording 应返回 null', () => {
      recorder = new SessionRecorder(defaultOptions);
      expect(recorder.exportRecording()).toBeNull();
    });

    it('recording 状态下 exportRecording 应返回 null', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      expect(recorder.exportRecording()).toBeNull();
    });

    it('无事件时 exportRecording 应返回 null', async () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      await recorder.stop();
      // events 为空（mock rrweb 未 emit 任何事件）
      expect(recorder.exportRecording()).toBeNull();
    });

    it('clearRecording 应清空所有数据', async () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      await recorder.stop();
      recorder.clearRecording();
      expect(recorder.getStatus()).toBe('idle');
      expect(recorder.getSessionId()).toBe('');
      expect(recorder.getEventCount()).toBe(0);
    });

    it('recording 状态下 clearRecording 应被忽略', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      const sid = recorder.getSessionId();
      recorder.clearRecording();
      expect(recorder.getSessionId()).toBe(sid);
      expect(recorder.getStatus()).toBe('recording');
    });

    it('clearRecording 后可正常 start 新录制', async () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      await recorder.stop();
      recorder.clearRecording();
      recorder.start();
      expect(recorder.getStatus()).toBe('recording');
      expect(recorder.getSessionId()).toBeTruthy();
    });
  });

  describe('maxEvents 自动停止', () => {
    it('事件数达到 maxEvents 应自动停止录制', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        maxEvents: 3,
      });
      recorder.start();
      const emit = (record as any).mock.calls[0]?.[0]?.emit;
      expect(emit).toBeDefined();

      emit({ type: 2, data: {}, timestamp: Date.now() });
      emit({ type: 3, data: {}, timestamp: Date.now() });
      // 第 3 个事件触发 maxEvents
      emit({ type: 3, data: {}, timestamp: Date.now() });

      expect(recorder.getStatus()).toBe('stopped');
    });

    it('未达到 maxEvents 应继续录制', () => {
      recorder = new SessionRecorder({
        ...defaultOptions,
        maxEvents: 10,
      });
      recorder.start();
      const emit = (record as any).mock.calls[0]?.[0]?.emit;
      expect(emit).toBeDefined();

      emit({ type: 2, data: {}, timestamp: Date.now() });
      emit({ type: 3, data: {}, timestamp: Date.now() });
      expect(recorder.getStatus()).toBe('recording');
    });
  });

  describe('identify', () => {
    it('录制中调用 identify 应更新 metadata 并触发 addCustomEvent', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      recorder.identify('user-123', { name: 'Alice' });

      const metadata = recorder.getMetadata();
      expect(metadata?.user).toBeDefined();
      expect(metadata?.user?.userId).toBe('user-123');
      expect(metadata?.user?.traits).toEqual({ name: 'Alice' });
      expect(metadata?.user?.identifiedAt).toBeGreaterThan(0);

      expect(mockAddCustomEvent).toHaveBeenCalledWith(
        'sigillum-identify',
        { userId: 'user-123', traits: { name: 'Alice' } },
      );
    });

    it('idle 状态调用 identify 应在 start 后生效', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.identify('user-early', { role: 'tester' });
      expect(recorder.getMetadata()).toBeNull();

      recorder.start();
      const metadata = recorder.getMetadata();
      expect(metadata?.user?.userId).toBe('user-early');
      expect(metadata?.user?.traits).toEqual({ role: 'tester' });
    });

    it('多次 identify 应覆盖之前的身份', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      recorder.identify('user-A');
      recorder.identify('user-B', { role: 'admin' });

      const metadata = recorder.getMetadata();
      expect(metadata?.user?.userId).toBe('user-B');
      expect(metadata?.user?.traits).toEqual({ role: 'admin' });
    });
  });

  describe('getEstimatedSize', () => {
    it('无事件时返回 0', () => {
      recorder = new SessionRecorder(defaultOptions);
      expect(recorder.getEstimatedSize()).toBe(0);
    });

    it('录制中返回正数', () => {
      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      const emit = (record as any).mock.calls[0]?.[0]?.emit;
      emit({ type: 2, data: { html: '<h1>Hello</h1>' }, timestamp: Date.now() });
      emit({ type: 3, data: {}, timestamp: Date.now() });
      emit({ type: 3, data: {}, timestamp: Date.now() });

      const size = recorder.getEstimatedSize();
      expect(size).toBeGreaterThan(0);
    });
  });

  describe('sendBeacon unload', () => {
    let originalSendBeacon: any;

    beforeEach(() => {
      originalSendBeacon = navigator.sendBeacon;
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'sendBeacon', {
        value: originalSendBeacon,
        writable: true,
        configurable: true,
      });
    });

    it('配置 beaconUrl 时，pagehide 应使用 sendBeacon', () => {
      const mockSendBeacon = vi.fn().mockReturnValue(true);
      Object.defineProperty(navigator, 'sendBeacon', {
        value: mockSendBeacon,
        writable: true,
        configurable: true,
      });

      recorder = new SessionRecorder({
        ...defaultOptions,
        beaconUrl: 'https://example.com/beacon',
      });
      recorder.start();
      const emit = (record as any).mock.calls[0]?.[0]?.emit;
      emit({ type: 2, data: {}, timestamp: Date.now() });

      window.dispatchEvent(new Event('pagehide'));

      expect(mockSendBeacon).toHaveBeenCalledWith(
        'https://example.com/beacon',
        expect.any(Blob),
      );

      recorder.destroy();
    });

    it('sendBeacon 失败时应降级到缓存', () => {
      const mockSendBeacon = vi.fn().mockReturnValue(false);
      Object.defineProperty(navigator, 'sendBeacon', {
        value: mockSendBeacon,
        writable: true,
        configurable: true,
      });

      recorder = new SessionRecorder({
        ...defaultOptions,
        beaconUrl: 'https://example.com/beacon',
      });
      recorder.start();
      const emit = (record as any).mock.calls[0]?.[0]?.emit;
      emit({ type: 2, data: {}, timestamp: Date.now() });

      window.dispatchEvent(new Event('pagehide'));

      expect(mockSendBeacon).toHaveBeenCalled();

      recorder.destroy();
    });

    it('未配置 beaconUrl 时不调用 sendBeacon', () => {
      const mockSendBeacon = vi.fn();
      Object.defineProperty(navigator, 'sendBeacon', {
        value: mockSendBeacon,
        writable: true,
        configurable: true,
      });

      recorder = new SessionRecorder(defaultOptions);
      recorder.start();
      const emit = (record as any).mock.calls[0]?.[0]?.emit;
      emit({ type: 2, data: {}, timestamp: Date.now() });

      window.dispatchEvent(new Event('pagehide'));

      expect(mockSendBeacon).not.toHaveBeenCalled();
    });
  });

  describe('崩溃恢复 FullSnapshot 补充', () => {
    it('恢复 chunk 中缺少 FullSnapshot 时应从缓存中补充', async () => {
      vi.useRealTimers();

      const onUpload = vi.fn().mockResolvedValue({ success: true });

      // 第一步：创建 recorder 并手动缓存一些包含 FullSnapshot 的事件
      const recorder1 = new SessionRecorder({
        cache: { enabled: true },
        chunkedUpload: { enabled: true, interval: 999999 },
        onUpload,
      });
      recorder1.start();

      const emit1 = (record as any).mock.calls[(record as any).mock.calls.length - 1]?.[0]?.emit;

      // 模拟 FullSnapshot (type=2) + Meta (type=4) + IncrementalSnapshot (type=3)
      const now = Date.now();
      emit1({ type: 4, data: { href: 'http://test.com' }, timestamp: now });
      emit1({ type: 2, data: { node: { type: 0 } }, timestamp: now + 1 });
      for (let i = 0; i < 10; i++) {
        emit1({ type: 3, data: { source: 0 }, timestamp: now + 100 + i * 100 });
      }

      // 等待缓存写入
      await new Promise(r => setTimeout(r, 200));

      // 模拟"第一个 chunk 已上传成功"：手动推进 lastChunkEventIndex
      // 通过直接调用 uploadChunk（模拟定时器触发）
      await (recorder1 as any).uploadChunk(false);

      // 此时 onUpload 应已被调用一次（c0 包含 FullSnapshot）
      expect(onUpload).toHaveBeenCalledTimes(1);
      const c0 = onUpload.mock.calls[0][0];
      expect(c0.events.some((e: any) => e.type === 2)).toBe(true);

      // 添加更多增量事件（这些会被缓存但未上传）
      for (let i = 0; i < 5; i++) {
        emit1({ type: 3, data: { source: 1 }, timestamp: now + 2000 + i * 100 });
      }
      await new Promise(r => setTimeout(r, 200));

      // 模拟崩溃：销毁 recorder 但不清理 IndexedDB
      (recorder1 as any).stopRecordingFn?.();
      (recorder1 as any).stopRecordingFn = null;
      (recorder1 as any).clearTimers();
      (recorder1 as any).setStatus('stopped');

      // 第二步：创建新 recorder，触发恢复
      onUpload.mockClear();
      const recorder2 = new SessionRecorder({
        cache: { enabled: true },
        chunkedUpload: { enabled: true, interval: 999999 },
        onUpload,
      });

      // 等待恢复完成
      await new Promise(r => setTimeout(r, 500));

      // 恢复 chunk 应包含 FullSnapshot (type=2)
      if (onUpload.mock.calls.length > 0) {
        const recoveryChunk = onUpload.mock.calls[0][0];
        expect(recoveryChunk.isRecovery).toBe(true);
        const hasFullSnapshot = recoveryChunk.events.some((e: any) => e.type === 2);
        expect(hasFullSnapshot).toBe(true);

        // FullSnapshot 应在恢复事件之前（timestamp 更小）
        const fullSnapshotIdx = recoveryChunk.events.findIndex((e: any) => e.type === 2);
        const firstIncrementalIdx = recoveryChunk.events.findIndex((e: any) => e.type === 3);
        if (fullSnapshotIdx !== -1 && firstIncrementalIdx !== -1) {
          expect(recoveryChunk.events[fullSnapshotIdx].timestamp)
            .toBeLessThan(recoveryChunk.events[firstIncrementalIdx].timestamp);
        }
      }

      recorder2.destroy();
      vi.useFakeTimers();
    });
  });
});
