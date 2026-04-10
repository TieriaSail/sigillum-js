/**
 * 语义化行为链
 *
 * 将原始 TrackEvent[] 转化为人类可读的行为链——
 * 不再试图还原 UI，而是直接讲述"用户做了什么"。
 *
 * 支持三档监控预设（lite / standard / full）和自定义 ActionRule。
 */

import type { TrackEvent, MiniAppRawRecordingData, ActionRule, ActionRuleContext } from '../core/types';

// ==================== 行为链节点类型 ====================

export type ActionType =
  | 'session_start'
  | 'session_end'
  | 'page_enter'
  | 'page_leave'
  | 'page_redirect'
  | 'tap'
  | 'longpress'
  | 'input_focus'
  | 'input_change'
  | 'input_blur'
  | 'scroll'
  | 'scroll_depth'
  | 'swipe'
  | 'touch_start'
  | 'touch_move'
  | 'touch_end'
  | 'drag_start'
  | 'drag_move'
  | 'drag_end'
  | 'app_hide'
  | 'app_show'
  | 'network_request'
  | 'error'
  | 'identify'
  | 'custom';

export interface ActionTarget {
  tag?: string;
  id?: string;
  text?: string;
  className?: string;
  src?: string;
  dataset?: Record<string, string>;
}

export interface ActionNode {
  type: ActionType;
  timestamp: number;
  relativeTime: number;
  page: string;
  description: string;
  target?: ActionTarget;
  detail?: Record<string, unknown>;
  icon: string;
  color: string;
}

export interface ActionChain {
  sessionId: string;
  platform: string;
  startTime: number;
  endTime: number;
  duration: number;
  actions: ActionNode[];
  pageGroups: ActionPageGroup[];
  stats: ActionChainStats;
}

export interface ActionPageGroup {
  page: string;
  enterTime: number;
  leaveTime?: number;
  actions: ActionNode[];
  scrollDepth?: number;
}

export interface ActionChainStats {
  totalActions: number;
  tapCount: number;
  inputCount: number;
  scrollCount: number;
  swipeCount: number;
  touchCount: number;
  dragCount: number;
  pageCount: number;
  networkCount: number;
  errorCount: number;
  maxScrollDepth: number;
  avgPageDuration: number;
  duration: number;
}

export interface BuildActionChainOptions {
  rules?: ActionRule[];
}

// ==================== 行为链构建器 ====================

const ICONS: Record<ActionType, string> = {
  session_start: '🟢',
  session_end: '🔴',
  page_enter: '📄',
  page_leave: '📄',
  page_redirect: '🔀',
  tap: '👆',
  longpress: '👇',
  input_focus: '⌨️',
  input_change: '⌨️',
  input_blur: '⌨️',
  scroll: '📜',
  scroll_depth: '📊',
  swipe: '👈',
  touch_start: '🔵',
  touch_move: '🔵',
  touch_end: '🔵',
  drag_start: '✊',
  drag_move: '✊',
  drag_end: '✊',
  app_hide: '📴',
  app_show: '📲',
  network_request: '📡',
  error: '❌',
  identify: '👤',
  custom: '⚙️',
};

const COLORS: Record<ActionType, string> = {
  session_start: '#4caf50',
  session_end: '#f44336',
  page_enter: '#2196f3',
  page_leave: '#90a4ae',
  page_redirect: '#7c4dff',
  tap: '#ff5252',
  longpress: '#ff7043',
  input_focus: '#ffc107',
  input_change: '#ff9800',
  input_blur: '#bdbdbd',
  scroll: '#4285f4',
  scroll_depth: '#00897b',
  swipe: '#7c4dff',
  touch_start: '#42a5f5',
  touch_move: '#64b5f6',
  touch_end: '#1e88e5',
  drag_start: '#8d6e63',
  drag_move: '#a1887f',
  drag_end: '#6d4c41',
  app_hide: '#78909c',
  app_show: '#26a69a',
  network_request: '#00bcd4',
  error: '#d32f2f',
  identify: '#8bc34a',
  custom: '#9e9e9e',
};

const DIRECTION_ARROWS: Record<string, string> = {
  up: '↑', down: '↓', left: '←', right: '→',
};

