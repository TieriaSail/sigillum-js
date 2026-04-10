/**
 * 小程序通用类型
 *
 * 抽象小程序平台的共有概念，避免在每个适配器中重复定义。
 */

/** 小程序事件对象的通用子集 */
export interface MiniAppEventObject {
  type: string;
  timeStamp: number;
  detail?: {
    x?: number;
    y?: number;
    value?: string;
    scrollTop?: number;
    scrollLeft?: number;
    [key: string]: unknown;
  };
  currentTarget?: {
    id?: string;
    dataset?: Record<string, string>;
  };
  target?: {
    id?: string;
    dataset?: Record<string, string>;
    tagName?: string;
  };
  touches?: Array<{
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
  }>;
  changedTouches?: Array<{
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
  }>;
}

/** 小程序页面实例的通用子集 */
export interface MiniAppPageInstance {
  route?: string;
  __route__?: string;
  options?: Record<string, string>;
  is?: string;
}

/**
 * 从小程序事件对象中提取标准化的事件目标信息
 */
export function extractEventTarget(e: MiniAppEventObject) {
  const target = e.currentTarget || e.target;
  return {
    id: target?.id || undefined,
    dataset: target?.dataset || undefined,
    tagName: (e.target as any)?.tagName || undefined,
    text: undefined as string | undefined,
  };
}

/**
 * 从小程序事件对象中提取点击坐标
 */
export function extractTapPosition(e: MiniAppEventObject): { x: number; y: number } {
  if (e.detail?.x !== undefined && e.detail?.y !== undefined) {
    return { x: e.detail.x, y: e.detail.y };
  }
  const touch = e.touches?.[0] || e.changedTouches?.[0];
  if (touch) {
    return { x: touch.clientX, y: touch.clientY };
  }
  return { x: 0, y: 0 };
}
