/**
 * 会话回放播放器组件
 * 支持字段映射，可以直接使用后端返回的数据
 */

import React, { useEffect, useRef, useMemo } from 'react';
import rrwebPlayer from 'rrweb-player';
// CSS 需要由用户自行引入：import 'rrweb-player/dist/style.css'
// 避免在 SSR/非 bundler 环境下直接 import CSS 导致报错
import type { ReplayPlayerProps, FieldMapping, RawRecordingData } from '../types';
import { FieldMapper } from '../FieldMapper';

/**
 * ReplayPlayer 组件
 *
 * @example
 * ```tsx
 * // 使用后端返回的数据
 * <ReplayPlayer
 *   data={serverData}
 *   fieldMapping={[
 *     ['sessionId', 'id'],
 *     ['events', 'content', JSON.stringify, JSON.parse],
 *   ]}
 * />
 * ```
 */
export const ReplayPlayer: React.FC<ReplayPlayerProps> = ({
  data,
  fieldMapping,
  config = {},
  style,
  className,
  // 事件回调暂未实现（rrweb-player 需要额外处理）
  // onPlay,
  // onPause,
  // onFinish,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<rrwebPlayer | null>(null);

  // 字段映射器
  const fieldMapper = useMemo(() => new FieldMapper(fieldMapping), [fieldMapping]);

  // 将后端数据转换为原始数据
  const recordingData = useMemo((): RawRecordingData | null => {
    if (!data) return null;

    try {
      return fieldMapper.fromServer(data);
    } catch (error) {
      console.error('[ReplayPlayer] Failed to parse data:', error);
      return null;
    }
  }, [data, fieldMapper]);

  useEffect(() => {
    if (!containerRef.current || !recordingData || !recordingData.events?.length) {
      return;
    }

    // 销毁旧的播放器
    if (playerRef.current) {
      // rrweb-player 没有提供 destroy 方法，需要手动清理
      containerRef.current.innerHTML = '';
      playerRef.current = null;
    }

    try {
      // 创建播放器
      playerRef.current = new rrwebPlayer({
        target: containerRef.current,
        props: {
          events: recordingData.events,
          width: recordingData.viewport?.width || 1280,
          height: recordingData.viewport?.height || 720,
          speed: config.speed || 1,
          autoPlay: config.autoPlay || false,
          showController: config.showController !== false,
          skipInactive: config.skipInactive !== false,
        },
      });

      // 注意：rrweb-player 的事件监听需要通过 getReplayer() 获取
      // 这里简化处理，如果需要精确的事件回调，可以扩展
    } catch (error) {
      console.error('[ReplayPlayer] Failed to create player:', error);
    }

    // 清理函数
    const container = containerRef.current;
    return () => {
      if (playerRef.current) {
        playerRef.current = null;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [recordingData, config]);

  if (!recordingData) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#f5f5f5',
          color: '#999',
          ...style,
        }}
      >
        无录制数据
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        width: '100%',
        height: '100%',
        ...style,
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
};

/**
 * 会话信息显示组件
 */
interface SessionInfoProps {
  data: Record<string, any>;
  fieldMapping?: FieldMapping[];
  style?: React.CSSProperties;
  className?: string;
}

export const SessionInfo: React.FC<SessionInfoProps> = ({
  data,
  fieldMapping,
  style,
  className,
}) => {
  const fieldMapper = useMemo(() => new FieldMapper(fieldMapping), [fieldMapping]);

  const recordingData = useMemo((): RawRecordingData | null => {
    if (!data) return null;
    try {
      return fieldMapper.fromServer(data);
    } catch {
      return null;
    }
  }, [data, fieldMapper]);

  if (!recordingData) {
    return null;
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div
      className={className}
      style={{
        padding: '16px',
        backgroundColor: '#f5f5f5',
        borderRadius: '4px',
        ...style,
      }}
    >
      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>会话信息</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '8px 16px',
          fontSize: '14px',
        }}
      >
        <strong>会话 ID:</strong>
        <span>{recordingData.sessionId}</span>

        <strong>开始时间:</strong>
        <span>{formatDate(recordingData.startTime)}</span>

        {recordingData.endTime && (
          <>
            <strong>结束时间:</strong>
            <span>{formatDate(recordingData.endTime)}</span>
          </>
        )}

        {recordingData.duration && (
          <>
            <strong>录制时长:</strong>
            <span>{formatDuration(recordingData.duration)}</span>
          </>
        )}

        <strong>页面 URL:</strong>
        <span style={{ wordBreak: 'break-all' }}>{recordingData.url}</span>

        <strong>屏幕分辨率:</strong>
        <span>{recordingData.screenResolution}</span>

        {recordingData.viewport && (
          <>
            <strong>视口大小:</strong>
            <span>{`${recordingData.viewport.width}x${recordingData.viewport.height}`}</span>
          </>
        )}

        <strong>事件数量:</strong>
        <span>{recordingData.events?.length || 0}</span>

        {recordingData.tags && recordingData.tags.length > 0 && (
          <>
            <strong>标记数量:</strong>
            <span>{recordingData.tags.length}</span>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * 完整的回放页面组件（包含信息 + 播放器）
 */
interface ReplayPageProps extends ReplayPlayerProps {
  /** 是否显示会话信息 */
  showInfo?: boolean;
}

export const ReplayPage: React.FC<ReplayPageProps> = ({
  showInfo = true,
  ...playerProps
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showInfo && (
        <SessionInfo
          data={playerProps.data}
          fieldMapping={playerProps.fieldMapping}
          style={{ marginBottom: '16px' }}
        />
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReplayPlayer {...playerProps} />
      </div>
    </div>
  );
};

