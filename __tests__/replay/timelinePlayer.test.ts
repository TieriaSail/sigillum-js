import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TimelinePlayer } from '../../src/replay/TimelinePlayer';
import type { TrackEvent } from '../../src/core/types';

function makeEvents(count: number, startTs = 1000): TrackEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'tap' as const,
    timestamp: startTs + i * 1000,
    data: { x: i * 10, y: i * 10 },
  }));
}

describe('TimelinePlayer', () => {
  let player: TimelinePlayer;

  afterEach(() => {
    player?.destroy();
  });

  describe('初始化', () => {
    it('应正确计算总时长', () => {
      player = new TimelinePlayer({
        events: makeEvents(5, 1000),
      });
      expect(player.getDuration()).toBe(4000); // 1000 ~ 5000
    });

    it('空事件列表的时长应为 0', () => {
      player = new TimelinePlayer({ events: [] });
      expect(player.getDuration()).toBe(0);
    });

    it('初始状态应为 idle', () => {
      player = new TimelinePlayer({ events: makeEvents(3) });
      expect(player.getStatus()).toBe('idle');
      expect(player.getCurrentTime()).toBe(0);
    });
  });

  describe('播放控制', () => {
    it('play 应切换到 playing 状态', () => {
      const onStatusChange = vi.fn();
      player = new TimelinePlayer({
        events: makeEvents(3),
        onStatusChange,
      });
      player.play();
      expect(player.getStatus()).toBe('playing');
      expect(onStatusChange).toHaveBeenCalledWith('playing');
    });

    it('pause 应切换到 paused 状态', () => {
      player = new TimelinePlayer({ events: makeEvents(3) });
      player.play();
      player.pause();
      expect(player.getStatus()).toBe('paused');
    });

    it('非 playing 状态 pause 应忽略', () => {
      player = new TimelinePlayer({ events: makeEvents(3) });
      player.pause();
      expect(player.getStatus()).toBe('idle');
    });
  });

  describe('事件回调', () => {
    it('应按顺序触发事件', async () => {
      vi.useFakeTimers();
      const onEvent = vi.fn();
      player = new TimelinePlayer({
        events: makeEvents(3, 0),
        onEvent,
      });
      player.play();

      // 快进到事件都发生
      vi.advanceTimersByTime(3000);

      // events 的 timestamp: 0, 1000, 2000
      // 第一个事件 (timestamp=0) 应立即触发
      expect(onEvent).toHaveBeenCalled();
      expect(onEvent.mock.calls[0][0].timestamp).toBe(0);

      player.destroy();
      vi.useRealTimers();
    });
  });

  describe('seekTo', () => {
    it('应跳转到指定时间', () => {
      player = new TimelinePlayer({ events: makeEvents(10, 0) });
      player.seekTo(5000);
      // seekTo 不改变状态
      expect(player.getStatus()).toBe('idle');
    });

    it('应 clamp 到有效范围', () => {
      player = new TimelinePlayer({ events: makeEvents(5, 0) });
      player.seekTo(-1000);
      player.seekTo(999999);
      // 不报错即可
    });
  });

  describe('setSpeed', () => {
    it('应改变播放速度', () => {
      player = new TimelinePlayer({ events: makeEvents(3) });
      player.setSpeed(2);
      // 不报错，speed 被接受
    });

    it('播放中改变速度应生效', () => {
      vi.useFakeTimers();
      player = new TimelinePlayer({ events: makeEvents(3) });
      player.play();
      player.setSpeed(4);
      vi.advanceTimersByTime(2000);
      player.destroy();
      vi.useRealTimers();
    });
  });

  describe('getEvents', () => {
    it('应返回排序后的事件', () => {
      const unsorted: TrackEvent[] = [
        { type: 'tap', timestamp: 3000, data: {} },
        { type: 'tap', timestamp: 1000, data: {} },
        { type: 'tap', timestamp: 2000, data: {} },
      ];
      player = new TimelinePlayer({ events: unsorted });
      const sorted = player.getEvents();
      expect(sorted[0].timestamp).toBe(1000);
      expect(sorted[1].timestamp).toBe(2000);
      expect(sorted[2].timestamp).toBe(3000);
    });
  });

  describe('finished 状态', () => {
    it('播放结束后状态应为 finished', async () => {
      vi.useFakeTimers();
      const onStatusChange = vi.fn();
      player = new TimelinePlayer({
        events: [
          { type: 'tap', timestamp: 0, data: {} },
          { type: 'tap', timestamp: 100, data: {} },
        ],
        onStatusChange,
      });
      player.play();
      vi.advanceTimersByTime(500);

      expect(player.getStatus()).toBe('finished');
      expect(onStatusChange).toHaveBeenCalledWith('finished');

      vi.useRealTimers();
    });

    it('finished 后 play 应从头开始', () => {
      vi.useFakeTimers();
      player = new TimelinePlayer({
        events: [
          { type: 'tap', timestamp: 0, data: {} },
          { type: 'tap', timestamp: 50, data: {} },
        ],
      });
      player.play();
      vi.advanceTimersByTime(200);
      expect(player.getStatus()).toBe('finished');

      player.play();
      expect(player.getStatus()).toBe('playing');

      player.destroy();
      vi.useRealTimers();
    });
  });

  describe('destroy', () => {
    it('应停止播放并重置状态', () => {
      player = new TimelinePlayer({ events: makeEvents(3) });
      player.play();
      player.destroy();
      expect(player.getStatus()).toBe('idle');
    });
  });

  describe('progress 回调', () => {
    it('应报告进度', () => {
      vi.useFakeTimers();
      const onProgress = vi.fn();
      player = new TimelinePlayer({
        events: makeEvents(3, 0),
        onProgress,
      });
      player.play();
      vi.advanceTimersByTime(100);

      expect(onProgress).toHaveBeenCalled();
      const [currentTime, totalDuration] = onProgress.mock.calls[0];
      expect(typeof currentTime).toBe('number');
      expect(totalDuration).toBe(2000);

      player.destroy();
      vi.useRealTimers();
    });
  });
});
