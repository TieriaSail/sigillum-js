import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';

let lastReplayerEvents: unknown = null;
let lastReplayerOptions: Record<string, unknown> | null = null;

class MockReplayer {
  wrapper: HTMLDivElement;
  constructor(events: unknown, options: Record<string, unknown>) {
    lastReplayerEvents = events;
    lastReplayerOptions = options;
    this.wrapper = document.createElement('div');
  }
  getMetaData() { return { startTime: 0, endTime: 60000, totalTime: 60000 }; }
  getCurrentTime() { return 0; }
  on() { return this; }
  play() { /* noop */ }
  pause() { /* noop */ }
  setConfig() { /* noop */ }
  destroy() { /* noop */ }
  getMirror() { return {}; }
}

// rrweb-player 2.0.x 发布产物已损坏，组件改为直接驱动 rrweb 核心 Replayer。
vi.mock('rrweb', () => {
  return {
    Replayer: MockReplayer,
  };
});

import { ReplayPlayer, SessionInfo, ReplayPage } from '../src/ui/index';

const sampleServerData = {
  sessionId: 'sess-123',
  events: [{ type: 2, data: {}, timestamp: 1700000000000 }],
  startTime: 1700000000000,
  endTime: 1700000060000,
  duration: 60000,
  tags: [{ name: 'click', timestamp: 1700000030000 }],
  url: 'https://example.com/page',
  userAgent: 'Mozilla/5.0',
  screenResolution: '1920x1080',
  viewport: { width: 1280, height: 720 },
};

const customMappedData = {
  id: 'sess-456',
  content: JSON.stringify([{ type: 2, data: {}, timestamp: 1700000000000 }]),
  start_at: 1700000000000,
  end_at: 1700000060000,
  duration_ms: 60000,
  page_url: 'https://example.com/mapped',
};

const customFieldMapping: [string, string, ...any[]][] = [
  ['sessionId', 'id'],
  ['events', 'content', JSON.stringify, JSON.parse],
  ['startTime', 'start_at'],
  ['endTime', 'end_at'],
  ['duration', 'duration_ms'],
  ['url', 'page_url'],
];

