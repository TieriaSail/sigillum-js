import { describe, it, expect } from 'vitest';
import {
  buildActionChain,
  renderActionChainHTML,
  getActionChainCSS,
} from '../../src/replay/ActionChain';
import type { MiniAppRawRecordingData, TrackEvent } from '../../src/core/types';

function makeData(events: TrackEvent[]): MiniAppRawRecordingData {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const start = sorted[0]?.timestamp ?? 0;
  const end = sorted[sorted.length - 1]?.timestamp ?? 0;
  return {
    sessionId: 'test-session-001',
    events,
    startTime: start,
    endTime: end,
    duration: end - start,
    metadata: { platform: 'wechat', sdkVersion: '2.0.0-beta.1' },
  };
}

describe('buildActionChain', () => {
  it('应将 session_start/end 转化为行为节点', () => {
    const chain = buildActionChain(makeData([
      { type: 'session_start', timestamp: 1000, data: { platform: 'wechat', sdkVersion: '2.0.0' } },
      { type: 'session_end', timestamp: 5000, data: { reason: 'manual' } },
    ]));

    expect(chain.actions).toHaveLength(2);
    expect(chain.actions[0].icon).toBe('🟢');
    expect(chain.actions[0].description).toContain('会话开始');
    expect(chain.actions[0].description).toContain('wechat');
    expect(chain.actions[1].icon).toBe('🔴');
    expect(chain.actions[1].description).toContain('会话结束');
    expect(chain.actions[1].description).toContain('manual');
  });

  it('应将 page_enter 转化为页面进入或跳转', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index/index' } },
      { type: 'page_enter', timestamp: 3000, data: { page: 'pages/detail/detail', from: 'pages/index/index' } },
    ]));

    expect(chain.actions[0].description).toContain('进入页面');
    expect(chain.actions[0].icon).toBe('📄');
    expect(chain.actions[1].description).toContain('跳转');
    expect(chain.actions[1].description).toContain('→');
    expect(chain.actions[1].icon).toBe('🔀');
    expect(chain.stats.pageCount).toBe(2);
  });

  it('应将 tap 转化为点击行为，包含 target 信息', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      {
        type: 'tap', timestamp: 2000,
        data: { x: 100, y: 200, target: { tagName: 'button', id: 'buy', text: '立即购买' }, page: 'pages/index' },
      },
    ]));

    const tap = chain.actions[1];
    expect(tap.icon).toBe('👆');
    expect(tap.description).toContain('点击');
    expect(tap.description).toContain('<button');
    expect(tap.description).toContain('#buy');
    expect(tap.description).toContain('"立即购买"');
    expect(tap.target?.tag).toBe('button');
    expect(tap.target?.id).toBe('buy');
    expect(chain.stats.tapCount).toBe(1);
  });

  it('应将 input_focus → input → input_blur 序列合并', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/search' } },
      { type: 'input_focus', timestamp: 2000, data: { target: { tagName: 'input', id: 'q' }, page: 'pages/search' } },
      { type: 'input', timestamp: 2100, data: { value: '安', target: { tagName: 'input', id: 'q' }, page: 'pages/search' } },
      { type: 'input', timestamp: 2200, data: { value: '安卓', target: { tagName: 'input', id: 'q' }, page: 'pages/search' } },
      { type: 'input', timestamp: 2300, data: { value: '安卓手机', target: { tagName: 'input', id: 'q' }, page: 'pages/search' } },
      { type: 'input_blur', timestamp: 3000, data: { target: { tagName: 'input', id: 'q' }, page: 'pages/search' } },
    ]));

    const inputActions = chain.actions.filter(a => a.type === 'input_change');
    expect(inputActions).toHaveLength(1);
    expect(inputActions[0].description).toContain('安卓手机');

    const focusActions = chain.actions.filter(a => a.type === 'input_focus');
    expect(focusActions).toHaveLength(1);
    expect(focusActions[0].description).toContain('聚焦');

    const blurActions = chain.actions.filter(a => a.type === 'input_blur');
    expect(blurActions).toHaveLength(1);
  });

  it('应将连续 scroll 事件合并为一条', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/list' } },
      { type: 'scroll', timestamp: 2000, data: { scrollTop: 100, direction: 'down', page: 'pages/list' } },
      { type: 'scroll', timestamp: 2100, data: { scrollTop: 200, direction: 'down', page: 'pages/list' } },
      { type: 'scroll', timestamp: 2200, data: { scrollTop: 350, direction: 'down', page: 'pages/list' } },
    ]));

    const scrollActions = chain.actions.filter(a => a.type === 'scroll');
    expect(scrollActions).toHaveLength(1);
    expect(scrollActions[0].description).toContain('350');
    expect(chain.stats.scrollCount).toBe(1);
  });

  it('应将 network_request 转化为请求行为', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      {
        type: 'network_request', timestamp: 2000,
        data: { url: 'https://api.example.com/order', method: 'POST', statusCode: 200, duration: 320 },
      },
    ]));

    const req = chain.actions.find(a => a.type === 'network_request')!;
    expect(req.icon).toBe('📡');
    expect(req.description).toContain('POST');
    expect(req.description).toContain('api.example.com/order');
    expect(req.description).toContain('200');
    expect(req.description).toContain('320ms');
    expect(chain.stats.networkCount).toBe(1);
  });

  it('应按页面分组', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      { type: 'tap', timestamp: 2000, data: { x: 0, y: 0, target: { tagName: 'button', text: 'Go' }, page: 'pages/index' } },
      { type: 'page_enter', timestamp: 3000, data: { page: 'pages/detail', from: 'pages/index' } },
      { type: 'tap', timestamp: 4000, data: { x: 0, y: 0, target: { tagName: 'text', text: 'Back' }, page: 'pages/detail' } },
    ]));

    expect(chain.pageGroups).toHaveLength(2);
    expect(chain.pageGroups[0].page).toBe('pages/index');
    expect(chain.pageGroups[0].actions.length).toBeGreaterThanOrEqual(2);
    expect(chain.pageGroups[1].page).toBe('pages/detail');
  });

  it('应正确计算 relativeTime', () => {
    const chain = buildActionChain(makeData([
      { type: 'session_start', timestamp: 10000, data: { platform: 'taro', sdkVersion: '2.0.0' } },
      { type: 'page_enter', timestamp: 11000, data: { page: 'pages/index' } },
      { type: 'tap', timestamp: 13000, data: { x: 0, y: 0, target: {}, page: 'pages/index' } },
    ]));

    expect(chain.actions[0].relativeTime).toBe(0);
    expect(chain.actions[1].relativeTime).toBe(1000);
    expect(chain.actions[2].relativeTime).toBe(3000);
  });

  it('应处理 error 事件', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      { type: 'error', timestamp: 2000, data: { message: 'TypeError: Cannot read property x', page: 'pages/index' } },
    ]));

    const err = chain.actions.find(a => a.type === 'error')!;
    expect(err.icon).toBe('❌');
    expect(err.description).toContain('TypeError');
    expect(chain.stats.errorCount).toBe(1);
  });
});

