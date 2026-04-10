import { describe, it, expect, vi } from 'vitest';
import {
  MINIAPP_SDK_VERSION,
  SIGILLUM_SCHEMA_VERSION,
  isSigillumRecording,
  unwrapRecording,
  detectRecordingSource,
  detectRecordingSourceWithReason,
} from '../../src/core/types';
import type {
  TrackEvent,
  TrackEventType,
  TapEventData,
  ScrollEventData,
  PageEventData,
  InputEventData,
  MiniAppRawRecordingData,
  MiniAppRecordingChunk,
  MiniAppRecorderOptions,
  MiniAppRecordingSummary,
  SigillumRecording,
} from '../../src/core/types';

describe('core/types', () => {
  it('MINIAPP_SDK_VERSION 应为有效的 semver 版本', () => {
    expect(MINIAPP_SDK_VERSION).toBeTruthy();
    expect(MINIAPP_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('TrackEvent 应可以创建有效实例', () => {
    const event: TrackEvent<TapEventData> = {
      type: 'tap',
      timestamp: Date.now(),
      data: {
        x: 100,
        y: 200,
        target: { id: 'btn', tagName: 'button', text: '提交' },
        page: 'pages/index',
      },
    };
    expect(event.type).toBe('tap');
    expect(event.data.x).toBe(100);
    expect(event.data.target.text).toBe('提交');
  });

  it('ScrollEventData 应包含滚动方向', () => {
    const data: ScrollEventData = {
      scrollTop: 500,
      scrollLeft: 0,
      direction: 'down',
      page: 'pages/index',
    };
    expect(data.direction).toBe('down');
  });

  it('PageEventData 应支持可选的 from 和 query', () => {
    const data: PageEventData = {
      page: 'pages/detail',
      from: 'pages/index',
      query: { id: '123' },
    };
    expect(data.from).toBe('pages/index');
    expect(data.query?.id).toBe('123');
  });

  it('InputEventData 应包含值和目标', () => {
    const data: InputEventData = {
      value: 'hello',
      target: { id: 'input1', tagName: 'input' },
      page: 'pages/form',
    };
    expect(data.value).toBe('hello');
  });

  it('MiniAppRawRecordingData 应可以构建完整数据', () => {
    const data: MiniAppRawRecordingData = {
      sessionId: 'test-123',
      events: [],
      startTime: 1000,
      endTime: 2000,
      duration: 1000,
      metadata: { platform: 'wechat', sdkVersion: '2.0.0-beta.1' },
      summary: {
        totalEvents: 0,
        tapCount: 0,
        inputCount: 0,
        scrollCount: 0,
        pageChangeCount: 0,
        pageChanges: [],
        duration: 1000,
        visitedPages: [],
      },
    };
    expect(data.sessionId).toBe('test-123');
    expect(data.metadata?.platform).toBe('wechat');
  });

  it('MiniAppRecordingChunk 应区分首个和后续分段', () => {
    const firstChunk: MiniAppRecordingChunk = {
      sessionId: 'test-123',
      chunkIndex: 0,
      isFinal: false,
      events: [],
      startTime: 1000,
      endTime: 2000,
      summary: {
        totalEvents: 0, tapCount: 0, inputCount: 0, scrollCount: 0,
        pageChangeCount: 0, pageChanges: [], duration: 1000, visitedPages: [],
      },
      metadata: { platform: 'wechat', sdkVersion: '2.0.0-beta.1' },
    };
    expect(firstChunk.metadata).toBeDefined();

    const secondChunk: MiniAppRecordingChunk = {
      ...firstChunk,
      chunkIndex: 1,
      isFinal: true,
      metadata: undefined,
    };
    expect(secondChunk.metadata).toBeUndefined();
  });

  it('MiniAppRecorderOptions 应支持所有可选配置', () => {
    const opts: MiniAppRecorderOptions = {
      maxDuration: 60000,
      maxEvents: 10000,
      maxRetries: 3,
      debug: true,
      maskInputs: true,
      chunkedUpload: { enabled: true, interval: 30000 },
    };
    expect(opts.chunkedUpload?.enabled).toBe(true);
  });

  it('TrackEventType 应覆盖所有预定义类型', () => {
    const allTypes: TrackEventType[] = [
      'session_start', 'session_end',
      'page_enter', 'page_leave',
      'tap', 'longpress',
      'input', 'input_focus', 'input_blur',
      'scroll', 'scroll_depth', 'swipe',
      'touch_start', 'touch_move', 'touch_end',
      'drag_start', 'drag_move', 'drag_end',
      'app_hide', 'app_show',
      'network_request', 'error',
      'custom', 'identify',
    ];
    expect(allTypes).toHaveLength(24);
  });
});

describe('SigillumRecording 统一协议', () => {
  const miniappEnvelope: SigillumRecording<MiniAppRawRecordingData> = {
    sigillum: true,
    schemaVersion: SIGILLUM_SCHEMA_VERSION,
    source: 'miniapp',
    sdkVersion: MINIAPP_SDK_VERSION,
    exportedAt: Date.now(),
    recording: {
      sessionId: 'test-123',
      events: [{ type: 'tap', timestamp: 1000, data: {} }],
      startTime: 1000,
      endTime: 2000,
      duration: 1000,
      metadata: { platform: 'wechat', sdkVersion: MINIAPP_SDK_VERSION },
      summary: {
        totalEvents: 1, tapCount: 1, inputCount: 0, scrollCount: 0,
        pageChangeCount: 0, pageChanges: [], duration: 1000, visitedPages: [],
      },
    },
  };

  const webEnvelope: SigillumRecording = {
    sigillum: true,
    schemaVersion: SIGILLUM_SCHEMA_VERSION,
    source: 'web',
    sdkVersion: '2.0.0-beta.1',
    exportedAt: Date.now(),
    recording: {
      sessionId: 'web-456',
      events: [{ type: 4, timestamp: 1000, data: {} }],
      startTime: 1000,
      endTime: 2000,
      duration: 1000,
    },
  };

  it('SIGILLUM_SCHEMA_VERSION 应为 1', () => {
    expect(SIGILLUM_SCHEMA_VERSION).toBe(1);
  });

  describe('isSigillumRecording', () => {
    it('应识别有效的信封格式', () => {
      expect(isSigillumRecording(miniappEnvelope)).toBe(true);
      expect(isSigillumRecording(webEnvelope)).toBe(true);
    });

    it('应拒绝裸数据', () => {
      expect(isSigillumRecording(miniappEnvelope.recording)).toBe(false);
    });

    it('应拒绝 null / undefined / 非对象', () => {
      expect(isSigillumRecording(null)).toBe(false);
      expect(isSigillumRecording(undefined)).toBe(false);
      expect(isSigillumRecording('string')).toBe(false);
      expect(isSigillumRecording(42)).toBe(false);
    });

    it('应拒绝缺少必要字段的对象', () => {
      expect(isSigillumRecording({ sigillum: true })).toBe(false);
      expect(isSigillumRecording({ sigillum: true, schemaVersion: 1 })).toBe(false);
    });
  });

  describe('unwrapRecording', () => {
    it('应解包信封格式', () => {
      const result = unwrapRecording(miniappEnvelope);
      expect(result.source).toBe('miniapp');
      expect(result.schemaVersion).toBe(1);
      expect((result.recording as any).sessionId).toBe('test-123');
    });

    it('应原样返回裸数据', () => {
      const raw = miniappEnvelope.recording;
      const result = unwrapRecording(raw);
      expect(result.source).toBeNull();
      expect(result.schemaVersion).toBeNull();
      expect(result.recording).toBe(raw);
    });

    it('高版本信封应触发 console.warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const futureEnvelope = { ...miniappEnvelope, schemaVersion: 999 };
      unwrapRecording(futureEnvelope);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('schemaVersion 999'),
      );
      warnSpy.mockRestore();
    });

    it('当前版本信封不应触发 console.warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      unwrapRecording(miniappEnvelope);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('detectRecordingSource', () => {
    it('应识别 Web 裸数据（events[0].type 为 number）', () => {
      expect(detectRecordingSource(webEnvelope.recording)).toBe('web');
    });

    it('应识别 MiniApp 裸数据（events[0].type 为 string）', () => {
      expect(detectRecordingSource(miniappEnvelope.recording)).toBe('miniapp');
    });

    it('空 events 应返回 null', () => {
      expect(detectRecordingSource({ events: [] })).toBeNull();
    });

    it('非对象应返回 null', () => {
      expect(detectRecordingSource(null)).toBeNull();
      expect(detectRecordingSource('string')).toBeNull();
    });
  });

  describe('detectRecordingSourceWithReason', () => {
    it('成功时应返回 source 且无 reason', () => {
      const result = detectRecordingSourceWithReason(webEnvelope.recording);
      expect(result.source).toBe('web');
      expect(result.reason).toBeUndefined();
    });

    it('非对象应返回具体原因', () => {
      const result = detectRecordingSourceWithReason(null);
      expect(result.source).toBeNull();
      expect(result.reason).toBe('Data is not an object');
    });

    it('无 events 数组应返回具体原因', () => {
      const result = detectRecordingSourceWithReason({ foo: 'bar' });
      expect(result.source).toBeNull();
      expect(result.reason).toBe('Data has no "events" array');
    });

    it('空 events 应返回具体原因', () => {
      const result = detectRecordingSourceWithReason({ events: [] });
      expect(result.source).toBeNull();
      expect(result.reason).toBe('Events array is empty');
    });

    it('未知 type 类型应返回具体原因', () => {
      const result = detectRecordingSourceWithReason({ events: [{ type: true }] });
      expect(result.source).toBeNull();
      expect(result.reason).toMatch(/Unexpected events\[0\]\.type/);
    });
  });
});
