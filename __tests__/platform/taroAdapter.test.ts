import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaroAdapter } from '../../src/platform/miniapp/taro';
import type { TrackEvent } from '../../src/core/types';

/**
 * TaroAdapter 兼容性测试
 *
 * 通过构造函数 DI 注入 mock runtime/taro/nativeApi，覆盖：
 *   - dispatchEvent monkey-patch (TaroEvent 对象)
 *   - 各 API 的降级回退
 */

const EMPTY_OBJ = Object.freeze({});

function createMockTaroDocument(options: {
  uidPrefix?: string;
  hasSid?: boolean;
  datasetEmpty?: boolean;
}) {
  const { uidPrefix = '_', hasSid = true, datasetEmpty = false } = options;
  let idCounter = 0;
  const nextId = () => `${uidPrefix}${++idCounter}`;

  function makeNode(
    nodeName: string,
    attrs: { className?: string; text?: string; src?: string; dataset?: Record<string, string> } = {},
    children: any[] = [],
  ): any {
    const uid = nextId();
    const textChildren = attrs.text
      ? [{ nodeType: 3, textContent: attrs.text, childNodes: [] }]
      : [];
    const node: any = {
      nodeType: 1, nodeName, uid,
      className: attrs.className || '',
      props: { class: attrs.className || '', src: attrs.src },
      dataset: attrs.dataset || (datasetEmpty ? EMPTY_OBJ : {}),
      childNodes: [...textChildren, ...children],
      textContent: attrs.text || '',
    };
    if (hasSid) node.sid = uid;
    return node;
  }

  const app = makeNode('view', { className: 'container' }, [
    makeNode('text', { className: 'title', text: 'Hello Taro' }),
    makeNode('button', { className: 'btn', text: 'Click me' }),
    makeNode('input', { className: 'field' }),
    makeNode('image', { className: 'logo', src: '/logo.png' }),
    makeNode('scroll-view', { className: 'list' }, [
      makeNode('view', { className: 'item', dataset: { id: '1' } }, [
        makeNode('text', { text: 'Item 1' }),
      ]),
    ]),
  ]);

  const container = { nodeType: 1, nodeName: 'container', uid: nextId(), childNodes: [app], props: {}, dataset: {} };
  const body = { nodeType: 1, nodeName: 'body', uid: nextId(), childNodes: [container], props: {}, dataset: {} };
  const html = { nodeType: 1, nodeName: 'html', uid: nextId(), childNodes: [body], lastChild: body, props: {}, dataset: {} };
  const doc: any = { nodeType: 9, nodeName: '#document', childNodes: [html], body, documentElement: html };
  return { doc };
}

