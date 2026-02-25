import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CacheManager } from '../CacheManager';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(async () => {
    cache = new CacheManager(5);
    // 等待 DB 初始化完成
    await new Promise(r => setTimeout(r, 50));
    // 清空数据
    await cache.clear();
  });

  const makeCachedRecording = (id: string, startTime = 1000) => ({
    id,
    events: [{ type: 2, data: {}, timestamp: startTime }],
    tags: [{ name: 'test', timestamp: startTime + 100 }],
    startTime,
    url: 'https://example.com',
    userAgent: 'test-agent',
    screenResolution: '1920x1080',
    viewport: { width: 1280, height: 720 },
    updatedAt: startTime + 500,
  });

  describe('save & getAll', () => {
    it('应保存并读取数据', async () => {
      await cache.save(makeCachedRecording('session-1'));

      const all = await cache.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('session-1');
    });

    it('应保存多条数据', async () => {
      await cache.save(makeCachedRecording('session-1'));
      await cache.save(makeCachedRecording('session-2'));
      await cache.save(makeCachedRecording('session-3'));

      const all = await cache.getAll();
      expect(all).toHaveLength(3);
    });

    it('应更新已有数据（相同 id，使用 put）', async () => {
      await cache.save(makeCachedRecording('session-1', 1000));

      await cache.save({
        ...makeCachedRecording('session-1', 1000),
        url: 'https://updated.com',
      });

      const all = await cache.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].url).toBe('https://updated.com');
    });
  });

  describe('delete', () => {
    it('应删除指定的缓存', async () => {
      await cache.save(makeCachedRecording('session-1'));
      await cache.save(makeCachedRecording('session-2'));

      await cache.delete('session-1');

      const all = await cache.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('session-2');
    });

    it('删除不存在的 id 不应报错', async () => {
      await expect(cache.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('clear', () => {
    it('应清空所有缓存', async () => {
      await cache.save(makeCachedRecording('session-1'));
      await cache.save(makeCachedRecording('session-2'));

      await cache.clear();

      const all = await cache.getAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('toRawRecordingData', () => {
    it('应正确转换缓存数据为 RawRecordingData', () => {
      const cached = makeCachedRecording('session-1', 1000);
      const raw = cache.toRawRecordingData(cached);

      expect(raw.sessionId).toBe('session-1');
      expect(raw.events).toEqual(cached.events);
      expect(raw.tags).toEqual(cached.tags);
      expect(raw.startTime).toBe(1000);
      expect(raw.url).toBe('https://example.com');
      expect(raw.userAgent).toBe('test-agent');
      expect(raw.screenResolution).toBe('1920x1080');
      expect(raw.viewport).toEqual({ width: 1280, height: 720 });
      // 不应包含 endTime 和 duration
      expect((raw as any).endTime).toBeUndefined();
      expect((raw as any).duration).toBeUndefined();
    });
  });

  describe('IndexedDB 不可用时的降级', () => {
    it('indexedDB undefined 时应优雅降级', async () => {
      const originalIndexedDB = globalThis.indexedDB;
      // @ts-ignore
      delete globalThis.indexedDB;

      const fallbackCache = new CacheManager();

      await expect(fallbackCache.save(makeCachedRecording('s1'))).resolves.toBeUndefined();
      const all = await fallbackCache.getAll();
      expect(all).toEqual([]);
      await expect(fallbackCache.delete('s1')).resolves.toBeUndefined();
      await expect(fallbackCache.clear()).resolves.toBeUndefined();

      globalThis.indexedDB = originalIndexedDB;
    });
  });
});