function formatTarget(target?: ActionTarget): string {
  if (!target) return '';
  const parts: string[] = [];
  if (target.tag) parts.push(`<${target.tag}`);
  if (target.id) parts.push(`#${target.id}`);
  if (parts.length > 0 && target.tag) parts.push('>');
  if (target.text) {
    const t = target.text.trim();
    if (t) parts.push(`"${t.length > 30 ? t.slice(0, 30) + '…' : t}"`);
  }
  if (target.src) {
    const s = target.src.length > 40 ? '…' + target.src.slice(-35) : target.src;
    parts.push(`(src=${s})`);
  }
  return parts.join('');
}

function formatPage(path: string): string {
  return path.replace(/^\//, '');
}

function formatCoord(x: unknown, y: unknown): string {
  if (x == null || y == null) return '';
  return ` (${Math.round(x as number)}, ${Math.round(y as number)})`;
}

/**
 * 将原始录制数据转化为语义化行为链
 */
export function buildActionChain(
  data: MiniAppRawRecordingData,
  options?: BuildActionChainOptions,
): ActionChain {
  const events = [...data.events].sort((a, b) => a.timestamp - b.timestamp);
  const startTime = events.length > 0 ? events[0].timestamp : data.startTime;
  const actions: ActionNode[] = [];
  let currentPage = '';
  let lastInputTarget = '';
  let lastInputValue = '';
  const customRules = options?.rules ?? [];

  const stats: ActionChainStats = {
    totalActions: 0,
    tapCount: 0,
    inputCount: 0,
    scrollCount: 0,
    swipeCount: 0,
    touchCount: 0,
    dragCount: 0,
    pageCount: 0,
    networkCount: 0,
    errorCount: 0,
    maxScrollDepth: 0,
    avgPageDuration: 0,
    duration: data.duration,
  };

  for (const event of events) {
    const d = event.data as any;
    const relTime = event.timestamp - startTime;
    const page = d?.page || currentPage;

    const ruleCtx: ActionRuleContext = { currentPage: page, sessionStartTime: startTime };
    let handledByRule = false;
    for (const rule of customRules) {
      if (!rule.eventTypes.includes(event.type)) continue;
      if (rule.match && !rule.match(event)) continue;
      if (rule.transform) {
        const result = rule.transform(event, ruleCtx);
        if (result) {
          const actionType = (rule.name in ICONS ? rule.name : 'custom') as ActionType;
          actions.push(makeAction(actionType, event, relTime, page, result.description, result.target as ActionTarget | undefined, result.detail));
          handledByRule = true;
          break;
        }
      }
    }
    if (handledByRule) continue;

    switch (event.type) {
      case 'session_start': {
        actions.push(makeAction('session_start', event, relTime, page,
          `会话开始 (${d?.platform || '?'}, ${d?.sdkVersion || '?'})`,
        ));
        break;
      }
      case 'session_end': {
        actions.push(makeAction('session_end', event, relTime, page,
          `会话结束 (${d?.reason || 'unknown'})`,
        ));
        break;
      }
      case 'page_enter': {
        const pagePath = formatPage(d?.page || '');
        const from = d?.from ? formatPage(d.from) : '';
        if (from && from !== pagePath) {
          actions.push(makeAction('page_redirect', event, relTime, pagePath,
            `跳转 ${from} → ${pagePath}`,
            undefined,
            { from, to: pagePath, query: d?.query },
          ));
        } else {
          actions.push(makeAction('page_enter', event, relTime, pagePath,
            `进入页面 ${pagePath}${d?.query ? ' ?' + new URLSearchParams(d.query).toString() : ''}`,
            undefined,
            { query: d?.query },
          ));
        }
        currentPage = pagePath;
        stats.pageCount++;
        break;
      }
      case 'page_leave': {
        actions.push(makeAction('page_leave', event, relTime, page,
          `离开页面 ${formatPage(d?.page || page)}`,
        ));
        break;
      }
      case 'tap':
      case 'longpress': {
        const target = extractTarget(d?.target);
        const type = event.type === 'longpress' ? 'longpress' : 'tap';
        const verb = type === 'longpress' ? '长按' : '点击';
        const coord = formatCoord(d?.x, d?.y);
        actions.push(makeAction(type, event, relTime, page,
          `${verb} ${formatTarget(target) || '(未知元素)'}${coord}`,
          target,
          { x: d?.x, y: d?.y },
        ));
        stats.tapCount++;
        break;
      }
      case 'input_focus': {
        const target = extractTarget(d?.target);
        lastInputTarget = target?.id || target?.tag || '';
        lastInputValue = '';
        actions.push(makeAction('input_focus', event, relTime, page,
          `聚焦 ${formatTarget(target) || '输入框'}`,
          target,
        ));
        break;
      }
      case 'input': {
        const target = extractTarget(d?.target);
        const value = d?.value ?? '';
        const targetKey = target?.id || target?.tag || '';
        if (targetKey === lastInputTarget && lastInputValue !== '') {
          const lastAction = actions[actions.length - 1];
          if (lastAction?.type === 'input_change') {
            lastAction.description = `输入 "${maskIfNeeded(value)}"`;
            lastAction.detail = { ...lastAction.detail, value };
            lastAction.timestamp = event.timestamp;
            lastAction.relativeTime = relTime;
            break;
          }
        }
        lastInputTarget = targetKey;
        lastInputValue = value;
        actions.push(makeAction('input_change', event, relTime, page,
          `输入 "${maskIfNeeded(value)}"`,
          target,
          { value },
        ));
        stats.inputCount++;
        break;
      }
      case 'input_blur': {
        const target = extractTarget(d?.target);
        actions.push(makeAction('input_blur', event, relTime, page,
          `失焦 ${formatTarget(target) || '输入框'}`,
          target,
        ));
        lastInputTarget = '';
        lastInputValue = '';
        break;
      }
      case 'scroll': {
        const last = actions[actions.length - 1];
        const arrow = DIRECTION_ARROWS[d?.direction] ?? '↕';
        const depthStr = d?.scrollHeight && d?.viewportHeight
          ? ` ${Math.min(100, Math.round(((d.scrollTop + d.viewportHeight) / d.scrollHeight) * 100))}%`
          : '';
        if (last?.type === 'scroll' && last.page === page) {
          last.description = `滚动 ${arrow}${depthStr} scrollTop=${d?.scrollTop ?? 0}`;
          last.detail = { ...last.detail, scrollTop: d?.scrollTop, scrollLeft: d?.scrollLeft, direction: d?.direction };
          last.timestamp = event.timestamp;
          last.relativeTime = relTime;
          break;
        }
        actions.push(makeAction('scroll', event, relTime, page,
          `滚动 ${arrow}${depthStr} scrollTop=${d?.scrollTop ?? 0}`,
          undefined,
          { scrollTop: d?.scrollTop, scrollLeft: d?.scrollLeft, direction: d?.direction },
        ));
        stats.scrollCount++;
        break;
      }
      case 'scroll_depth': {
        const pct = d?.maxDepthPercent ?? 0;
        if (pct > stats.maxScrollDepth) stats.maxScrollDepth = pct;
        actions.push(makeAction('scroll_depth', event, relTime, page,
          `页面滚动深度 ${pct}%`,
          undefined,
          { maxScrollTop: d?.maxScrollTop, maxDepthPercent: pct, scrollHeight: d?.scrollHeight, viewportHeight: d?.viewportHeight },
        ));
        break;
      }
      case 'swipe': {
        const arrow = DIRECTION_ARROWS[d?.direction] ?? '?';
        const distStr = d?.distance ? ` 距离 ${d.distance}px` : '';
        const velStr = d?.velocity ? ` 速度 ${d.velocity}px/ms` : '';
        const durStr = d?.duration ? ` ${d.duration}ms` : '';
        actions.push(makeAction('swipe', event, relTime, page,
          `滑动 ${arrow}${distStr}${velStr}${durStr}`,
          undefined,
          { direction: d?.direction, startX: d?.startX, startY: d?.startY, endX: d?.endX, endY: d?.endY, velocity: d?.velocity, distance: d?.distance, duration: d?.duration },
        ));
        stats.swipeCount++;
        break;
      }
      case 'touch_start': {
        const target = extractTarget(d?.target);
        actions.push(makeAction('touch_start', event, relTime, page,
          `触摸开始${formatCoord(d?.x, d?.y)}${d?.touchCount > 1 ? ` ${d.touchCount}指` : ''}`,
          target,
          { x: d?.x, y: d?.y, touchCount: d?.touchCount },
        ));
        stats.touchCount++;
        break;
      }
      case 'touch_move': {
        const last = actions[actions.length - 1];
        if (last?.type === 'touch_move' && last.page === page) {
          const count = ((last.detail?.sampleCount as number) ?? 1) + 1;
          last.description = `触摸移动 ${formatCoord(last.detail?.startX, last.detail?.startY).trim()} → ${formatCoord(d?.x, d?.y).trim()} ${count} 个采样点`;
          last.detail = { ...last.detail, endX: d?.x, endY: d?.y, sampleCount: count };
          last.timestamp = event.timestamp;
          last.relativeTime = relTime;
          break;
        }
        actions.push(makeAction('touch_move', event, relTime, page,
          `触摸移动${formatCoord(d?.x, d?.y)}`,
          extractTarget(d?.target),
          { startX: d?.x, startY: d?.y, endX: d?.x, endY: d?.y, sampleCount: 1 },
        ));
        break;
      }
      case 'touch_end': {
        actions.push(makeAction('touch_end', event, relTime, page,
          `触摸结束${formatCoord(d?.x, d?.y)}`,
          extractTarget(d?.target),
          { x: d?.x, y: d?.y },
        ));
        break;
      }
      case 'drag_start': {
        const target = extractTarget(d?.target);
        actions.push(makeAction('drag_start', event, relTime, page,
          `拖拽开始 ${formatTarget(target) || ''}${formatCoord(d?.x, d?.y)}`,
          target,
          { x: d?.x, y: d?.y },
        ));
        stats.dragCount++;
        break;
      }
      case 'drag_move': {
        const last = actions[actions.length - 1];
        if ((last?.type === 'drag_move' || last?.type === 'drag_start') && last.page === page) {
          const startX = last.detail?.startX ?? last.detail?.x;
          const startY = last.detail?.startY ?? last.detail?.y;
          if (last.type === 'drag_move') {
            last.description = `拖拽中 ${formatCoord(startX, startY).trim()} → ${formatCoord(d?.x, d?.y).trim()}`;
            last.detail = { ...last.detail, endX: d?.x, endY: d?.y };
            last.timestamp = event.timestamp;
            last.relativeTime = relTime;
            break;
          }
        }
        actions.push(makeAction('drag_move', event, relTime, page,
          `拖拽中${formatCoord(d?.x, d?.y)}`,
          extractTarget(d?.target),
          { startX: d?.x, startY: d?.y, endX: d?.x, endY: d?.y },
        ));
        break;
      }
      case 'drag_end': {
        const target = extractTarget(d?.target);
        actions.push(makeAction('drag_end', event, relTime, page,
          `拖拽结束${formatCoord(d?.x, d?.y)}`,
          target,
          { x: d?.x, y: d?.y },
        ));
        break;
      }
      case 'network_request': {
        const method = (d?.method || 'GET').toUpperCase();
        const url = d?.url || '';
        const shortUrl = url.length > 50 ? url.slice(0, 47) + '...' : url;
        const status = d?.statusCode ? ` → ${d.statusCode}` : '';
        const dur = d?.duration ? ` (${d.duration}ms)` : '';
        actions.push(makeAction('network_request', event, relTime, page,
          `${method} ${shortUrl}${status}${dur}`,
          undefined,
          { url, method, statusCode: d?.statusCode, duration: d?.duration, success: d?.success },
        ));
        stats.networkCount++;
        break;
      }
      case 'error': {
        actions.push(makeAction('error', event, relTime, page,
          `错误: ${(d?.message || '').slice(0, 80)}`,
          undefined,
          { message: d?.message, stack: d?.stack },
        ));
        stats.errorCount++;
        break;
      }
      case 'identify': {
        actions.push(makeAction('identify', event, relTime, page,
          `用户标识 userId=${d?.userId || '?'}`,
          undefined,
          { userId: d?.userId, traits: d?.traits },
        ));
        break;
      }
      case 'app_hide': {
        actions.push(makeAction('app_hide', event, relTime, page,
          '应用退到后台',
        ));
        break;
      }
      case 'app_show': {
        actions.push(makeAction('app_show', event, relTime, page,
          '应用回到前台',
        ));
        break;
      }
      case 'custom': {
        actions.push(makeAction('custom', event, relTime, page,
          `自定义事件: ${d?.name || '?'}`,
          undefined,
          d?.payload,
        ));
        break;
      }
    }
  }

  stats.totalActions = actions.length;

  const pageGroups = buildPageGroups(actions);

  let totalPageDuration = 0;
  let pagesWithDuration = 0;
  for (const group of pageGroups) {
    if (group.leaveTime) {
      totalPageDuration += group.leaveTime - group.enterTime;
      pagesWithDuration++;
    }
    const depthAction = group.actions.find(a => a.type === 'scroll_depth');
    if (depthAction?.detail?.maxDepthPercent != null) {
      group.scrollDepth = depthAction.detail.maxDepthPercent as number;
    }
  }
  stats.avgPageDuration = pagesWithDuration > 0 ? Math.round(totalPageDuration / pagesWithDuration) : 0;

  return {
    sessionId: data.sessionId,
    platform: data.metadata?.platform || '?',
    startTime,
    endTime: data.endTime,
    duration: data.duration,
    actions,
    pageGroups,
    stats,
  };
}

function makeAction(
  type: ActionType,
  event: TrackEvent,
  relativeTime: number,
  page: string,
  description: string,
  target?: ActionTarget,
  detail?: Record<string, unknown>,
): ActionNode {
  return {
    type,
    timestamp: event.timestamp,
    relativeTime,
    page,
    description,
    target,
    detail,
    icon: ICONS[type] ?? '⚙️',
    color: COLORS[type] ?? '#9e9e9e',
  };
}

function extractTarget(raw: any): ActionTarget | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    tag: raw.tagName || undefined,
    id: raw.id || undefined,
    text: raw.text || undefined,
    className: raw.className || undefined,
    src: raw.src || undefined,
    dataset: raw.dataset || undefined,
  };
}

