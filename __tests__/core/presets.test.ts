import { describe, it, expect } from 'vitest';
import { resolveMonitoringConfig, PRESET_MAP } from '../../src/core/presets';

describe('resolveMonitoringConfig', () => {
  it('默认使用 standard 预设', () => {
    const cfg = resolveMonitoringConfig();
    expect(cfg.preset).toBe('standard');
    expect(cfg.capture.tap).toBe(true);
    expect(cfg.capture.longpress).toBe(true);
    expect(cfg.capture.input).toBe(true);
    expect(cfg.capture.scroll).toBe(true);
    expect(cfg.capture.swipe).toBe(true);
    expect(cfg.capture.drag).toBe(false);
    expect(cfg.capture.touch).toBe(false);
    expect(cfg.capture.network).toBe(true);
    expect(cfg.capture.error).toBe(true);
    expect(cfg.capture.custom).toBe(true);
    expect(cfg.scrollDepth).toBe(false);
  });

  it('lite 预设只采集最少事件', () => {
    const cfg = resolveMonitoringConfig({ preset: 'lite' });
    expect(cfg.preset).toBe('lite');
    expect(cfg.capture.tap).toBe(true);
    expect(cfg.capture.longpress).toBe(false);
    expect(cfg.capture.input).toBe(false);
    expect(cfg.capture.scroll).toBe(false);
    expect(cfg.capture.swipe).toBe(false);
    expect(cfg.capture.network).toBe(false);
    expect(cfg.capture.error).toBe(true);
    expect(cfg.capture.session).toBe(true);
    expect(cfg.capture.pageLifecycle).toBe(true);
    expect(cfg.throttle.scroll).toBe(1000);
  });

  it('full 预设采集所有事件', () => {
    const cfg = resolveMonitoringConfig({ preset: 'full' });
    expect(cfg.preset).toBe('full');
    expect(cfg.capture.tap).toBe(true);
    expect(cfg.capture.drag).toBe(true);
    expect(cfg.capture.touch).toBe(true);
    expect(cfg.scrollDepth).toBe(true);
    expect(cfg.throttle.scroll).toBe(100);
    expect(cfg.throttle.touchMove).toBe(50);
  });

  it('用户覆盖可以修改预设的 capture 开关', () => {
    const cfg = resolveMonitoringConfig({
      preset: 'lite',
      capture: { network: true, scroll: true },
    });
    expect(cfg.capture.network).toBe(true);
    expect(cfg.capture.scroll).toBe(true);
    expect(cfg.capture.input).toBe(false);
  });

  it('用户覆盖可以修改 throttle', () => {
    const cfg = resolveMonitoringConfig({
      preset: 'standard',
      throttle: { scroll: 500 },
    });
    expect(cfg.throttle.scroll).toBe(500);
    expect(cfg.throttle.touchMove).toBe(0);
  });

  it('用户可以开启 scrollDepth', () => {
    const cfg = resolveMonitoringConfig({
      preset: 'standard',
      scrollDepth: true,
    });
    expect(cfg.scrollDepth).toBe(true);
  });

  it('自定义规则被保留', () => {
    const rule = { name: 'test', eventTypes: ['tap' as const] };
    const cfg = resolveMonitoringConfig({ rules: [rule] });
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].name).toBe('test');
  });

  it('eventFilter 被保留', () => {
    const filter = () => true;
    const cfg = resolveMonitoringConfig({ eventFilter: filter });
    expect(cfg.eventFilter).toBe(filter);
  });

  it('undefined 覆盖值不会覆盖预设', () => {
    const cfg = resolveMonitoringConfig({
      preset: 'full',
      capture: { tap: undefined as any },
    });
    expect(cfg.capture.tap).toBe(true);
  });
});

describe('PRESET_MAP', () => {
  it('包含三个预设', () => {
    expect(Object.keys(PRESET_MAP)).toEqual(['lite', 'standard', 'full']);
  });
});
