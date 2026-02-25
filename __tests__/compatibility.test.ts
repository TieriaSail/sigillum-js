import { describe, it, expect, afterEach, vi } from 'vitest';
import { checkCompatibility, isBrowser } from '../compatibility';

describe('compatibility', () => {
  describe('isBrowser', () => {
    it('jsdom 环境下应返回 true', () => {
      expect(isBrowser()).toBe(true);
    });

    it('window undefined 时应返回 false', () => {
      const originalWindow = globalThis.window;
      // @ts-ignore
      delete globalThis.window;

      expect(isBrowser()).toBe(false);

      globalThis.window = originalWindow;
    });
  });

  describe('checkCompatibility', () => {
    it('jsdom 环境下应返回 supported', () => {
      const result = checkCompatibility();
      expect(result.supported).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.details.mutationObserver).toBe(true);
      expect(result.details.proxy).toBe(true);
      expect(result.details.weakMap).toBe(true);
      expect(result.details.requestAnimationFrame).toBe(true);
    });

    it('缺少 MutationObserver 时应返回不支持', () => {
      const original = globalThis.MutationObserver;
      // @ts-ignore
      delete globalThis.MutationObserver;

      const result = checkCompatibility();
      expect(result.supported).toBe(false);
      expect(result.reason).toContain('MutationObserver');
      expect(result.details.mutationObserver).toBe(false);

      globalThis.MutationObserver = original;
    });

    it('缺少 Proxy 时应返回不支持', () => {
      const original = globalThis.Proxy;
      // @ts-ignore
      delete globalThis.Proxy;

      const result = checkCompatibility();
      expect(result.supported).toBe(false);
      expect(result.reason).toContain('Proxy');
      expect(result.details.proxy).toBe(false);

      globalThis.Proxy = original;
    });

    it('缺少 WeakMap 时应返回不支持', () => {
      const original = globalThis.WeakMap;
      // @ts-ignore
      delete globalThis.WeakMap;

      const result = checkCompatibility();
      expect(result.supported).toBe(false);
      expect(result.reason).toContain('WeakMap');
      expect(result.details.weakMap).toBe(false);

      globalThis.WeakMap = original;
    });

    it('缺少多个特性时 reason 应包含所有缺失项', () => {
      const origProxy = globalThis.Proxy;
      const origWeakMap = globalThis.WeakMap;
      // @ts-ignore
      delete globalThis.Proxy;
      // @ts-ignore
      delete globalThis.WeakMap;

      const result = checkCompatibility();
      expect(result.supported).toBe(false);
      expect(result.reason).toContain('Proxy');
      expect(result.reason).toContain('WeakMap');

      globalThis.Proxy = origProxy;
      globalThis.WeakMap = origWeakMap;
    });
  });
});

