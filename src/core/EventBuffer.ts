/**
 * 事件缓冲区
 *
 * 管理事件在内存中的存储，提供溢出保护和批量读取能力。
 */

import type { TrackEvent } from './types';

export class EventBuffer {
  private events: TrackEvent[] = [];
  private maxEvents: number;

  constructor(maxEvents: number = 50000) {
    this.maxEvents = Number.isFinite(maxEvents) && maxEvents > 0 ? maxEvents : 50000;
  }

  push(event: TrackEvent): boolean {
    if (this.events.length >= this.maxEvents) {
      return false;
    }
    this.events.push(event);
    return true;
  }

  /** 强制追加事件，无视容量限制（仅用于 session_end 等终结事件） */
  forceAppend(event: TrackEvent): void {
    this.events.push(event);
  }

  getEvents(): TrackEvent[] {
    return this.events;
  }

  getEventCount(): number {
    return this.events.length;
  }

  /**
   * 获取指定索引之后的事件（用于分段上传）
   */
  getEventsSince(fromIndex: number): TrackEvent[] {
    return this.events.slice(fromIndex);
  }

  isFull(): boolean {
    return this.events.length >= this.maxEvents;
  }

  clear(): void {
    this.events = [];
  }
}
