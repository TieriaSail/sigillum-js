import type { MonitoringConfig, MonitoringPreset, CaptureConfig, ThrottleConfig } from './types';

const LITE_CAPTURE: Required<CaptureConfig> = {
  session: true,
  pageLifecycle: true,
  tap: true,
  longpress: false,
  input: false,
  scroll: false,
  swipe: false,
  drag: false,
  touch: false,
  network: false,
  error: true,
  custom: false,
};

const STANDARD_CAPTURE: Required<CaptureConfig> = {
  session: true,
  pageLifecycle: true,
  tap: true,
  longpress: true,
  input: true,
  scroll: true,
  swipe: true,
  drag: false,
  touch: false,
  network: true,
  error: true,
  custom: true,
};

const FULL_CAPTURE: Required<CaptureConfig> = {
  session: true,
  pageLifecycle: true,
  tap: true,
  longpress: true,
  input: true,
  scroll: true,
  swipe: true,
  drag: true,
  touch: true,
  network: true,
  error: true,
  custom: true,
};

const LITE_THROTTLE: Required<ThrottleConfig> = {
  scroll: 1000,
  touchMove: 0,
  drag: 200,
};

const STANDARD_THROTTLE: Required<ThrottleConfig> = {
  scroll: 300,
  touchMove: 0,
  drag: 100,
};

const FULL_THROTTLE: Required<ThrottleConfig> = {
  scroll: 100,
  touchMove: 50,
  drag: 100,
};

const PRESET_MAP: Record<MonitoringPreset, MonitoringConfig> = {
  lite: {
    preset: 'lite',
    capture: LITE_CAPTURE,
    throttle: LITE_THROTTLE,
    scrollDepth: false,
  },
  standard: {
    preset: 'standard',
    capture: STANDARD_CAPTURE,
    throttle: STANDARD_THROTTLE,
    scrollDepth: false,
  },
  full: {
    preset: 'full',
    capture: FULL_CAPTURE,
    throttle: FULL_THROTTLE,
    scrollDepth: true,
  },
};

export interface ResolvedMonitoringConfig {
  preset: MonitoringPreset;
  capture: Required<CaptureConfig>;
  throttle: Required<ThrottleConfig>;
  scrollDepth: boolean;
  rules: NonNullable<MonitoringConfig['rules']>;
  eventFilter?: MonitoringConfig['eventFilter'];
}

const VALID_PRESETS: ReadonlySet<string> = new Set(['lite', 'standard', 'full']);

export function resolveMonitoringConfig(
  config?: MonitoringConfig,
): ResolvedMonitoringConfig {
  const presetName = config?.preset ?? 'standard';
  if (!VALID_PRESETS.has(presetName)) {
    throw new Error(`[sigillum] Invalid monitoring preset "${presetName}". Must be one of: lite, standard, full.`);
  }
  const base = PRESET_MAP[presetName];

  return {
    preset: presetName,
    capture: {
      ...(base.capture as Required<CaptureConfig>),
      ...stripUndefined(config?.capture),
    },
    throttle: {
      ...(base.throttle as Required<ThrottleConfig>),
      ...stripUndefined(config?.throttle),
    },
    scrollDepth: config?.scrollDepth ?? base.scrollDepth ?? false,
    rules: config?.rules ?? [],
    eventFilter: config?.eventFilter,
  };
}

function stripUndefined<T>(obj: T | undefined): Partial<T> {
  if (!obj) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== undefined) result[k] = v;
  }
  return result as Partial<T>;
}

export { PRESET_MAP };
