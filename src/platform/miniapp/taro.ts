/**
 * Taro 跨端框架适配器
 *
 * 最低要求：Taro >= 3.0.0（@tarojs/runtime 提供 TaroElement / document）
 *
 * 兼容矩阵：
 *   - Taro 3.0.x: TaroNode.uid 前缀 `_n_`，document 为模块顶层导出
 *   - Taro 3.3+:  TaroNode.uid 前缀 `_`，document 同上
 *   - Taro 3.6+:  新增 env 对象导出（env.document 在小程序环境为 EMPTY_OBJ）
 *   - Taro 4.x:   document 导出改名为 taroDocumentProvider，签名/结构不变
 *
 * dispatchEvent 签名在所有 3.x/4.x 版本中一致：dispatchEvent(event: TaroEvent)
 * TaroEvent.type 是事件名字符串，TaroEvent.mpEvent 持有原始小程序事件。
 *
 * 采集策略：monkey-patch TaroElement.prototype.dispatchEvent 实现自动全量采集。
 * 无需用户手动埋点。
 *
 * 注意：此文件不直接 import @tarojs/runtime，而是在运行时动态获取，
 * 以避免在非 Taro 环境下 import 报错。
 */

import type {
  MiniAppPlatformAdapter,
  PageInfo,
  EventInterceptor,
  PlatformStorage,
  Unsubscribe,
} from '../types';
import type { TrackEvent, MonitoringConfig } from '../../core/types';
import { resolveMonitoringConfig, type ResolvedMonitoringConfig } from '../../core/presets';
import { ThrottleManager, ScrollDepthTracker, computeScrollDirection, detectSwipe } from './shared';

declare const wx: any;
declare const my: any;
declare const tt: any;

/** Taro 运行时类型（不直接依赖） */
interface TaroElementLike {
  nodeName: string;
  uid?: string;
  dataset?: Record<string, string>;
  textContent?: string;
  props?: Record<string, any>;
  dispatchEvent?: (event: any) => any;
}

declare function getCurrentPages(): any[];

/** 获取 Taro 运行时（延迟加载） */
function getTaroRuntime(): any | null {
  try {
    return require('@tarojs/runtime');
  } catch {
    return null;
  }
}

/** 获取 Taro 全局 */
function getTaro(): any | null {
  try {
    return require('@tarojs/taro');
  } catch {
    return null;
  }
}

/** 获取底层小程序 API 对象 */
function getNativeApi(): any {
  if (typeof wx !== 'undefined') return wx;
  if (typeof my !== 'undefined') return my;
  if (typeof tt !== 'undefined') return tt;
  return null;
}

/**
 * 用户交互事件名称集合（Taro 标准化后的事件名）
 */
const USER_INTERACTION_EVENTS = new Set([
  'tap', 'longpress', 'longtap',
  'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'input', 'focus', 'blur', 'confirm',
  'scroll',
  'change', 'submit',
]);

function isUserInteraction(eventName: string): boolean {
  return USER_INTERACTION_EVENTS.has(eventName);
}

export class TaroAdapter implements MiniAppPlatformAdapter {
  readonly platform = 'taro' as const;

  private pageShowCallbacks: Array<(page: PageInfo) => void> = [];
  private pageHideCallbacks: Array<(page: PageInfo) => void> = [];
  private routeChangeCallbacks: Array<(from: PageInfo, to: PageInfo) => void> = [];
  private appHideCallbacks: Array<() => void> = [];

  private lastPagePath = '';
  private taroInstance: any = null;
  private nativeApi: any = null;
  /** @internal DI for testing — do not use in production */
  private _runtimeOverride: any = null;

  private monitoringConfig: ResolvedMonitoringConfig;

  private lastScrollTop = 0;
  private lastScrollLeft = 0;
  private scrollDepthTracker = new ScrollDepthTracker();

  private touchStartState: { x: number; y: number; timestamp: number; target: any; element: TaroElementLike | null } | null = null;

  private throttle = new ThrottleManager();

  private routerListenerAttached = false;
  private routerListenerFn: (() => void) | null = null;

  constructor(deps?: { runtime?: any; taro?: any; nativeApi?: any; monitoring?: MonitoringConfig }) {
    this.taroInstance = deps?.taro ?? getTaro();
    this.nativeApi = deps?.nativeApi ?? getNativeApi();
    this._runtimeOverride = deps?.runtime ?? null;
    this.monitoringConfig = resolveMonitoringConfig(deps?.monitoring);
  }