describe('UI Components', () => {
  beforeEach(() => {
    lastReplayerEvents = null;
    lastReplayerOptions = null;
  });

  afterEach(() => {
    cleanup();
  });

  describe('SessionInfo', () => {
    it('应显示会话信息', () => {
      render(<SessionInfo data={sampleServerData} />);

      expect(screen.getByText('Session Info')).toBeTruthy();
      expect(screen.getByText('sess-123')).toBeTruthy();
      expect(screen.getByText('https://example.com/page')).toBeTruthy();
      expect(screen.getByText('1920x1080')).toBeTruthy();
    });

    it('应显示录制时长', () => {
      render(<SessionInfo data={sampleServerData} />);
      // 60000ms = 1m 0s
      expect(screen.getByText('1m 0s')).toBeTruthy();
    });

    it('应显示视口大小', () => {
      render(<SessionInfo data={sampleServerData} />);
      expect(screen.getByText('1280x720')).toBeTruthy();
    });

    it('应显示事件数量和标记数量', () => {
      render(<SessionInfo data={sampleServerData} />);
      expect(screen.getByText('Event Count:')).toBeTruthy();
      expect(screen.getByText('Tag Count:')).toBeTruthy();
      const ones = screen.getAllByText('1');
      expect(ones.length).toBe(2); // 事件 1 + 标记 1
    });

    it('data 为 null 时不应渲染', () => {
      const { container } = render(<SessionInfo data={null as any} />);
      expect(container.innerHTML).toBe('');
    });

    it('应支持字段映射', () => {
      render(
        <SessionInfo
          data={customMappedData}
          fieldMapping={customFieldMapping}
        />
      );

      expect(screen.getByText('sess-456')).toBeTruthy();
      expect(screen.getByText('https://example.com/mapped')).toBeTruthy();
    });

    it('应支持自定义 className 和 style', () => {
      const { container } = render(
        <SessionInfo
          data={sampleServerData}
          className="custom-class"
          style={{ border: '1px solid red' }}
        />
      );

      const element = container.firstChild as HTMLElement;
      expect(element.className).toContain('custom-class');
      expect(element.style.border).toBe('1px solid red');
    });
  });

  describe('ReplayPlayer', () => {
    it('无数据时应显示"无录制数据"', () => {
      render(<ReplayPlayer data={null as any} />);
      expect(screen.getByText('No recording data')).toBeTruthy();
    });

    it('有数据时应渲染容器', async () => {
      await act(async () => {
        render(<ReplayPlayer data={sampleServerData} />);
      });
      await waitFor(() => expect(lastReplayerOptions).not.toBeNull());

      expect(document.querySelector('div')).toBeTruthy();
    });

    it('应支持自定义 className 和 style', async () => {
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(
          <ReplayPlayer
            data={sampleServerData}
            className="player-class"
            style={{ height: '500px' }}
          />
        ));
      });
      await waitFor(() => expect(lastReplayerOptions).not.toBeNull());

      const element = container.firstChild as HTMLElement;
      expect(element.className).toContain('player-class');
      expect(element.style.height).toBe('500px');
    });

    it('应支持字段映射', async () => {
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(
          <ReplayPlayer
            data={customMappedData}
            fieldMapping={customFieldMapping}
          />
        ));
      });
      await waitFor(() => expect(lastReplayerOptions).not.toBeNull());

      expect(container.querySelector('div')).toBeTruthy();
    });

    it('events 应作为 Replayer 的第一个构造参数传入', async () => {
      await act(async () => {
        render(<ReplayPlayer data={sampleServerData} />);
      });

      await waitFor(() => expect(lastReplayerEvents).not.toBeNull());
      expect(lastReplayerEvents).toEqual(sampleServerData.events);
    });

    it('应透传 rrweb Replayer 显式字段（UNSAFE_replayCanvas, mouseTail, triggerFocus, insertStyleRules）', async () => {
      await act(async () => {
        render(
          <ReplayPlayer
            data={sampleServerData}
            config={{
              UNSAFE_replayCanvas: true,
              mouseTail: false,
              triggerFocus: true,
              insertStyleRules: ['body { color: red; }'],
            }}
          />
        );
      });

      await waitFor(() => expect(lastReplayerOptions).not.toBeNull());
      expect(lastReplayerOptions!.UNSAFE_replayCanvas).toBe(true);
      expect(lastReplayerOptions!.mouseTail).toBe(false);
      expect(lastReplayerOptions!.triggerFocus).toBe(true);
      expect(lastReplayerOptions!.insertStyleRules).toEqual(['body { color: red; }']);
    });

    it('应始终把挂载点设为 root，且 events 由第一个参数提供（不被 replayerConfig 覆盖）', async () => {
      await act(async () => {
        render(
          <ReplayPlayer
            data={sampleServerData}
            config={{
              replayerConfig: {
                showWarning: false,
                root: document.createElement('span'),
              },
            }}
          />
        );
      });

      await waitFor(() => expect(lastReplayerOptions).not.toBeNull());
      expect(lastReplayerOptions!.showWarning).toBe(false);
      // events 走第一个构造参数，始终是录制数据本身
      expect(lastReplayerEvents).toEqual(sampleServerData.events);
      // root 始终被组件强制设为内部 frame（不被 replayerConfig 覆盖）
      expect(lastReplayerOptions!.root).toBeInstanceOf(HTMLElement);
      expect((lastReplayerOptions!.root as HTMLElement).tagName).toBe('DIV');
    });

    it('显式字段优先级高于 replayerConfig', async () => {
      await act(async () => {
        render(
          <ReplayPlayer
            data={sampleServerData}
            config={{
              UNSAFE_replayCanvas: true,
              replayerConfig: {
                UNSAFE_replayCanvas: false,
              },
            }}
          />
        );
      });

      await waitFor(() => expect(lastReplayerOptions).not.toBeNull());
      expect(lastReplayerOptions!.UNSAFE_replayCanvas).toBe(true);
    });

    it('默认 config 值应正确传递', async () => {
      await act(async () => {
        render(
          <ReplayPlayer data={sampleServerData} config={{}} />
        );
      });

      await waitFor(() => expect(lastReplayerOptions).not.toBeNull());
      expect(lastReplayerOptions!.speed).toBe(1);
      expect(lastReplayerOptions!.skipInactive).toBe(true);
      expect(lastReplayerOptions!.UNSAFE_replayCanvas).toBeUndefined();
      // autoPlay / showController 属于控制条层，不应出现在 Replayer 选项里
      expect(lastReplayerOptions!.autoPlay).toBeUndefined();
      expect(lastReplayerOptions!.showController).toBeUndefined();
    });
  });

  describe('ReplayPage', () => {
    it('应同时渲染 SessionInfo 和 ReplayPlayer', () => {
      render(<ReplayPage data={sampleServerData} />);

      // SessionInfo 应该可见
      expect(screen.getByText('Session Info')).toBeTruthy();
      expect(screen.getByText('sess-123')).toBeTruthy();
    });

    it('showInfo=false 应隐藏 SessionInfo', () => {
      render(<ReplayPage data={sampleServerData} showInfo={false} />);

      expect(screen.queryByText('Session Info')).toBeNull();
    });

    it('showInfo 默认为 true', () => {
      render(<ReplayPage data={sampleServerData} />);
      expect(screen.getByText('Session Info')).toBeTruthy();
    });
  });
});

