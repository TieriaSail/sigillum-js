/**
 * 事件时间轴回放器
 *
 * 将追踪事件按时间顺序播放，提供播放控制（播放/暂停/跳转/倍速）。
 * 纯逻辑，不依赖 DOM —— UI 渲染由外层组件负责。
 */

import type { TrackEvent } from '../core/types';

export type TimelinePlayerStatus = 'idle' | 'playing' | 'paused' | 'finished';

export interface TimelinePlayerOptions {
  events: TrackEvent[];
  speed?: number;
  onEvent?: (event: TrackEvent, index: number) => void;
  onStatusChange?: (status: TimelinePlayerStatus) => void;
  onProgress?: (currentTime: number, totalDuration: number) => void;
}

export class TimelinePlayer {
  private events: TrackEvent[];
  private speed: number;
  private status: TimelinePlayerStatus = 'idle';

  private startTimestamp = 0;
  private totalDuration = 0;
  private currentIndex = 0;
  private playbackStart = 0;
  private pauseOffset = 0;
  private rafId: ReturnType<typeof requestAnimationFrame> | null = null;

  private onEvent?: (event: TrackEvent, index: number) => void;
  private onStatusChange?: (status: TimelinePlayerStatus) => void;
  private onProgress?: (currentTime: number, totalDuration: number) => void;

  constructor(options: TimelinePlayerOptions) {
    this.events = [...options.events].sort((a, b) => a.timestamp - b.timestamp);
    this.speed = Math.max(0.1, Number.isFinite(options.speed) ? options.speed! : 1);
    this.onEvent = options.onEvent;
    this.onStatusChange = options.onStatusChange;
    this.onProgress = options.onProgress;

    if (this.events.length > 0) {
      this.startTimestamp = this.events[0].timestamp;
      const lastEvent = this.events[this.events.length - 1];
      this.totalDuration = lastEvent.timestamp - this.startTimestamp;
    }
  }

  play(): void {
    if (this.status === 'playing') return;
    if (this.status === 'finished') {
      this.currentIndex = 0;
      this.pauseOffset = 0;
    }

    this.playbackStart = Date.now() - this.pauseOffset;
    this.setStatus('playing');
    this.tick();
  }

  pause(): void {
    if (this.status !== 'playing') return;
    this.pauseOffset = Date.now() - this.playbackStart;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.setStatus('paused');
  }

  seekTo(timeMs: number): void {
    const clampedTime = Math.max(0, Math.min(timeMs, this.totalDuration));
    this.pauseOffset = clampedTime / this.speed;
    this.playbackStart = Date.now() - this.pauseOffset;

    const targetTimestamp = this.startTimestamp + clampedTime;

    this.currentIndex = 0;
    for (let i = 0; i < this.events.length; i++) {
      if (this.events[i].timestamp > targetTimestamp) break;
      this.currentIndex = i;
    }

    if (this.status === 'finished') {
      this.setStatus('paused');
    }

    this.onProgress?.(clampedTime, this.totalDuration);

    if (this.status === 'playing') {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
      }
      this.tick();
    }
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0) return;
    const currentTime = this.getCurrentTime();
    this.speed = speed;
    if (this.status === 'playing') {
      this.pauseOffset = currentTime / this.speed;
      this.playbackStart = Date.now() - this.pauseOffset;
    } else if (this.status === 'paused') {
      this.pauseOffset = currentTime / this.speed;
    }
  }

  getStatus(): TimelinePlayerStatus {
    return this.status;
  }

  getDuration(): number {
    return this.totalDuration;
  }

  getCurrentTime(): number {
    if (this.status === 'idle') return 0;
    if (this.status === 'finished') return this.totalDuration;
    if (this.status === 'paused') return Math.min(this.pauseOffset * this.speed, this.totalDuration);
    const elapsed = (Date.now() - this.playbackStart) * this.speed;
    return Math.min(elapsed, this.totalDuration);
  }

  getEvents(): TrackEvent[] {
    return this.events;
  }

  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.setStatus('idle');
  }

  // ==================== 内部 ====================

  private tick = (): void => {
    if (this.status !== 'playing') return;

    const elapsed = (Date.now() - this.playbackStart) * this.speed;
    const currentTimestamp = this.startTimestamp + elapsed;

    while (this.currentIndex < this.events.length) {
      const event = this.events[this.currentIndex];
      if (event.timestamp <= currentTimestamp) {
        this.onEvent?.(event, this.currentIndex);
        this.currentIndex++;
      } else {
        break;
      }
    }

    this.onProgress?.(Math.min(elapsed, this.totalDuration), this.totalDuration);

    if (elapsed >= this.totalDuration) {
      this.setStatus('finished');
      return;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private setStatus(status: TimelinePlayerStatus): void {
    const prev = this.status;
    this.status = status;
    if (prev !== status) {
      this.onStatusChange?.(status);
    }
  }
}