describe('renderActionChainHTML', () => {
  it('应返回包含行为链的 HTML 字符串', () => {
    const chain = buildActionChain(makeData([
      { type: 'session_start', timestamp: 1000, data: { platform: 'wechat', sdkVersion: '2.0.0' } },
      { type: 'page_enter', timestamp: 1500, data: { page: 'pages/index' } },
      { type: 'tap', timestamp: 2000, data: { x: 0, y: 0, target: { tagName: 'button', text: '确定' }, page: 'pages/index' } },
    ]));

    const html = renderActionChainHTML(chain);
    expect(html).toContain('用户行为链');
    expect(html).toContain('会话开始');
    expect(html).toContain('进入页面');
    expect(html).toContain('点击');
    expect(html).toContain('&lt;button&gt;');
    expect(html).toContain('&quot;确定&quot;');
  });

  it('应包含统计信息', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      { type: 'tap', timestamp: 2000, data: { x: 0, y: 0, target: {}, page: 'pages/index' } },
      { type: 'tap', timestamp: 3000, data: { x: 0, y: 0, target: {}, page: 'pages/index' } },
    ]));

    const html = renderActionChainHTML(chain);
    expect(html).toContain('2 点击');
  });
});

describe('新增事件类型', () => {
  it('应处理 swipe 事件并包含速度和距离', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      { type: 'swipe', timestamp: 2000, data: { startX: 100, startY: 200, endX: 300, endY: 200, direction: 'right', page: 'pages/index', velocity: 0.6, distance: 200, duration: 333 } },
    ]));

    const swipe = chain.actions.find(a => a.type === 'swipe')!;
    expect(swipe.icon).toBe('👈');
    expect(swipe.description).toContain('滑动');
    expect(swipe.description).toContain('→');
    expect(swipe.description).toContain('200px');
    expect(swipe.description).toContain('0.6px/ms');
    expect(chain.stats.swipeCount).toBe(1);
  });

  it('应处理 touch_start/move/end 事件', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      { type: 'touch_start', timestamp: 2000, data: { x: 100, y: 200, target: {}, page: 'pages/index', touchCount: 1 } },
      { type: 'touch_move', timestamp: 2050, data: { x: 110, y: 210, target: {}, page: 'pages/index' } },
      { type: 'touch_move', timestamp: 2100, data: { x: 120, y: 220, target: {}, page: 'pages/index' } },
      { type: 'touch_move', timestamp: 2150, data: { x: 130, y: 230, target: {}, page: 'pages/index' } },
      { type: 'touch_end', timestamp: 2200, data: { x: 130, y: 230, target: {}, page: 'pages/index' } },
    ]));

    expect(chain.actions.find(a => a.type === 'touch_start')).toBeDefined();
    expect(chain.actions.find(a => a.type === 'touch_end')).toBeDefined();
    const moves = chain.actions.filter(a => a.type === 'touch_move');
    expect(moves).toHaveLength(1);
    expect(moves[0].description).toContain('3 个采样点');
    expect(chain.stats.touchCount).toBe(1);
  });

  it('应处理 scroll_depth 事件', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      { type: 'scroll_depth', timestamp: 5000, data: { page: 'pages/index', maxScrollTop: 800, maxDepthPercent: 75, scrollHeight: 1200, viewportHeight: 600 } },
      { type: 'page_leave', timestamp: 6000, data: { page: 'pages/index' } },
    ]));

    const depth = chain.actions.find(a => a.type === 'scroll_depth')!;
    expect(depth.icon).toBe('📊');
    expect(depth.description).toContain('75%');
    expect(chain.stats.maxScrollDepth).toBe(75);
    expect(chain.pageGroups[0].scrollDepth).toBe(75);
  });

  it('应处理 drag_start/move/end 事件', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      { type: 'drag_start', timestamp: 2000, data: { x: 100, y: 200, target: { tagName: 'slider', id: 'vol' }, page: 'pages/index' } },
      { type: 'drag_move', timestamp: 2100, data: { x: 150, y: 200, target: { tagName: 'slider', id: 'vol' }, page: 'pages/index' } },
      { type: 'drag_end', timestamp: 2200, data: { x: 200, y: 200, target: { tagName: 'slider', id: 'vol' }, page: 'pages/index' } },
    ]));

    expect(chain.actions.find(a => a.type === 'drag_start')).toBeDefined();
    expect(chain.actions.find(a => a.type === 'drag_end')).toBeDefined();
    expect(chain.stats.dragCount).toBe(1);
  });

  it('tap 描述应包含坐标', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      { type: 'tap', timestamp: 2000, data: { x: 120, y: 340, target: { tagName: 'button', text: 'OK' }, page: 'pages/index' } },
    ]));

    const tap = chain.actions.find(a => a.type === 'tap')!;
    expect(tap.description).toContain('(120, 340)');
  });

  it('scroll 描述应包含方向箭头和深度百分比', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
      { type: 'scroll', timestamp: 2000, data: { scrollTop: 400, scrollLeft: 0, direction: 'up', page: 'pages/index', scrollHeight: 1000, viewportHeight: 500 } },
    ]));

    const scroll = chain.actions.find(a => a.type === 'scroll')!;
    expect(scroll.description).toContain('↑');
    expect(scroll.description).toContain('90%');
  });
});

