import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ThrottleManager,
  ScrollDepthTracker,
  computeScrollDirection,
  detectSwipe,
} from '../../src/platform/miniapp/shared';
import type { ResolvedMonitoringConfig } from '../../src/core/presets';

function makeConfig(overrides?: Partial<ResolvedMonitoringConfig>): ResolvedMonitoringConfig {
  return {
    preset: 'full',
    capture: {
      session: true, pageLifecycle: true, tap: true, longpress: true,
      input: true, scroll: true, swipe: true, drag: true, touch: true,
      network: true, error: true, custom: true,
    },
    throttle: { scroll: 100, touchMove: 50, drag: 100 },
    scrollDepth: true,
    rules: [],
    ...overrides,
  };
}

describe('ThrottleManager', () => {
  it('interval <= 0 时不节流', () => {
    const mgr = new ThrottleManager();
    expect(mgr.isThrottled('key', 0)).toBe(false);
    expect(mgr.isThrottled('key', -1)).toBe(false);
  });

  it('第一次调用不被节流', () => {
    const mgr = new ThrottleManager();
    expect(mgr.isThrottled('scroll', 200)).toBe(false);
  });

  it('间隔内被节流', () => {
    const mgr = new ThrottleManager();
    mgr.isThrottled('scroll', 200);
    expect(mgr.isThrottled('scroll', 200)).toBe(true);
  });

  it('不同 key 互不影响', () => {
    const mgr = new ThrottleManager();
    mgr.isThrottled('scroll', 200);
    expect(mgr.isThrottled('touchMove', 200)).toBe(false);
  });

  it('超过间隔后不再节流', () => {
    const mgr = new ThrottleManager();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    mgr.isThrottled('scroll', 100);

    vi.spyOn(Date, 'now').mockReturnValue(now + 101);
    expect(mgr.isThrottled('scroll', 100)).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('ScrollDepthTracker', () => {
  it('update 只在 scrollTop 增大时更新', () => {
    const tracker = new ScrollDepthTracker();
    tracker.update('pages/index', 100, 2000, 667);
    tracker.update('pages/index', 50, 2000, 667);

    const handler = vi.fn();
    tracker.emit(handler, 'pages/index', makeConfig());
    expect(handler).toHaveBeenCalledTimes(1);
    const data = handler.mock.calls[0][0].data;
    expect(data.maxScrollTop).toBe(100);
  });

  it('emit 在 scrollDepth 关闭时不触发', () => {
    const tracker = new ScrollDepthTracker();
    tracker.update('pages/index', 100, 2000, 667);

    const handler = vi.fn();
    tracker.emit(handler, 'pages/index', makeConfig({ scrollDepth: false }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('emit 后清除该页面数据', () => {
    const tracker = new ScrollDepthTracker();
    tracker.update('pages/index', 100, 2000, 667);

    const handler = vi.fn();
    tracker.emit(handler, 'pages/index', makeConfig());
    expect(handler).toHaveBeenCalledTimes(1);

    tracker.emit(handler, 'pages/index', makeConfig());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('maxDepthPercent 计算正确', () => {
    const tracker = new ScrollDepthTracker();
    tracker.update('pages/index', 1333, 2000, 667);

    const handler = vi.fn();
    tracker.emit(handler, 'pages/index', makeConfig());
    expect(handler.mock.calls[0][0].data.maxDepthPercent).toBe(100);
  });
});

describe('computeScrollDirection', () => {
  it('向下滚动', () => {
    expect(computeScrollDirection(200, 0, 100, 0)).toBe('down');
  });

  it('向上滚动', () => {
    expect(computeScrollDirection(50, 0, 200, 0)).toBe('up');
  });

  it('向右滚动', () => {
    expect(computeScrollDirection(0, 200, 0, 100)).toBe('right');
  });

  it('向左滚动', () => {
    expect(computeScrollDirection(0, 50, 0, 200)).toBe('left');
  });

  it('垂直位移等于水平位移时优先垂直', () => {
    expect(computeScrollDirection(110, 110, 100, 100)).toBe('down');
  });
});

describe('detectSwipe', () => {
  it('距离和速度足够时识别为滑动', () => {
    const result = detectSwipe(0, 0, 0, 100, 0, 100);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('right');
    expect(result!.distance).toBe(100);
  });

  it('距离不足时返回 null', () => {
    const result = detectSwipe(0, 0, 0, 10, 0, 100);
    expect(result).toBeNull();
  });

  it('速度不足时返回 null', () => {
    const result = detectSwipe(0, 0, 0, 50, 0, 5000);
    expect(result).toBeNull();
  });

  it('向下滑动', () => {
    const result = detectSwipe(0, 0, 0, 0, 200, 100);
    expect(result!.direction).toBe('down');
  });

  it('向上滑动', () => {
    const result = detectSwipe(0, 200, 0, 0, 0, 100);
    expect(result!.direction).toBe('up');
  });

  it('向左滑动', () => {
    const result = detectSwipe(200, 0, 0, 0, 0, 100);
    expect(result!.direction).toBe('left');
  });
});
