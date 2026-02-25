/**
 * IndexedDB 缓存管理器
 * 用于防止页面崩溃/刷新时丢失录制数据
 */

import type { RawRecordingData, EventWithTime, TagInfo } from './types';

const DB_NAME = 'session-replay-cache';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

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

  constructor(maxItems: number = 10) {
    this.maxItems = maxItems;
    this.dbReady = this.initDB();
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
   * 保存录制数据到缓存
   */
  async save(data: CachedRecording): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    try {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      // 先检查数量，超过限制则删除最旧的
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        if (countRequest.result >= this.maxItems) {
          // 删除最旧的记录
          const getAllRequest = store.getAll();
          getAllRequest.onsuccess = () => {
            const all = getAllRequest.result as CachedRecording[];
            all.sort((a, b) => a.updatedAt - b.updatedAt);
            // 删除最旧的
            if (all.length > 0) {
              store.delete(all[0].id);
            }
          };
        }
      };

      // 保存数据
      store.put({
        ...data,
        updatedAt: Date.now(),
      });
    } catch {
      // 静默处理
    }
  }

  /**
   * 获取所有未完成的录制
   */
  async getAll(): Promise<CachedRecording[]> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return [];

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
   * 删除指定的录制缓存
   */
  async delete(sessionId: string): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    try {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.delete(sessionId);
    } catch {
      // 静默处理
    }
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    const ready = await this.dbReady;
    if (!ready || !this.db) return;

    try {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
    } catch {
      // 静默处理
    }
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

