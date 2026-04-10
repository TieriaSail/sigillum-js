/**
 * 语义化行为链回放组件
 *
 * 以时间轴形式展示用户的完整操作链，按页面分组。
 * 支持自动播放（逐条高亮）和手动浏览。
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { MiniAppRawRecordingData, SigillumRecording } from '../core/types';
import { unwrapRecording } from '../core/types';
import {
  buildActionChain,
  getActionChainCSS,
} from './ActionChain';
import type { ActionNode } from './ActionChain';

export interface ActionChainPlayerProps {
  /** 接受统一信封格式或裸 MiniAppRawRecordingData（向后兼容） */
  data: SigillumRecording<MiniAppRawRecordingData> | MiniAppRawRecordingData;
  style?: React.CSSProperties;
  speed?: number;
  autoPlay?: boolean;
  onActionHighlight?: (action: ActionNode, index: number) => void;
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

const INTERACTION_TYPES = new Set([
  'tap', 'longpress', 'input_focus', 'input_change', 'input_blur', 'swipe',
]);
const NAV_TYPES = new Set(['page_enter', 'page_redirect', 'page_leave']);

function getRowBackground(type: string, isActive: boolean): string {
  if (isActive) return '#e6f7ff';
  if (type === 'error') return '#fff5f5';
  if (INTERACTION_TYPES.has(type)) return '#fffbe6';
  if (NAV_TYPES.has(type)) return '#f0f5ff';
  if (type.startsWith('touch_') || type.startsWith('drag_')) return '#f3e5f5';
  return 'transparent';
}

