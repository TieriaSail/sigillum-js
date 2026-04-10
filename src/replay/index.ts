/**
 * sigillum-js 回放系统入口
 *
 * import { ActionChainPlayer, buildActionChain } from 'sigillum-js/replay';
 */

// 事件时间轴（纯逻辑播放器）
export { TimelinePlayer } from './TimelinePlayer';
export type { TimelinePlayerOptions, TimelinePlayerStatus } from './TimelinePlayer';

// 语义化行为链（推荐）
export { ActionChainPlayer } from './ActionChainPlayer';
export type { ActionChainPlayerProps } from './ActionChainPlayer';

export {
  buildActionChain,
  renderActionChainHTML,
  getActionChainCSS,
} from './ActionChain';
export type {
  ActionChain,
  ActionNode,
  ActionType,
  ActionTarget,
  ActionPageGroup,
  ActionChainStats,
  BuildActionChainOptions,
} from './ActionChain';

export type {
  TrackEvent,
  MiniAppRawRecordingData,
  MiniAppRecordingSummary,
  ActionRule,
  ActionRuleContext,
  SigillumRecording,
  SigillumRecordingSource,
} from '../core/types';

export {
  isSigillumRecording,
  unwrapRecording,
  detectRecordingSource,
  detectRecordingSourceWithReason,
} from '../core/types';
