import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CacheManager } from '../src/CacheManager';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(async () => {
    cache = new CacheManager(5);
    // 等待 DB 初始化完成
    await new Promise(r => setTimeout(r, 50));
    // 清空数据
    await cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeCachedRecording = (id: string, startTime = 1000, updatedAt?: number) => ({
    id,
    events: [{ type: 2, data: {}, timestamp: startTime }],
    tags: [{ name: 'test', timestamp: startTime + 100 }],
    startTime,
    url: 'https://example.com',
    userAgent: 'test-agent',
    screenResolution: '1920x1080',
    viewport: { width: 1280, height: 720 },
    updatedAt: updatedAt ?? startTime + 500,
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

    it('无分段进度时 lastChunkEventIndex 和 chunkIndex 默认为 0', () => {
      const cached = makeCachedRecording('session-1', 1000);
      const raw = cache.toRawRecordingData(cached);

      expect(raw.lastChunkEventIndex).toBe(0);
      expect(raw.chunkIndex).toBe(0);
    });

    it('应正确透传分段上传进度', () => {
      const cached = {
        ...makeCachedRecording('session-1', 1000),
        lastChunkEventIndex: 42,
        chunkIndex: 3,
      };
      const raw = cache.toRawRecordingData(cached);

      expect(raw.lastChunkEventIndex).toBe(42);
      expect(raw.chunkIndex).toBe(3);
    });
  });

  describe('分段上传进度持久化', () => {
    it('应保存并恢复分段进度字段', async () => {
      const data = {
        ...makeCachedRecording('chunk-session', 1000),
        lastChunkEventIndex: 100,
        chunkIndex: 5,
      };
      await cache.save(data);

      const all = await cache.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].lastChunkEventIndex).toBe(100);
      expect(all[0].chunkIndex).toBe(5);
    });

    it('旧缓存数据（无分段字段）应兼容', async () => {
      const data = makeCachedRecording('old-session', 1000);
      await cache.save(data);

      const all = await cache.getAll();
      const raw = cache.toRawRecordingData(all[0]);
      expect(raw.lastChunkEventIndex).toBe(0);
      expect(raw.chunkIndex).toBe(0);
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

  describe('过期清理 (maxAge)', () => {
    it('getAll 应过滤掉超过 maxAge 的条目', async () => {
      const realNow = Date.now();
      const maxAge = 3000;
      const expiredCache = new CacheManager(10, maxAge);
      await new Promise(r => setTimeout(r, 50));
      await expiredCache.clear();

      // save() 内部用 Date.now() 设置 updatedAt，通过 mock 控制时间
      // 写入"旧"数据：模拟 5 秒前保存
      vi.spyOn(Date, 'now').mockReturnValue(realNow - 5000);
      await expiredCache.save(makeCachedRecording('old', 100));
      await new Promise(r => setTimeout(r, 30));

      // 写入"新"数据：恢复当前时间
      vi.spyOn(Date, 'now').mockReturnValue(realNow);
      await expiredCache.save(makeCachedRecording('new', 200));
      await new Promise(r => setTimeout(r, 30));

      vi.restoreAllMocks();

      const all = await expiredCache.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('new');
    });

    it('默认 maxAge 为 7 天', async () => {
      const realNow = Date.now();
      const defaultCache = new CacheManager(10);
      await new Promise(r => setTimeout(r, 50));
      await defaultCache.clear();

      // 6 天前的数据应保留
      vi.spyOn(Date, 'now').mockReturnValue(realNow - 6 * 24 * 60 * 60 * 1000);
      await defaultCache.save(makeCachedRecording('recent', 100));
      await new Promise(r => setTimeout(r, 30));

      // 8 天前的数据应被清理
      vi.spyOn(Date, 'now').mockReturnValue(realNow - 8 * 24 * 60 * 60 * 1000);
      await defaultCache.save(makeCachedRecording('old', 200));
      await new Promise(r => setTimeout(r, 30));

      vi.restoreAllMocks();

      const all = await defaultCache.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('recent');
    });

    it('初始化时应执行一次过期清理', async () => {
      const realNow = Date.now();
      // 先用一个长 maxAge 写入"旧数据"
      const setupCache = new CacheManager(10, 999999999);
      await new Promise(r => setTimeout(r, 50));
      await setupCache.clear();

      // 写入一条"5秒前"的数据
      vi.spyOn(Date, 'now').mockReturnValue(realNow - 5000);
      await setupCache.save(makeCachedRecording('expired', 100));
      await new Promise(r => setTimeout(r, 30));

      // 写入一条"当前"的数据
      vi.spyOn(Date, 'now').mockReturnValue(realNow);
      await setupCache.save(makeCachedRecording('valid', 200));
      await new Promise(r => setTimeout(r, 30));

      vi.restoreAllMocks();

      // 用短 maxAge 创建新 cache，初始化时自动 cleanup
      const strictCache = new CacheManager(10, 2000);
      await new Promise(r => setTimeout(r, 150));

      const all = await strictCache.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('valid');
    });
  });

  describe('条数淘汰', () => {
    it('超过 maxItems 时应淘汰最旧的条目', async () => {
      const smallCache = new CacheManager(3);
      await new Promise(r => setTimeout(r, 50));
      await smallCache.clear();

      const now = Date.now();
      await smallCache.save(makeCachedRecording('s1', 100, now - 3000));
      await smallCache.save(makeCachedRecording('s2', 200, now - 2000));
      await smallCache.save(makeCachedRecording('s3', 300, now - 1000));
      // 等待 IDB 事务完成
      await new Promise(r => setTimeout(r, 50));

      // 第 4 条写入时应淘汰 s1
      await smallCache.save(makeCachedRecording('s4', 400, now));
      await new Promise(r => setTimeout(r, 50));

      const all = await smallCache.getAll();
      const ids = all.map(a => a.id).sort();
      expect(ids).not.toContain('s1');
      expect(all.length).toBeLessThanOrEqual(3);
    });
  });

  describe('存储空间预警清理', () => {
    it('navigator.storage.estimate 不可用时不报错', async () => {
      // 默认 jsdom 环境没有 navigator.storage.estimate
      // 创建新 cache 触发 cleanup，不应报错
      const newCache = new CacheManager(10, 1000);
      await new Promise(r => setTimeout(r, 100));
      await expect(newCache.getAll()).resolves.toBeDefined();
    });

    it('存储使用率低于阈值时不清理', async () => {
      const mockEstimate = vi.fn().mockResolvedValue({
        usage: 100,
        quota: 1000, // 10% usage, well below 80%
      });
      vi.stubGlobal('navigator', {
        ...globalThis.navigator,
        storage: { estimate: mockEstimate },
      });

      const now = Date.now();
      await cache.save(makeCachedRecording('s1', 100, now));
      await cache.save(makeCachedRecording('s2', 200, now));

      // 手动触发 cleanup 通过重建
      const newCache = new CacheManager(10);
      await new Promise(r => setTimeout(r, 100));

      const all = await newCache.getAll();
      expect(all.length).toBe(2);
    });
  });
});