describe('自定义规则', () => {
  it('自定义规则可以覆盖内置行为', () => {
    const chain = buildActionChain(
      makeData([
        { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
        { type: 'tap', timestamp: 2000, data: { x: 0, y: 0, target: { tagName: 'button', id: 'add-to-cart' }, page: 'pages/index' } },
      ]),
      {
        rules: [{
          name: 'cart_add',
          eventTypes: ['tap'],
          match: (e) => (e.data as any).target?.id === 'add-to-cart',
          transform: () => ({
            description: '加入购物车',
            detail: { productId: '123' },
          }),
        }],
      },
    );

    const cartAction = chain.actions.find(a => a.description === '加入购物车');
    expect(cartAction).toBeDefined();
    expect(cartAction!.detail?.productId).toBe('123');
  });

  it('不匹配的规则不会触发', () => {
    const chain = buildActionChain(
      makeData([
        { type: 'page_enter', timestamp: 1000, data: { page: 'pages/index' } },
        { type: 'tap', timestamp: 2000, data: { x: 0, y: 0, target: { tagName: 'button', id: 'other' }, page: 'pages/index' } },
      ]),
      {
        rules: [{
          name: 'cart_add',
          eventTypes: ['tap'],
          match: (e) => (e.data as any).target?.id === 'add-to-cart',
          transform: () => ({ description: '加入购物车' }),
        }],
      },
    );

    expect(chain.actions.find(a => a.description === '加入购物车')).toBeUndefined();
    expect(chain.actions.find(a => a.type === 'tap')).toBeDefined();
  });
});

describe('增强统计', () => {
  it('应计算 avgPageDuration', () => {
    const chain = buildActionChain(makeData([
      { type: 'page_enter', timestamp: 1000, data: { page: 'pages/a' } },
      { type: 'page_leave', timestamp: 3000, data: { page: 'pages/a' } },
      { type: 'page_enter', timestamp: 3000, data: { page: 'pages/b', from: 'pages/a' } },
      { type: 'page_leave', timestamp: 7000, data: { page: 'pages/b' } },
    ]));

    expect(chain.stats.avgPageDuration).toBe(3000);
  });
});

describe('getActionChainCSS', () => {
  it('应返回包含 hover 和 active 样式的 CSS', () => {
    const css = getActionChainCSS();
    expect(css).toContain('data-action-idx');
    expect(css).toContain('hover');
    expect(css).toContain('active');
  });
});
