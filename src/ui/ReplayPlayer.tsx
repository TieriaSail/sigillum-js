/**
 * 会话回放播放器组件
 * 支持字段映射，可以直接使用后端返回的数据
 */

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
// 回放所需的 rrweb 样式由组件自动注入，用户无需手动 import 任何 CSS。
import type { ReplayPlayerProps, FieldMapping, RawRecordingData } from '../types';
import { FieldMapper } from '../FieldMapper';
import { isBrowser } from '../compatibility';

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
 * rrweb 回放渲染所需的样式（光标、wrapper 定位等）。
 *
 * 背景：rrweb-player 2.0.0/2.0.1 的发布产物存在回归（Replayer 从未实例化，回放白屏，
 * 见 https://github.com/rrweb-io/rrweb/issues/1872），因此 sigillum-js 直接驱动
 * rrweb 核心 Replayer 并自带控制条。这段样式即原 `@rrweb/replay/dist/style.css`，
 * 由组件在挂载时注入到宿主文档，用户无需再手动 import 任何 CSS。
 */
const REPLAY_CSS = `.replayer-wrapper{position:relative}
.replayer-mouse{position:absolute;width:20px;height:20px;transition:left .05s linear,top .05s linear;background-size:contain;background-position:center center;background-repeat:no-repeat;background-image:url('data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9JzMwMHB4JyB3aWR0aD0nMzAwcHgnICBmaWxsPSIjMDAwMDAwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGRhdGEtbmFtZT0iTGF5ZXIgMSIgdmlld0JveD0iMCAwIDUwIDUwIiB4PSIwcHgiIHk9IjBweCI+PHRpdGxlPkRlc2lnbl90bnA8L3RpdGxlPjxwYXRoIGQ9Ik00OC43MSw0Mi45MUwzNC4wOCwyOC4yOSw0NC4zMywxOEExLDEsMCwwLDAsNDQsMTYuMzlMMi4zNSwxLjA2QTEsMSwwLDAsMCwxLjA2LDIuMzVMMTYuMzksNDRhMSwxLDAsMCwwLDEuNjUuMzZMMjguMjksMzQuMDgsNDIuOTEsNDguNzFhMSwxLDAsMCwwLDEuNDEsMGw0LjM4LTQuMzhBMSwxLDAsMCwwLDQ4LjcxLDQyLjkxWm0tNS4wOSwzLjY3TDI5LDMyYTEsMSwwLDAsMC0xLjQxLDBsLTkuODUsOS44NUwzLjY5LDMuNjlsMzguMTIsMTRMMzIsMjcuNThBMSwxLDAsMCwwLDMyLDI5TDQ2LjU5LDQzLjYyWiI+PC9wYXRoPjwvc3ZnPg==');border-color:transparent}
.replayer-mouse::after{content:'';display:inline-block;width:20px;height:20px;background:rgb(73,80,246);border-radius:100%;transform:translate(-50%,-50%);opacity:.3}
.replayer-mouse.active::after{animation:sigillum-click .2s ease-in-out 1}
.replayer-mouse.touch-device{background-image:none;width:70px;height:70px;border-width:4px;border-style:solid;border-radius:100%;margin-left:-37px;margin-top:-37px;border-color:rgba(73,80,246,0);transition:left 0s linear,top 0s linear,border-color .2s ease-in-out}
.replayer-mouse.touch-device.touch-active{border-color:rgba(73,80,246,1);transition:left .25s linear,top .25s linear,border-color .2s ease-in-out}
.replayer-mouse.touch-device::after{opacity:0}
.replayer-mouse.touch-device.active::after{animation:sigillum-touch-click .2s ease-in-out 1}
.replayer-mouse-tail{position:absolute;pointer-events:none}
@keyframes sigillum-click{0%{opacity:.3;width:20px;height:20px}50%{opacity:.5;width:10px;height:10px}}
@keyframes sigillum-touch-click{0%{opacity:0;width:20px;height:20px}50%{opacity:.5;width:10px;height:10px}}`;

