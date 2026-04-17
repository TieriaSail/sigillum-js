/**
 * IndexedDB 缓存管理器（增量 chunk 存储）
 * 用于防止页面崩溃/刷新时丢失录制数据
 *
 * v2 架构：每次缓存写入只存新增事件（增量），避免全量覆盖带来的性能问题。
 * 每个 session 可能有多条 chunk 记录，通过 sessionId 索引关联。
 *
 * 清理策略（按优先级执行）：
 * 1. 过期清理 — 超过 maxAge 的缓存条目自动删除
 * 2. 会话数限制 — 超过 maxItems 时淘汰最旧会话的全部 chunk
 * 3. 存储空间预警 — 当 IndexedDB 使用量超过配额 80% 时淘汰最旧会话
 */

import type { CachedChunk, EventWithTime, TagInfo } from './types';

const DB_NAME = 'session-replay-cache';
const DB_VERSION = 2;
const STORE_NAME = 'recordings';
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const STORAGE_USAGE_THRESHOLD = 0.8; // 80%

/** v1 遗留的全量缓存格式 */
interface LegacyCachedRecording {
  id: string;
  events: EventWithTime[];
  tags: TagInfo[];
  startTime: number;
  url: string;
  userAgent: string;
  screenResolution: string;
  viewport: { width: number; height: number };
  updatedAt: number;
  lastChunkEventIndex?: number;
  chunkIndex?: number;
}

/**
 * 缓存管理器
 */
export class CacheManager {
  private db: IDBDatabase | null = null;
  private dbReady: Promise<boolean>;
  private maxItems: number;
  private maxAge: number;

  constructor(maxItems: number = 10, maxAge: number = DEFAULT_MAX_AGE) {
    this.maxItems = maxItems;
    this.maxAge = maxAge;
    this.dbReady = this.initDB();

    this.dbReady.then((ready) => {
      if (ready) this.cleanup();
    });
  }

