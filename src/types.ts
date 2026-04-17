/**
 * 会话录制系统类型定义
 * sigillum-js
 */

import type React from 'react';

// ==================== rrweb 相关类型 ====================

/** rrweb 事件类型 */
export interface EventWithTime {
  type: number;
  data: any;
  timestamp: number;
  delay?: number;
}

/** rrweb 录制插件类型（透传给 rrweb） */
export interface RrwebRecordPlugin<TOptions = unknown> {
  name: string;
  observer?: (cb: (...args: Array<unknown>) => void, win: any, options: TOptions) => (() => void);
  eventProcessor?: <TExtend>(event: EventWithTime) => EventWithTime & TExtend;
  options: TOptions;
}

// ==================== 字段映射 ====================

/** 简单映射：[原始字段, 后端字段] */
export type SimpleFieldMapping = [string, string];

/** 带转换函数的映射：[原始字段, 后端字段, toServer, fromServer] */
export type TransformFieldMapping = [
  string,
  string,
  (value: any) => any,
  (value: any) => any,
];

/** 字段映射类型 */
export type FieldMapping = SimpleFieldMapping | TransformFieldMapping;

// ==================== 录制数据结构 ====================

/** 标记信息 */
export interface TagInfo {
  name: string;
  data?: Record<string, any>;
  timestamp: number;
}

/** 路由变化记录 */
export interface RouteChange {
  /** 来源 URL */
  from: string;
  /** 目标 URL */
  to: string;
  /** 变化时间戳 */
  timestamp: number;
}

/** 用户身份信息 */
export interface UserIdentity {
  /** 用户 ID */
  userId: string;
  /** 附加用户属性 */
  traits?: Record<string, any>;
  /** 标识时间 */
  identifiedAt: number;
}

/** 会话元数据（自动采集的环境信息） */
export interface SessionMetadata {
  /** 页面标题 */
  title: string;
  /** 来源页面 */
  referrer: string;
  /** 浏览器语言 */
  language: string;
  /** 用户时区 */
  timezone: string;
  /** 网络连接类型（4g/3g/wifi 等，不支持时为 unknown） */
  connectionType: string;
  /** 网络有效类型（slow-2g/2g/3g/4g，不支持时为 unknown） */
  connectionEffectiveType: string;
  /** 设备内存（GB，不支持时为 0） */
  deviceMemory: number;
  /** CPU 核心数 */
  hardwareConcurrency: number;
  /** 是否触屏设备 */
  touchSupport: boolean;
  /** 设备像素比 */
  devicePixelRatio: number;
  /** 用户身份（通过 identify() 设置） */
  user?: UserIdentity;
}

/**
 * 录制行为摘要
 * 不看回放就能快速了解用户行为
 */
export interface RecordingSummary {
  /** 总事件数 */
  totalEvents: number;
  /** 鼠标点击次数 */
  clickCount: number;
  /** 输入次数 */
  inputCount: number;
  /** 滚动次数 */
  scrollCount: number;
  /** 路由跳转次数 */
  routeChangeCount: number;
  /** 路由变化历史 */
  routeChanges: RouteChange[];
  /** 标记数 */
  tagCount: number;
  /** 页面停留时长（毫秒） */
  duration: number;
  /** 访问的 URL 列表（去重） */
  visitedUrls: string[];
}

/** 原始录制数据（内部使用） */
export interface RawRecordingData {
  /** 会话 ID */
  sessionId: string;
  /** 录制事件列表 */
  events: EventWithTime[];
  /** 开始时间戳 */
  startTime: number;
  /** 结束时间戳 */
  endTime: number;
  /** 录制时长（毫秒） */
  duration: number;
  /** 标记列表 */
  tags: TagInfo[];
  /** 页面 URL */
  url: string;
  /** 用户代理 */
  userAgent: string;
  /** 屏幕分辨率 */
  screenResolution: string;
  /** 视口大小 */
  viewport: {
    width: number;
    height: number;
  };
  /** 会话元数据（自动采集） */
  metadata?: SessionMetadata;
  /** 行为摘要 */
  summary?: RecordingSummary;
}

// ==================== 上传结果 ====================

/** 上传结果 */
export interface UploadResult {
  success: boolean;
  /** 失败时是否应重试（分段上传使用） */
  shouldRetry?: boolean;
  error?: string;
}

// ==================== 录制器配置 ====================

/** 缓存配置 */
export interface CacheConfig {
  /** 是否启用 @default true */
  enabled?: boolean;
  /** 暂存间隔（毫秒）@default 5000 */
  saveInterval?: number;
  /** 最大缓存条数 @default 10 */
  maxItems?: number;
  /** 缓存最大保留时间（毫秒），超过后自动清理 @default 604800000 (7天) */
  maxAge?: number;
}