const REPLAY_STYLE_ID = 'sigillum-rrweb-replay-style';

/** 把回放样式注入宿主文档（只注入一次）。 */
function ensureReplayStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(REPLAY_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = REPLAY_STYLE_ID;
  style.textContent = REPLAY_CSS;
  document.head.appendChild(style);
}

/** 毫秒格式化为 m:ss。 */
function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const SPEED_OPTIONS = [1, 2, 4, 8];

/**
 * ReplayPlayer 组件
 *
 * 直接驱动 rrweb 核心 `Replayer`（不依赖已损坏的 rrweb-player 2.0.x），
 * 自带轻量控制条：播放/暂停、进度拖拽、时间显示、倍速切换。
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const recordedSizeRef = useRef<{ width: number; height: number } | null>(null);

  const [playerLoading, setPlayerLoading] = useState(true);
  const [playerError, setPlayerError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [speed, setSpeed] = useState(config.speed || 1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [progressHover, setProgressHover] = useState(false);

  const texts = { ...DEFAULT_TEXTS, ...userTexts };

  const fieldMapper = useMemo(() => new FieldMapper(fieldMapping), [fieldMapping]);

  const recordingData = useMemo((): RawRecordingData | null => {
    if (!data) return null;
    try {
      return fieldMapper.fromServer(data);
    } catch {
      return null;
    }
  }, [data, fieldMapper]);

  const showController = config.showController !== false;

  // 根据容器与录制视口尺寸，把回放 wrapper 等比缩放居中。
  const applyScale = useCallback(() => {
    const replayer = replayerRef.current;
    const frame = frameRef.current;
    const size = recordedSizeRef.current;
    if (!replayer || !frame || !size || !replayer.wrapper) return;
    const cw = frame.clientWidth;
    const ch = frame.clientHeight;
    if (!cw || !ch || !size.width || !size.height) return;
    const scale = Math.min(cw / size.width, ch / size.height);
    const wrapper = replayer.wrapper as HTMLElement;
    wrapper.style.position = 'absolute';
    wrapper.style.transformOrigin = 'top left';
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.left = `${(cw - size.width * scale) / 2}px`;
    wrapper.style.top = `${(ch - size.height * scale) / 2}px`;
  }, []);

  useEffect(() => {
    if (!isBrowser() || !frameRef.current || !recordingData || !recordingData.events?.length) {
      setPlayerLoading(false);
      return;
    }

    let cancelled = false;
    const frame = frameRef.current;
    let resizeObserver: ResizeObserver | null = null;

    setPlayerLoading(true);
    setPlayerError(false);

    import('rrweb')
      .then((mod) => {
        if (cancelled || !frameRef.current) return;
        const Replayer = (mod as any).Replayer;
        if (typeof Replayer !== 'function') {
          throw new Error('rrweb Replayer not found');
        }

        ensureReplayStyles();
        frame.innerHTML = '';

        const {
          autoPlay, skipInactive,
          UNSAFE_replayCanvas, pauseAnimation, mouseTail,
          useVirtualDom, liveMode, triggerFocus,
          insertStyleRules, unpackFn,
          replayerConfig,
        } = config;

        const replayerOptions: Record<string, unknown> = {
          ...(replayerConfig ?? {}),
          ...(UNSAFE_replayCanvas !== undefined && { UNSAFE_replayCanvas }),
          ...(pauseAnimation !== undefined && { pauseAnimation }),
          ...(mouseTail !== undefined && { mouseTail }),
          ...(useVirtualDom !== undefined && { useVirtualDom }),
          ...(liveMode !== undefined && { liveMode }),
          ...(triggerFocus !== undefined && { triggerFocus }),
          ...(insertStyleRules !== undefined && { insertStyleRules }),
          ...(unpackFn !== undefined && { unpackFn }),
          speed: config.speed || 1,
          skipInactive: skipInactive !== false,
          root: frame,
        };

        const replayer = new Replayer(recordingData.events, replayerOptions);
        replayerRef.current = replayer;

        const meta = replayer.getMetaData();
        setTotalTime(meta.totalTime || 0);
        setCurrentTime(0);
        setSpeed(config.speed || 1);

        // 初始视口尺寸：优先取 resize 事件回报，回退到录制数据 viewport。
        recordedSizeRef.current = recordingData.viewport
          ? { width: recordingData.viewport.width, height: recordingData.viewport.height }
          : { width: 1280, height: 720 };

        replayer.on('resize', (payload: any) => {
          if (payload && payload.width && payload.height) {
            recordedSizeRef.current = { width: payload.width, height: payload.height };
          }
          applyScale();
        });
        replayer.on('start', () => { setPlaying(true); onPlay?.(); });
        replayer.on('resume', () => { setPlaying(true); onPlay?.(); });
        replayer.on('pause', () => { setPlaying(false); onPause?.(); });
        replayer.on('finish', () => {
          setPlaying(false);
          setCurrentTime(meta.totalTime || 0);
          onFinish?.();
        });

        applyScale();
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => applyScale());
          resizeObserver.observe(frame);
        }

        setPlayerLoading(false);

        if (autoPlay) {
          replayer.play();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerLoading(false);
          setPlayerError(true);
        }
      });

    return () => {
      cancelled = true;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (replayerRef.current) {
        try { replayerRef.current.destroy?.(); } catch { /* */ }
        replayerRef.current = null;
      }
      if (frame) frame.innerHTML = '';
      setPlaying(false);
    };
  }, [recordingData, config, applyScale, onPlay, onPause, onFinish]);

  // 播放中用 rAF 刷新进度；getCurrentTime() 在首次 play() 前会返回巨大负值，统一 clamp 到 [0, totalTime]。
  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const tick = () => {
      const replayer = replayerRef.current;
      if (replayer) {
        const t = clamp(replayer.getCurrentTime(), 0, totalTime || 0);
        setCurrentTime(t);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing, totalTime]);

  const handleToggle = useCallback(() => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    if (playing) {
      replayer.pause();
    } else {
      // 播放结束后再次点击：从头开始。
      if (totalTime > 0 && currentTime >= totalTime) {
        replayer.play(0);
      } else {
        replayer.play(currentTime);
      }
    }
  }, [playing, currentTime, totalTime]);

  const seekTo = useCallback((offset: number) => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    const target = clamp(offset, 0, totalTime || 0);
    setCurrentTime(target);
    if (playing) {
      replayer.play(target);
    } else {
      replayer.pause(target);
    }
  }, [playing, totalTime]);

  const handleProgressPointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!totalTime) return;
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const computeOffset = (clientX: number) => {
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return ratio * totalTime;
    };
    seekTo(computeOffset(e.clientX));

    const onMove = (ev: PointerEvent) => seekTo(computeOffset(ev.clientX));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [totalTime, seekTo]);

  const handleSetSpeed = useCallback((s: number) => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    replayer.setConfig?.({ speed: s });
    setSpeed(s);
    setSpeedMenuOpen(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current;
    if (!el || typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (!recordingData) {
    return (
      <div
        className={className}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100%', height: '100%',
          backgroundColor: '#f5f5f5', color: '#999', ...style,
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
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100%', height: '100%',
          backgroundColor: '#fff3f3', color: '#cc0000', ...style,
        }}
      >
        {texts.error}
      </div>
    );
  }

  const progressRatio = totalTime > 0 ? clamp(currentTime / totalTime, 0, 1) : 0;
  const accent = '#6366f1';
  const trackHeight = progressHover ? 6 : 4;
  const thumbSize = progressHover ? 13 : 0;
  const iconBtn: React.CSSProperties = {
    flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 30, height: 30, padding: 0, border: 'none', background: 'transparent',
    color: '#fff', cursor: 'pointer', borderRadius: 6,
  };

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#1c1c1f',
        ...style,
      }}
    >
      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', backgroundColor: '#1c1c1f' }}>
        {playerLoading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
            {texts.loading}
          </div>
        )}
        <div
          ref={frameRef}
          style={{ width: '100%', height: '100%', visibility: playerLoading ? 'hidden' : 'visible' }}
        />
      </div>

      {showController && !playerLoading && (
        <div
          style={{
            position: 'relative',
            padding: '10px 14px 8px',
            backgroundColor: '#18181b',
            userSelect: 'none',
            fontSize: 13,
            color: '#fff',
            boxShadow: '0 -1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {/* 全宽进度条 */}
          <div
            onPointerDown={handleProgressPointer}
            onMouseEnter={() => setProgressHover(true)}
            onMouseLeave={() => setProgressHover(false)}
            style={{
              position: 'relative', height: 14, display: 'flex', alignItems: 'center',
              cursor: 'pointer', marginBottom: 4,
            }}
          >
            <div
              style={{
                position: 'relative', width: '100%', height: trackHeight,
                borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)',
                transition: 'height 0.12s ease',
              }}
            >
              <div
                style={{
                  position: 'absolute', left: 0, top: 0, height: '100%',
                  width: `${progressRatio * 100}%`, borderRadius: 3, backgroundColor: accent,
                }}
              />
              <div
                style={{
                  position: 'absolute', top: '50%', left: `${progressRatio * 100}%`,
                  width: thumbSize, height: thumbSize, borderRadius: '50%', backgroundColor: '#fff',
                  transform: 'translate(-50%, -50%)', transition: 'width 0.12s ease, height 0.12s ease',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                }}
              />
            </div>
          </div>

          {/* 控制行 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={handleToggle}
              aria-label={playing ? 'Pause' : 'Play'}
              style={iconBtn}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {playing ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <rect x="3" y="2" width="3.6" height="12" rx="1" />
                  <rect x="9.4" y="2" width="3.6" height="12" rx="1" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M4 2.5l9 5.5-9 5.5z" />
                </svg>
              )}
            </button>

            <span style={{ flex: '0 0 auto', fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.3 }}>
              {formatTime(currentTime)} <span style={{ color: 'rgba(255,255,255,0.45)' }}>/ {formatTime(totalTime)}</span>
            </span>

            <div style={{ flex: '1 1 auto' }} />

            {/* 倍速菜单 */}
            <div style={{ position: 'relative', flex: '0 0 auto' }}>
              <button
                type="button"
                onClick={() => setSpeedMenuOpen((v) => !v)}
                aria-label="Playback speed"
                style={{
                  border: 'none', background: speedMenuOpen ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: '#fff', cursor: 'pointer', borderRadius: 6,
                  padding: '5px 8px', fontSize: 12.5, fontVariantNumeric: 'tabular-nums',
                  display: 'flex', alignItems: 'center', gap: 3,
                }}
              >
                {speed}x
                <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" style={{ opacity: 0.7 }}>
                  <path d="M1 3l4 4 4-4z" />
                </svg>
              </button>
              {speedMenuOpen && (
                <>
                  <div
                    onClick={() => setSpeedMenuOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 1 }}
                  />
                  <div
                    style={{
                      position: 'absolute', bottom: 'calc(100% + 6px)', right: 0, zIndex: 2,
                      backgroundColor: '#26262b', borderRadius: 8, padding: 4, minWidth: 64,
                      boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
                    }}
                  >
                    {SPEED_OPTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleSetSpeed(s)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          border: 'none', cursor: 'pointer', borderRadius: 5,
                          padding: '6px 10px', fontSize: 12.5,
                          backgroundColor: speed === s ? accent : 'transparent',
                          color: speed === s ? '#fff' : 'rgba(255,255,255,0.85)',
                        }}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 全屏 */}
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={iconBtn}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {isFullscreen ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
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
  const texts = { ...DEFAULT_TEXTS, ...userTexts };

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
