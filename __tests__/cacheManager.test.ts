import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CacheManager } from '../src/CacheManager';
import type { CachedChunk } from '../src/CacheManager';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(async () => {
    cache = new CacheManager(5);
    await new Promise(r => setTimeout(r, 50));
    await cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeChunk = (
    sessionId: string,
    cacheChunkIndex: number,
    startTime = 1000,
    updatedAt?: number,
  ): Omit<CachedChunk, 'id'> => ({
    sessionId,
    cacheChunkIndex,
    events: [{ type: 2, data: {}, timestamp: startTime }],
    tags: [{ name: 'test', timestamp: startTime + 100 }],
    startTime,
    url: 'https://example.com',
    userAgent: 'test-agent',
    screenResolution: '1920x1080',
    viewport: { width: 1280, height: 720 },
    updatedAt: updatedAt ?? startTime + 500,
  });

  describe('saveChunk & getSessionChunks', () => {
    it('应保存并读取增量 chunk', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));

      const chunks = await cache.getSessionChunks('session-1');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].sessionId).toBe('session-1');
      expect(chunks[0].cacheChunkIndex).toBe(0);
      expect(chunks[0].id).toBe('session-1:0');
    });

    it('应保存多个 chunk 到同一个 session', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-1', 1, 2000));
      await cache.saveChunk(makeChunk('session-1', 2, 3000));

      const chunks = await cache.getSessionChunks('session-1');
      expect(chunks).toHaveLength(3);
    });

    it('不同 session 的 chunk 应独立', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-2', 0));

      const chunks1 = await cache.getSessionChunks('session-1');
      const chunks2 = await cache.getSessionChunks('session-2');
      expect(chunks1).toHaveLength(1);
      expect(chunks2).toHaveLength(1);
    });

    it('相同 id 应覆盖而非新增', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk({
        ...makeChunk('session-1', 0),
        url: 'https://updated.com',
      });

      const chunks = await cache.getSessionChunks('session-1');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].url).toBe('https://updated.com');
    });
  });

  describe('getAllSessions', () => {
    it('应返回所有不同 sessionId', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-1', 1, 2000));
      await cache.saveChunk(makeChunk('session-2', 0));

      const sessions = await cache.getAllSessions();
      expect(sessions).toHaveLength(2);
      const ids = sessions.map(s => s.sessionId).sort();
      expect(ids).toEqual(['session-1', 'session-2']);
    });

    it('无缓存时返回空数组', async () => {
      const sessions = await cache.getAllSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('deleteChunk', () => {
    it('应删除单个 chunk', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-1', 1, 2000));

      await cache.deleteChunk('session-1:0');

      const chunks = await cache.getSessionChunks('session-1');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].cacheChunkIndex).toBe(1);
    });

    it('删除不存在的 chunk 不应报错', async () => {
      await expect(cache.deleteChunk('nonexistent:0')).resolves.toBeUndefined();
    });
  });

  describe('deleteSession', () => {
    it('应删除指定 session 的所有 chunk', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-1', 1, 2000));
      await cache.saveChunk(makeChunk('session-2', 0));

      await cache.deleteSession('session-1');

      const chunks1 = await cache.getSessionChunks('session-1');
      const chunks2 = await cache.getSessionChunks('session-2');
      expect(chunks1).toHaveLength(0);
      expect(chunks2).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('应清空所有缓存', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-2', 0));

      await cache.clear();

      const sessions = await cache.getAllSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('分段上传进度持久化', () => {
    it('应保存并恢复分段进度字段', async () => {
      await cache.saveChunk({
        ...makeChunk('chunk-session', 0),
        lastChunkEventIndex: 100,
        chunkIndex: 5,
      });

      const chunks = await cache.getSessionChunks('chunk-session');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].lastChunkEventIndex).toBe(100);
      expect(chunks[0].chunkIndex).toBe(5);
    });

    it('未提供分段字段时默认为 undefined', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));

      const chunks = await cache.getSessionChunks('session-1');
      expect(chunks[0].lastChunkEventIndex).toBeUndefined();
      expect(chunks[0].chunkIndex).toBeUndefined();
    });
  });

  describe('IndexedDB 不可用时的降级', () => {
    it('indexedDB undefined 时应优雅降级', async () => {
      const originalIndexedDB = globalThis.indexedDB;
      // @ts-ignore
      delete globalThis.indexedDB;

      const fallbackCache = new CacheManager();

      await expect(
        fallbackCache.saveChunk(makeChunk('s1', 0))
      ).resolves.toBeUndefined();
      const sessions = await fallbackCache.getAllSessions();
      expect(sessions).toEqual([]);
      await expect(fallbackCache.deleteSession('s1')).resolves.toBeUndefined();
      await expect(fallbackCache.clear()).resolves.toBeUndefined();

      globalThis.indexedDB = originalIndexedDB;
    });
  });

  describe('过期清理 (maxAge)', () => {
    it('getAllSessions 应过滤掉超过 maxAge 的条目', async () => {
      const realNow = Date.now();
      const maxAge = 3000;
      const expiredCache = new CacheManager(10, maxAge);
      await new Promise(r => setTimeout(r, 50));
      await expiredCache.clear();

      vi.spyOn(Date, 'now').mockReturnValue(realNow - 5000);
      await expiredCache.saveChunk(makeChunk('old', 0, 100));
      await new Promise(r => setTimeout(r, 30));

      vi.spyOn(Date, 'now').mockReturnValue(realNow);
      await expiredCache.saveChunk(makeChunk('new', 0, 200));
      await new Promise(r => setTimeout(r, 30));

      vi.restoreAllMocks();

      const sessions = await expiredCache.getAllSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('new');
    });

    it('默认 maxAge 为 7 天', async () => {
      const realNow = Date.now();
      const defaultCache = new CacheManager(10);
      await new Promise(r => setTimeout(r, 50));
      await defaultCache.clear();

      vi.spyOn(Date, 'now').mockReturnValue(realNow - 6 * 24 * 60 * 60 * 1000);
      await defaultCache.saveChunk(makeChunk('recent', 0, 100));
      await new Promise(r => setTimeout(r, 30));

      vi.spyOn(Date, 'now').mockReturnValue(realNow - 8 * 24 * 60 * 60 * 1000);
      await defaultCache.saveChunk(makeChunk('old', 0, 200));
      await new Promise(r => setTimeout(r, 30));

      vi.restoreAllMocks();

      const sessions = await defaultCache.getAllSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('recent');
    });

    it('初始化时应执行一次过期清理', async () => {
      const realNow = Date.now();
      const setupCache = new CacheManager(10, 999999999);
      await new Promise(r => setTimeout(r, 50));
      await setupCache.clear();

      vi.spyOn(Date, 'now').mockReturnValue(realNow - 5000);
      await setupCache.saveChunk(makeChunk('expired', 0, 100));
      await new Promise(r => setTimeout(r, 30));

      vi.spyOn(Date, 'now').mockReturnValue(realNow);
      await setupCache.saveChunk(makeChunk('valid', 0, 200));
      await new Promise(r => setTimeout(r, 30));

      vi.restoreAllMocks();

      const strictCache = new CacheManager(10, 2000);
      await new Promise(r => setTimeout(r, 150));

      const sessions = await strictCache.getAllSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('valid');
    });
  });

  describe('条数淘汰', () => {
    it('超过 maxItems 时初始化清理应淘汰最旧的 session', async () => {
      const setupCache = new CacheManager(100);
      await new Promise(r => setTimeout(r, 50));
      await setupCache.clear();

      const now = Date.now();
      await setupCache.saveChunk(makeChunk('s1', 0, 100, now - 3000));
      await setupCache.saveChunk(makeChunk('s2', 0, 200, now - 2000));
      await setupCache.saveChunk(makeChunk('s3', 0, 300, now - 1000));
      await setupCache.saveChunk(makeChunk('s4', 0, 400, now));
      await new Promise(r => setTimeout(r, 50));

      // maxItems=3 的新 cache 初始化时应清理 s1
      const smallCache = new CacheManager(3);
      await new Promise(r => setTimeout(r, 150));

      const sessions = await smallCache.getAllSessions();
      const ids = sessions.map(s => s.sessionId).sort();
      expect(ids).not.toContain('s1');
      expect(sessions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('存储空间预警清理', () => {
    it('navigator.storage.estimate 不可用时不报错', async () => {
      const newCache = new CacheManager(10, 1000);
      await new Promise(r => setTimeout(r, 100));
      await expect(newCache.getAllSessions()).resolves.toBeDefined();
    });

    it('存储使用率低于阈值时不清理', async () => {
      const mockEstimate = vi.fn().mockResolvedValue({
        usage: 100,
        quota: 1000,
      });
      vi.stubGlobal('navigator', {
        ...globalThis.navigator,
        storage: { estimate: mockEstimate },
      });

      const now = Date.now();
      await cache.saveChunk(makeChunk('s1', 0, 100, now));
      await cache.saveChunk(makeChunk('s2', 0, 200, now));

      const newCache = new CacheManager(10);
      await new Promise(r => setTimeout(r, 100));

      const sessions = await newCache.getAllSessions();
      expect(sessions.length).toBe(2);
    });
  });
});
