/**
 * 微信小程序平台适配器
 *
 * 最低要求：微信基础库 >= 1.4.0（推荐 >= 2.1.0）
 * - SelectorQuery.fields() 支持 rect, size, dataset, properties
 * - Component 生命周期 pageLifetimes
 * - App.onPageNotFound
 *
 * 采集策略：声明式埋点。用户在 Page 方法中调用 sigillum.track('tap', e) 采集事件。
 */

import type {
  MiniAppPlatformAdapter,
  PageInfo,
  MiniAppEventInterceptor,
  PlatformStorage,
  Unsubscribe,
} from '../types';
import type { TrackEvent, MonitoringConfig } from '../../core/types';
import type { MiniAppEventObject, MiniAppPageInstance } from './types';
import { extractEventTarget, extractTapPosition } from './types';
import { resolveMonitoringConfig, type ResolvedMonitoringConfig } from '../../core/presets';
import { ThrottleManager, ScrollDepthTracker, computeScrollDirection, detectSwipe } from './shared';

declare const wx: any;
declare function getCurrentPages(): any[];
declare let Page: any;

/** 获取当前页面栈的最后一个页面 */
function getCurrentWxPage(): MiniAppPageInstance | null {
  try {
    const pages = getCurrentPages();
    return pages.length > 0 ? pages[pages.length - 1] : null;
  } catch {
    return null;
  }
}

function getPagePath(page: MiniAppPageInstance | null): string {
  if (!page) return '';
  return page.route || page.__route__ || page.is || '';
}

export class WechatAdapter implements MiniAppPlatformAdapter {
  readonly platform = 'wechat' as const;

  private pageShowCallbacks: Array<(page: PageInfo) => void> = [];
  private pageHideCallbacks: Array<(page: PageInfo) => void> = [];
  private routeChangeCallbacks: Array<(from: PageInfo, to: PageInfo) => void> = [];
  private appHideCallbacks: Array<() => void> = [];
  private appShowCallbacks: Array<() => void> = [];

  private lastPagePath = '';
  private originalPageFn: any = null;
  private hooked = false;

  private monitoringConfig: ResolvedMonitoringConfig;
  private lastScrollTop = 0;
  private lastScrollLeft = 0;
  private scrollDepthTracker = new ScrollDepthTracker();
  private touchStartState: { x: number; y: number; timestamp: number } | null = null;
  private throttle = new ThrottleManager();

  constructor(deps?: { monitoring?: MonitoringConfig }) {
    this.monitoringConfig = resolveMonitoringConfig(deps?.monitoring);
  }