/**
 * rrweb 隐私配置
 *
 * 提供多层次的隐私保护：
 * - blockClass/blockSelector: 完全屏蔽元素（不录制 DOM 变化）
 * - maskTextClass/maskTextSelector: 遮盖文本内容
 * - maskAllInputs/maskInputOptions: 遮盖输入内容
 * - maskInputFn/maskTextFn: 自定义遮盖逻辑
 */
export interface PrivacyConfig {
  // ========== 元素屏蔽（最强，完全不录制） ==========

  /** 带此 class 的元素完全不录制（DOM 变化也不记录）@default undefined */
  blockClass?: string | RegExp;
  /**
   * CSS 选择器级别的屏蔽（更灵活）
   *
   * @deprecated rrweb 2.0.0-alpha.4 存在 bug：当 DOM 中出现 characterData 类型的
   * mutation（如文本节点内容变化）时，isBlocked() 会在 Text 节点上调用 node.matches()，
   * 导致 TypeError 崩溃并静默中断后续所有录制。sigillum-js 已通过 patch-package 修复此问题，
   * 但如果你单独安装了 rrweb，blockSelector 仍会触发此 bug。
   * 推荐使用 blockClass 替代。
   * @see https://github.com/rrweb-io/rrweb/issues/1486
   * @default undefined
   */
  blockSelector?: string;

  // ========== 文本遮盖 ==========

  /** 带此 class 的文本内容被遮盖为 * @default undefined */
  maskTextClass?: string | RegExp;
  /** 需要遮盖文本的 CSS 选择器 @default undefined */
  maskTextSelector?: string;
  /** 自定义文本遮盖函数 @default undefined */
  maskTextFn?: (text: string, element: HTMLElement | null) => string;

  // ========== 输入遮盖 ==========

  /** 是否屏蔽所有输入 @default false */
  maskAllInputs?: boolean;
  /**
   * 按输入类型精确控制遮盖
   * 支持：color, date, datetime-local, email, month, number,
   * range, search, tel, text, time, url, week, textarea, select, password
   * @default { password: true }
   */
  maskInputOptions?: Partial<{
    color: boolean;
    date: boolean;
    'datetime-local': boolean;
    email: boolean;
    month: boolean;
    number: boolean;
    range: boolean;
    search: boolean;
    tel: boolean;
    text: boolean;
    time: boolean;
    url: boolean;
    week: boolean;
    textarea: boolean;
    select: boolean;
    password: boolean;
  }>;
  /** 自定义输入遮盖函数 @default undefined */
  maskInputFn?: (text: string, element: HTMLElement) => string;

  // ========== 忽略 ==========

  /** 需要忽略的 class（不录制该元素的交互，但录制 DOM）@default 'rr-ignore' */
  ignoreClass?: string;
}

/**
 * DOM 精简选项
 * 去掉对回放无用的 DOM 内容，减小录制体积
 */
export interface SlimDOMConfig {
  /** 移除 script 标签 @default true */
  script?: boolean;
  /** 移除 HTML 注释 @default true */
  comment?: boolean;
  /** 移除 favicon link @default true */
  headFavicon?: boolean;
  /** 移除 head 中的空白 @default true */
  headWhitespace?: boolean;
  /** 移除 meta description/keywords @default true */
  headMetaDescKeywords?: boolean;
  /** 移除 meta 社交标签（og:xxx）@default true */
  headMetaSocial?: boolean;
  /** 移除 meta robots @default true */
  headMetaRobots?: boolean;
  /** 移除 meta http-equiv @default true */
  headMetaHttpEquiv?: boolean;
  /** 移除 meta authorship @default true */
  headMetaAuthorship?: boolean;
  /** 移除 meta verification @default true */
  headMetaVerification?: boolean;
}

/** rrweb 录制配置 */
export interface RrwebConfig {
  // ========== 采样配置 ==========

  /** 是否记录鼠标移动 @default true */
  recordMouseMove?: boolean;
  /** 鼠标移动采样间隔（毫秒）@default 50 */
  mouseMoveInterval?: number;
  /** 是否记录滚动事件 @default true */
  recordScroll?: boolean;
  /** 滚动采样间隔（毫秒）@default 150 */
  scrollInterval?: number;
  /** 是否记录输入事件 @default true */
  recordInput?: boolean;
  /** 是否记录媒体交互 @default true */
  recordMedia?: boolean;
  /** 是否记录画布 @default false */
  recordCanvas?: boolean;
  /** 画布采样率 @default 0 */
  canvasFPS?: number;

  // ========== 快照配置 ==========

  /** 完整快照间隔（毫秒）@default 300000 (5分钟) */
  checkoutEveryNms?: number;
  /** 完整快照间隔（事件数）@default undefined */
  checkoutEveryNth?: number;

