/**
 * 会话回放播放器组件
 * 支持字段映射，可以直接使用后端返回的数据
 */

import React, { useEffect, useRef, useMemo, useState } from 'react';
// CSS 需要由用户自行引入：import 'rrweb-player/dist/style.css'
import type { ReplayPlayerProps, FieldMapping, RawRecordingData } from '../types';
import { FieldMapper } from '../FieldMapper';
import { isBrowser } from '../compatibility';
import { unwrapRecording } from '../core/types';

/** @internal */
interface PlayerTexts {
  noData?: string;
  loading?: string;
  error?: string;
  sessionInfo?: string;
  sessionId?: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  pageUrl?: string;
  screenResolution?: string;
  viewportSize?: string;
  eventCount?: string;
  tagCount?: string;
}

const DEFAULT_TEXTS: PlayerTexts = {
  noData: 'No recording data',
  loading: 'Loading player...',
  error: 'Failed to load player',
  sessionInfo: 'Session Info',
  sessionId: 'Session ID',
  startTime: 'Start Time',
  endTime: 'End Time',
  duration: 'Duration',
  pageUrl: 'Page URL',
  screenResolution: 'Screen Resolution',
  viewportSize: 'Viewport Size',
  eventCount: 'Event Count',
  tagCount: 'Tag Count',
};

/**
 * ReplayPlayer 组件
 *
 * @example
 * ```tsx
 * <ReplayPlayer
 *   data={serverData}
 *   fieldMapping={[
 *     ['sessionId', 'id'],
 *     ['events', 'content', JSON.stringify, JSON.parse],
 *   ]}
 * />
 * ```
 */
export const ReplayPlayer: React.FC<ReplayPlayerProps & { texts?: PlayerTexts }> = ({
  data,
  fieldMapping,
  config = {},
  style,
  className,
  texts: userTexts,
  onPlay,
  onPause,
  onFinish,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [playerLoading, setPlayerLoading] = useState(true);
  const [playerError, setPlayerError] = useState(false);

  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onFinishRef = useRef(onFinish);
  useEffect(() => { onPlayRef.current = onPlay; });
  useEffect(() => { onPauseRef.current = onPause; });
  useEffect(() => { onFinishRef.current = onFinish; });
  const texts = useMemo(() => ({ ...DEFAULT_TEXTS, ...userTexts }), [userTexts]);

  const fieldMapper = useMemo(() => new FieldMapper(fieldMapping), [fieldMapping]);

  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; });

  const recordingData = useMemo((): RawRecordingData | null => {
    if (!data) return null;
    try {
      const { recording } = unwrapRecording(data);
      return fieldMapper.fromServer(recording as Record<string, any>);
    } catch {
      return null;
    }
  }, [data, fieldMapper]);

  useEffect(() => {
    if (!isBrowser() || !containerRef.current || !recordingData || !recordingData.events?.length) {
      setPlayerLoading(false);
      return;
    }

    if (playerRef.current) {
      containerRef.current.innerHTML = '';
      playerRef.current = null;
    }

    let cancelled = false;

    import('rrweb-player')
      .then((mod) => {
        if (cancelled || !containerRef.current) return;
        const RrwebPlayer = mod.default || mod;

        try {
          const {
            speed, autoPlay, showController, skipInactive,
            UNSAFE_replayCanvas, pauseAnimation, mouseTail,
            useVirtualDom, liveMode, triggerFocus,
            insertStyleRules, unpackFn,
            replayerConfig,
          } = configRef.current;

          const replayerProps: Record<string, unknown> = {
            ...(replayerConfig ?? {}),
            ...(UNSAFE_replayCanvas !== undefined && { UNSAFE_replayCanvas }),
            ...(pauseAnimation !== undefined && { pauseAnimation }),
            ...(mouseTail !== undefined && { mouseTail }),
            ...(useVirtualDom !== undefined && { useVirtualDom }),
            ...(liveMode !== undefined && { liveMode }),
            ...(triggerFocus !== undefined && { triggerFocus }),
            ...(insertStyleRules !== undefined && { insertStyleRules }),
            ...(unpackFn !== undefined && { unpackFn }),
            speed: speed || 1,
            autoPlay: autoPlay || false,
            showController: showController !== false,
            skipInactive: skipInactive !== false,
            events: recordingData.events,
            width: recordingData.viewport?.width || 1280,
            height: recordingData.viewport?.height || 720,
          };

          const player = new RrwebPlayer({
            target: containerRef.current,
            props: replayerProps as any,
          });
          playerRef.current = player;

          player.$on?.('play', () => onPlayRef.current?.());
          player.$on?.('pause', () => onPauseRef.current?.());
          player.$on?.('finish', () => onFinishRef.current?.());

          setPlayerLoading(false);
          setPlayerError(false);
        } catch {
          setPlayerLoading(false);
          setPlayerError(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerLoading(false);
          setPlayerError(true);
        }
      });

    const container = containerRef.current;
    return () => {
      cancelled = true;
      if (playerRef.current) {
        try { (playerRef.current as any).$destroy?.(); } catch { /* */ }
        playerRef.current = null;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [recordingData]);

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
        {texts.noData}
      </div>
    );
  }

  if (playerError) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#fff3f3',
          color: '#cc0000',
          ...style,
        }}
      >
        {texts.error}
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
      {playerLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: '#999' }}>
          {texts.loading}
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          display: playerLoading ? 'none' : 'block',
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
  texts?: PlayerTexts;
}

