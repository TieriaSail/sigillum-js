/**
 * IndexedDB 缓存管理器
 * 用于防止页面崩溃/刷新时丢失录制数据
 *
 * 存储模式（v1.4.0+）：
 * 每次 saveToCache 写入一个新的 chunk 条目（增量），而非覆盖一个不断膨胀的大条目。
 * key 格式：{sessionId}:{cacheChunkIndex}
 *
 * 清理策略（按优先级执行）：
 * 1. 过期清理 — 超过 maxAge 的缓存条目自动删除
 * 2. 条数限制 — 超过 maxItems 时淘汰最旧条目
 * 3. 存储空间预警 — 当 IndexedDB 使用量超过配额 80% 时淘汰最旧条目
 */

import type { EventWithTime, TagInfo, SessionMetadata } from './types';

const DB_NAME = 'session-replay-cache';
const DB_VERSION = 2;
const STORE_NAME = 'recordings';
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const STORAGE_USAGE_THRESHOLD = 0.8; // 80%

/** 增量缓存 chunk 条目 */
export interface CachedChunk {
  /** 复合 key：{sessionId}:{cacheChunkIndex} */
  id: string;
  sessionId: string;
  cacheChunkIndex: number;
  events: EventWithTime[];
  tags: TagInfo[];
  startTime: number;
  url: string;
  userAgent: string;
  screenResolution: string;
  viewport: { width: number; height: number };
  updatedAt: number;
  /** 已通过分段上传成功的事件截止索引 */
  lastChunkEventIndex?: number;
  /** 下一个待上传的 chunk 序号 */
  chunkIndex?: number;
  /** 会话元数据 */
  metadata?: SessionMetadata;
}