  private initDB(): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(false);
        return;
      }

      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          resolve(false);
        };

        request.onsuccess = () => {
          this.db = request.result;
          resolve(true);
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const oldVersion = event.oldVersion;

          if (oldVersion < 1) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('sessionId', 'sessionId', { unique: false });
          } else if (oldVersion < 2) {
            const transaction = (event.target as IDBOpenDBRequest).transaction!;
            const store = transaction.objectStore(STORE_NAME);
            if (!store.indexNames.contains('sessionId')) {
              store.createIndex('sessionId', 'sessionId', { unique: false });
            }
          }
        };
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * 迁移 v1 遗留数据为 v2 chunk 格式（per-row try/catch 防止单条失败影响整体）
   */
  async migrateLegacyData(): Promise<void> {
    if (!this.db) return;

    try {
      const allItems = await this.getAllInternal();
      for (const item of allItems) {
        if ((item as any).sessionId) continue; // already v2 format

        const legacy = item as unknown as LegacyCachedRecording;
        const chunk: CachedChunk = {
          id: `${legacy.id}_0`,
          sessionId: legacy.id,
          cacheChunkIndex: 0,
          events: legacy.events || [],
          tags: legacy.tags || [],
          startTime: legacy.startTime,
          url: legacy.url,
          userAgent: legacy.userAgent,
          screenResolution: legacy.screenResolution,
          viewport: legacy.viewport,
          updatedAt: legacy.updatedAt,
          chunkIndex: legacy.chunkIndex,
          lastChunkEventIndex: legacy.lastChunkEventIndex,
        };

        try {
          await this.putInternal(chunk);
          await this.deleteInternal(legacy.id);
        } catch {
          // per-row failure: keep old data, skip
        }
      }
    } catch {
      // migration failure is non-fatal
    }
  }

  /**
   * 内部 put 操作，reject on error (B2 修复)
   */
  private putInternal(data: CachedChunk): Promise<void> {
    if (!this.db) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(data);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error('IndexedDB put failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 内部 delete 操作
   */
  private deleteInternal(id: string): Promise<void> {
    if (!this.db) return Promise.resolve();

    return new Promise<void>((resolve) => {
      try {
        const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * 保存一个增量 chunk
   */
  async saveChunk(chunk: CachedChunk): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    await this.putInternal(chunk);
  }

  /**
   * 获取所有不同的 sessionId 列表
   */
  async getAllSessions(): Promise<string[]> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return [];

    const all = await this.getAllInternal();
    const sessions = new Set<string>();
    for (const item of all) {
      const sid = (item as any).sessionId || (item as any).id;
      if (sid) sessions.add(sid);
    }
    return Array.from(sessions);
  }

  /**
   * 获取指定 session 的所有 chunk，按 cacheChunkIndex 排序
   */
  async getSessionChunks(sessionId: string): Promise<CachedChunk[]> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return [];

    const all = await this.getAllInternal();
    const chunks = all.filter((item: any) => {
      return item.sessionId === sessionId;
    }) as CachedChunk[];

    chunks.sort((a, b) => (a.cacheChunkIndex ?? 0) - (b.cacheChunkIndex ?? 0));
    return chunks;
  }

  /**
   * 删除单个 chunk
   */
  async deleteChunk(chunkId: string): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;
    await this.deleteInternal(chunkId);
  }

  /**
   * 删除指定 session 的所有 chunk
   */
  async deleteSession(sessionId: string): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    const chunks = await this.getSessionChunks(sessionId);
    for (const chunk of chunks) {
      await this.deleteInternal(chunk.id);
    }
  }

  /**
   * 兼容旧接口: 删除指定录制缓存
   */
  async delete(sessionId: string): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    // 尝试删单条（v1 格式）和删 session（v2 格式）
    await this.deleteInternal(sessionId);
    await this.deleteSession(sessionId);
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    return new Promise<void>((resolve) => {
      try {
        const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * 获取所有未完成的缓存（过滤过期条目）— 兼容旧代码
   */
  async getAll(): Promise<any[]> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return [];

    const all = await this.getAllInternal();
    if (all.length === 0) return [];

    const now = Date.now();
    const valid: any[] = [];
    const expired: string[] = [];

    for (const item of all) {
      if (now - (item as any).updatedAt > this.maxAge) {
        expired.push((item as any).id);
      } else {
        valid.push(item);
      }
    }

    if (expired.length > 0) {
      this.deleteBatch(expired);
    }

    return valid;
  }

  // ==================== 内部方法 ====================

  private getAllInternal(): Promise<any[]> {
    if (!this.db) return Promise.resolve([]);

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          resolve(request.result || []);
        };

        request.onerror = () => {
          resolve([]);
        };
      } catch {
        resolve([]);
      }
    });
  }

  private deleteBatch(ids: string[]): Promise<void> {
    if (!this.db || ids.length === 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      try {
        const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        for (const id of ids) {
          store.delete(id);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async cleanup(): Promise<void> {
    if (!this.db) return;

    // 先迁移 v1 数据
    await this.migrateLegacyData();

    try {
      const all = await this.getAllInternal();
      if (all.length === 0) return;

      const now = Date.now();
      const toDelete: string[] = [];

      // Phase 1: 过期清理
      for (const item of all) {
        if (now - (item as any).updatedAt > this.maxAge) {
          toDelete.push((item as any).id);
        }
      }

      // Phase 2: 会话数限制
      const remaining = all.filter((item: any) => !toDelete.includes(item.id));
      const sessionMap = new Map<string, number>();
      for (const item of remaining) {
        const sid = (item as any).sessionId || (item as any).id;
        const updatedAt = (item as any).updatedAt || 0;
        const existing = sessionMap.get(sid) ?? 0;
        sessionMap.set(sid, Math.max(existing, updatedAt));
      }

      if (sessionMap.size > this.maxItems) {
        const sorted = Array.from(sessionMap.entries()).sort((a, b) => a[1] - b[1]);
        const excess = sorted.length - this.maxItems;
        const sessionsToRemove = new Set(sorted.slice(0, excess).map(s => s[0]));

        for (const item of remaining) {
          const sid = (item as any).sessionId || (item as any).id;
          if (sessionsToRemove.has(sid)) {
            toDelete.push((item as any).id);
          }
        }
      }

      if (toDelete.length > 0) {
        await this.deleteBatch(toDelete);
      }

      await this.cleanupByStorageQuota();
    } catch {
      // 静默处理
    }
  }

  private async cleanupByStorageQuota(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;

    try {
      const estimate = await navigator.storage.estimate();
      if (!estimate.quota || !estimate.usage) return;

      const usageRatio = estimate.usage / estimate.quota;
      if (usageRatio < STORAGE_USAGE_THRESHOLD) return;

      const all = await this.getAllInternal();
      if (all.length <= 1) return;

      // 按 session 分组，找出最旧的 session 整体删除（避免部分删导致 session 残缺）
      const sessionUpdatedAt = new Map<string, number>();
      for (const item of all) {
        const sid = (item as any).sessionId || (item as any).id;
        const existing = sessionUpdatedAt.get(sid) || 0;
        if ((item as any).updatedAt > existing) sessionUpdatedAt.set(sid, (item as any).updatedAt);
      }

      const sorted = [...sessionUpdatedAt.entries()].sort((a, b) => a[1] - b[1]);
      const sessionsToDelete = new Set(sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))).map(s => s[0]));

      const toDelete = all
        .filter((item: any) => sessionsToDelete.has((item as any).sessionId || (item as any).id))
        .map((item: any) => item.id);
      if (toDelete.length > 0) {
        await this.deleteBatch(toDelete);
      }
    } catch {
      // navigator.storage.estimate 可能失败，静默处理
    }
  }

  /**
   * 兼容旧接口: 保存全量录制数据
   * @deprecated 优先使用 saveChunk
   */
  async save(data: any): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    return new Promise<void>((resolve) => {
      try {
        const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const record = { ...data, updatedAt: Date.now() };

        store.put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * 兼容旧接口: 转换缓存数据
   * @deprecated
   */
  toRawRecordingData(cached: any): any {
    return {
      sessionId: cached.id || cached.sessionId,
      events: cached.events,
      tags: cached.tags,
      startTime: cached.startTime,
      url: cached.url,
      userAgent: cached.userAgent,
      screenResolution: cached.screenResolution,
      viewport: cached.viewport,
      lastChunkEventIndex: cached.lastChunkEventIndex ?? 0,
      chunkIndex: cached.chunkIndex ?? 0,
    };
  }
}
