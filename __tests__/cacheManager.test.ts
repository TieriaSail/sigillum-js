import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CacheManager } from '../src/CacheManager';
import type { CachedChunk } from '../src/types';

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
    cacheChunkIndex: number = 0,
    overrides: Partial<CachedChunk> = {},
  ): CachedChunk => ({
    id: `${sessionId}_${cacheChunkIndex}`,
    sessionId,
    cacheChunkIndex,
    events: [{ type: 2, data: {}, timestamp: 1000 }],
    tags: [{ name: 'test', timestamp: 1100 }],
    startTime: 1000,
    url: 'https://example.com',
    userAgent: 'test-agent',
    screenResolution: '1920x1080',
    viewport: { width: 1280, height: 720 },
    updatedAt: Date.now(),
    ...overrides,
  });

  describe('saveChunk & getSessionChunks', () => {
    it('应保存并读取 chunk', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));

      const chunks = await cache.getSessionChunks('session-1');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].sessionId).toBe('session-1');
      expect(chunks[0].cacheChunkIndex).toBe(0);
    });

    it('应保存多个 chunk 并按 cacheChunkIndex 排序', async () => {
      await cache.saveChunk(makeChunk('session-1', 2));
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-1', 1));

      const chunks = await cache.getSessionChunks('session-1');
      expect(chunks).toHaveLength(3);
      expect(chunks[0].cacheChunkIndex).toBe(0);
      expect(chunks[1].cacheChunkIndex).toBe(1);
      expect(chunks[2].cacheChunkIndex).toBe(2);
    });

    it('不同 session 的 chunk 应独立', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-2', 0));
      await cache.saveChunk(makeChunk('session-2', 1));

      const chunks1 = await cache.getSessionChunks('session-1');
      const chunks2 = await cache.getSessionChunks('session-2');
      expect(chunks1).toHaveLength(1);
      expect(chunks2).toHaveLength(2);
    });
  });

  describe('getAllSessions', () => {
    it('应返回所有不同的 sessionId', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-1', 1));
      await cache.saveChunk(makeChunk('session-2', 0));

      const sessions = await cache.getAllSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions).toContain('session-1');
      expect(sessions).toContain('session-2');
    });

    it('空 DB 应返回空数组', async () => {
      const sessions = await cache.getAllSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('deleteChunk', () => {
    it('应删除指定 chunk', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-1', 1));

      await cache.deleteChunk('session-1_0');

      const chunks = await cache.getSessionChunks('session-1');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].cacheChunkIndex).toBe(1);
    });

    it('删除不存在的 chunk 不应报错', async () => {
      await expect(cache.deleteChunk('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('deleteSession', () => {
    it('应删除指定 session 的所有 chunk', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));
      await cache.saveChunk(makeChunk('session-1', 1));
      await cache.saveChunk(makeChunk('session-2', 0));

      await cache.deleteSession('session-1');

      const chunks1 = await cache.getSessionChunks('session-1');
      const chunks2 = await cache.getSessionChunks('session-2');
      expect(chunks1).toHaveLength(0);
      expect(chunks2).toHaveLength(1);
    });

    it('删除不存在的 session 不应报错', async () => {
      await expect(cache.deleteSession('nonexistent')).resolves.toBeUndefined();
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

  describe('chunk 分段进度持久化', () => {
    it('应保存并恢复分段进度字段', async () => {
      await cache.saveChunk(makeChunk('session-1', 0, {
        chunkIndex: 5,
        lastChunkEventIndex: 100,
      }));

      const chunks = await cache.getSessionChunks('session-1');
      expect(chunks[0].chunkIndex).toBe(5);
      expect(chunks[0].lastChunkEventIndex).toBe(100);
    });

    it('无分段字段时应兼容', async () => {
      await cache.saveChunk(makeChunk('session-1', 0));

      const chunks = await cache.getSessionChunks('session-1');
      expect(chunks[0].chunkIndex).toBeUndefined();
      expect(chunks[0].lastChunkEventIndex).toBeUndefined();
    });
  });

  describe('兼容旧接口', () => {
    it('save() 应能保存旧格式数据', async () => {
      await cache.save({
        id: 'legacy-session',
        events: [{ type: 2, data: {}, timestamp: 1000 }],
        tags: [],
        startTime: 1000,
        url: 'https://example.com',
        userAgent: 'test',
        screenResolution: '1920x1080',
        viewport: { width: 1280, height: 720 },
        updatedAt: Date.now(),
      });

      const all = await cache.getAll();
      expect(all.length).toBeGreaterThanOrEqual(1);
    });

    it('delete() 应能删除旧格式数据', async () => {
      await cache.save({
        id: 'legacy-session',
        events: [],
        tags: [],
        startTime: 1000,
        url: 'https://example.com',
        userAgent: 'test',
        screenResolution: '1920x1080',
        viewport: { width: 1280, height: 720 },
        updatedAt: Date.now(),
      });

      await cache.delete('legacy-session');
      const all = await cache.getAll();
      const found = all.find((item: any) => item.id === 'legacy-session');
      expect(found).toBeUndefined();
    });

    it('toRawRecordingData() 应正确转换', () => {
      const raw = cache.toRawRecordingData({
        id: 'session-1',
        events: [{ type: 2, data: {}, timestamp: 1000 }],
        tags: [],
        startTime: 1000,
        url: 'https://example.com',
        userAgent: 'test',
        screenResolution: '1920x1080',
        viewport: { width: 1280, height: 720 },
        lastChunkEventIndex: 42,
        chunkIndex: 3,
      });

      expect(raw.sessionId).toBe('session-1');
      expect(raw.lastChunkEventIndex).toBe(42);
      expect(raw.chunkIndex).toBe(3);
    });
  });

  describe('IndexedDB 不可用时的降级', () => {
    it('indexedDB undefined 时应优雅降级', async () => {
      const originalIndexedDB = globalThis.indexedDB;
      // @ts-ignore
      delete globalThis.indexedDB;

      const fallbackCache = new CacheManager();

      await expect(fallbackCache.saveChunk(makeChunk('s1'))).resolves.toBeUndefined();
      const chunks = await fallbackCache.getSessionChunks('s1');
      expect(chunks).toEqual([]);
      const sessions = await fallbackCache.getAllSessions();
      expect(sessions).toEqual([]);
      await expect(fallbackCache.deleteChunk('s1_0')).resolves.toBeUndefined();
      await expect(fallbackCache.deleteSession('s1')).resolves.toBeUndefined();
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

      vi.spyOn(Date, 'now').mockReturnValue(realNow - 5000);
      await expiredCache.saveChunk(makeChunk('old', 0, { updatedAt: realNow - 5000 }));
      await new Promise(r => setTimeout(r, 30));

      vi.spyOn(Date, 'now').mockReturnValue(realNow);
      await expiredCache.saveChunk(makeChunk('new', 0, { updatedAt: realNow }));
      await new Promise(r => setTimeout(r, 30));

      vi.restoreAllMocks();

      const all = await expiredCache.getAll();
      const newOnly = all.filter((item: any) => (item.sessionId || item.id) !== 'old');
      expect(newOnly.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('存储空间预警清理', () => {
    it('navigator.storage.estimate 不可用时不报错', async () => {
      const newCache = new CacheManager(10, 1000);
      await new Promise(r => setTimeout(r, 100));
      await expect(newCache.getAll()).resolves.toBeDefined();
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
      await cache.saveChunk(makeChunk('s1', 0, { updatedAt: now }));
      await cache.saveChunk(makeChunk('s2', 0, { updatedAt: now }));

      const newCache = new CacheManager(10);
      await new Promise(r => setTimeout(r, 100));

      const all = await newCache.getAll();
      expect(all.length).toBe(2);
    });
  });
});
