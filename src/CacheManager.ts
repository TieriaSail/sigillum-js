/**
 * IndexedDB 缓存管理器
 * 用于防止页面崩溃/刷新时丢失录制数据
 *
 * 清理策略（按优先级执行）：
 * 1. 过期清理 — 超过 maxAge 的缓存条目自动删除
 * 2. 条数限制 — 超过 maxItems 时淘汰最旧条目
 * 3. 存储空间预警 — 当 IndexedDB 使用量超过配额 80% 时淘汰最旧条目
 */

import type { RawRecordingData, EventWithTime, TagInfo } from './types';

const DB_NAME = 'session-replay-cache';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const STORAGE_USAGE_THRESHOLD = 0.8; // 80%

/** 缓存的录制数据 */
interface CachedRecording {
  id: string; // sessionId
  events: EventWithTime[];
  tags: TagInfo[];
  startTime: number;
  url: string;
  userAgent: string;
  screenResolution: string;
  viewport: { width: number; height: number };
  updatedAt: number;
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

    // DB 就绪后执行一次清理
    this.dbReady.then((ready) => {
      if (ready) this.cleanup();
    });
  }

  /**
   * 初始化 IndexedDB
   */
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
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
      } catch {
        resolve(false);
      }
    });
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

      // Phase 1: 过期清理
      for (const item of all) {
        if (now - item.updatedAt > this.maxAge) {
          toDelete.push(item.id);
        }
      }

      // Phase 2: 条数限制（排除已标记删除的）
      const remaining = all.filter((item) => !toDelete.includes(item.id));
      if (remaining.length > this.maxItems) {
        remaining.sort((a, b) => a.updatedAt - b.updatedAt);
        const excess = remaining.length - this.maxItems;
        for (let i = 0; i < excess; i++) {
          toDelete.push(remaining[i].id);
        }
      }

      // 执行删除
      if (toDelete.length > 0) {
        await this.deleteBatch(toDelete);
      }

      // Phase 3: 存储空间预警（仅在 navigator.storage.estimate 可用时）
      await this.cleanupByStorageQuota();
    } catch {
      // 静默处理
    }
  }

  /**
   * 基于存储空间配额的清理
   * 当使用量超过 80% 时，逐条删除最旧的缓存直到低于阈值
   */
  private async cleanupByStorageQuota(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;

    try {
      const estimate = await navigator.storage.estimate();
      if (!estimate.quota || !estimate.usage) return;

      const usageRatio = estimate.usage / estimate.quota;
      if (usageRatio < STORAGE_USAGE_THRESHOLD) return;

      const all = await this.getAllInternal();
      if (all.length <= 1) return;

      // 按时间排序，删除最旧的一半
      all.sort((a, b) => a.updatedAt - b.updatedAt);
      const deleteCount = Math.ceil(all.length / 2);
      const toDelete = all.slice(0, deleteCount).map((item) => item.id);
      await this.deleteBatch(toDelete);
    } catch {
      // navigator.storage.estimate 可能失败，静默处理
    }
  }

  /**
   * 内部方法：获取所有缓存条目
   */
  private getAllInternal(): Promise<CachedRecording[]> {
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

  /**
   * 批量删除
   */
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

  /**
   * 保存录制数据到缓存
   */
  async save(data: CachedRecording): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    return new Promise<void>((resolve) => {
      try {
        const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const record = { ...data, updatedAt: Date.now() };

        const getRequest = store.get(data.id);
        getRequest.onsuccess = () => {
          const isUpdate = !!getRequest.result;
          store.put(record);

          if (!isUpdate) {
            const countRequest = store.count();
            countRequest.onsuccess = () => {
              if (countRequest.result > this.maxItems) {
                const getAllRequest = store.getAll();
                getAllRequest.onsuccess = () => {
                  const all = getAllRequest.result as CachedRecording[];
                  all.sort((a, b) => a.updatedAt - b.updatedAt);
                  const oldest = all.find((item) => item.id !== data.id);
                  if (oldest) {
                    store.delete(oldest.id);
                  }
                };
              }
            };
          }
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * 获取所有未完成的录制（自动过滤过期条目）
   */
  async getAll(): Promise<CachedRecording[]> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return [];

    const all = await this.getAllInternal();
    if (all.length === 0) return [];

    // 过滤过期条目并异步清理
    const now = Date.now();
    const valid: CachedRecording[] = [];
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
   * 删除指定的录制缓存
   */
  async delete(sessionId: string): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    return new Promise<void>((resolve) => {
      try {
        const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete(sessionId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
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
   * 将缓存数据转换为 RawRecordingData
   */
  toRawRecordingData(cached: CachedRecording): Omit<RawRecordingData, 'endTime' | 'duration'> {
    return {
      sessionId: cached.id,
      events: cached.events,
      tags: cached.tags,
      startTime: cached.startTime,
      url: cached.url,
      userAgent: cached.userAgent,
      screenResolution: cached.screenResolution,
      viewport: cached.viewport,
    };
  }
}
