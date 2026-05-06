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
  UploadResult,
  UserIdentity,
  SigillumRecording,
} from './types';
import { SIGILLUM_SCHEMA_VERSION, SDK_VERSION } from './types';
import { CacheManager } from './CacheManager';
import { checkCompatibility, isBrowser } from './compatibility';

/**
 * 默认配置
 */
const DEFAULT_OPTIONS: Partial<SessionRecorderOptions> = {
  enabled: true,
  maxDuration: 30 * 60 * 1000, // 30 分钟
  maxEvents: 50000,
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
  private cacheManager: CacheManager | null = null;

  private stopRecordingFn: (() => void) | null = null;
  private events: EventWithTime[] = [];
  private tags: TagInfo[] = [];
  private sessionId: string = '';
  private startTime: number = 0;
  private endTime: number = 0;
  private pausedAt: number = 0;
  private status: RecordingStatus = 'idle';

  private cacheTimer: number | null = null;
  private maxDurationTimer: number | null = null;
  private unloadHandler: ((e: PageTransitionEvent) => void) | null = null;
  private visibilityHandler: (() => void) | null = null;

  /** 是否因不兼容而禁用 */
  private disabled: boolean = false;

  // ========== 元数据 ==========
  private metadata: SessionMetadata | null = null;
  private pendingIdentity: UserIdentity | null = null;

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
  private uploadingChunk: boolean = false;
  private chunkIndex: number = 0;
  private lastChunkEventIndex: number = 0;
  private lastCachedEventIndex: number = 0;
  private cacheChunkWriteIndex: number = 0;
  private cacheStopped: boolean = false;

  /** 统一上传回调（从 onUpload / onChunkUpload 解析而来） */
  private uploadFn: ((chunk: RecordingChunk) => Promise<UploadResult>) | null = null;

  constructor(options: SessionRecorderOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // 解析统一上传回调
    if (options.onUpload) {
      this.uploadFn = options.onUpload;
      if (options.onChunkUpload) {
        console.warn(
          '[sigillum-js] Both onUpload and onChunkUpload are provided. ' +
          'onChunkUpload is deprecated — onUpload will be used. ' +
          'Please remove onChunkUpload.'
        );
      }
    } else if (options.onChunkUpload) {
      console.warn(
        '[sigillum-js] onChunkUpload is deprecated. ' +
        'Please migrate to the unified onUpload callback, which uses the same signature. ' +
        'onChunkUpload will be removed in the next major version.'
      );
      this.uploadFn = options.onChunkUpload;
    }

    // 检查浏览器环境
    if (!isBrowser()) {
      this.disabled = true;
      return;
    }

    // 检查兼容性
    const compatibility = checkCompatibility();
    if (!compatibility.supported) {
      this.disabled = true;
      try {
        this.options.onUnsupported?.(compatibility.reason || 'Browser not supported');
      } catch {
        // 静默处理
      }
      this.log('Browser not supported:', compatibility.reason);
      return;
    }

    // 初始化缓存管理器
    if (this.options.cache?.enabled !== false) {
      this.cacheManager = new CacheManager(this.options.cache?.maxItems, this.options.cache?.maxAge);
      this.recoverCachedRecordings().catch(() => {});
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
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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
      duration: (() => {
        const now = this.endTime > 0 ? this.endTime : Date.now();
        const pauseOffset = this.pausedAt > 0 ? (now - this.pausedAt) : 0;
        return now - this.startTime - pauseOffset;
      })(),
      visitedUrls: Array.from(visitedUrls),
    };
  }

  // ==================== 分段上传 ====================

  /**
   * 启动分段上传定时器
   */
  private startChunkTimer(): void {
    const config = this.options.chunkedUpload;
    if (!config?.enabled || !this.uploadFn) return;

    const interval = config.interval ?? 60000;

    this.chunkTimer = setInterval(() => {
      this.uploadChunk(false).then(success => {
        if (!success && this.status === 'recording') {
          setTimeout(() => {
            if (this.status === 'recording') {
              this.uploadChunk(false).catch(err => this.log('Chunk retry error:', err));
            }
          }, 5000);
        }
      }).catch((err) => this.log('Chunk timer error:', err));
    }, interval) as unknown as number;

    this.log('Chunked upload enabled, interval:', interval);
  }

  /**
   * 上传一个分段（含重试 + 失败回滚）
   */
  private async uploadChunk(isFinal: boolean): Promise<boolean> {
    if (!this.uploadFn) return false;
    if (this.uploadingChunk) {
      this.log('Upload already in progress, skipping');
      return false;
    }
    this.uploadingChunk = true;

    try {
      return await this._doUploadChunk(isFinal);
    } finally {
      this.uploadingChunk = false;
    }
  }

  private async _doUploadChunk(isFinal: boolean): Promise<boolean> {
    const snapshotEventCount = this.events.length;
    const newEvents = this.events.slice(this.lastChunkEventIndex);
    if (newEvents.length === 0 && !isFinal) return true;

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

    let processedChunk = chunk;
    if (this.options.beforeUpload) {
      try {
        processedChunk = this.options.beforeUpload(chunk);
      } catch (error) {
        this.log('Error in beforeUpload:', error);
        this.emitError(error);
        return false;
      }
    }

    const maxRetries = this.options.maxRetries ?? 3;
    let retries = 0;

    while (retries <= maxRetries) {
      try {
        const result = await this.uploadFn!(processedChunk);
        if (result.success) {
          this.lastChunkEventIndex = snapshotEventCount;
          this.chunkIndex++;
          this.log(`Chunk ${chunk.chunkIndex} uploaded (${newEvents.length} events, final: ${isFinal})`);
          return true;
        }
        if (!result.shouldRetry) {
          this.log(`Chunk ${chunk.chunkIndex} upload failed (no retry):`, result.error);
          return false;
        }
      } catch (error) {
        this.log(`Chunk ${chunk.chunkIndex} upload error (attempt ${retries + 1}):`, error);
        if (retries >= maxRetries) {
          this.emitError(error);
          return false;
        }
      }
      retries++;
      await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, retries - 1), 10000)));
    }

    return false;
  }

  // ==================== rrweb 配置构建 ====================

  /**
   * 构建 rrweb record() 的完整配置
   */
  private buildRrwebOptions(): Record<string, any> {
    const rrwebConfig = this.options.rrwebConfig || {};
    const privacy = rrwebConfig.privacy || {};

    if (privacy.blockSelector) {
      console.warn(
        '[sigillum-js] privacy.blockSelector has a known bug in rrweb 2.0.0-alpha.4: ' +
        'when a Text node triggers a characterData mutation, rrweb calls node.matches(selector) ' +
        'on it, but Text nodes have no matches() method, causing a silent crash that breaks all ' +
        'subsequent recording. This has been patched in sigillum-js, but if you installed rrweb ' +
        'separately, consider using blockClass instead. ' +
        'See: https://github.com/rrweb-io/rrweb/issues/1486'
      );
    }

    const options: Record<string, any> = {
      emit: (event: EventWithTime) => {
        try {
          this.events.push(event);
          this.analyzeEvent(event);

          // 事件数量上限保护
          const maxEvents = this.options.maxEvents ?? 50000;
          if (this.events.length >= maxEvents) {
            this.log(`Max events (${maxEvents}) reached, stopping recording`);
            this.stop().catch((err) => this.log('Error stopping after maxEvents:', err));
            return;
          }

          this.options.onEventEmit?.(event, this.events.length);
        } catch (err) {
          this.log('Error in emit callback:', err);
        }
      },

      // 快照配置
      checkoutEveryNms: rrwebConfig.checkoutEveryNms ?? 5 * 60 * 1000,
      checkoutEveryNth: rrwebConfig.checkoutEveryNth,

      // Canvas
      recordCanvas: rrwebConfig.recordCanvas || false,

      // 采样策略
      sampling: {
        mousemove: rrwebConfig.recordMouseMove !== false
          ? rrwebConfig.mouseMoveInterval ?? 50
          : false,
        scroll: rrwebConfig.recordScroll !== false
          ? rrwebConfig.scrollInterval ?? 150
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

    // 如果是暂停状态，不重新初始化；否则清空上一次的数据
    if (this.status !== 'paused') {
      this.resetState();
      this.sessionId = this.generateSessionId();
      this.startTime = Date.now();

      // 采集元数据
      this.metadata = this.collectMetadata();
      if (this.pendingIdentity) {
        this.metadata.user = this.pendingIdentity;
        this.pendingIdentity = null;
      }
    } else if (this.pausedAt > 0) {
      // 抵消暂停时长，确保 maxDuration 和 duration 不包含暂停时间
      this.startTime += (Date.now() - this.pausedAt);
      this.pausedAt = 0;
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

      // 设置最大录制时长（resume 时扣除已录制的时间）
      if (this.options.maxDuration) {
        const elapsed = this.startTime > 0 ? Date.now() - this.startTime : 0;
        const remaining = Math.max(0, this.options.maxDuration - elapsed);
        if (remaining <= 0) {
          this.log('Max duration already exceeded, stopping');
          this.stop().catch((err) => this.log('Error stopping after maxDuration:', err));
        } else {
          this.maxDurationTimer = setTimeout(() => {
            if (this.status === 'recording') {
              this.log('Max duration reached, stopping');
              this.stop().catch((err) => this.log('Error stopping after maxDuration:', err));
            }
          }, remaining) as unknown as number;
        }
      }

      // 注册页面卸载处理（先清理旧的，防止 pause/resume 泄漏监听器）
      if (this.options.uploadOnUnload !== false) {
        this.unregisterUnloadHandler();
        this.registerUnloadHandler();
      }
    } catch (error) {
      this.log('Failed to start recording:', error);
      this.emitError(error);
      this.setStatus('idle');
    }
  }

  /**
   * 停止录制
   * 停止后数据保留在内存中，可通过 exportRecording() 导出
   * 下次 start() 或手动 clearRecording() 时清空
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

    // 清理定时器，标记缓存停止（防止 in-flight saveChunk 产生幽灵缓存）
    this.clearTimers();
    this.cacheStopped = true;

    // 停止路由追踪
    this.stopRouteTracking();

    // 移除卸载处理
    this.unregisterUnloadHandler();

    // 如果从 paused 状态 stop，补偿暂停时长
    if (this.pausedAt > 0) {
      this.startTime += (Date.now() - this.pausedAt);
      this.pausedAt = 0;
    }

    this.endTime = Date.now();
    this.setStatus('stopped');

    try {
      let uploadSuccess = false;
      if (this.uploadFn && this.events.length > 0) {
        uploadSuccess = await this.uploadChunk(true);
        this.log(uploadSuccess ? 'Stopped recording, upload complete' : 'Stopped recording, final upload failed — cache preserved');
      } else {
        this.log('Stopped recording, data retained for export');
        uploadSuccess = true;
      }

      if (this.cacheManager && uploadSuccess) {
        await this.cacheManager.deleteSession(this.sessionId);
      }
    } catch (error) {
      this.log('Error during stop upload phase:', error);
      this.emitError(error);
    }
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
    this.pausedAt = Date.now();
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
   * 启动缓存定时器
   */
  private startCacheTimer(): void {
    if (!this.cacheManager || this.options.cache?.enabled === false) {
      return;
    }

    const interval = this.options.cache?.saveInterval ?? 5000;

    this.cacheTimer = setInterval(() => {
      this.saveToCache();
    }, interval) as unknown as number;
  }

  /**
   * 增量保存到缓存（只写入自上次缓存以来的新事件）
   * 每次调用写入一个新的 cache chunk 条目，而非覆盖一个不断膨胀的大条目
   */
  private saveToCache(): void {
    if (!this.cacheManager || this.events.length === 0 || this.cacheStopped) {
      return;
    }

    const startIndex = this.lastCachedEventIndex;
    const newEvents = this.events.slice(startIndex);
    if (newEvents.length === 0) return;

    const cacheChunkIndex = this.cacheChunkWriteIndex++;

    // 同步推进，防止下次 saveToCache 重复 slice 相同事件
    this.lastCachedEventIndex = this.events.length;

    this.cacheManager.saveChunk({
      sessionId: this.sessionId,
      cacheChunkIndex,
      events: newEvents,
      tags: this.tags,
      startTime: this.startTime,
      url: window.location.href,
      userAgent: navigator.userAgent,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      updatedAt: Date.now(),
      lastChunkEventIndex: this.lastChunkEventIndex,
      chunkIndex: this.chunkIndex,
      metadata: this.metadata || undefined,
    }).then(() => {
      if (this.cacheStopped) return;
      this.log('Saved to cache (incremental)');
    }).catch(() => {
      if (this.cacheStopped) return;
      this.lastCachedEventIndex = Math.min(this.lastCachedEventIndex, startIndex);
      this.log('Failed to save cache chunk, will retry next interval');
    });
  }

  /**
   * 恢复缓存的录制
   * 合并所有缓存 chunk → 按 timestamp+type 去重 → 跳过已上传部分 → 分段上传
   */
  private async recoverCachedRecordings(): Promise<void> {
    if (!this.cacheManager) return;

    const sessions = await this.cacheManager.getAllSessions();
    if (sessions.length === 0) return;

    if (!this.uploadFn) {
      this.log(`Found ${sessions.length} cached sessions, no onUpload configured, skipping recovery`);
      return;
    }

    this.log(`Found ${sessions.length} cached sessions, recovering...`);

    for (const session of sessions) {
      const sessionId = session.sessionId;
      try {
        const chunks = await this.cacheManager.getSessionChunks(sessionId);
        if (chunks.length === 0) {
          await this.cacheManager.deleteSession(sessionId);
          continue;
        }

        chunks.sort((a, b) => a.cacheChunkIndex - b.cacheChunkIndex);

        const allEvents: EventWithTime[] = [];
        const seen = new Set<string>();
        const allTags: TagInfo[] = [];
        const sessionStartTime = chunks[0].startTime;
        let latestUpdatedAt = 0;
        const firstChunk = chunks[0];

        for (const cached of chunks) {
          for (const event of cached.events) {
            const key = `${event.timestamp}-${event.type}`;
            if (!seen.has(key)) {
              seen.add(key);
              allEvents.push(event);
            }
          }
          if (cached.tags) {
            for (const tag of cached.tags) {
              const tagKey = `${tag.timestamp}-${tag.name}`;
              if (!seen.has(tagKey)) {
                seen.add(tagKey);
                allTags.push(tag);
              }
            }
          }
          if (cached.updatedAt > latestUpdatedAt) latestUpdatedAt = cached.updatedAt;
        }
        allEvents.sort((a, b) => a.timestamp - b.timestamp);

        const maxLastChunkIdx = Math.max(...chunks.map(c => c.lastChunkEventIndex ?? 0));
        const pendingEvents = maxLastChunkIdx > 0 ? allEvents.slice(maxLastChunkIdx) : allEvents;

        if (pendingEvents.length === 0) {
          await this.cacheManager.deleteSession(sessionId);
          this.log('Recovered session (all events already uploaded):', sessionId);
          continue;
        }

        // 恢复 chunk 需要自包含可独立回放：如果 pending 事件中缺少 FullSnapshot，
        // 从全量缓存事件中找回原始 FullSnapshot + Meta 并 prepend 到头部
        let recoveryEvents = pendingEvents;
        if (maxLastChunkIdx > 0 && !pendingEvents.some(e => e.type === 2)) {
          const fullSnapshot = allEvents.find(e => e.type === 2);
          const metaEvent = allEvents.find(e => e.type === 4);
          if (fullSnapshot) {
            const baseTs = pendingEvents[0].timestamp;
            const prefix: EventWithTime[] = [];
            if (metaEvent) {
              prefix.push({ ...metaEvent, timestamp: baseTs - 2 });
            }
            prefix.push({ ...fullSnapshot, timestamp: baseTs - 1 });
            recoveryEvents = [...prefix, ...pendingEvents];
          }
        }

        const maxChunkIndex = Math.max(...chunks.map(c => c.chunkIndex ?? 0));
        let recoveryChunkIndex = maxChunkIndex;

        const RECOVERY_CHUNK_SIZE = 5000;
        let allSuccess = true;

        for (let i = 0; i < recoveryEvents.length; i += RECOVERY_CHUNK_SIZE) {
          const slice = recoveryEvents.slice(i, i + RECOVERY_CHUNK_SIZE);
          const isFinal = i + RECOVERY_CHUNK_SIZE >= recoveryEvents.length;

          const chunk: RecordingChunk = {
            sessionId,
            chunkIndex: recoveryChunkIndex,
            isFinal,
            events: slice,
            startTime: slice[0]?.timestamp ?? sessionStartTime,
            endTime: slice[slice.length - 1]?.timestamp ?? latestUpdatedAt,
            tags: isFinal ? allTags : [],
            summary: {
              totalEvents: slice.length,
              clickCount: 0, inputCount: 0, scrollCount: 0,
              routeChangeCount: 0, routeChanges: [],
              tagCount: allTags.length,
              duration: latestUpdatedAt - sessionStartTime,
              visitedUrls: firstChunk.url ? [firstChunk.url] : [],
            },
            metadata: recoveryChunkIndex === 0 ? firstChunk.metadata : undefined,
            isRecovery: true,
          };

          let processedChunk: RecordingChunk = chunk;
          if (this.options.beforeUpload) {
            try {
              processedChunk = this.options.beforeUpload(chunk);
            } catch (e) {
              this.log('beforeUpload threw during recovery, using original chunk:', e);
            }
          }

          const maxRetries = this.options.maxRetries ?? 3;
          let success = false;
          let retries = 0;

          while (retries <= maxRetries) {
            try {
              const result = await this.uploadFn!(processedChunk);
              if (result.success) {
                success = true;
                break;
              }
              if (!result.shouldRetry) break;
            } catch (error) {
              this.log(`Recovery chunk upload error (attempt ${retries + 1}):`, error);
              if (retries >= maxRetries) break;
            }
            retries++;
            await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, retries - 1), 10000)));
          }

          if (success) {
            recoveryChunkIndex++;
          } else {
            allSuccess = false;
            this.log('Failed to recover session, will retry next time:', sessionId);
            break;
          }
        }

        if (allSuccess) {
          await this.cacheManager.deleteSession(sessionId);
          this.log('Fully recovered session:', sessionId,
            `(${pendingEvents.length} events, skipped ${maxLastChunkIdx} already-uploaded)`);
        }
      } catch (error) {
        this.log('Failed to recover cached session:', error);
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
   * 使用 pagehide 替代 beforeunload：移动端 WebView 更可靠，且不阻止 bfcache
   */
  private registerUnloadHandler(): void {
    this.unloadHandler = () => {
      if (this.status !== 'recording' || this.events.length === 0) return;

      // 优先使用 sendBeacon 投递未上传数据
      if (this.options.beaconUrl && typeof navigator.sendBeacon === 'function') {
        try {
          const payload = JSON.stringify({
            sessionId: this.sessionId,
            events: this.events.slice(this.lastChunkEventIndex),
            metadata: this.metadata || undefined,
            summary: this.buildSummary(),
            timestamp: Date.now(),
          });
          const sent = navigator.sendBeacon(
            this.options.beaconUrl,
            new Blob([payload], { type: 'application/json' }),
          );
          if (sent) {
            this.log('Page hide, sent via sendBeacon');
            return;
          }
        } catch {
          // sendBeacon 失败，降级到缓存
        }
      }

      this.saveToCache();
      this.log('Page hide, saved to cache');
    };

    window.addEventListener('pagehide', this.unloadHandler);

    if (this.options.saveOnVisibilityHidden === true) {
      this.visibilityHandler = () => {
        if (document.visibilityState === 'hidden' && this.status === 'recording' && this.events.length > 0) {
          this.saveToCache();
          this.log('Visibility hidden, saved to cache');
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /**
   * 移除卸载处理
   */
  private unregisterUnloadHandler(): void {
    if (this.unloadHandler) {
      window.removeEventListener('pagehide', this.unloadHandler);
      this.unloadHandler = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
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
    this.endTime = 0;
    this.pausedAt = 0;
    this.status = 'idle';
    this.metadata = null;
    // pendingIdentity is intentionally NOT cleared here — it survives reset so
    // identify() called before start() is applied when metadata is collected
    this.routeChanges = [];
    this.currentUrl = '';
    this.clickCount = 0;
    this.inputCount = 0;
    this.scrollCount = 0;
    this.chunkIndex = 0;
    this.lastChunkEventIndex = 0;
    this.lastCachedEventIndex = 0;
    this.cacheChunkWriteIndex = 0;
    this.cacheStopped = false;
    this.uploadingChunk = false;
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
   * 关联用户身份，可在录制的任何阶段调用
   * 身份信息会写入 metadata 并作为 rrweb 自定义事件记录到时间线
   */
  identify(userId: string, traits?: Record<string, any>): void {
    if (!this.isEnabled()) return;

    const identity: UserIdentity = {
      userId,
      traits,
      identifiedAt: Date.now(),
    };

    if (this.metadata) {
      this.metadata.user = identity;
    } else {
      this.pendingIdentity = identity;
    }

    if (this.status === 'recording') {
      try {
        record.addCustomEvent('sigillum-identify', { userId, traits });
      } catch {
        this.events.push({
          type: 5,
          data: { tag: 'sigillum-identify', payload: { userId, traits } },
          timestamp: Date.now(),
        } as any);
      }
    }

    this.log('User identified:', userId);
  }

  /**
   * 获取事件数量
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * 估算当前录制数据在内存中的大小（bytes）
   * 基于 JSON 序列化估算，适合用于 UI 展示或触发自定义容量告警
   */
  getEstimatedSize(): number {
    if (this.events.length === 0) return 0;
    try {
      const sample = this.events.slice(-10);
      const avgEventSize = new Blob([JSON.stringify(sample)]).size / sample.length;
      return Math.round(avgEventSize * this.events.length);
    } catch {
      return 0;
    }
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
   * 导出录制数据
   * 仅在 stopped 状态下可用，返回完整的录制数据副本
   * 数据包含事件流、元数据、行为摘要等，可直接用于 rrweb-player 回放
   */
  exportRecording(): SigillumRecording<RawRecordingData> | null {
    if (this.status !== 'stopped') {
      this.log('exportRecording() requires stopped state, current:', this.status);
      return null;
    }

    if (this.events.length === 0) {
      this.log('No events to export');
      return null;
    }

    const recording: RawRecordingData = {
      sessionId: this.sessionId,
      events: [...this.events],
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.endTime - this.startTime,
      tags: [...this.tags],
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

    return {
      sigillum: true,
      schemaVersion: SIGILLUM_SCHEMA_VERSION,
      source: 'web',
      sdkVersion: SDK_VERSION,
      exportedAt: Date.now(),
      recording,
    };
  }

  /**
   * 手动清空录制数据
   * 在 exportRecording() 之后调用，释放内存
   */
  clearRecording(): void {
    if (this.status === 'recording') {
      this.log('Cannot clear while recording');
      return;
    }
    this.resetState();
    this.log('Recording data cleared');
  }

  /**
   * 销毁录制器，立即释放全部资源（同步操作，不触发上传）
   * 与 stop() 不同，destroy() 不会尝试上传数据
   */
  destroy(): void {
    if (this.stopRecordingFn) {
      this.stopRecordingFn();
      this.stopRecordingFn = null;
    }
    this.clearTimers();
    this.stopRouteTracking();
    this.unregisterUnloadHandler();
    this.setStatus('stopped');
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
 * 未初始化时返回 null 并输出警告，不会抛出异常
 */
export function getRecorder(options: SessionRecorderOptions): SessionRecorder;
export function getRecorder(): SessionRecorder | null;
export function getRecorder(options?: SessionRecorderOptions): SessionRecorder | null {
  if (!instance && options) {
    instance = new SessionRecorder(options);
  }
  if (!instance) {
    console.warn('[SessionRecorder] Not initialized. Call getRecorder(options) first.');
    return null;
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
