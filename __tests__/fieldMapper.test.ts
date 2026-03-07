import { describe, it, expect } from 'vitest';
import { FieldMapper, createFieldMapper, DEFAULT_FIELD_MAPPING } from '../src/FieldMapper';
import type { RawRecordingData } from '../src/types';

const sampleRaw: RawRecordingData = {
  sessionId: 'sess-123',
  events: [{ type: 2, data: {}, timestamp: 1000 }],
  startTime: 1000,
  endTime: 2000,
  duration: 1000,
  tags: [{ name: 'click', timestamp: 1500 }],
  url: 'https://example.com',
  userAgent: 'Mozilla/5.0',
  screenResolution: '1920x1080',
  viewport: { width: 1280, height: 720 },
};

describe('FieldMapper', () => {
  describe('默认映射（无 fieldMapping）', () => {
    it('toServer 应保持原始字段名', () => {
      const mapper = new FieldMapper();
      const result = mapper.toServer(sampleRaw);
      expect(result.sessionId).toBe('sess-123');
      expect(result.startTime).toBe(1000);
      expect(result.endTime).toBe(2000);
      expect(result.duration).toBe(1000);
      expect(result.url).toBe('https://example.com');
      expect(result.viewport).toEqual({ width: 1280, height: 720 });
    });

    it('fromServer 应保持原始字段名', () => {
      const mapper = new FieldMapper();
      const serverData = mapper.toServer(sampleRaw);
      const restored = mapper.fromServer(serverData);
      expect(restored.sessionId).toBe('sess-123');
      expect(restored.events).toHaveLength(1);
      expect(restored.tags).toHaveLength(1);
    });
  });

  describe('自定义字段映射', () => {
    const customMapping = [
      ['sessionId', 'id'] as [string, string],
      ['events', 'content', JSON.stringify, JSON.parse] as [string, string, (v: any) => any, (v: any) => any],
      ['startTime', 'start_at'] as [string, string],
      ['endTime', 'end_at'] as [string, string],
      ['duration', 'duration_ms'] as [string, string],
      ['url', 'page_url'] as [string, string],
    ];

    it('toServer 应映射字段名', () => {
      const mapper = new FieldMapper(customMapping);
      const result = mapper.toServer(sampleRaw);

      expect(result.id).toBe('sess-123');
      expect(result.start_at).toBe(1000);
      expect(result.end_at).toBe(2000);
      expect(result.duration_ms).toBe(1000);
      expect(result.page_url).toBe('https://example.com');
      // 原始字段名不应存在
      expect(result.sessionId).toBeUndefined();
      expect(result.startTime).toBeUndefined();
    });

    it('toServer 应应用转换函数', () => {
      const mapper = new FieldMapper(customMapping);
      const result = mapper.toServer(sampleRaw);

      // events 应被 JSON.stringify
      expect(typeof result.content).toBe('string');
      expect(JSON.parse(result.content)).toEqual(sampleRaw.events);
    });

    it('fromServer 应逆向映射', () => {
      const mapper = new FieldMapper(customMapping);
      const serverData = mapper.toServer(sampleRaw);
      const restored = mapper.fromServer(serverData);

      expect(restored.sessionId).toBe('sess-123');
      expect(restored.startTime).toBe(1000);
      expect(restored.endTime).toBe(2000);
      expect(restored.duration).toBe(1000);
      expect(restored.url).toBe('https://example.com');
    });

    it('fromServer 应应用逆转换函数', () => {
      const mapper = new FieldMapper(customMapping);
      const serverData = mapper.toServer(sampleRaw);
      const restored = mapper.fromServer(serverData);

      // content (string) 应被 JSON.parse 回 events 数组
      expect(Array.isArray(restored.events)).toBe(true);
      expect(restored.events).toHaveLength(1);
      expect(restored.events[0].type).toBe(2);
    });
  });

  describe('边界情况', () => {
    it('undefined 值不应被映射', () => {
      const mapper = new FieldMapper([['sessionId', 'id']]);
      const partial = { sessionId: 'test' } as any;
      const result = mapper.toServer(partial);

      expect(result.id).toBe('test');
      // 其他字段不存在
      expect(Object.keys(result)).toHaveLength(1);
    });

    it('空映射数组应返回空对象', () => {
      const mapper = new FieldMapper([]);
      const result = mapper.toServer(sampleRaw);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('getMapping 应返回当前映射配置', () => {
      const mapper = new FieldMapper();
      expect(mapper.getMapping()).toBe(DEFAULT_FIELD_MAPPING);
    });
  });

  describe('createFieldMapper 工厂函数', () => {
    it('应创建 FieldMapper 实例', () => {
      const mapper = createFieldMapper();
      expect(mapper).toBeInstanceOf(FieldMapper);
    });

    it('应接受自定义映射', () => {
      const mapper = createFieldMapper([['sessionId', 'id']]);
      const result = mapper.toServer(sampleRaw);
      expect(result.id).toBe('sess-123');
    });
  });

  describe('双向转换一致性', () => {
    it('toServer -> fromServer 应还原原始数据（默认映射）', () => {
      const mapper = new FieldMapper();
      const serverData = mapper.toServer(sampleRaw);
      const restored = mapper.fromServer(serverData);

      expect(restored.sessionId).toBe(sampleRaw.sessionId);
      expect(restored.startTime).toBe(sampleRaw.startTime);
      expect(restored.endTime).toBe(sampleRaw.endTime);
      expect(restored.duration).toBe(sampleRaw.duration);
      expect(restored.url).toBe(sampleRaw.url);
      expect(restored.userAgent).toBe(sampleRaw.userAgent);
      expect(restored.screenResolution).toBe(sampleRaw.screenResolution);
      expect(restored.viewport).toEqual(sampleRaw.viewport);
    });

    it('toServer -> fromServer 应还原原始数据（带转换函数）', () => {
      const mapping = [
        ['sessionId', 'id'] as [string, string],
        ['events', 'content', JSON.stringify, JSON.parse] as [string, string, (v: any) => any, (v: any) => any],
        ['tags', 'tag_list', JSON.stringify, JSON.parse] as [string, string, (v: any) => any, (v: any) => any],
      ];
      const mapper = new FieldMapper(mapping);
      const serverData = mapper.toServer(sampleRaw);
      const restored = mapper.fromServer(serverData);

      expect(restored.sessionId).toBe(sampleRaw.sessionId);
      expect(restored.events).toEqual(sampleRaw.events);
      expect(restored.tags).toEqual(sampleRaw.tags);
    });
  });
});