/** 旧版全量缓存格式（v1.3.x 兼容） */
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
      if (ready) {
        this.migrateLegacyData().then(() => this.cleanup());
      }
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
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('sessionId', 'sessionId', { unique: false });
          } else {
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
   * 将 v1.3.x 的旧格式数据迁移为增量 chunk 格式
   */
  private async migrateLegacyData(): Promise<void> {
    if (!this.db) return;

    try {
      const all = await this.getAllInternal();
      for (const item of all) {
        if (!('sessionId' in item) || !(item as any).sessionId) {
          const legacy = item as unknown as LegacyCachedRecording;
          const migrated: CachedChunk = {
            id: `${legacy.id}:0`,
            sessionId: legacy.id,
            cacheChunkIndex: 0,
            events: legacy.events,
            tags: legacy.tags,
            startTime: legacy.startTime,
            url: legacy.url,
            userAgent: legacy.userAgent,
            screenResolution: legacy.screenResolution,
            viewport: legacy.viewport,
            updatedAt: legacy.updatedAt,
            lastChunkEventIndex: legacy.lastChunkEventIndex,
            chunkIndex: legacy.chunkIndex,
          };

          try {
            await this.putInternal(migrated);
            await this.deleteInternal(legacy.id);
          } catch {
            // 单行迁移失败，保留旧数据，继续处理下一行
          }
        }
      }
    } catch {
      // getAllInternal 失败，跳过整个迁移
    }
  }

  /**
   * 综合清理：过期 + 条数 + 存储空间
   */
  private async cleanup(): Promise<void> {
    if (!this.db) return;

    try {
      const all = await this.getAllInternal();
      if (all.length === 0) return;

      const now = Date.now();
      const toDelete: string[] = [];

      for (const item of all) {
        if (now - item.updatedAt > this.maxAge) {
          toDelete.push(item.id);
        }
      }

      // 按 session 分组计数
      const remaining = all.filter((item) => !toDelete.includes(item.id));
      const sessionIds = new Set(remaining.map(c => (c as CachedChunk).sessionId || c.id));
      if (sessionIds.size > this.maxItems) {
        const sessionUpdatedAt = new Map<string, number>();
        for (const item of remaining) {
          const sid = (item as CachedChunk).sessionId || item.id;
          const existing = sessionUpdatedAt.get(sid) || 0;
          if (item.updatedAt > existing) sessionUpdatedAt.set(sid, item.updatedAt);
        }
        const sorted = [...sessionUpdatedAt.entries()].sort((a, b) => a[1] - b[1]);
        const excess = sorted.length - this.maxItems;
        const sessionsToDelete = new Set(sorted.slice(0, excess).map(s => s[0]));
        for (const item of remaining) {
          const sid = (item as CachedChunk).sessionId || item.id;
          if (sessionsToDelete.has(sid)) {
            toDelete.push(item.id);
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

      const all = await this.getAllInternal() as CachedChunk[];
      if (all.length <= 1) return;

      // 按 session 分组，整体删除最旧的 session（避免部分删导致 session 残缺）
      const sessionUpdatedAt = new Map<string, number>();
      for (const item of all) {
        const sid = item.sessionId || item.id;
        const existing = sessionUpdatedAt.get(sid) || 0;
        if (item.updatedAt > existing) sessionUpdatedAt.set(sid, item.updatedAt);
      }

      const sorted = [...sessionUpdatedAt.entries()].sort((a, b) => a[1] - b[1]);
      const sessionsToDelete = new Set(sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))).map(s => s[0]));

      const toDelete = all
        .filter(item => sessionsToDelete.has(item.sessionId || item.id))
        .map(item => item.id);
      if (toDelete.length > 0) {
        await this.deleteBatch(toDelete);
      }
    } catch {
      // 静默处理
    }
  }

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

  private putInternal(data: CachedChunk): Promise<void> {
    if (!this.db) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(data);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error('IndexedDB put failed'));
      } catch (e) {
        reject(e);
      }
    });
  }

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

  // ==================== 公开 API ====================

  /**
   * 保存增量 chunk
   */
  async saveChunk(data: Omit<CachedChunk, 'id'>): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    const chunk: CachedChunk = {
      ...data,
      id: `${data.sessionId}:${data.cacheChunkIndex}`,
      updatedAt: Date.now(),
    };

    await this.putInternal(chunk);
  }

  /**
   * 获取所有不同 sessionId 的列表
   */
  async getAllSessions(): Promise<{ sessionId: string; updatedAt: number }[]> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return [];

    const all = await this.getAllInternal() as CachedChunk[];
    const now = Date.now();
    const sessionMap = new Map<string, number>();

    for (const item of all) {
      if (now - item.updatedAt > this.maxAge) continue;
      const sid = item.sessionId || item.id;
      const existing = sessionMap.get(sid) || 0;
      if (item.updatedAt > existing) sessionMap.set(sid, item.updatedAt);
    }

    return [...sessionMap.entries()].map(([sessionId, updatedAt]) => ({ sessionId, updatedAt }));
  }

  /**
   * 获取指定 session 的所有缓存 chunk
   */
  async getSessionChunks(sessionId: string): Promise<CachedChunk[]> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return [];

    const all = await this.getAllInternal() as CachedChunk[];
    return all.filter(item =>
      (item.sessionId === sessionId) ||
      (!item.sessionId && item.id === sessionId)
    );
  }

  /**
   * 删除单个 chunk 条目
   */
  async deleteChunk(id: string): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;
    await this.deleteInternal(id);
  }

  /**
   * 删除指定 session 的所有缓存 chunk
   */
  async deleteSession(sessionId: string): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    const chunks = await this.getSessionChunks(sessionId);
    const ids = chunks.map(c => c.id);
    // 也尝试删除旧格式 key
    ids.push(sessionId);
    await this.deleteBatch(ids);
  }

  /**
   * 获取所有缓存条目（兼容旧 API）
   */
  async getAll(): Promise<CachedChunk[]> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return [];

    const all = await this.getAllInternal() as CachedChunk[];
    if (all.length === 0) return [];

    const now = Date.now();
    const valid: CachedChunk[] = [];
    const expired: string[] = [];

    for (const item of all) {
      if (now - item.updatedAt > this.maxAge) {
        expired.push(item.id);
      } else {
        valid.push(item);
      }
    }

    if (expired.length > 0) {
      this.deleteBatch(expired);
    }

    return valid;
  }

  /**
   * @deprecated Use deleteSession instead
   */
  async delete(sessionId: string): Promise<void> {
    return this.deleteSession(sessionId);
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
}
