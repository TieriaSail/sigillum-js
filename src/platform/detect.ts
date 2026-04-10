/**
 * 运行时平台检测
 *
 * 通过检查全局对象判断当前运行环境。
 */

export type DetectedPlatform =
  | 'browser'
  | 'wechat'
  | 'alipay'
  | 'tiktok'
  | 'baidu'
  | 'qq'
  | 'taro'
  | 'unknown';

declare const wx: unknown;
declare const my: unknown;
declare const tt: unknown;
declare const swan: unknown;
declare const qq: unknown;

export function detectPlatform(): DetectedPlatform {
  // Taro 运行时会在全局挂载标识
  if (typeof globalThis !== 'undefined' && (globalThis as any).__tarojs_runtime) {
    return 'taro';
  }

  if (typeof wx !== 'undefined' && typeof (wx as any).getSystemInfoSync === 'function') {
    return 'wechat';
  }

  if (typeof my !== 'undefined' && typeof (my as any).getSystemInfoSync === 'function') {
    return 'alipay';
  }

  if (typeof tt !== 'undefined' && typeof (tt as any).getSystemInfoSync === 'function') {
    return 'tiktok';
  }

  if (typeof swan !== 'undefined' && typeof (swan as any).getSystemInfoSync === 'function') {
    return 'baidu';
  }

  if (typeof qq !== 'undefined' && typeof (qq as any).getSystemInfoSync === 'function') {
    return 'qq';
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'browser';
  }

  return 'unknown';
}

export function isMiniApp(): boolean {
  const p = detectPlatform();
  return p !== 'browser' && p !== 'unknown';
}