  readonly storage: PlatformStorage = {
    get(key: string): string | null {
      try {
        return wx.getStorageSync(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      try {
        wx.setStorageSync(key, value);
      } catch {
        // silent
      }
    },
    remove(key: string): void {
      try {
        wx.removeStorageSync(key);
      } catch {
        // silent
      }
    },
  };

  private hookPageLifecycles(): void {
    if (this.hooked) return;

    if (typeof Page !== 'function') return;

    this.hooked = true;

    const self = this;
    this.originalPageFn = Page;

    (globalThis as any).Page = function (config: any) {
      const origOnShow = config.onShow;
      const origOnHide = config.onHide;

      config.onShow = function (this: any, ...args: any[]) {
        try {
          const page = getCurrentWxPage();
          const path = getPagePath(page);
          const pageInfo: PageInfo = { path, query: page?.options };

          if (self.lastPagePath && self.lastPagePath !== path) {
            const from: PageInfo = { path: self.lastPagePath };
            self.routeChangeCallbacks.forEach(cb => cb(from, pageInfo));
          }
          self.lastPagePath = path;
          self.pageShowCallbacks.forEach(cb => cb(pageInfo));
        } catch {
          // SDK errors must never block the page's original onShow
        }

        return origOnShow?.apply(this, args);
      };

      config.onHide = function (this: any, ...args: any[]) {
        try {
          const page = getCurrentWxPage();
          const path = getPagePath(page);
          const pageInfo: PageInfo = { path, query: page?.options };
          self.pageHideCallbacks.forEach(cb => cb(pageInfo));
          self.lastScrollTop = 0;
          self.lastScrollLeft = 0;
          self.touchStartState = null;
        } catch {
          // SDK errors must never block the page's original onHide
        }

        return origOnHide?.apply(this, args);
      };

      return self.originalPageFn(config);
    };
  }

  onPageShow(callback: (page: PageInfo) => void): Unsubscribe {
    this.hookPageLifecycles();
    this.pageShowCallbacks.push(callback);
    return () => {
      this.pageShowCallbacks = this.pageShowCallbacks.filter(cb => cb !== callback);
    };
  }

  onPageHide(callback: (page: PageInfo) => void): Unsubscribe {
    this.hookPageLifecycles();
    this.pageHideCallbacks.push(callback);
    return () => {
      this.pageHideCallbacks = this.pageHideCallbacks.filter(cb => cb !== callback);
    };
  }

  onRouteChange(callback: (from: PageInfo, to: PageInfo) => void): Unsubscribe {
    this.hookPageLifecycles();
    this.routeChangeCallbacks.push(callback);
    return () => {
      this.routeChangeCallbacks = this.routeChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  onAppHide(callback: () => void): Unsubscribe {
    this.appHideCallbacks.push(callback);
    const handler = () => callback();
    wx.onAppHide?.(handler);
    return () => {
      this.appHideCallbacks = this.appHideCallbacks.filter(cb => cb !== callback);
      wx.offAppHide?.(handler);
    };
  }

  onAppShow(callback: () => void): Unsubscribe {
    this.appShowCallbacks.push(callback);
    const handler = () => callback();
    wx.onAppShow?.(handler);
    return () => {
      this.appShowCallbacks = this.appShowCallbacks.filter(cb => cb !== callback);
      wx.offAppShow?.(handler);
    };
  }

  getCurrentPage(): PageInfo {
    const page = getCurrentWxPage();
    return {
      path: getPagePath(page),
      query: page?.options,
    };
  }

  getSystemInfo(): Record<string, unknown> {
    try {
      if (wx.getDeviceInfo && wx.getWindowInfo && wx.getAppBaseInfo) {
        return {
          ...wx.getDeviceInfo(),
          ...wx.getWindowInfo(),
          ...wx.getAppBaseInfo(),
        };
      }
      return wx.getSystemInfoSync?.() || {};
    } catch {
      return {};
    }
  }

  getViewportSize(): { width: number; height: number } {
    try {
      if (wx.getWindowInfo) {
        const info = wx.getWindowInfo();
        return {
          width: info?.windowWidth || 375,
          height: info?.windowHeight || 667,
        };
      }
      const info = wx.getSystemInfoSync?.();
      return {
        width: info?.windowWidth || 375,
        height: info?.windowHeight || 667,
      };
    } catch {
      return { width: 375, height: 667 };
    }
  }

  emitScrollDepth(handler: (event: TrackEvent) => void, page: string): void {
    this.scrollDepthTracker.emit(handler, page, this.monitoringConfig);
  }

  createEventInterceptor(handler: (event: TrackEvent) => void): MiniAppEventInterceptor {
    let active = false;
    const self = this;

    const filteredHandler = (event: TrackEvent) => {
      try {
        if (self.monitoringConfig.eventFilter && !self.monitoringConfig.eventFilter(event)) return;
        handler(event);
      } catch {
        // SDK errors must never break the host app's event handling
      }
    };

    const interceptor: MiniAppEventInterceptor = {
      start() { active = true; },
      stop() { active = false; },
      track(type: string, e: MiniAppEventObject) {
        if (!active) return;

        const cfg = self.monitoringConfig.capture;
        const page = self.getCurrentPage().path;
        const target = extractEventTarget(e);
        const timestamp = Date.now();

        switch (type) {
          case 'tap':
          case 'longpress': {
            if (type === 'tap' && !cfg.tap) return;
            if (type === 'longpress' && !cfg.longpress) return;
            const pos = extractTapPosition(e);
            filteredHandler({
              type: type as 'tap' | 'longpress',
              timestamp,
              data: { x: pos.x, y: pos.y, target, page },
            });
            break;
          }
          case 'input': {
            if (!cfg.input) return;
            filteredHandler({
              type: 'input',
              timestamp,
              data: { value: e.detail?.value ?? '', target, page },
            });
            break;
          }
          case 'focus': {
            if (!cfg.input) return;
            filteredHandler({ type: 'input_focus', timestamp, data: { target, page } });
            break;
          }
          case 'blur': {
            if (!cfg.input) return;
            filteredHandler({ type: 'input_blur', timestamp, data: { target, page } });
            break;
          }
          case 'scroll': {
            if (!cfg.scroll) return;
            if (self.throttle.isThrottled('scroll', self.monitoringConfig.throttle.scroll)) return;
            const scrollTop = e.detail?.scrollTop ?? 0;
            const scrollLeft = e.detail?.scrollLeft ?? 0;

            const direction = computeScrollDirection(scrollTop, scrollLeft, self.lastScrollTop, self.lastScrollLeft);
            self.lastScrollTop = scrollTop;
            self.lastScrollLeft = scrollLeft;

            const scrollHeight: number | undefined = typeof e.detail?.scrollHeight === 'number' ? e.detail.scrollHeight : undefined;
            const viewportHeight = self.getViewportSize().height;

            if (self.monitoringConfig.scrollDepth && scrollHeight) {
              self.scrollDepthTracker.update(page, scrollTop, scrollHeight, viewportHeight);
            }

            filteredHandler({
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
            const pos = extractTapPosition(e);
            self.touchStartState = { x: pos.x, y: pos.y, timestamp };

            if (cfg.touch) {
              const touches = (e as any).touches;
              filteredHandler({
                type: 'touch_start',
                timestamp,
                data: { x: pos.x, y: pos.y, target, page, touchCount: touches?.length ?? 1 },
              });
            }
            break;
          }
          case 'touchmove': {
            if (cfg.touch) {
              const throttleMs = self.monitoringConfig.throttle.touchMove;
              if (throttleMs <= 0 || !self.throttle.isThrottled('touchMove', throttleMs)) {
                const pos = extractTapPosition(e);
                const touches = (e as any).touches;
                filteredHandler({
                  type: 'touch_move',
                  timestamp,
                  data: { x: pos.x, y: pos.y, target, page, touchCount: touches?.length ?? 1 },
                });
              }
            }
            break;
          }
          case 'touchend': {
            const endPos = extractTapPosition(e);

            if (cfg.touch) {
              filteredHandler({
                type: 'touch_end',
                timestamp,
                data: { x: endPos.x, y: endPos.y, target, page, touchCount: 0 },
              });
            }

            if (cfg.swipe && self.touchStartState) {
              const start = self.touchStartState;
              const swipe = detectSwipe(start.x, start.y, start.timestamp, endPos.x, endPos.y, timestamp);
              if (swipe) {
                filteredHandler({
                  type: 'swipe',
                  timestamp,
                  data: {
                    startX: start.x, startY: start.y,
                    endX: endPos.x, endY: endPos.y,
                    direction: swipe.direction, page,
                    velocity: swipe.velocity,
                    distance: swipe.distance,
                    duration: swipe.duration,
                  },
                });
              }
            }

            self.touchStartState = null;
            break;
          }
          case 'touchcancel': {
            if (cfg.touch) {
              filteredHandler({
                type: 'touch_end',
                timestamp,
                data: { x: 0, y: 0, target, page, touchCount: 0 },
              });
            }
            self.touchStartState = null;
            break;
          }
          default: {
            if (!cfg.custom) return;
            filteredHandler({
              type: 'custom',
              timestamp,
              data: { name: type, payload: e.detail || {} },
            });
          }
        }
      },
    };

    return interceptor;
  }

  destroy(): void {
    if (this.hooked && this.originalPageFn) {
      (globalThis as any).Page = this.originalPageFn;
      this.originalPageFn = null;
      this.hooked = false;
    }
    this.pageShowCallbacks = [];
    this.pageHideCallbacks = [];
    this.routeChangeCallbacks = [];
    this.appHideCallbacks = [];
    this.appShowCallbacks = [];
  }

}