  private getRuntime(): any | null {
    return this._runtimeOverride ?? getTaroRuntime();
  }

  readonly storage: PlatformStorage = {
    get: (key: string): string | null => {
      try {
        if (this.taroInstance?.getStorageSync) {
          return this.taroInstance.getStorageSync(key) ?? null;
        }
        return this.nativeApi?.getStorageSync?.(key) ?? null;
      } catch {
        return null;
      }
    },
    set: (key: string, value: string): void => {
      try {
        if (this.taroInstance?.setStorageSync) {
          this.taroInstance.setStorageSync(key, value);
        } else {
          this.nativeApi?.setStorageSync?.(key, value);
        }
      } catch {
        // silent
      }
    },
    remove: (key: string): void => {
      try {
        if (this.taroInstance?.removeStorageSync) {
          this.taroInstance.removeStorageSync(key);
        } else {
          this.nativeApi?.removeStorageSync?.(key);
        }
      } catch {
        // silent
      }
    },
  };

  getCurrentPage(): PageInfo {
    try {
      const Taro = this.taroInstance;
      if (Taro?.getCurrentInstance) {
        const inst = Taro.getCurrentInstance();
        const router = inst?.router;
        if (router) {
          return { path: router.path || '', query: router.params };
        }
      }
      // fallback to native getCurrentPages
      const pages = getCurrentPages?.();
      if (pages?.length > 0) {
        const page = pages[pages.length - 1] as any;
        return { path: page.route || page.__route__ || '', query: page.options };
      }
    } catch {
      // silent
    }
    return { path: '' };
  }

  /**
   * Lazily attach a single __taroRouterChange listener that dispatches to all
   * pageShow / pageHide / routeChange callbacks. This ensures those APIs work
   * regardless of which one the consumer subscribes to first.
   */
  private ensureRouterListener(): void {
    if (this.routerListenerAttached) return;
    const Taro = this.taroInstance;
    if (!Taro?.eventCenter) return;

    this.routerListenerAttached = true;
    this.routerListenerFn = () => {
      try {
        const page = this.getCurrentPage();
        if (this.lastPagePath && this.lastPagePath !== page.path) {
          const from: PageInfo = { path: this.lastPagePath };
          this.pageHideCallbacks.forEach(cb => cb(from));
          this.routeChangeCallbacks.forEach(cb => cb(from, page));
          this.lastScrollTop = 0;
          this.lastScrollLeft = 0;
          this.touchStartState = null;
        }
        this.lastPagePath = page.path;
        this.pageShowCallbacks.forEach(cb => cb(page));
      } catch {
        // SDK errors must never break Taro's router event dispatch
      }
    };
    Taro.eventCenter.on('__taroRouterChange', this.routerListenerFn);
  }

  onPageShow(callback: (page: PageInfo) => void): Unsubscribe {
    this.ensureRouterListener();
    this.pageShowCallbacks.push(callback);
    return () => {
      this.pageShowCallbacks = this.pageShowCallbacks.filter(cb => cb !== callback);
    };
  }

  onPageHide(callback: (page: PageInfo) => void): Unsubscribe {
    this.ensureRouterListener();
    this.pageHideCallbacks.push(callback);
    return () => {
      this.pageHideCallbacks = this.pageHideCallbacks.filter(cb => cb !== callback);
    };
  }

