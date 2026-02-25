/**
 * 字段映射工具
 * 支持原始数据和后端数据结构之间的双向转换
 */

import type { FieldMapping, RawRecordingData } from './types';

/**
 * 默认字段映射
 * 如果不配置 fieldMapping，使用原始字段名
 */
export const DEFAULT_FIELD_MAPPING: FieldMapping[] = [
  ['sessionId', 'sessionId'],
  ['events', 'events'],
  ['startTime', 'startTime'],
  ['endTime', 'endTime'],
  ['duration', 'duration'],
  ['tags', 'tags'],
  ['url', 'url'],
  ['userAgent', 'userAgent'],
  ['screenResolution', 'screenResolution'],
  ['viewport', 'viewport'],
  ['metadata', 'metadata'],
  ['summary', 'summary'],
];

/**
 * 字段映射器
 */
export class FieldMapper {
  private mapping: FieldMapping[];

  constructor(mapping?: FieldMapping[]) {
    this.mapping = mapping || DEFAULT_FIELD_MAPPING;
  }

  /**
   * 上传时：原始数据 -> 后端数据结构
   */
  toServer(raw: RawRecordingData): Record<string, any> {
    const result: Record<string, any> = {};

    for (const item of this.mapping) {
      const [rawKey, serverKey, toServerFn] = item;
      const value = (raw as any)[rawKey];

      if (value !== undefined) {
        result[serverKey] = toServerFn ? toServerFn(value) : value;
      }
    }

    return result;
  }

  /**
   * 回放时：后端数据结构 -> 原始数据
   */
  fromServer(server: Record<string, any>): RawRecordingData {
    const result: Record<string, any> = {};

    for (const item of this.mapping) {
      const [rawKey, serverKey, , fromServerFn] = item;
      const value = server[serverKey];

      if (value !== undefined) {
        result[rawKey] = fromServerFn ? fromServerFn(value) : value;
      }
    }

    return result as RawRecordingData;
  }

  /**
   * 获取映射配置
   */
  getMapping(): FieldMapping[] {
    return this.mapping;
  }
}

/**
 * 创建字段映射器
 */
export function createFieldMapper(mapping?: FieldMapping[]): FieldMapper {
  return new FieldMapper(mapping);
}

