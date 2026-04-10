/**
 * 统一回放路由组件
 *
 * 自动识别录制数据来源（Web / MiniApp），选择对应的回放组件。
 * 支持 SigillumRecording 统一信封格式和旧版裸数据格式。
 */

import React, { useMemo, useEffect, useRef } from 'react';
import type { SigillumRecordingSource } from '../core/types';
import { isSigillumRecording, detectRecordingSourceWithReason } from '../core/types';
import type { ReplayConfig, FieldMapping } from '../types';
import type { ActionChainPlayerProps } from '../replay/ActionChainPlayer';

const LazyReplayPlayer = React.lazy(() =>
  import('./ReplayPlayer').then(mod => ({ default: mod.ReplayPlayer })),
);

const LazyActionChainPlayer = React.lazy(() =>
  import('../replay/ActionChainPlayer').then(mod => ({ default: mod.ActionChainPlayer })),
);

export interface ReplayRouterProps {
  /** 录制数据（统一信封格式或裸数据） */
  data: unknown;
  /** Web 回放的字段映射 */
  fieldMapping?: FieldMapping[];
  /** Web 回放配置 */
  replayConfig?: ReplayConfig;
  /** MiniApp 回放速度 */
  speed?: number;
  /** MiniApp 自动播放 */
  autoPlay?: boolean;
  /** 容器样式 */
  style?: React.CSSProperties;
  /** 容器类名 */
  className?: string;
  /** 无法识别数据格式时的回调 */
  onUnknownFormat?: (data: unknown) => void;
}

export const ReplayRouter: React.FC<ReplayRouterProps> = ({
  data,
  fieldMapping,
  replayConfig,
  speed = 1,
  autoPlay = false,
  style,
  className,
  onUnknownFormat,
}) => {
  const { source, reason } = useMemo(() => {
    if (isSigillumRecording(data)) {
      const s = data.source;
      if (s === 'web' || s === 'miniapp') return { source: s, reason: undefined };
      return { source: null as SigillumRecordingSource | null, reason: `Invalid source in SigillumRecording: "${s}"` };
    }
    return detectRecordingSourceWithReason(data);
  }, [data]);

  if (!data) {
    return <div style={style} className={className}>No recording data</div>;
  }

  if (source === 'web') {
    const raw = isSigillumRecording(data) ? data.recording : data;
    return (
      <React.Suspense fallback={<div style={style}>Loading web player...</div>}>
        <LazyReplayPlayer
          data={raw as Record<string, any>}
          fieldMapping={fieldMapping}
          config={replayConfig}
          style={style}
          className={className}
        />
      </React.Suspense>
    );
  }

  if (source === 'miniapp') {
    return (
      <React.Suspense fallback={<div style={style}>Loading action chain player...</div>}>
        <LazyActionChainPlayer
          data={data as ActionChainPlayerProps['data']}
          speed={speed}
          autoPlay={autoPlay}
          style={style}
        />
      </React.Suspense>
    );
  }

  return <UnknownFormatFallback data={data} reason={reason} onUnknownFormat={onUnknownFormat} style={style} className={className} />;
};

const UnknownFormatFallback: React.FC<{
  data: unknown;
  reason?: string;
  onUnknownFormat?: (data: unknown) => void;
  style?: React.CSSProperties;
  className?: string;
}> = ({ data, reason, onUnknownFormat, style, className }) => {
  const callbackRef = useRef(onUnknownFormat);
  useEffect(() => { callbackRef.current = onUnknownFormat; });

  const notifiedRef = useRef<unknown>(undefined);
  useEffect(() => {
    if (notifiedRef.current !== data) {
      notifiedRef.current = data;
      callbackRef.current?.(data);
    }
  }, [data]);

  return (
    <div style={{ padding: 16, color: '#999', ...style }} className={className}>
      Unable to detect recording format{reason ? `: ${reason}` : ''}.
      Expected a SigillumRecording envelope or a raw recording with an events array.
    </div>
  );
};