  // ========== 隐私保护 ==========

  /** 隐私保护配置 */
  privacy?: PrivacyConfig;

  // ========== DOM 精简（减小录制体积）==========

  /**
   * DOM 精简选项
   * - true 或 'all'：启用所有精简（推荐生产环境使用）
   * - 对象：精确控制每个选项
   * - undefined：不精简
   * @default undefined
   */
  slimDOMOptions?: SlimDOMConfig | 'all' | true;

  // ========== 资源内联 ==========

  /** 是否内联样式表（确保回放样式准确）@default true */
  inlineStylesheet?: boolean;
  /** 是否内联图片（确保回放图片显示）@default false */
  inlineImages?: boolean;
  /** 是否收集字体（确保回放字体准确）@default false */
  collectFonts?: boolean;

  // ========== iframe 支持 ==========

  /** 是否录制跨域 iframe @default false */
  recordCrossOriginIframes?: boolean;

  // ========== 数据压缩 ==========

  /**
   * 数据压缩函数
   * 在录制时对事件数据进行压缩，减小传输和存储体积
   *
   * @example
   * ```ts
   * import pako from 'pako';
   * { packFn: (event) => pako.deflate(JSON.stringify(event)) }
   * ```
   */
  packFn?: (event: EventWithTime) => unknown;

  // ========== rrweb 插件 ==========

  /**
   * rrweb 录制插件列表
   * 透传给 rrweb 的 plugins 选项，支持官方和自定义插件
   *
   * @example
   * ```ts
   * import { getRecordConsolePlugin } from 'rrweb';
   * { plugins: [getRecordConsolePlugin()] }
   * ```
   */
  plugins?: RrwebRecordPlugin[];

  // ========== 其他 ==========

  /** 标记输入是否由用户触发（精确回放）@default false */
  userTriggeredOnInput?: boolean;
  /** 需要忽略的 CSS 属性 @default undefined */
  ignoreCSSAttributes?: Set<string>;
}

/** 录制器配置 */
export interface SessionRecorderOptions {
  // ========== 上传 ==========
  /**
   * 统一上传回调
   *
   * 无论是定时分段上传、录制结束上传、还是崩溃恢复上传，都走这一个回调。
   * 每次调用传入一个 RecordingChunk，包含 chunkIndex、isFinal、events 等字段。
   * 不提供时为纯本地模式，录制数据仅保留在内存中，需通过 exportRecording() 手动导出。
   *
   * @example
   * ```ts
   * {
   *   onUpload: async (chunk) => {
   *     await fetch('/api/recording', {
   *       method: 'POST',
   *       body: JSON.stringify(chunk),
   *     });
   *     return { success: true };
   *   },
   *   chunkedUpload: { enabled: true, interval: 60000 },
   * }
   * ```
   */
  onUpload?: (chunk: RecordingChunk) => Promise<UploadResult>;

  // ========== 字段映射 ==========
  /** 字段映射配置 */
  fieldMapping?: FieldMapping[];
  /** 上传前额外处理（接收 RecordingChunk，返回处理后的对象） */
  beforeUpload?: (chunk: RecordingChunk) => RecordingChunk;

  // ========== 启用条件 ==========
  /** 是否启用（支持函数，可以做条件判断）@default true */
  enabled?: boolean | (() => boolean);

  // ========== 缓存配置（防崩溃）==========
  /** 缓存配置 */
  cache?: CacheConfig;

  // ========== 兼容性 ==========
  /** 不兼容时回调 */
  onUnsupported?: (reason: string) => void;

  // ========== rrweb 配置 ==========
  /** rrweb 录制配置 */
  rrwebConfig?: RrwebConfig;

  // ========== 事件回调 ==========

  /**
   * 每个录制事件触发时的回调
   * 可用于监控事件数量、实现分片上传等
   */
  onEventEmit?: (event: EventWithTime, eventCount: number) => void;

  /**
   * 录制过程中发生错误时的回调
   */
  onError?: (error: Error) => void;

  /**
   * 录制状态变化时的回调
   */
  onStatusChange?: (status: RecordingStatus, prevStatus: RecordingStatus) => void;

  // ========== 分段上传 ==========

  /**
   * 分段上传配置
   * 启用后，录制过程中会按间隔自动分段上传，避免一次性上传大量数据
   * 每个分段包含该时间段内的事件和当前摘要
   */
  chunkedUpload?: {
    /** 是否启用分段上传 @default false */
    enabled?: boolean;
    /** 分段间隔（毫秒）@default 60000 (1分钟) */
    interval?: number;
  };

  /**
   * @deprecated 请使用统一的 onUpload 代替。onChunkUpload 将在下一个大版本中移除。
   * 如果同时提供了 onUpload 和 onChunkUpload，onUpload 优先。
   */
  onChunkUpload?: (chunk: RecordingChunk) => Promise<UploadResult>;

