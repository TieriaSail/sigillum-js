/**
 * 会话录制器
 * 基于 rrweb 实现用户行为录制，用于线上问题复现
 *
 * 特性：
 * - 手动控制录制（start/stop/pause/resume）
 * - 字段映射（适配自定义后端数据结构）
 * - IndexedDB 缓存（防止页面崩溃丢失数据）
 * - 兼容性检查（不兼容时静默处理）
 * - 完整的 rrweb 隐私保护配置透传
 * - DOM 精简、数据压缩、插件系统
 * - 事件回调（onEventEmit / onError / onStatusChange）
 * - 手动全量快照（takeFullSnapshot）
 * - 会话元数据自动采集
 * - SPA 路由变化追踪
 * - 录制行为摘要（不看回放就能了解用户行为）
 * - 分段上传（长录制场景）
 * - 单例模式支持
 */

import { record } from 'rrweb';
import type {
  SessionRecorderOptions,
  RecordingStatus,
  EventWithTime,
  TagInfo,
  RawRecordingData,
  SessionMetadata,
  RecordingSummary,
  RouteChange,
  RecordingChunk,
} from './types';
import { FieldMapper } from './FieldMapper';
import { CacheManager } from './CacheManager';
import { checkCompatibility, isBrowser } from './compatibility';

/**
 * 默认配置
 */
const DEFAULT_OPTIONS: Partial<SessionRecorderOptions> = {
  enabled: true,
  maxDuration: 30 * 60 * 1000, // 30 分钟
  maxRetries: 3,
  uploadOnUnload: true,
  debug: false,
  cache: {
    enabled: true,
    saveInterval: 5000,
    maxItems: 10,
  },
  rrwebConfig: {
    recordMouseMove: true,
    mouseMoveInterval: 50,
    recordScroll: true,
    scrollInterval: 150,
    recordInput: true,
    recordMedia: true,
    recordCanvas: false,
    canvasFPS: 0,
    checkoutEveryNms: 5 * 60 * 1000, // 5 分钟
    inlineStylesheet: true,
    inlineImages: false,
    collectFonts: false,
    recordCrossOriginIframes: false,
    userTriggeredOnInput: false,
    privacy: {
      maskAllInputs: false,
      maskInputOptions: { password: true },
      ignoreClass: 'rr-ignore',
    },
  },
};

// ==================== rrweb 事件类型常量 ====================
// https://github.com/rrweb-io/rrweb/blob/master/packages/types/src/index.ts
const RRWEB_EVENT_TYPE = {
  DomContentLoaded: 0,
  Load: 1,
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
  Plugin: 6,
} as const;

// IncrementalSource 子类型
const INCREMENTAL_SOURCE = {
  Mutation: 0,
  MouseMove: 1,
  MouseInteraction: 2,
  Scroll: 3,
  ViewportResize: 4,
  Input: 5,
  TouchMove: 6,
  MediaInteraction: 7,
  StyleSheetRule: 8,
  CanvasMutation: 9,
  Font: 10,
  Log: 11,
  Drag: 12,
  StyleDeclaration: 13,
  Selection: 14,
  AdoptedStyleSheet: 15,
} as const;

// MouseInteraction 子类型
const MOUSE_INTERACTION = {
  MouseUp: 0,
  MouseDown: 1,
  Click: 2,
  ContextMenu: 3,
  DblClick: 4,
  Focus: 5,
  Blur: 6,
  TouchStart: 7,
  TouchMove_Departed: 8,
  TouchEnd: 9,
  TouchCancel: 10,
} as const;

/**
 * SessionRecorder 类
 */
export class SessionRecorder {
  private options: SessionRecorderOptions;
  private fieldMapper: FieldMapper;
  private cacheManager: CacheManager | null = null;

  private stopRecordingFn: (() => void) | null = null;
  private events: EventWithTime[] = [];
  private tags: TagInfo[] = [];
  private sessionId: string = '';
  private startTime: number = 0;
  private status: RecordingStatus = 'idle';

  private cacheTimer: number | null = null;
  private maxDurationTimer: number | null = null;
  private unloadHandler: (() => void) | null = null;

  /** 是否因不兼容而禁用 */
  private disabled: boolean = false;

  // ========== 元数据 ==========
  private metadata: SessionMetadata | null = null;

