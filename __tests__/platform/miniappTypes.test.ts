import { describe, it, expect } from 'vitest';
import { extractEventTarget, extractTapPosition } from '../../src/platform/miniapp/types';
import type { MiniAppEventObject } from '../../src/platform/miniapp/types';

describe('platform/miniapp/types', () => {
  describe('extractEventTarget', () => {
    it('应从 currentTarget 中提取信息', () => {
      const e: MiniAppEventObject = {
        type: 'tap',
        timeStamp: 1000,
        currentTarget: { id: 'btn1', dataset: { action: 'submit' } },
        target: { id: 'btn1' },
      };
      const target = extractEventTarget(e);
      expect(target.id).toBe('btn1');
      expect(target.dataset).toEqual({ action: 'submit' });
    });

    it('无 currentTarget 时应降级到 target', () => {
      const e: MiniAppEventObject = {
        type: 'tap',
        timeStamp: 1000,
        target: { id: 'input1', tagName: 'input' },
      };
      const target = extractEventTarget(e);
      expect(target.id).toBe('input1');
    });

    it('无 target 信息时应返回 undefined 字段', () => {
      const e: MiniAppEventObject = {
        type: 'tap',
        timeStamp: 1000,
      };
      const target = extractEventTarget(e);
      expect(target.id).toBeUndefined();
      expect(target.dataset).toBeUndefined();
    });
  });

  describe('extractTapPosition', () => {
    it('应优先从 detail 中提取坐标', () => {
      const e: MiniAppEventObject = {
        type: 'tap',
        timeStamp: 1000,
        detail: { x: 120, y: 340 },
        touches: [{ clientX: 100, clientY: 200, pageX: 100, pageY: 200 }],
      };
      const pos = extractTapPosition(e);
      expect(pos).toEqual({ x: 120, y: 340 });
    });

    it('无 detail 时应从 touches 中提取', () => {
      const e: MiniAppEventObject = {
        type: 'tap',
        timeStamp: 1000,
        touches: [{ clientX: 150, clientY: 250, pageX: 150, pageY: 250 }],
      };
      const pos = extractTapPosition(e);
      expect(pos).toEqual({ x: 150, y: 250 });
    });

    it('无 detail 且有 changedTouches 时应使用 changedTouches', () => {
      const e: MiniAppEventObject = {
        type: 'tap',
        timeStamp: 1000,
        changedTouches: [{ clientX: 200, clientY: 300, pageX: 200, pageY: 300 }],
      };
      const pos = extractTapPosition(e);
      expect(pos).toEqual({ x: 200, y: 300 });
    });

    it('无任何坐标信息时应返回 (0, 0)', () => {
      const e: MiniAppEventObject = {
        type: 'tap',
        timeStamp: 1000,
      };
      const pos = extractTapPosition(e);
      expect(pos).toEqual({ x: 0, y: 0 });
    });
  });
});
