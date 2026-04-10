import { describe, it, expect, beforeEach } from 'vitest';
import { EventBuffer } from '../../src/core/EventBuffer';
import type { TrackEvent } from '../../src/core/types';

function makeEvent(type: string, timestamp: number): TrackEvent {
  return { type: type as any, timestamp, data: {} };
}

describe('EventBuffer', () => {
  let buffer: EventBuffer;

  beforeEach(() => {
    buffer = new EventBuffer(100);
  });

  it('初始化状态应为空', () => {
    expect(buffer.getEventCount()).toBe(0);
    expect(buffer.getEvents()).toEqual([]);
    expect(buffer.isFull()).toBe(false);
  });

  it('push 应添加事件并返回 true', () => {
    const event = makeEvent('tap', 1000);
    const result = buffer.push(event);
    expect(result).toBe(true);
    expect(buffer.getEventCount()).toBe(1);
    expect(buffer.getEvents()[0]).toBe(event);
  });

  it('push 在达到上限后应返回 false', () => {
    const smallBuffer = new EventBuffer(3);
    expect(smallBuffer.push(makeEvent('tap', 1))).toBe(true);
    expect(smallBuffer.push(makeEvent('tap', 2))).toBe(true);
    expect(smallBuffer.push(makeEvent('tap', 3))).toBe(true);
    expect(smallBuffer.isFull()).toBe(true);
    expect(smallBuffer.push(makeEvent('tap', 4))).toBe(false);
    expect(smallBuffer.getEventCount()).toBe(3);
  });

  it('getEventsSince 应返回指定索引之后的事件', () => {
    buffer.push(makeEvent('tap', 1));
    buffer.push(makeEvent('scroll', 2));
    buffer.push(makeEvent('input', 3));

    const since1 = buffer.getEventsSince(1);
    expect(since1).toHaveLength(2);
    expect(since1[0].type).toBe('scroll');

    const since0 = buffer.getEventsSince(0);
    expect(since0).toHaveLength(3);

    const since3 = buffer.getEventsSince(3);
    expect(since3).toHaveLength(0);
  });

  it('clear 应清空所有数据', () => {
    buffer.push(makeEvent('tap', 1));
    buffer.clear();

    expect(buffer.getEventCount()).toBe(0);
    expect(buffer.isFull()).toBe(false);
  });

  it('默认上限应为 50000', () => {
    const defaultBuffer = new EventBuffer();
    for (let i = 0; i < 100; i++) {
      defaultBuffer.push(makeEvent('tap', i));
    }
    expect(defaultBuffer.isFull()).toBe(false);
    expect(defaultBuffer.getEventCount()).toBe(100);
  });
});
