/**
 * 兼容性检查
 * 检查浏览器是否支持 rrweb 录制所需的 API
 */

export interface CompatibilityResult {
  supported: boolean;
  reason?: string;
  details: {
    mutationObserver: boolean;
    proxy: boolean;
    weakMap: boolean;
    requestAnimationFrame: boolean;
  };
}

/**
 * 检查浏览器兼容性
 */
export function checkCompatibility(): CompatibilityResult {
  const details = {
    mutationObserver: typeof MutationObserver !== 'undefined',
    proxy: typeof Proxy !== 'undefined',
    weakMap: typeof WeakMap !== 'undefined',
    requestAnimationFrame: typeof requestAnimationFrame !== 'undefined',
  };

  const missingFeatures: string[] = [];

  if (!details.mutationObserver) {
    missingFeatures.push('MutationObserver');
  }
  if (!details.proxy) {
    missingFeatures.push('Proxy');
  }
  if (!details.weakMap) {
    missingFeatures.push('WeakMap');
  }
  if (!details.requestAnimationFrame) {
    missingFeatures.push('requestAnimationFrame');
  }

  const supported = missingFeatures.length === 0;

  return {
    supported,
    reason: supported ? undefined : `Missing: ${missingFeatures.join(', ')}`,
    details,
  };
}

/**
 * 检查是否在浏览器环境
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

