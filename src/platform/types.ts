/**
 * 平台适配器接口定义
 *
 * 所有小程序平台必须实现此接口。
 * 浏览器端不使用此接口（继续走 rrweb 通道）。
 */

import type { TrackEvent } from '../core/types';

export interface PageInfo {
  path: string;
  query?: Record<string, string>;
}

export type Unsubscribe = () => void;

/**
 * 事件拦截器
 * 由适配器创建，用于自动或手动拦截用户交互事件。
 */
export interface EventInterceptor {
  /** 开始拦截 */
  start(): void;
  /** 停止拦截 */
  stop(): void;
}

/** 小程序事件拦截器，支持声明式 track 调用 */
export interface MiniAppEventInterceptor extends EventInterceptor {
  track(type: string, e: import('./miniapp/types').MiniAppEventObject): void;
}

/**
 * 平台适配器基础存储接口
 * 替代浏览器端的 localStorage / IndexedDB
 */
export interface PlatformStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * 小程序平台适配器
 *
 * 最低版本要求：
 * - 微信小程序基础库 >= 1.4.0 (SelectorQuery), 推荐 >= 2.1.0 (fields computedStyle, onAppHide)
 * - Taro >= 3.0.0 (@tarojs/runtime TaroElement.dispatchEvent)
 * - 支付宝小程序基础库 >= 2.0.0（后续支持）
 * - 抖音小程序基础库 >= 2.0.0（后续支持）
 */
export interface MiniAppPlatformAdapter {
  readonly platform: 'wechat' | 'alipay' | 'tiktok' | 'baidu' | 'qq' | 'taro';

  /** 页面进入时回调 */
  onPageShow(callback: (page: PageInfo) => void): Unsubscribe;

  /** 页面离开时回调 */
  onPageHide(callback: (page: PageInfo) => void): Unsubscribe;

  /** 创建事件拦截器 */
  createEventInterceptor(handler: (event: TrackEvent) => void): EventInterceptor;

  /** 获取当前页面信息 */
  getCurrentPage(): PageInfo;

  /** 路由变化监听 */
  onRouteChange(callback: (from: PageInfo, to: PageInfo) => void): Unsubscribe;

  /** 平台存储 */
  storage: PlatformStorage;

  /** 应用退到后台 */
  onAppHide(callback: () => void): Unsubscribe;

  /** 应用进入前台 */
  onAppShow(callback: () => void): Unsubscribe;

  /** 获取系统信息 */
  getSystemInfo(): Record<string, unknown>;

  /** 获取视口尺寸 */
  getViewportSize(): { width: number; height: number };
}