  // ========== 其他 ==========
  /** 最大录制时长（毫秒）@default 1800000 (30分钟) */
  maxDuration?: number;
  /** 最大事件数量，超过后自动停止录制以防内存溢出 @default 50000 */
  maxEvents?: number;
  /** 上传失败重试次数 @default 3 */
  maxRetries?: number;
  /** 页面卸载时尝试上传 @default true */
  uploadOnUnload?: boolean;
  /**
   * 页面卸载时使用 navigator.sendBeacon 发送数据的 URL
   * 仅在 sendBeacon 可用时生效；提供此配置后，卸载时会优先用 sendBeacon
   * 将未上传的事件投递到该地址（JSON 格式），确保数据不会因为页面关闭而丢失
   */
  beaconUrl?: string;
  /** 调试模式 @default false */
  debug?: boolean;
}

// ==================== 分段上传 ====================

/** 录制分段（分段上传时使用） */
export interface RecordingChunk {
  /** 会话 ID */
  sessionId: string;
  /** 分段索引（从 0 开始） */
  chunkIndex: number;
  /** 是否为最后一个分段 */
  isFinal: boolean;
  /** 该分段包含的事件 */
  events: EventWithTime[];
  /** 分段开始时间 */
  startTime: number;
  /** 分段结束时间 */
  endTime: number;
  /** 当前累计的标记 */
  tags: TagInfo[];
  /** 当前的行为摘要（累计） */
  summary: RecordingSummary;
  /** 会话元数据（只在第一个分段包含） */
  metadata?: SessionMetadata;
  /** 是否为崩溃恢复上传（业务层可据此选择存储路径） */
  isRecovery?: boolean;
}

// ==================== 录制状态 ====================

/** 录制状态 */
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped';

/** SDK 版本常量（统一来源，构建时从 package.json 注入） */
export { SDK_VERSION } from './version';

// Re-export unified recording protocol from core
export type {
  SigillumRecording,
  SigillumRecordingSource,
  DetectResult,
} from './core/types';
export {
  SIGILLUM_SCHEMA_VERSION,
  isSigillumRecording,
  unwrapRecording,
  detectRecordingSource,
  detectRecordingSourceWithReason,
} from './core/types';

// ==================== 回放配置 ====================

/** 回放配置 */
export interface ReplayConfig {
  /** 播放速度 @default 1 */
  speed?: number;
  /** 是否自动播放 @default false */
  autoPlay?: boolean;
  /** 是否显示控制器 @default true */
  showController?: boolean;
  /** 跳过不活跃时间 @default true */
  skipInactive?: boolean;

  // ==================== rrweb Replayer 配置 ====================

  /**
   * 启用 Canvas 回放（给回放 iframe 添加 allow-scripts 权限）。
   * 录制时启用了 recordCanvas 则回放时需要开启此项。
   * @default false
   */
  UNSAFE_replayCanvas?: boolean;
  /** 暂停 CSS 动画 @default undefined */
  pauseAnimation?: boolean;
  /**
   * 鼠标轨迹配置。
   * - `true`: 显示默认轨迹
   * - `false`: 不显示
   * - 对象: 自定义轨迹样式
   */
  mouseTail?: boolean | {
    duration?: number;
    lineCap?: string;
    lineWidth?: number;
    strokeStyle?: string;
  };
  /** 使用虚拟 DOM 模式回放 @default false */
  useVirtualDom?: boolean;
  /** 实时模式（用于直播场景）@default false */
  liveMode?: boolean;
  /** 回放时触发 focus 事件 @default false */
  triggerFocus?: boolean;
  /** 注入自定义 CSS 规则到回放 iframe */
  insertStyleRules?: string[];
  /** 事件解压函数（与录制端 packFn 配对使用）*/
  unpackFn?: (event: unknown) => unknown;

  /**
   * 透传给 rrweb Replayer 的其他原生配置。
   * 上面未列出的 rrweb Replayer 选项可通过此字段传入。
   * 注意：events、width、height 不可通过此字段覆盖。
   */
  replayerConfig?: Record<string, unknown>;
}

/** 回放播放器属性 */
export interface ReplayPlayerProps {
  /** 后端返回的数据 */
  data: Record<string, any>;
  /** 字段映射（与录制时相同） */
  fieldMapping?: FieldMapping[];
  /** 回放配置 */
  config?: ReplayConfig;
  /** 播放器容器样式 */
  style?: React.CSSProperties;
  /** 播放器容器类名 */
  className?: string;
  /** 播放开始回调 */
  onPlay?: () => void;
  /** 播放暂停回调 */
  onPause?: () => void;
  /** 播放结束回调 */
  onFinish?: () => void;
}