  // ========== 路由追踪 ==========
  private routeChanges: RouteChange[] = [];
  private currentUrl: string = '';
  private popstateHandler: (() => void) | null = null;
  private originalPushState: typeof history.pushState | null = null;
  private originalReplaceState: typeof history.replaceState | null = null;

  // ========== 行为统计 ==========
  private clickCount: number = 0;
  private inputCount: number = 0;
  private scrollCount: number = 0;

  // ========== 分段上传 ==========
  private chunkTimer: number | null = null;
  private chunkIndex: number = 0;
  private lastChunkEventIndex: number = 0;

  constructor(options: SessionRecorderOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.fieldMapper = new FieldMapper(options.fieldMapping);

    // 检查浏览器环境
    if (!isBrowser()) {
      this.disabled = true;
      return;
    }

    // 检查兼容性
    const compatibility = checkCompatibility();
    if (!compatibility.supported) {
      this.disabled = true;
      this.options.onUnsupported?.(compatibility.reason || 'Browser not supported');
      this.log('Browser not supported:', compatibility.reason);
      return;
    }

    // 初始化缓存管理器
    if (this.options.cache?.enabled !== false) {
      this.cacheManager = new CacheManager(this.options.cache?.maxItems);
      // 尝试恢复之前未完成的录制
      this.recoverCachedRecordings();
    }
  }

  /**
   * 日志输出
   */
  private log(...args: any[]): void {
    if (this.options.debug) {
      console.log('[SessionRecorder]', ...args);
    }
  }

  /**
   * 更新录制状态并触发回调
   */
  private setStatus(newStatus: RecordingStatus): void {
    const prevStatus = this.status;
    this.status = newStatus;
    if (prevStatus !== newStatus) {
      try {
        this.options.onStatusChange?.(newStatus, prevStatus);
      } catch (err) {
        this.log('Error in onStatusChange callback:', err);
      }
    }
  }

