/**
 * 平台适配器共享工具
 *
 * Taro 和 WeChat 适配器中重复的通用逻辑提取到此处。
 */

import type { TrackEvent } from '../../core/types';
import type { ResolvedMonitoringConfig } from '../../core/presets';

export class ThrottleManager {
  private timers = new Map<string, number>();

  isThrottled(key: string, interval: number): boolean {
    if (interval <= 0) return false;
    const now = Date.now();
    const last = this.timers.get(key) ?? 0;
    if (now - last < interval) return true;
    this.timers.set(key, now);
    return false;
  }
}

export interface ScrollDepthEntry {
  maxScrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
}

export class ScrollDepthTracker {
  private depthMap = new Map<string, ScrollDepthEntry>();

  update(page: string, scrollTop: number, scrollHeight: number, viewportHeight: number): void {
    const existing = this.depthMap.get(page);
    if (!existing || scrollTop > existing.maxScrollTop) {
      this.depthMap.set(page, { maxScrollTop: scrollTop, scrollHeight, viewportHeight });
    }
  }

  emit(
    handler: (event: TrackEvent) => void,
    page: string,
    config: ResolvedMonitoringConfig,
  ): void {
    if (!config.scrollDepth) return;
    const depth = this.depthMap.get(page);
    if (!depth || depth.scrollHeight <= 0) return;

    const maxPercent = Math.min(
      100,
      Math.round(((depth.maxScrollTop + depth.viewportHeight) / depth.scrollHeight) * 100),
    );
    handler({
      type: 'scroll_depth',
      timestamp: Date.now(),
      data: {
        page,
        maxScrollTop: depth.maxScrollTop,
        maxDepthPercent: maxPercent,
        scrollHeight: depth.scrollHeight,
        viewportHeight: depth.viewportHeight,
      },
    });
    this.depthMap.delete(page);
  }
}

export function computeScrollDirection(
  scrollTop: number,
  scrollLeft: number,
  lastScrollTop: number,
  lastScrollLeft: number,
): 'up' | 'down' | 'left' | 'right' {
  const dY = scrollTop - lastScrollTop;
  const dX = scrollLeft - lastScrollLeft;
  if (Math.abs(dY) >= Math.abs(dX)) {
    return dY >= 0 ? 'down' : 'up';
  }
  return dX >= 0 ? 'right' : 'left';
}

const SWIPE_MIN_DISTANCE = 30;
const SWIPE_MIN_VELOCITY = 0.3;

export interface SwipeResult {
  direction: 'up' | 'down' | 'left' | 'right';
  distance: number;
  velocity: number;
  duration: number;
}

export function detectSwipe(
  startX: number, startY: number, startTimestamp: number,
  endX: number, endY: number, endTimestamp: number,
): SwipeResult | null {
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const duration = endTimestamp - startTimestamp;
  const velocity = duration > 0 ? distance / duration : 0;

  if (distance <= SWIPE_MIN_DISTANCE || velocity <= SWIPE_MIN_VELOCITY) return null;

  let direction: 'up' | 'down' | 'left' | 'right';
  if (Math.abs(dx) >= Math.abs(dy)) {
    direction = dx > 0 ? 'right' : 'left';
  } else {
    direction = dy > 0 ? 'down' : 'up';
  }

  return {
    direction,
    distance: Math.round(distance),
    velocity: Math.round(velocity * 1000) / 1000,
    duration,
  };
}