  onRouteChange(callback: (from: PageInfo, to: PageInfo) => void): Unsubscribe {
    this.ensureRouterListener();
    this.routeChangeCallbacks.push(callback);
    return () => {
      this.routeChangeCallbacks = this.routeChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  onAppHide(callback: () => void): Unsubscribe {
    this.appHideCallbacks.push(callback);
    const handler = () => callback();
    this.nativeApi?.onAppHide?.(handler);
    return () => {
      this.appHideCallbacks = this.appHideCallbacks.filter(cb => cb !== callback);
      this.nativeApi?.offAppHide?.(handler);
    };
  }

  onAppShow(callback: () => void): Unsubscribe {
    const handler = () => callback();
    this.nativeApi?.onAppShow?.(handler);
    return () => {
      this.nativeApi?.offAppShow?.(handler);
    };
  }

  getSystemInfo(): Record<string, unknown> {
    try {
      const api = this.nativeApi;
      if (api?.getDeviceInfo && api?.getWindowInfo && api?.getAppBaseInfo) {
        return {
          ...api.getDeviceInfo(),
          ...api.getWindowInfo(),
          ...api.getAppBaseInfo(),
        };
      }
      if (this.taroInstance?.getSystemInfoSync) {
        return this.taroInstance.getSystemInfoSync() || {};
      }
      return api?.getSystemInfoSync?.() || {};
    } catch {
      return {};
    }
  }

  getViewportSize(): { width: number; height: number } {
    try {
      const api = this.nativeApi;
      if (api?.getWindowInfo) {
        const info = api.getWindowInfo();
        return {
          width: info?.windowWidth || 375,
          height: info?.windowHeight || 667,
        };
      }
      const info = this.getSystemInfo();
      return {
        width: (info.windowWidth as number) || 375,
        height: (info.windowHeight as number) || 667,
      };
    } catch {
      return { width: 375, height: 667 };
    }
  }

  /**
   * monkey-patch TaroElement.prototype.dispatchEvent 以自动捕获所有用户交互。
   */
  createEventInterceptor(handler: (event: TrackEvent) => void): EventInterceptor {
    let active = false;
    let originalDispatch: any = null;
    let runtime: any = null;
    const self = this;

    const filteredHandler = (event: TrackEvent) => {
      try {
        if (self.monitoringConfig.eventFilter && !self.monitoringConfig.eventFilter(event)) return;
        handler(event);
      } catch {
        // SDK errors must never break the host app's event handling
      }
    };

    return {
      start() {
        active = true;
        runtime = self.getRuntime();
        if (!runtime?.TaroElement) return;

        const proto = runtime.TaroElement.prototype;
        if (proto.__sigillum_patched) return;

        originalDispatch = proto.dispatchEvent;
        proto.dispatchEvent = function (event: any) {
          if (active) {
            try {
              const eventType = event?.type;
              if (eventType && isUserInteraction(eventType)) {
                self.processAutoEvent(filteredHandler, eventType, event?.mpEvent || event, this as TaroElementLike);
              }
            } catch {
              // Analytics errors must never block native event dispatch
            }
          }
          return originalDispatch.call(this, event);
        };
        proto.__sigillum_patched = true;
      },

      stop() {
        active = false;
        if (runtime?.TaroElement?.prototype && originalDispatch) {
          runtime.TaroElement.prototype.dispatchEvent = originalDispatch;
          delete runtime.TaroElement.prototype.__sigillum_patched;
          originalDispatch = null;
        }
      },
    };
  }

  emitScrollDepth(handler: (event: TrackEvent) => void, page: string): void {
    this.scrollDepthTracker.emit(handler, page, this.monitoringConfig);
  }

  private extractDetail(eventObj: any): Record<string, any> {
    return eventObj?.detail
      || eventObj?.mpEvent?.detail
      || eventObj
      || {};
  }

  private extractTouchPoint(eventObj: any): { x: number; y: number } {
    const touches = eventObj?.touches || eventObj?.changedTouches;
    if (touches?.length > 0) {
      return { x: touches[0].clientX ?? touches[0].pageX ?? 0, y: touches[0].clientY ?? touches[0].pageY ?? 0 };
    }
    const detail = this.extractDetail(eventObj);
    return { x: detail.x ?? detail.clientX ?? 0, y: detail.y ?? detail.clientY ?? 0 };
  }

  private processAutoEvent(
    handler: (event: TrackEvent) => void,
    eventName: string,
    eventObj: any,
    element: TaroElementLike,
  ): void {
    const cfg = this.monitoringConfig.capture;
    const page = this.getCurrentPage().path;
    const timestamp = Date.now();
    const target = {
      id: element.uid || undefined,
      tagName: element.nodeName || undefined,
      dataset: element.dataset || undefined,
      text: element.textContent?.slice(0, 50) || undefined,
    };

    switch (eventName) {
      case 'tap':
      case 'longpress':
      case 'longtap': {
        const type = eventName === 'longtap' ? 'longpress' : eventName;
        if (type === 'tap' && !cfg.tap) return;
        if (type === 'longpress' && !cfg.longpress) return;
        const detail = this.extractDetail(eventObj);
        handler({
          type: type as 'tap' | 'longpress',
          timestamp,
          data: {
            x: detail.x ?? detail.clientX ?? 0,
            y: detail.y ?? detail.clientY ?? 0,
            target,
            page,
          },
        });
        break;
      }
      case 'input':
      case 'confirm': {
        if (!cfg.input) return;
        const detail = this.extractDetail(eventObj);
        handler({
          type: 'input',
          timestamp,
          data: { value: detail.value ?? '', target, page },
        });
        break;
      }
      case 'focus': {
        if (!cfg.input) return;
        handler({ type: 'input_focus', timestamp, data: { target, page } });
        break;
      }
      case 'blur': {
        if (!cfg.input) return;
        handler({ type: 'input_blur', timestamp, data: { target, page } });
        break;
      }
      case 'scroll': {
        if (!cfg.scroll) return;
        if (this.throttle.isThrottled('scroll', this.monitoringConfig.throttle.scroll)) return;
        const detail = this.extractDetail(eventObj);
        const scrollTop = detail.scrollTop ?? 0;
        const scrollLeft = detail.scrollLeft ?? 0;

        const direction = computeScrollDirection(scrollTop, scrollLeft, this.lastScrollTop, this.lastScrollLeft);
        this.lastScrollTop = scrollTop;
        this.lastScrollLeft = scrollLeft;

        const scrollHeight = detail.scrollHeight ?? undefined;
        const viewportHeight = this.getViewportSize().height;

        if (this.monitoringConfig.scrollDepth && scrollHeight) {
          this.scrollDepthTracker.update(page, scrollTop, scrollHeight, viewportHeight);
        }

        handler({
          type: 'scroll',
          timestamp,
          data: {
            scrollTop,
            scrollLeft,
            direction,
            page,
            ...(scrollHeight != null ? { scrollHeight } : {}),
            ...(viewportHeight ? { viewportHeight } : {}),
          },
        });
        break;
      }
      case 'touchstart': {
        const point = this.extractTouchPoint(eventObj);
        this.touchStartState = { x: point.x, y: point.y, timestamp, target: eventObj, element };

        if (cfg.touch) {
          const touches = eventObj?.touches;
          handler({
            type: 'touch_start',
            timestamp,
            data: {
              x: point.x,
              y: point.y,
              target,
              page,
              touchCount: touches?.length ?? 1,
            },
          });
        }
        break;
      }
      case 'touchmove': {
        if (cfg.touch) {
          const throttleMs = this.monitoringConfig.throttle.touchMove;
          if (throttleMs <= 0 || !this.throttle.isThrottled('touchMove', throttleMs)) {
            const point = this.extractTouchPoint(eventObj);
            const touches = eventObj?.touches;
            handler({
              type: 'touch_move',
              timestamp,
              data: {
                x: point.x,
                y: point.y,
                target,
                page,
                touchCount: touches?.length ?? 1,
              },
            });
          }
        }
        break;
      }
      case 'touchend': {
        const endPoint = this.extractTouchPoint(eventObj);

        if (cfg.touch) {
          handler({
            type: 'touch_end',
            timestamp,
            data: {
              x: endPoint.x,
              y: endPoint.y,
              target,
              page,
              touchCount: 0,
            },
          });
        }

        if (cfg.swipe && this.touchStartState) {
          const start = this.touchStartState;
          const swipe = detectSwipe(start.x, start.y, start.timestamp, endPoint.x, endPoint.y, timestamp);
          if (swipe) {
            handler({
              type: 'swipe',
              timestamp,
              data: {
                startX: start.x,
                startY: start.y,
                endX: endPoint.x,
                endY: endPoint.y,
                direction: swipe.direction,
                page,
                velocity: swipe.velocity,
                distance: swipe.distance,
                duration: swipe.duration,
              },
            });
          }
        }

        this.touchStartState = null;
        break;
      }
      case 'touchcancel': {
        if (cfg.touch) {
          handler({
            type: 'touch_end',
            timestamp,
            data: { x: 0, y: 0, target, page, touchCount: 0 },
          });
        }
        this.touchStartState = null;
        break;
      }
      case 'change':
      case 'submit': {
        if (!cfg.custom) return;
        const detail = this.extractDetail(eventObj);
        handler({
          type: 'custom',
          timestamp,
          data: { name: eventName, payload: detail, target, page },
        });
        break;
      }
    }
  }

  destroy(): void {
    if (this.routerListenerFn && this.taroInstance?.eventCenter) {
      this.taroInstance.eventCenter.off('__taroRouterChange', this.routerListenerFn);
      this.routerListenerFn = null;
      this.routerListenerAttached = false;
    }
    this.pageShowCallbacks = [];
    this.pageHideCallbacks = [];
    this.routeChangeCallbacks = [];
    this.appHideCallbacks = [];
  }

}