  /**
   * 安全触发错误回调
   */
  private emitError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    try {
      this.options.onError?.(err);
    } catch (callbackErr) {
      this.log('Error in onError callback:', callbackErr);
    }
  }

  /**
   * 检查是否启用
   */
  private isEnabled(): boolean {
    if (this.disabled) return false;

    const enabled = this.options.enabled;
    if (typeof enabled === 'function') {
      try {
        return enabled();
      } catch (error) {
        this.log('Error in enabled function:', error);
        return false;
      }
    }
    return enabled !== false;
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ==================== 元数据采集 ====================

  /**
   * 自动采集会话元数据
   */
  private collectMetadata(): SessionMetadata {
    const nav = navigator as any;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

    return {
      title: document.title || '',
      referrer: document.referrer || '',
      language: navigator.language || '',
      timezone: Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone || '',
      connectionType: conn?.type || 'unknown',
      connectionEffectiveType: conn?.effectiveType || 'unknown',
      deviceMemory: nav.deviceMemory || 0,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      touchSupport: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }

  // ==================== SPA 路由追踪 ====================

  /**
   * 开始监听路由变化
   */
  private startRouteTracking(): void {
    this.currentUrl = window.location.href;

    // 监听 popstate（浏览器前进/后退）
    this.popstateHandler = () => {
      this.onRouteChange(window.location.href);
    };
    window.addEventListener('popstate', this.popstateHandler);

    // 劫持 pushState / replaceState（SPA 路由跳转）
    this.originalPushState = history.pushState.bind(history);
    this.originalReplaceState = history.replaceState.bind(history);

    const self = this;

    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      self.originalPushState!(...args);
      // pushState 不触发 popstate，需要手动检测
      self.onRouteChange(window.location.href);
    };

    history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
      self.originalReplaceState!(...args);
      self.onRouteChange(window.location.href);
    };
  }

  /**
   * 路由变化处理
   */
  private onRouteChange(newUrl: string): void {
    if (newUrl === this.currentUrl) return;

    const change: RouteChange = {
      from: this.currentUrl,
      to: newUrl,
      timestamp: Date.now(),
    };

    this.routeChanges.push(change);
    this.currentUrl = newUrl;

    // 同时作为 tag 记录，方便回放时定位
    try {
      record.addCustomEvent('sigillum-route-change', change);
    } catch {
      // 静默处理
    }

    this.log('Route changed:', change.from, '->', change.to);
  }

  /**
   * 停止路由追踪
   */
  private stopRouteTracking(): void {
    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler);
      this.popstateHandler = null;
    }

    // 恢复原始方法
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
  }

  // ==================== 行为统计 ====================

  /**
   * 分析事件并更新行为统计
   */
  private analyzeEvent(event: EventWithTime): void {
    if (event.type !== RRWEB_EVENT_TYPE.IncrementalSnapshot) return;

    const source = event.data?.source;

    switch (source) {
      case INCREMENTAL_SOURCE.MouseInteraction:
        if (
          event.data?.type === MOUSE_INTERACTION.Click ||
          event.data?.type === MOUSE_INTERACTION.DblClick
        ) {
          this.clickCount++;
        }
        break;
      case INCREMENTAL_SOURCE.Input:
        this.inputCount++;
        break;
      case INCREMENTAL_SOURCE.Scroll:
        this.scrollCount++;
        break;
    }
  }

  /**
   * 生成录制行为摘要
   */
  private buildSummary(): RecordingSummary {
    const visitedUrls = new Set<string>();
    visitedUrls.add(this.currentUrl);
    for (const rc of this.routeChanges) {
      visitedUrls.add(rc.from);
      visitedUrls.add(rc.to);
    }

    return {
      totalEvents: this.events.length,
      clickCount: this.clickCount,
      inputCount: this.inputCount,
      scrollCount: this.scrollCount,
      routeChangeCount: this.routeChanges.length,
      routeChanges: [...this.routeChanges],
      tagCount: this.tags.length,
      duration: Date.now() - this.startTime,
      visitedUrls: Array.from(visitedUrls),
    };
  }

  // ==================== 分段上传 ====================

  /**
   * 启动分段上传定时器
   */
  private startChunkTimer(): void {
    const config = this.options.chunkedUpload;
    if (!config?.enabled || !this.options.onChunkUpload) return;

    const interval = config.interval || 60000;

    this.chunkTimer = setInterval(() => {
      this.uploadChunk(false);
    }, interval) as unknown as number;

    this.log('Chunked upload enabled, interval:', interval);
  }

  /**
   * 上传一个分段
   */
  private async uploadChunk(isFinal: boolean): Promise<void> {
    if (!this.options.onChunkUpload) return;

    const newEvents = this.events.slice(this.lastChunkEventIndex);
    if (newEvents.length === 0 && !isFinal) return;

    const chunk: RecordingChunk = {
      sessionId: this.sessionId,
      chunkIndex: this.chunkIndex,
      isFinal,
      events: newEvents,
      startTime: this.chunkIndex === 0 ? this.startTime : (newEvents[0]?.timestamp || Date.now()),
      endTime: Date.now(),
      tags: [...this.tags],
      summary: this.buildSummary(),
      metadata: this.chunkIndex === 0 ? (this.metadata || undefined) : undefined,
    };

    this.lastChunkEventIndex = this.events.length;
    this.chunkIndex++;

    try {
      const result = await this.options.onChunkUpload(chunk);
      if (result.success) {
        this.log(`Chunk ${chunk.chunkIndex} uploaded (${newEvents.length} events, final: ${isFinal})`);
      } else {
        this.log(`Chunk ${chunk.chunkIndex} upload failed:`, result.error);
      }
    } catch (error) {
      this.log('Chunk upload error:', error);
      this.emitError(error);
    }
  }

  // ==================== rrweb 配置构建 ====================

  /**
   * 构建 rrweb record() 的完整配置
   */
  private buildRrwebOptions(): Record<string, any> {
    const rrwebConfig = this.options.rrwebConfig || {};
    const privacy = rrwebConfig.privacy || {};

    const options: Record<string, any> = {
      emit: (event: EventWithTime) => {
        this.events.push(event);

        // 分析行为统计
        this.analyzeEvent(event);

        // 触发事件回调
        try {
          this.options.onEventEmit?.(event, this.events.length);
        } catch (err) {
          this.log('Error in onEventEmit callback:', err);
        }
      },

      // 快照配置
      checkoutEveryNms: rrwebConfig.checkoutEveryNms || 5 * 60 * 1000,
      checkoutEveryNth: rrwebConfig.checkoutEveryNth,

      // Canvas
      recordCanvas: rrwebConfig.recordCanvas || false,

      // 采样策略
      sampling: {
        mousemove: rrwebConfig.recordMouseMove !== false
          ? rrwebConfig.mouseMoveInterval || 50
          : false,
        scroll: rrwebConfig.recordScroll !== false
          ? rrwebConfig.scrollInterval || 150
          : 150,
        input: rrwebConfig.recordInput !== false ? 'last' : undefined,
        media: rrwebConfig.recordMedia !== false ? 800 : undefined,
        canvas: rrwebConfig.canvasFPS || 0,
      },

      // ========== 隐私保护（完整透传）==========
      blockClass: privacy.blockClass,
      blockSelector: privacy.blockSelector,
      maskTextClass: privacy.maskTextClass,
      maskTextSelector: privacy.maskTextSelector,
      maskTextFn: privacy.maskTextFn,
      maskAllInputs: privacy.maskAllInputs,
      maskInputOptions: privacy.maskInputOptions || { password: true },
      maskInputFn: privacy.maskInputFn,
      ignoreClass: privacy.ignoreClass || 'rr-ignore',

      // ========== DOM 精简 ==========
      slimDOMOptions: rrwebConfig.slimDOMOptions,

      // ========== 资源内联 ==========
      inlineStylesheet: rrwebConfig.inlineStylesheet !== false,
      inlineImages: rrwebConfig.inlineImages || false,
      collectFonts: rrwebConfig.collectFonts || false,

      // ========== iframe ==========
      recordCrossOriginIframes: rrwebConfig.recordCrossOriginIframes || false,

      // ========== 数据压缩 ==========
      packFn: rrwebConfig.packFn,

      // ========== 插件 ==========
      plugins: rrwebConfig.plugins,

      // ========== 其他 ==========
      userTriggeredOnInput: rrwebConfig.userTriggeredOnInput || false,
      ignoreCSSAttributes: rrwebConfig.ignoreCSSAttributes,
    };

    // 清理 undefined 值，避免覆盖 rrweb 的默认值
    Object.keys(options).forEach(key => {
      if (options[key] === undefined) {
        delete options[key];
      }
    });

    return options;
  }

  // ==================== 录制生命周期 ====================

  /**
   * 开始录制
   */
  start(): void {
    if (!this.isEnabled()) {
      this.log('Recording disabled');
      return;
    }

    if (this.status === 'recording') {
      this.log('Already recording');
      return;
    }

    // 如果是暂停状态，不重新初始化
    if (this.status !== 'paused') {
      this.sessionId = this.generateSessionId();
      this.startTime = Date.now();
      this.events = [];
      this.tags = [];
      this.routeChanges = [];
      this.clickCount = 0;
      this.inputCount = 0;
      this.scrollCount = 0;
      this.chunkIndex = 0;
      this.lastChunkEventIndex = 0;

      // 采集元数据
      this.metadata = this.collectMetadata();
    }

    try {
      const rrwebOptions = this.buildRrwebOptions();

      this.stopRecordingFn = record(rrwebOptions) as (() => void);

      this.setStatus('recording');
      this.log('Started recording, sessionId:', this.sessionId);

      // 启动路由追踪
      this.startRouteTracking();

      // 启动缓存定时器
      this.startCacheTimer();

      // 启动分段上传定时器
      this.startChunkTimer();

      // 设置最大录制时长
      if (this.options.maxDuration) {
        this.maxDurationTimer = setTimeout(() => {
          if (this.status === 'recording') {
            this.log('Max duration reached, stopping');
            this.stop();
          }
        }, this.options.maxDuration) as unknown as number;
      }

      // 注册页面卸载处理
      if (this.options.uploadOnUnload !== false) {
        this.registerUnloadHandler();
      }
    } catch (error) {
      this.log('Failed to start recording:', error);
      this.emitError(error);
      this.setStatus('idle');
    }
  }

  /**
   * 停止录制并上传
   */
  async stop(): Promise<void> {
    if (this.status !== 'recording' && this.status !== 'paused') {
      return;
    }

    // 停止 rrweb 录制
    if (this.stopRecordingFn) {
      this.stopRecordingFn();
      this.stopRecordingFn = null;
    }

    // 清理定时器
    this.clearTimers();

    // 停止路由追踪
    this.stopRouteTracking();

    // 移除卸载处理
    this.unregisterUnloadHandler();

    const endTime = Date.now();
    this.setStatus('stopped');

    this.log('Stopped recording, uploading...');

    // 删除缓存
    if (this.cacheManager) {
      await this.cacheManager.delete(this.sessionId);
    }

    // 如果启用了分段上传，上传最后一个分段
    if (this.options.chunkedUpload?.enabled && this.options.onChunkUpload) {
      await this.uploadChunk(true);
    }

    // 上传完整数据
    if (this.events.length > 0) {
      await this.upload(endTime);
    }

    // 重置状态
    this.resetState();
  }

  /**
   * 暂停录制（不上传）
   */
  pause(): void {
    if (this.status !== 'recording') {
      return;
    }

    if (this.stopRecordingFn) {
      this.stopRecordingFn();
      this.stopRecordingFn = null;
    }

    this.clearTimers();
    this.stopRouteTracking();
    this.setStatus('paused');
    this.log('Paused recording');
  }

  /**
   * 恢复录制
   */
  resume(): void {
    if (this.status !== 'paused') {
      return;
    }

    this.log('Resuming recording');
    this.start();
  }

  /**
   * 上传录制数据
   */
  private async upload(endTime: number): Promise<void> {
    const rawData: RawRecordingData = {
      sessionId: this.sessionId,
      events: this.events,
      startTime: this.startTime,
      endTime,
      duration: endTime - this.startTime,
      tags: this.tags,
      url: window.location.href,
      userAgent: navigator.userAgent,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      metadata: this.metadata || undefined,
      summary: this.buildSummary(),
    };

    // 字段映射
    let serverData = this.fieldMapper.toServer(rawData);

    // 上传前处理
    if (this.options.beforeUpload) {
      serverData = this.options.beforeUpload(serverData);
    }

    // 上传（带重试）
    let retries = 0;
    const maxRetries = this.options.maxRetries || 3;

    while (retries < maxRetries) {
      try {
        const result = await this.options.onUpload(serverData);
        if (result.success) {
          this.log('Upload successful');
          return;
        }
        throw new Error(result.error || 'Upload failed');
      } catch (error) {
        retries++;
        this.log(`Upload failed (attempt ${retries}/${maxRetries}):`, error);

        if (retries >= maxRetries) {
          this.log('Max retries reached, upload failed');
          this.emitError(error);
          return;
        }

        // 指数退避
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retries) * 1000));
      }
    }
  }

  /**
   * 启动缓存定时器
   */
  private startCacheTimer(): void {
    if (!this.cacheManager || this.options.cache?.enabled === false) {
      return;
    }

    const interval = this.options.cache?.saveInterval || 5000;

    this.cacheTimer = setInterval(() => {
      this.saveToCache();
    }, interval) as unknown as number;
  }

  /**
   * 保存到缓存
   */
  private saveToCache(): void {
    if (!this.cacheManager || this.events.length === 0) {
      return;
    }

    this.cacheManager.save({
      id: this.sessionId,
      events: [...this.events],
      tags: [...this.tags],
      startTime: this.startTime,
      url: window.location.href,
      userAgent: navigator.userAgent,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      updatedAt: Date.now(),
    });

    this.log('Saved to cache');
  }

  /**
   * 恢复缓存的录制
   */
  private async recoverCachedRecordings(): Promise<void> {
    if (!this.cacheManager) return;

    const cached = await this.cacheManager.getAll();
    if (cached.length === 0) return;

    this.log(`Found ${cached.length} cached recordings, uploading...`);

    for (const item of cached) {
      const rawData: RawRecordingData = {
        ...this.cacheManager.toRawRecordingData(item),
        endTime: item.updatedAt,
        duration: item.updatedAt - item.startTime,
      };

      let serverData = this.fieldMapper.toServer(rawData);
      if (this.options.beforeUpload) {
        serverData = this.options.beforeUpload(serverData);
      }

      try {
        const result = await this.options.onUpload(serverData);
        if (result.success) {
          await this.cacheManager.delete(item.id);
          this.log('Recovered and uploaded cached recording:', item.id);
        }
      } catch (error) {
        this.log('Failed to upload cached recording:', error);
      }
    }
  }

  /**
   * 清理定时器
   */
  private clearTimers(): void {
    if (this.cacheTimer) {
      clearInterval(this.cacheTimer);
      this.cacheTimer = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }
  }

  /**
   * 注册页面卸载处理
   */
  private registerUnloadHandler(): void {
    this.unloadHandler = () => {
      if (this.status === 'recording' && this.events.length > 0) {
        // 保存到缓存（下次打开时恢复并上传）
        this.saveToCache();
        this.log('Page unload, saved to cache');
      }
    };

    window.addEventListener('beforeunload', this.unloadHandler);
  }

  /**
   * 移除卸载处理
   */
  private unregisterUnloadHandler(): void {
    if (this.unloadHandler) {
      window.removeEventListener('beforeunload', this.unloadHandler);
      this.unloadHandler = null;
    }
  }

  /**
   * 重置状态
   */
  private resetState(): void {
    this.events = [];
    this.tags = [];
    this.sessionId = '';
    this.startTime = 0;
    this.status = 'idle';
    this.metadata = null;
    this.routeChanges = [];
    this.currentUrl = '';
    this.clickCount = 0;
    this.inputCount = 0;
    this.scrollCount = 0;
    this.chunkIndex = 0;
    this.lastChunkEventIndex = 0;
  }

  // ==================== 公开 API ====================

  /**
   * 获取当前状态
   */
  getStatus(): RecordingStatus {
    return this.status;
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 设置会话 ID（用于关联外部系统，如 logger）
   */
  setSessionId(id: string): void {
    if (this.status === 'idle') {
      this.sessionId = id;
    } else {
      this.log('Cannot set sessionId while recording');
    }
  }

  /**
   * 获取事件数量
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * 获取会话元数据
   */
  getMetadata(): SessionMetadata | null {
    return this.metadata;
  }

  /**
   * 获取当前行为摘要（实时）
   */
  getSummary(): RecordingSummary | null {
    if (this.status === 'idle') return null;
    return this.buildSummary();
  }

  /**
   * 获取路由变化历史
   */
  getRouteChanges(): RouteChange[] {
    return [...this.routeChanges];
  }

  /**
   * 添加标记
   *
   * 使用 rrweb 原生的 addCustomEvent API，确保自定义事件
   * 与录制事件流完全同步，回放时时间线定位准确。
   */
  addTag(name: string, data?: Record<string, any>): void {
    if (this.status !== 'recording') {
      return;
    }

    const tag: TagInfo = {
      name,
      data,
      timestamp: Date.now(),
    };

    this.tags.push(tag);

    // 使用 rrweb 原生 API 添加自定义事件
    try {
      record.addCustomEvent('sigillum-tag', tag);
    } catch (err) {
      // 回退：如果 rrweb 的 addCustomEvent 不可用，手动添加
      this.log('record.addCustomEvent not available, falling back to manual event');
      const customEvent: EventWithTime = {
        type: 5, // Custom event type
        data: {
          tag: 'sigillum-tag',
          payload: tag,
        },
        timestamp: Date.now(),
      };
      this.events.push(customEvent);
    }

    this.log('Added tag:', name);
  }

  /**
   * 手动触发全量快照
   */
  takeFullSnapshot(): void {
    if (this.status !== 'recording') {
      this.log('Cannot take snapshot: not recording');
      return;
    }

    try {
      record.takeFullSnapshot();
      this.log('Full snapshot taken');
    } catch (err) {
      this.log('Failed to take full snapshot:', err);
    }
  }

  /**
   * 销毁录制器
   */
  destroy(): void {
    if (this.stopRecordingFn) {
      this.stopRecordingFn();
      this.stopRecordingFn = null;
    }
    this.clearTimers();
    this.stopRouteTracking();
    this.unregisterUnloadHandler();
    this.resetState();
    this.cacheManager = null;
    this.disabled = true;
    this.log('Destroyed');
  }
}

// ==================== 单例模式 ====================

let instance: SessionRecorder | null = null;

/**
 * 获取录制器实例（单例）
 */
export function getRecorder(options?: SessionRecorderOptions): SessionRecorder {
  if (!instance && options) {
    instance = new SessionRecorder(options);
  }
  if (!instance) {
    throw new Error('[SessionRecorder] Not initialized. Call getRecorder(options) first.');
  }
  return instance;
}

/**
 * 重置录制器实例
 */
export function resetRecorder(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

/**
 * 检查是否已初始化
 */
export function isRecorderInitialized(): boolean {
  return instance !== null;
}
