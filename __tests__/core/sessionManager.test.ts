import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../src/core/SessionManager';
import type { MiniAppRecorderOptions, MiniAppRecordingSummary, TrackEvent } from '../../src/core/types';

function makeEvents(count: number): TrackEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'tap' as const,
    timestamp: 1000 + i * 100,
    data: { x: i, y: i, target: {}, page: 'pages/index' },
  }));
}

function makeSummary(): MiniAppRecordingSummary {
  return {
    totalEvents: 5,
    tapCount: 3,
    inputCount: 1,
    scrollCount: 1,
    pageChangeCount: 0,
    pageChanges: [],
    duration: 1000,
    visitedPages: ['pages/index'],
  };
}

describe('SessionManager', () => {
  let options: MiniAppRecorderOptions;
  let manager: SessionManager;

  beforeEach(() => {
    options = { maxRetries: 2 };
    manager = new SessionManager(options);
  });

  describe('initSession', () => {
    it('应生成唯一的 sessionId', () => {
      const id1 = manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      expect(id1).toBeTruthy();
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(10);
    });

    it('连续两次 initSession 应生成不同的 ID', () => {
      const id1 = manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      const id2 = manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      expect(id1).not.toBe(id2);
    });

    it('应记录元数据', () => {
      manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1', appVersion: '1.0.0' });
      const meta = manager.getMetadata();
      expect(meta).toEqual({
        platform: 'wechat',
        sdkVersion: '2.0.0-beta.1',
        appVersion: '1.0.0',
      });
    });

    it('应记录开始时间', () => {
      const before = Date.now();
      manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      const after = Date.now();
      expect(manager.getStartTime()).toBeGreaterThanOrEqual(before);
      expect(manager.getStartTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('markEnd', () => {
    it('应返回结束时间戳', () => {
      manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      const before = Date.now();
      const endTime = manager.markEnd();
      expect(endTime).toBeGreaterThanOrEqual(before);
    });
  });

  describe('buildRecordingData', () => {
    it('应构建完整的录制数据', () => {
      manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      manager.markEnd();

      const events = makeEvents(3);
      const summary = makeSummary();

      const data = manager.buildRecordingData(events, summary);

      expect(data.sessionId).toBeTruthy();
      expect(data.events).toHaveLength(3);
      expect(data.startTime).toBeGreaterThan(0);
      expect(data.endTime).toBeGreaterThan(0);
      expect(data.duration).toBeGreaterThanOrEqual(0);
      expect(data.metadata?.platform).toBe('wechat');
      expect(data.summary).toEqual(summary);
    });

    it('构建的数据应是副本而非引用', () => {
      manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      const events = makeEvents(2);
      const data = manager.buildRecordingData(events, makeSummary());
      events.push(makeEvents(1)[0]);
      expect(data.events).toHaveLength(2);
    });
  });

  describe('upload', () => {
    it('无 onUpload 时应静默返回', async () => {
      manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      await expect(manager.upload(makeEvents(3), makeSummary())).resolves.toBeUndefined();
    });

    it('空事件时应静默返回', async () => {
      const onUpload = vi.fn().mockResolvedValue({ success: true });
      const mgr = new SessionManager({ onUpload });
      mgr.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      await mgr.upload([], makeSummary());
      expect(onUpload).not.toHaveBeenCalled();
    });

    it('上传成功时应调用 onUpload 并传入 SigillumRecording 信封', async () => {
      const onUpload = vi.fn().mockResolvedValue({ success: true });
      const mgr = new SessionManager({ onUpload, maxRetries: 1 });
      mgr.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      await mgr.upload(makeEvents(3), makeSummary());
      expect(onUpload).toHaveBeenCalledTimes(1);
      const envelope = onUpload.mock.calls[0][0];
      expect(envelope.sigillum).toBe(true);
      expect(envelope.schemaVersion).toBe(1);
      expect(envelope.source).toBe('miniapp');
      expect(envelope.recording.sessionId).toBeTruthy();
      expect(envelope.recording.events).toHaveLength(3);
    });

    it('上传失败应重试', async () => {
      const onUpload = vi.fn()
        .mockResolvedValueOnce({ success: false, shouldRetry: true })
        .mockResolvedValueOnce({ success: true });
      const mgr = new SessionManager({ onUpload, maxRetries: 3 });
      mgr.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      await mgr.upload(makeEvents(3), makeSummary());
      expect(onUpload).toHaveBeenCalledTimes(2);
    });

    it('shouldRetry=false 时不应重试', async () => {
      const onUpload = vi.fn()
        .mockResolvedValueOnce({ success: false, shouldRetry: false });
      const mgr = new SessionManager({ onUpload, maxRetries: 3 });
      mgr.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      await mgr.upload(makeEvents(3), makeSummary());
      expect(onUpload).toHaveBeenCalledTimes(1);
    });

    it('抛出异常后达到最大重试应调用 onError', async () => {
      const onUpload = vi.fn().mockRejectedValue(new Error('network'));
      const onError = vi.fn();
      const mgr = new SessionManager({ onUpload, onError, maxRetries: 1 });
      mgr.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      await mgr.upload(makeEvents(3), makeSummary());
      expect(onUpload).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('uploadChunk', () => {
    it('无 onChunkUpload 时应静默返回', async () => {
      manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      await expect(manager.uploadChunk(makeEvents(3), makeSummary(), false)).resolves.toBeUndefined();
    });

    it('应正确构建 chunk 数据', async () => {
      const onChunkUpload = vi.fn().mockResolvedValue({ success: true });
      const mgr = new SessionManager({ onChunkUpload });
      mgr.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });

      const events = makeEvents(5);
      await mgr.uploadChunk(events, makeSummary(), false);

      expect(onChunkUpload).toHaveBeenCalledTimes(1);
      const chunk = onChunkUpload.mock.calls[0][0];
      expect(chunk.chunkIndex).toBe(0);
      expect(chunk.isFinal).toBe(false);
      expect(chunk.events).toHaveLength(5);
      expect(chunk.metadata?.platform).toBe('wechat');
    });

    it('第二次 chunk 应只包含增量事件', async () => {
      const onChunkUpload = vi.fn().mockResolvedValue({ success: true });
      const mgr = new SessionManager({ onChunkUpload });
      mgr.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });

      const events = makeEvents(5);
      await mgr.uploadChunk(events, makeSummary(), false);

      events.push(...makeEvents(3));
      await mgr.uploadChunk(events, makeSummary(), true);

      const secondChunk = onChunkUpload.mock.calls[1][0];
      expect(secondChunk.chunkIndex).toBe(1);
      expect(secondChunk.isFinal).toBe(true);
      expect(secondChunk.events).toHaveLength(3);
      expect(secondChunk.metadata).toBeUndefined();
    });

    it('无新增事件且非 final 时不应上传', async () => {
      const onChunkUpload = vi.fn().mockResolvedValue({ success: true });
      const mgr = new SessionManager({ onChunkUpload });
      mgr.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });

      const events = makeEvents(3);
      await mgr.uploadChunk(events, makeSummary(), false);
      await mgr.uploadChunk(events, makeSummary(), false);

      expect(onChunkUpload).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset', () => {
    it('应清空所有状态', () => {
      manager.initSession({ platform: 'wechat', sdkVersion: '2.0.0-beta.1' });
      manager.reset();
      expect(manager.getSessionId()).toBe('');
      expect(manager.getStartTime()).toBe(0);
      expect(manager.getMetadata()).toBeNull();
    });
  });
});