function maskIfNeeded(value: string): string {
  if (value.length > 40) return value.slice(0, 37) + '…';
  return value;
}

function buildPageGroups(actions: ActionNode[]): ActionPageGroup[] {
  const groups: ActionPageGroup[] = [];
  let current: ActionPageGroup | null = null;

  for (const action of actions) {
    if (action.type === 'page_enter' || action.type === 'page_redirect') {
      if (current) {
        current.leaveTime = action.timestamp;
      }
      current = {
        page: action.page,
        enterTime: action.timestamp,
        actions: [action],
      };
      groups.push(current);
    } else if (current) {
      current.actions.push(action);
      if (action.type === 'page_leave') {
        current.leaveTime = action.timestamp;
      }
    } else {
      current = {
        page: action.page || '(unknown)',
        enterTime: action.timestamp,
        actions: [action],
      };
      groups.push(current);
    }
  }

  return groups;
}

// ==================== HTML 渲染器 ====================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function renderActionChainHTML(chain: ActionChain): string {
  const s = chain.stats;
  const statsItems = [
    `<span>⏱ ${formatTime(s.duration)}</span>`,
    `<span>👆 ${s.tapCount} 点击</span>`,
    s.inputCount > 0 ? `<span>⌨️ ${s.inputCount} 输入</span>` : '',
    s.scrollCount > 0 ? `<span>📜 ${s.scrollCount} 滚动</span>` : '',
    s.swipeCount > 0 ? `<span>👈 ${s.swipeCount} 滑动</span>` : '',
    s.touchCount > 0 ? `<span>🔵 ${s.touchCount} 触摸</span>` : '',
    s.dragCount > 0 ? `<span>✊ ${s.dragCount} 拖拽</span>` : '',
    `<span>📄 ${s.pageCount} 页面</span>`,
    s.networkCount > 0 ? `<span>📡 ${s.networkCount} 请求</span>` : '',
    s.errorCount > 0 ? `<span style="color:#d32f2f">❌ ${s.errorCount} 错误</span>` : '',
    s.maxScrollDepth > 0 ? `<span>📊 最深 ${s.maxScrollDepth}%</span>` : '',
  ].filter(Boolean).join('\n  ');

  const statsHtml = `
<div style="display:flex;gap:12px;flex-wrap:wrap;padding:12px 16px;background:#fafafa;border-bottom:1px solid #e8e8e8;font-size:12px;color:#666;">
  ${statsItems}
</div>`.trim();

  const groupsHtml = chain.pageGroups.map((group, gi) => {
    const pageDur = group.leaveTime
      ? formatTime(group.leaveTime - group.enterTime)
      : '…';

    const depthBar = group.scrollDepth != null
      ? `<div style="height:3px;background:#e0e0e0;border-radius:2px;margin-top:4px;overflow:hidden;"><div style="height:100%;width:${group.scrollDepth}%;background:#00897b;border-radius:2px;"></div></div>`
      : '';

    const actionsHtml = group.actions.map((action, ai) => {
      const isInteraction = ['tap', 'longpress', 'input_focus', 'input_change', 'input_blur', 'swipe'].includes(action.type);
      const isNav = ['page_enter', 'page_redirect', 'page_leave'].includes(action.type);
      const isError = action.type === 'error';
      const isTouch = action.type.startsWith('touch_') || action.type.startsWith('drag_');
      const bgColor = isError ? '#fff5f5' : isInteraction ? '#fffbe6' : isNav ? '#e6f7ff' : isTouch ? '#f3e5f5' : 'transparent';
      const borderLeft = `3px solid ${action.color}`;

      return `
<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 12px;border-left:${borderLeft};background:${bgColor};font-size:13px;line-height:1.6;${ai < group.actions.length - 1 ? 'border-bottom:1px solid #f5f5f5;' : ''}" data-action-idx="${gi}-${ai}" data-timestamp="${action.timestamp}">
  <span style="flex-shrink:0;min-width:36px;color:#999;font-size:11px;font-variant-numeric:tabular-nums;padding-top:2px;">${formatTime(action.relativeTime)}</span>
  <span style="flex-shrink:0;font-size:14px;">${action.icon}</span>
  <span style="color:#333;word-break:break-all;">${escapeHtml(action.description)}</span>
</div>`.trim();
    }).join('\n');

    const depthLabel = group.scrollDepth != null ? ` · 深度 ${group.scrollDepth}%` : '';

    return `
<div style="margin-bottom:2px;">
  <div style="padding:8px 12px;background:#f0f5ff;border-left:3px solid #2196f3;font-size:12px;font-weight:600;color:#1565c0;position:sticky;top:0;z-index:5;">
    <div style="display:flex;align-items:center;gap:8px;">
      <span>📄 ${escapeHtml(formatPage(group.page))}</span>
      <span style="font-weight:400;color:#90a4ae;">${pageDur} · ${group.actions.length} 操作${depthLabel}</span>
    </div>
    ${depthBar}
  </div>
  ${actionsHtml}
</div>`.trim();
  }).join('\n');

  return `
<div class="sigillum-action-chain" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
  <div style="padding:12px 16px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;">
    <div style="font-size:15px;font-weight:600;">用户行为链</div>
    <div style="font-size:11px;opacity:0.85;margin-top:2px;">${chain.platform} · ${chain.sessionId.slice(0, 16)}… · ${formatTime(chain.duration)}</div>
  </div>
  ${statsHtml}
  <div style="max-height:600px;overflow-y:auto;">
    ${groupsHtml}
  </div>
</div>`.trim();
}

export function getActionChainCSS(): string {
  return `
.sigillum-action-chain [data-action-idx]:hover {
  background: rgba(0, 0, 0, 0.03) !important;
}
.sigillum-action-chain [data-action-idx].active {
  background: #e6f7ff !important;
  outline: 2px solid #1890ff;
  outline-offset: -2px;
}
`.trim();
}