export const ActionChainPlayer: React.FC<ActionChainPlayerProps> = ({
  data: rawData,
  style,
  speed: initialSpeed = 1,
  autoPlay = false,
  onActionHighlight,
}) => {
  const data = useMemo<MiniAppRawRecordingData>(
    () => unwrapRecording(rawData).recording as MiniAppRawRecordingData,
    [rawData],
  );
  const chain = useMemo(() => buildActionChain(data), [data]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(initialSpeed);
  const [currentTime, setCurrentTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 组件卸载时清理定时器，防止泄漏
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flatActions = useMemo(() => chain.actions, [chain]);

  const flatIndexMap = useMemo(() => {
    const map = new Map<ActionNode, number>();
    flatActions.forEach((action, i) => map.set(action, i));
    return map;
  }, [flatActions]);

  const onActionHighlightRef = useRef(onActionHighlight);
  useEffect(() => {
    onActionHighlightRef.current = onActionHighlight;
  });

  // 同步外部 speed prop 到内部 state
  useEffect(() => {
    setSpeed(initialSpeed);
  }, [initialSpeed]);

  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  });

  const playNext = useCallback((fromIndex: number) => {
    if (fromIndex >= flatActions.length) {
      setPlaying(false);
      return;
    }

    setActiveIndex(fromIndex);
    setCurrentTime(flatActions[fromIndex].relativeTime);
    onActionHighlightRef.current?.(flatActions[fromIndex], fromIndex);

    const el = scrollRef.current?.querySelector(`[data-action-idx="${fromIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    if (fromIndex < flatActions.length - 1) {
      const gap = flatActions[fromIndex + 1].relativeTime - flatActions[fromIndex].relativeTime;
      const safeSpeed = Math.max(0.1, speedRef.current);
      const delay = Math.max(gap / safeSpeed, 80);
      timerRef.current = setTimeout(() => playNext(fromIndex + 1), delay);
    } else {
      setPlaying(false);
    }
  }, [flatActions]);

  const handlePlayPause = useCallback(() => {
    if (playing) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setPlaying(false);
    } else {
      setPlaying(true);
      const startFrom = activeIndex >= flatActions.length - 1 ? 0 : activeIndex + 1;
      playNext(startFrom);
    }
  }, [playing, activeIndex, flatActions.length, playNext]);

  const playNextRef = useRef(playNext);
  useEffect(() => {
    playNextRef.current = playNext;
  });

  // data 变化时重置播放状态
  const dataRef = useRef(data);
  useEffect(() => {
    if (dataRef.current !== data) {
      dataRef.current = data;
      setActiveIndex(-1);
      setCurrentTime(0);
      setPlaying(false);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [data]);

  // autoPlay 变化时控制播放状态
  useEffect(() => {
    if (autoPlay && flatActions.length > 0) {
      setPlaying(true);
      playNextRef.current(0);
    } else if (!autoPlay) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setPlaying(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [autoPlay, data, flatActions.length]);

  const handleActionClick = useCallback((idx: number) => {
    if (playing) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setPlaying(false);
    }
    setActiveIndex(idx);
    setCurrentTime(flatActions[idx].relativeTime);
    onActionHighlightRef.current?.(flatActions[idx], idx);
  }, [playing, flatActions]);

  const rangeMax = flatActions.length > 0 ? flatActions.length - 1 : 0;

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', fontSize: 13, ...style }}>
      <style>{getActionChainCSS()}</style>

      {/* Header */}
      <div style={{
        padding: '12px 16px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: '#fff',
        borderRadius: '8px 8px 0 0',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>用户行为链</div>
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
          {chain.platform} · {chain.sessionId.slice(0, 16)}… · {formatTime(chain.duration)}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{
        display: 'flex', gap: 12, flexWrap: 'wrap',
        padding: '8px 16px', background: '#fafafa',
        borderBottom: '1px solid #e8e8e8', fontSize: 12, color: '#666',
      }}>
        <span>⏱ {formatTime(chain.duration)}</span>
        <span>👆 {chain.stats.tapCount} 点击</span>
        {chain.stats.inputCount > 0 && <span>⌨️ {chain.stats.inputCount} 输入</span>}
        {chain.stats.scrollCount > 0 && <span>📜 {chain.stats.scrollCount} 滚动</span>}
        {chain.stats.swipeCount > 0 && <span>👈 {chain.stats.swipeCount} 滑动</span>}
        {chain.stats.touchCount > 0 && <span>🔵 {chain.stats.touchCount} 触摸</span>}
        {chain.stats.dragCount > 0 && <span>✊ {chain.stats.dragCount} 拖拽</span>}
        <span>📄 {chain.stats.pageCount} 页面</span>
        {chain.stats.networkCount > 0 && <span>📡 {chain.stats.networkCount} 请求</span>}
        {chain.stats.errorCount > 0 && <span style={{ color: '#d32f2f' }}>❌ {chain.stats.errorCount} 错误</span>}
        {chain.stats.maxScrollDepth > 0 && <span>📊 最深 {chain.stats.maxScrollDepth}%</span>}
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderBottom: '1px solid #e8e8e8',
      }}>
        <button
          onClick={handlePlayPause}
          aria-label={playing ? '暂停' : '播放'}
          style={{
            width: 32, height: 32, border: '1px solid #ddd', borderRadius: 4,
            background: '#fff', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 14,
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <span style={{ minWidth: 45, textAlign: 'center', color: '#666', fontSize: 12 }}>
          {formatTime(currentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={rangeMax}
          value={activeIndex >= 0 ? activeIndex : 0}
          onChange={(e) => handleActionClick(Number(e.target.value))}
          aria-label="行为链进度"
          style={{ flex: 1 }}
          disabled={flatActions.length === 0}
        />
        <span style={{ minWidth: 45, textAlign: 'center', color: '#666', fontSize: 12 }}>
          {formatTime(chain.duration)}
        </span>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          aria-label="播放速度"
          style={{ border: '1px solid #ddd', borderRadius: 4, padding: '2px 4px', background: '#fff', fontSize: 12 }}
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
          <option value={8}>8x</option>
        </select>
      </div>

      {/* Action list */}
      <div
        ref={scrollRef}
        className="sigillum-action-chain"
        style={{ maxHeight: 600, overflowY: 'auto', background: '#fff' }}
      >
        {chain.pageGroups.map((group, gi) => (
          <div key={gi} style={{ marginBottom: 2 }}>
            <div style={{
              padding: '8px 12px', background: '#f0f5ff',
              borderLeft: '3px solid #2196f3',
              fontSize: 12, fontWeight: 600, color: '#1565c0',
              position: 'sticky', top: 0, zIndex: 5,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📄 {group.page}</span>
                <span style={{ fontWeight: 400, color: '#90a4ae' }}>
                  {group.leaveTime ? formatTime(group.leaveTime - group.enterTime) : '…'} · {group.actions.length} 操作
                  {group.scrollDepth != null ? ` · 深度 ${group.scrollDepth}%` : ''}
                </span>
              </div>
              {group.scrollDepth != null && (
                <div style={{ height: 3, background: '#e0e0e0', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${group.scrollDepth}%`, background: '#00897b', borderRadius: 2 }} />
                </div>
              )}
            </div>
            {group.actions.map((action) => {
              const flatIdx = flatIndexMap.get(action) ?? -1;
              const isActive = flatIdx === activeIndex;

              return (
                <div
                  key={`${gi}-${flatIdx}`}
                  data-action-idx={flatIdx}
                  onClick={() => handleActionClick(flatIdx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleActionClick(flatIdx); }}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '6px 12px',
                    borderLeft: `3px solid ${action.color}`,
                    background: getRowBackground(action.type, isActive),
                    fontSize: 13, lineHeight: 1.6, cursor: 'pointer',
                    borderBottom: '1px solid #f5f5f5',
                    outline: isActive ? '2px solid #1890ff' : 'none',
                    outlineOffset: -2,
                    transition: 'background 0.15s',
                  }}
                >
                  <span style={{
                    flexShrink: 0, minWidth: 36, color: '#999',
                    fontSize: 11, fontVariantNumeric: 'tabular-nums', paddingTop: 2,
                  }}>
                    {formatTime(action.relativeTime)}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 14 }}>{action.icon}</span>
                  <span style={{ color: '#333', wordBreak: 'break-all' }}>{action.description}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