function mockWx(overrides: Record<string, any> = {}) {
  return {
    getStorageSync: vi.fn().mockReturnValue(''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    getSystemInfoSync: vi.fn().mockReturnValue({ windowWidth: 375, windowHeight: 667 }),
    onAppHide: vi.fn(),
    offAppHide: vi.fn(),
    ...overrides,
  };
}

describe('TaroAdapter', () => {
  beforeEach(() => {
    (globalThis as any).wx = mockWx();
    (globalThis as any).getCurrentPages = vi.fn().mockReturnValue([
      { route: 'pages/index/index', options: {} },
    ]);
  });

  afterEach(() => {
    delete (globalThis as any).wx;
    delete (globalThis as any).getCurrentPages;
  });

  // ──────────── dispatchEvent monkey-patch ────────────

  describe('dispatchEvent monkey-patch (TaroEvent 对象)', () => {
    function createPatchedAdapter() {
      const origDispatch = vi.fn().mockReturnValue(true);
      const TaroElement: any = function () {};
      TaroElement.prototype = { dispatchEvent: origDispatch };
      const { doc } = createMockTaroDocument({ uidPrefix: '_', hasSid: true });
      const runtime = { TaroElement, document: doc };
      const taro = {
        getCurrentInstance: vi.fn().mockReturnValue({ router: { path: 'pages/test/index', params: {} } }),
        eventCenter: { on: vi.fn(), off: vi.fn() },
        getStorageSync: vi.fn(), setStorageSync: vi.fn(), removeStorageSync: vi.fn(),
      };
      return { adapter: new TaroAdapter({ runtime, taro }), origDispatch, runtime };
    }

    function el(overrides: Record<string, any> = {}) {
      return { nodeName: 'button', uid: '_1', dataset: {}, textContent: 'Click', ...overrides };
    }

    it('应拦截 TaroEvent 对象的 tap 事件', () => {
      const { adapter, runtime } = createPatchedAdapter();
      const events: TrackEvent[] = [];
      const interceptor = adapter.createEventInterceptor((e: TrackEvent) => events.push(e));
      interceptor.start();

      runtime.TaroElement.prototype.dispatchEvent.call(el(), {
        type: 'tap', mpEvent: { detail: { x: 100, y: 200 } },
      });

      interceptor.stop();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('tap');
      expect(events[0].data.x).toBe(100);
      expect(events[0].data.y).toBe(200);
    });

    it('应拦截 scroll 事件并提取 scrollTop', () => {
      const { adapter, runtime } = createPatchedAdapter();
      const events: TrackEvent[] = [];
      const interceptor = adapter.createEventInterceptor((e: TrackEvent) => events.push(e));
      interceptor.start();

      runtime.TaroElement.prototype.dispatchEvent.call(
        el({ nodeName: 'scroll-view', uid: '_2', textContent: '' }),
        { type: 'scroll', mpEvent: { detail: { scrollTop: 150, scrollLeft: 0 } } },
      );

      interceptor.stop();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('scroll');
      expect(events[0].data.scrollTop).toBe(150);
    });

    it('应拦截 input 事件并提取 value', () => {
      const { adapter, runtime } = createPatchedAdapter();
      const events: TrackEvent[] = [];
      const interceptor = adapter.createEventInterceptor((e: TrackEvent) => events.push(e));
      interceptor.start();

      runtime.TaroElement.prototype.dispatchEvent.call(
        el({ nodeName: 'input', uid: '_3', textContent: '' }),
        { type: 'input', mpEvent: { detail: { value: 'hello' } } },
      );

      interceptor.stop();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('input');
      expect(events[0].data.value).toBe('hello');
    });

    it('应拦截 longpress 事件', () => {
      const { adapter, runtime } = createPatchedAdapter();
      const events: TrackEvent[] = [];
      const interceptor = adapter.createEventInterceptor((e: TrackEvent) => events.push(e));
      interceptor.start();

      runtime.TaroElement.prototype.dispatchEvent.call(
        el(), { type: 'longpress', mpEvent: { detail: { x: 10, y: 20 } } },
      );

      interceptor.stop();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('longpress');
    });

    it('应将 longtap 映射为 longpress', () => {
      const { adapter, runtime } = createPatchedAdapter();
      const events: TrackEvent[] = [];
      const interceptor = adapter.createEventInterceptor((e: TrackEvent) => events.push(e));
      interceptor.start();

      runtime.TaroElement.prototype.dispatchEvent.call(
        el(), { type: 'longtap', mpEvent: { detail: { x: 10, y: 20 } } },
      );

      interceptor.stop();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('longpress');
    });

    it('非用户交互事件不应被拦截', () => {
      const { adapter, runtime } = createPatchedAdapter();
      const events: TrackEvent[] = [];
      const interceptor = adapter.createEventInterceptor((e: TrackEvent) => events.push(e));
      interceptor.start();

      runtime.TaroElement.prototype.dispatchEvent.call(
        el({ nodeName: 'view' }), { type: 'animationend' },
      );

      interceptor.stop();
      expect(events.length).toBe(0);
    });

    it('stop 后不应继续拦截', () => {
      const { adapter, runtime } = createPatchedAdapter();
      const events: TrackEvent[] = [];
      const interceptor = adapter.createEventInterceptor((e: TrackEvent) => events.push(e));
      interceptor.start();
      interceptor.stop();

      runtime.TaroElement.prototype.dispatchEvent.call(
        el(), { type: 'tap', mpEvent: { detail: { x: 0, y: 0 } } },
      );

      expect(events.length).toBe(0);
    });

    it('无 mpEvent 时应降级到 event 自身提取 detail', () => {
      const { adapter, runtime } = createPatchedAdapter();
      const events: TrackEvent[] = [];
      const interceptor = adapter.createEventInterceptor((e: TrackEvent) => events.push(e));
      interceptor.start();

      runtime.TaroElement.prototype.dispatchEvent.call(
        el(), { type: 'tap', detail: { x: 50, y: 60 } },
      );

      interceptor.stop();
      expect(events.length).toBe(1);
      expect(events[0].data.x).toBe(50);
      expect(events[0].data.y).toBe(60);
    });

    it('原始 dispatchEvent 应被正确调用', () => {
      const { adapter, origDispatch, runtime } = createPatchedAdapter();
      const interceptor = adapter.createEventInterceptor(() => {});
      interceptor.start();

      const event = { type: 'tap', mpEvent: { detail: { x: 1, y: 2 } } };
      runtime.TaroElement.prototype.dispatchEvent.call(el(), event);

      expect(origDispatch).toHaveBeenCalledWith(event);
      interceptor.stop();
    });
  });

  // ──────────── 降级 ────────────

  describe('runtime 不可用时的降级', () => {
    it('TaroElement 不存在时 interceptor.start 不应崩溃', () => {
      const adapter = new TaroAdapter({ runtime: {}, taro: {} });
      const interceptor = adapter.createEventInterceptor(() => {});
      expect(() => interceptor.start()).not.toThrow();
      interceptor.stop();
    });
  });

  // ──────────── getCurrentPage ────────────

  describe('getCurrentPage 兼容性', () => {
    it('Taro.getCurrentInstance 可用时应优先使用', () => {
      const adapter = new TaroAdapter({
        runtime: {},
        taro: {
          getCurrentInstance: vi.fn().mockReturnValue({
            router: { path: '/pages/home/index', params: { id: '1' } },
          }),
          eventCenter: { on: vi.fn(), off: vi.fn() },
        },
      });
      const page = adapter.getCurrentPage();
      expect(page.path).toBe('/pages/home/index');
      expect(page.query).toEqual({ id: '1' });
    });

    it('Taro 不可用时应回退到 getCurrentPages', () => {
      (globalThis as any).getCurrentPages = vi.fn().mockReturnValue([
        { route: 'pages/fallback/index', options: { from: 'share' } },
      ]);
      const adapter = new TaroAdapter({ runtime: {}, taro: {} });
      const page = adapter.getCurrentPage();
      expect(page.path).toBe('pages/fallback/index');
      expect(page.query).toEqual({ from: 'share' });
    });
  });

  // ──────────── getViewportSize ────────────

  describe('getViewportSize 兼容性', () => {
    it('有 getWindowInfo 时应优先使用 (微信基础库 2.20.1+)', () => {
      (globalThis as any).wx = mockWx({
        getWindowInfo: vi.fn().mockReturnValue({ windowWidth: 414, windowHeight: 896 }),
        getDeviceInfo: vi.fn().mockReturnValue({}),
        getAppBaseInfo: vi.fn().mockReturnValue({}),
      });
      const adapter = new TaroAdapter({ runtime: {}, taro: {} });
      expect(adapter.getViewportSize()).toEqual({ width: 414, height: 896 });
    });

    it('无 getWindowInfo 时应回退到 getSystemInfoSync', () => {
      (globalThis as any).wx = mockWx();
      (globalThis as any).wx.getSystemInfoSync = vi.fn().mockReturnValue({
        windowWidth: 320, windowHeight: 568,
      });
      const adapter = new TaroAdapter({ runtime: {}, taro: {} });
      expect(adapter.getViewportSize()).toEqual({ width: 320, height: 568 });
    });
  });

  // ──────────── storage ────────────

  describe('storage 兼容性', () => {
    it('应优先使用 Taro API', () => {
      const get = vi.fn().mockReturnValue('val');
      const set = vi.fn();
      const remove = vi.fn();
      const adapter = new TaroAdapter({
        runtime: {},
        taro: { getStorageSync: get, setStorageSync: set, removeStorageSync: remove },
      });
      expect(adapter.storage.get('k')).toBe('val');
      adapter.storage.set('k', 'v');
      expect(set).toHaveBeenCalledWith('k', 'v');
      adapter.storage.remove('k');
      expect(remove).toHaveBeenCalledWith('k');
    });

    it('Taro 不可用时应回退到 wx API', () => {
      const adapter = new TaroAdapter({ runtime: {}, taro: {} });
      adapter.storage.get('key');
      expect((globalThis as any).wx.getStorageSync).toHaveBeenCalledWith('key');
    });
  });

  // ──────────── onPageShow / onRouteChange ────────────

  describe('onPageShow 与路由监听', () => {
    it('应通过 eventCenter 监听路由变化', () => {
      const on = vi.fn();
      const off = vi.fn();
      const adapter = new TaroAdapter({
        runtime: {},
        taro: {
          eventCenter: { on, off },
          getCurrentInstance: vi.fn().mockReturnValue({ router: { path: '/pages/a', params: {} } }),
        },
      });
      const cb = vi.fn();
      const unsub = adapter.onPageShow(cb);

      expect(on).toHaveBeenCalledWith('__taroRouterChange', expect.any(Function));

      const routerHandler = on.mock.calls[0][1];
      routerHandler();
      expect(cb).toHaveBeenCalled();

      unsub();
      cb.mockClear();
      routerHandler();
      expect(cb).not.toHaveBeenCalled();
    });

    it('onPageHide 无需 onPageShow 也能独立工作', () => {
      const on = vi.fn();
      const adapter = new TaroAdapter({
        runtime: {},
        taro: {
          eventCenter: { on, off: vi.fn() },
          getCurrentInstance: vi.fn().mockReturnValue({ router: { path: '/pages/b', params: {} } }),
        },
      });
      const hideCb = vi.fn();
      adapter.onPageHide(hideCb);

      expect(on).toHaveBeenCalledWith('__taroRouterChange', expect.any(Function));
    });
  });
});
