import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventRecorder } from '../../src/core/EventRecorder';
import type { MiniAppRecorderOptions, TrackEvent } from '../../src/core/types';

describe('EventRecorder', () => {
  let recorder: EventRecorder;
  let options: MiniAppRecorderOptions;

  beforeEach(() => {
    vi.useFakeTimers();
    options = {
      maxDuration: 60000,
      maxEvents: 100,
      maxRetries: 1,
      debug: false,
    };
    recorder = new EventRecorder(options);
  });

  afterEach(() => {
    recorder.destroy();
    vi.useRealTimers();
  });

  describe('生命周期', () => {
    it('初始状态应为 idle', () => {
      expect(recorder.getStatus()).toBe('idle');
      expect(recorder.getSessionId()).toBe('');
      expect(recorder.getEventCount()).toBe(0);
    });

    it('start 应切换到 recording 状态', () => {
      recorder.start('wechat');
      expect(recorder.getStatus()).toBe('recording');
      expect(recorder.getSessionId()).toBeTruthy();
    });

    it('start 应生成 session_start 事件', () => {
      recorder.start('wechat', '1.0.0');
      expect(recorder.getEventCount()).toBe(1);
    });

    it('重复 start 应忽略', () => {
      recorder.start('wechat');
      const id = recorder.getSessionId();
      recorder.start('wechat');
      expect(recorder.getSessionId()).toBe(id);
    });

    it('stop 应切换到 stopped 状态', async () => {
      recorder.start('wechat');
      await recorder.stop();
      expect(recorder.getStatus()).toBe('stopped');
    });

    it('stop 应生成 session_end 事件', async () => {
      recorder.start('wechat');
      const countBefore = recorder.getEventCount();
      await recorder.stop();
      expect(recorder.getEventCount()).toBe(countBefore + 1);
    });

    it('idle 状态 stop 应忽略', async () => {
      await recorder.stop();
      expect(recorder.getStatus()).toBe('idle');
    });

    it('pause 应切换到 paused 状态', () => {
      recorder.start('wechat');
      recorder.pause();
      expect(recorder.getStatus()).toBe('paused');
    });

    it('非 recording 状态 pause 应忽略', () => {
      recorder.pause();
      expect(recorder.getStatus()).toBe('idle');
    });

    it('resume 应从 paused 恢复到 recording', () => {
      recorder.start('wechat');
      recorder.pause();
      recorder.resume();
      expect(recorder.getStatus()).toBe('recording');
    });

    it('非 paused 状态 resume 应忽略', () => {
      recorder.resume();
      expect(recorder.getStatus()).toBe('idle');
    });

    it('destroy 应切换到 stopped 并清空', () => {
      recorder.start('wechat');
      recorder.captureEvent({ type: 'tap', timestamp: Date.now(), data: {} });
      recorder.destroy();
      expect(recorder.getStatus()).toBe('stopped');
      expect(recorder.getEventCount()).toBe(0);
    });
  });

  describe('事件采集', () => {
    it('recording 状态下应接受事件', () => {
      recorder.start('wechat');
      recorder.captureEvent({ type: 'tap', timestamp: Date.now(), data: { x: 100, y: 200, target: {}, page: 'pages/index' } });
      expect(recorder.getEventCount()).toBe(2); // session_start + tap
    });

    it('非 recording 状态下应忽略事件', () => {
      recorder.captureEvent({ type: 'tap', timestamp: Date.now(), data: {} });
      expect(recorder.getEventCount()).toBe(0);
    });

    it('达到 maxEvents 应自动停止', () => {
      const smallRecorder = new EventRecorder({ ...options, maxEvents: 5 });
      smallRecorder.start('wechat');
      // session_start 已占 1 个
      for (let i = 0; i < 10; i++) {
        smallRecorder.captureEvent({ type: 'tap', timestamp: Date.now() + i, data: {} });
      }
      expect(smallRecorder.getStatus()).toBe('stopped');
      smallRecorder.destroy();
    });

    it('onEventEmit 回调应在每次采集时触发', () => {
      const onEventEmit = vi.fn();
      const r = new EventRecorder({ ...options, onEventEmit });
      r.start('wechat');
      r.captureEvent({ type: 'tap', timestamp: Date.now(), data: {} });
      // session_start + tap
      expect(onEventEmit).toHaveBeenCalledTimes(2);
      r.destroy();
    });

    it('maskInputs 应脱敏 input 事件的 value', () => {
      const r = new EventRecorder({ ...options, maskInputs: true });
      r.start('wechat');
      r.captureEvent({ type: 'input', timestamp: Date.now(), data: { value: 'secret', target: {}, page: 'p' } });
      const exported = (r as any).buffer.getEvents();
      const inputEvent = exported.find((e: any) => e.type === 'input');
      expect(inputEvent.data.value).toBe('******');
      r.destroy();
    });

    it('maskInputs 脱敏不应修改原始事件对象', () => {
      const r = new EventRecorder({ ...options, maskInputs: true });
      r.start('wechat');
      const originalData = { value: 'hello', target: {}, page: 'p' };
      const event: TrackEvent = { type: 'input', timestamp: Date.now(), data: originalData };
      r.captureEvent(event);
      expect(originalData.value).toBe('hello');
      r.destroy();
    });

    it('maskInputs=false 不应脱敏', () => {
      const r = new EventRecorder({ ...options, maskInputs: false });
      r.start('wechat');
      r.captureEvent({ type: 'input', timestamp: Date.now(), data: { value: 'plain', target: {}, page: 'p' } });
      const exported = (r as any).buffer.getEvents();
      const inputEvent = exported.find((e: any) => e.type === 'input');
      expect(inputEvent.data.value).toBe('plain');
      r.destroy();
    });
  });

  describe('行为统计', () => {
    it('应正确统计 tap 次数', () => {
      recorder.start('wechat');
      recorder.captureEvent({ type: 'tap', timestamp: Date.now(), data: {} });
      recorder.captureEvent({ type: 'tap', timestamp: Date.now(), data: {} });
      recorder.captureEvent({ type: 'longpress', timestamp: Date.now(), data: {} });
      const summary = recorder.getSummary();
      expect(summary?.tapCount).toBe(3);
    });

    it('应正确统计 input 次数', () => {
      recorder.start('wechat');
      recorder.captureEvent({ type: 'input', timestamp: Date.now(), data: {} });
      recorder.captureEvent({ type: 'input', timestamp: Date.now(), data: {} });
      expect(recorder.getSummary()?.inputCount).toBe(2);
    });

    it('应正确统计 scroll 次数', () => {
      recorder.start('wechat');
      recorder.captureEvent({ type: 'scroll', timestamp: Date.now(), data: {} });
      expect(recorder.getSummary()?.scrollCount).toBe(1);
    });

    it('应正确追踪页面变化', () => {
      recorder.start('wechat');
      recorder.captureEvent({
        type: 'page_enter',
        timestamp: Date.now(),
        data: { page: 'pages/detail', from: 'pages/index' },
      });
      const summary = recorder.getSummary();
      expect(summary?.pageChangeCount).toBe(1);
      expect(summary?.visitedPages).toContain('pages/detail');
    });

    it('idle 状态 getSummary 应返回 null', () => {
      expect(recorder.getSummary()).toBeNull();
    });
  });

  describe('maxDuration', () => {
    it('超过最大时长应自动停止', () => {
      recorder.start('wechat');
      expect(recorder.getStatus()).toBe('recording');
      vi.advanceTimersByTime(61000);
      expect(recorder.getStatus()).toBe('stopped');
    });

    it('pause/resume 后 maxDuration 应按剩余时间计算', () => {
      const r = new EventRecorder({ ...options, maxDuration: 10000 });
      r.start('wechat');
      vi.advanceTimersByTime(4000);
      r.pause();
      vi.advanceTimersByTime(100000); // 暂停期间不计时
      r.resume();
      expect(r.getStatus()).toBe('recording');
      // 剩余 6000ms，前进 5000ms 不应停止
      vi.advanceTimersByTime(5000);
      expect(r.getStatus()).toBe('recording');
      // 再前进 2000ms 应停止（总计已超过 10000ms 录制时间）
      vi.advanceTimersByTime(2000);
      expect(r.getStatus()).toBe('stopped');
      r.destroy();
    });
  });

  describe('状态回调', () => {
    it('onStatusChange 应在状态变化时触发', () => {
      const onStatusChange = vi.fn();
      const r = new EventRecorder({ ...options, onStatusChange });
      r.start('wechat');
      expect(onStatusChange).toHaveBeenCalledWith('recording', 'idle');
      r.pause();
      expect(onStatusChange).toHaveBeenCalledWith('paused', 'recording');
      r.destroy();
    });

    it('onError 应在上传最终失败时触发', async () => {
      const onError = vi.fn();
      const onUpload = vi.fn().mockRejectedValue(new Error('fail'));
      const r = new EventRecorder({ ...options, onUpload, onError, maxRetries: 0 });
      r.start('wechat');
      r.captureEvent({ type: 'tap', timestamp: Date.now(), data: {} });
      await r.stop();
      expect(onError).toHaveBeenCalled();
      r.destroy();
    });
  });

  describe('exportRecording', () => {
    it('stopped 状态应返回 SigillumRecording 信封', async () => {
      recorder.start('wechat');
      recorder.captureEvent({ type: 'tap', timestamp: Date.now(), data: {} });
      await recorder.stop();

      const exported = recorder.exportRecording();
      expect(exported).not.toBeNull();
      expect(exported!.sigillum).toBe(true);
      expect(exported!.schemaVersion).toBe(1);
      expect(exported!.source).toBe('miniapp');
      expect(exported!.sdkVersion).toBeTruthy();
      expect(exported!.exportedAt).toBeGreaterThan(0);
      expect(exported!.recording.sessionId).toBeTruthy();
      expect(exported!.recording.events.length).toBeGreaterThan(0);
    });

    it('非 stopped 状态应返回 null', () => {
      recorder.start('wechat');
      expect(recorder.exportRecording()).toBeNull();
    });

    it('无事件时应返回 null', async () => {
      const emptyRecorder = new EventRecorder(options);
      emptyRecorder.start('wechat');
      emptyRecorder.destroy();
      expect(emptyRecorder.exportRecording()).toBeNull();
    });
  });

  describe('getCurrentPage / setCurrentPage', () => {
    it('应正确设置和获取当前页面', () => {
      recorder.start('wechat');
      recorder.setCurrentPage('pages/detail/detail');
      expect(recorder.getCurrentPage()).toBe('pages/detail/detail');
    });

    it('初始状态应返回空字符串', () => {
      expect(recorder.getCurrentPage()).toBe('');
    });
  });

  describe('分段上传', () => {
    it('应按间隔触发分段上传', () => {
      const onChunkUpload = vi.fn().mockResolvedValue({ success: true });
      const r = new EventRecorder({
        ...options,
        chunkedUpload: { enabled: true, interval: 5000 },
        onChunkUpload,
      });
      r.start('wechat');
      r.captureEvent({ type: 'tap', timestamp: Date.now(), data: {} });

      vi.advanceTimersByTime(5000);
      expect(onChunkUpload).toHaveBeenCalledTimes(1);
      r.destroy();
    });
  });
});
