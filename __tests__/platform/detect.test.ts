import { describe, it, expect, afterEach } from 'vitest';
import { detectPlatform, isMiniApp } from '../../src/platform/detect';

describe('platform/detect', () => {
  afterEach(() => {
    // 清理全局变量
    delete (globalThis as any).wx;
    delete (globalThis as any).my;
    delete (globalThis as any).tt;
    delete (globalThis as any).swan;
    delete (globalThis as any).qq;
    delete (globalThis as any).__tarojs_runtime;
  });

  it('jsdom 环境应检测为 browser', () => {
    expect(detectPlatform()).toBe('browser');
  });

  it('isMiniApp 在浏览器环境应返回 false', () => {
    expect(isMiniApp()).toBe(false);
  });

  it('存在 wx 全局变量时应检测为 wechat', () => {
    (globalThis as any).wx = {
      getSystemInfoSync: () => ({}),
    };
    expect(detectPlatform()).toBe('wechat');
    expect(isMiniApp()).toBe(true);
  });

  it('存在 my 全局变量时应检测为 alipay', () => {
    (globalThis as any).my = {
      getSystemInfoSync: () => ({}),
    };
    expect(detectPlatform()).toBe('alipay');
    expect(isMiniApp()).toBe(true);
  });

  it('存在 tt 全局变量时应检测为 tiktok', () => {
    (globalThis as any).tt = {
      getSystemInfoSync: () => ({}),
    };
    expect(detectPlatform()).toBe('tiktok');
    expect(isMiniApp()).toBe(true);
  });

  it('存在 swan 全局变量时应检测为 baidu', () => {
    (globalThis as any).swan = {
      getSystemInfoSync: () => ({}),
    };
    expect(detectPlatform()).toBe('baidu');
    expect(isMiniApp()).toBe(true);
  });

  it('存在 qq 全局变量时应检测为 qq', () => {
    (globalThis as any).qq = {
      getSystemInfoSync: () => ({}),
    };
    expect(detectPlatform()).toBe('qq');
    expect(isMiniApp()).toBe(true);
  });

  it('Taro 运行时标识应优先于 wx', () => {
    (globalThis as any).__tarojs_runtime = true;
    (globalThis as any).wx = { getSystemInfoSync: () => ({}) };
    expect(detectPlatform()).toBe('taro');
  });

  it('无任何小程序全局变量且无 window/document 时应返回 unknown', () => {
    const origWindow = globalThis.window;
    const origDocument = globalThis.document;
    // @ts-ignore
    delete globalThis.window;
    // @ts-ignore
    delete globalThis.document;

    expect(detectPlatform()).toBe('unknown');
    expect(isMiniApp()).toBe(false);

    globalThis.window = origWindow;
    globalThis.document = origDocument;
  });
});