export const SessionInfo: React.FC<SessionInfoProps> = ({
  data,
  fieldMapping,
  style,
  className,
  texts: userTexts,
}) => {
  const fieldMapper = useMemo(() => new FieldMapper(fieldMapping), [fieldMapping]);
  const texts = useMemo(() => ({ ...DEFAULT_TEXTS, ...userTexts }), [userTexts]);

  const recordingData = useMemo((): RawRecordingData | null => {
    if (!data) return null;
    try {
      const { recording } = unwrapRecording(data);
      return fieldMapper.fromServer(recording as Record<string, any>);
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
    return new Date(timestamp).toLocaleString(undefined, {
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
      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>{texts.sessionInfo}</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '8px 16px',
          fontSize: '14px',
        }}
      >
        <strong>{texts.sessionId}:</strong>
        <span>{recordingData.sessionId}</span>

        <strong>{texts.startTime}:</strong>
        <span>{formatDate(recordingData.startTime)}</span>

        {recordingData.endTime && (
          <>
            <strong>{texts.endTime}:</strong>
            <span>{formatDate(recordingData.endTime)}</span>
          </>
        )}

        {recordingData.duration && (
          <>
            <strong>{texts.duration}:</strong>
            <span>{formatDuration(recordingData.duration)}</span>
          </>
        )}

        <strong>{texts.pageUrl}:</strong>
        <span style={{ wordBreak: 'break-all' }}>{recordingData.url}</span>

        <strong>{texts.screenResolution}:</strong>
        <span>{recordingData.screenResolution}</span>

        {recordingData.viewport && (
          <>
            <strong>{texts.viewportSize}:</strong>
            <span>{`${recordingData.viewport.width}x${recordingData.viewport.height}`}</span>
          </>
        )}

        <strong>{texts.eventCount}:</strong>
        <span>{recordingData.events?.length || 0}</span>

        {recordingData.tags && recordingData.tags.length > 0 && (
          <>
            <strong>{texts.tagCount}:</strong>
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
  showInfo?: boolean;
  texts?: PlayerTexts;
}

export const ReplayPage: React.FC<ReplayPageProps> = ({
  showInfo = true,
  texts,
  ...playerProps
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showInfo && (
        <SessionInfo
          data={playerProps.data}
          fieldMapping={playerProps.fieldMapping}
          style={{ marginBottom: '16px' }}
          texts={texts}
        />
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReplayPlayer {...playerProps} texts={texts} />
      </div>
    </div>
  );
};
