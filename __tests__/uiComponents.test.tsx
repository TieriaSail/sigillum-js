import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

// Mock rrweb-player
vi.mock('rrweb-player', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getReplayer: vi.fn(),
    })),
  };
});

import { ReplayPlayer, SessionInfo, ReplayPage } from '../ui/index';

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

    it('有数据时应渲染容器', () => {
      const { container } = render(
        <ReplayPlayer data={sampleServerData} />
      );

      // 应该有一个容器 div（用于 rrweb-player 挂载）
      expect(container.querySelector('div')).toBeTruthy();
    });

    it('应支持自定义 className 和 style', () => {
      const { container } = render(
        <ReplayPlayer
          data={sampleServerData}
          className="player-class"
          style={{ height: '500px' }}
        />
      );

      const element = container.firstChild as HTMLElement;
      expect(element.className).toContain('player-class');
      expect(element.style.height).toBe('500px');
    });

    it('应支持字段映射', () => {
      // 使用映射数据不应报错
      const { container } = render(
        <ReplayPlayer
          data={customMappedData}
          fieldMapping={customFieldMapping}
        />
      );

      expect(container.querySelector('div')).toBeTruthy();
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

