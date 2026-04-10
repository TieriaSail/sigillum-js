/**
 * 小程序会话管理器
 *
 * 管理会话 ID、会话元数据、上传（含重试）和分段上传逻辑。
 * 纯逻辑，不含任何平台 API 调用。
 */

import type {
  MiniAppSessionMetadata,
  MiniAppRecordingSummary,
  MiniAppRawRecordingData,
  MiniAppRecordingChunk,
  MiniAppRecorderOptions,
  TrackEvent,
} from './types';
import { SIGILLUM_SCHEMA_VERSION } from './types';
import { SDK_VERSION } from '../version';

export class SessionManager {
  private sessionId = '';
  private startTime = 0;
  private endTime = 0;
  private metadata: MiniAppSessionMetadata | null = null;
  private options: MiniAppRecorderOptions;

  private chunkIndex = 0;
  private lastChunkEventIndex = 0;

  constructor(options: MiniAppRecorderOptions) {
    this.options = options;
  }

  /** 生成新会话 */
  initSession(metadata: MiniAppSessionMetadata): string {
    this.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    this.startTime = Date.now();
    this.endTime = 0;
    this.metadata = metadata;
    this.chunkIndex = 0;
    this.lastChunkEventIndex = 0;
    return this.sessionId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getStartTime(): number {
    return this.startTime;
  }

  getChunkIndex(): number {
    return this.chunkIndex;
  }

  markEnd(): number {
    this.endTime = Date.now();
    return this.endTime;
  }

  getMetadata(): MiniAppSessionMetadata | null {
    return this.metadata;
  }

  /** 构建完整录制数据 */
  buildRecordingData(
    events: TrackEvent[],
    summary: MiniAppRecordingSummary,
  ): MiniAppRawRecordingData {
    return {
      sessionId: this.sessionId,
      events: [...events],
      startTime: this.startTime,
      endTime: this.endTime || Date.now(),
      duration: (this.endTime || Date.now()) - this.startTime,
      metadata: this.metadata || undefined,
      summary,
    };
  }

  /** 带指数退避的重试执行器，返回是否成功 */
  private async retryWithBackoff(
    fn: () => Promise<{ success: boolean; shouldRetry?: boolean }>,
  ): Promise<boolean> {
    const maxRetries = this.options.maxRetries ?? 3;
    let retries = 0;
    let lastError: Error | null = null;

    while (retries <= maxRetries) {
      try {
        const result = await fn();
        if (result.success) return true;
        lastError = new Error('Upload failed');
        if (!result.shouldRetry) {
          this.safeOnError(lastError);
          return false;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (retries >= maxRetries) {
          this.safeOnError(lastError);
          return false;
        }
      }
      retries++;
      await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, retries - 1), 10000)));
    }

    if (lastError) {
      this.safeOnError(lastError);
    }
    return false;
  }

  /** 上传完整录制（含重试），自动包裹 SigillumRecording 信封 */
  async upload(
    events: TrackEvent[],
    summary: MiniAppRecordingSummary,
  ): Promise<void> {
    if (!this.options.onUpload || events.length === 0) return;
    const recording = this.buildRecordingData(events, summary);
    const envelope = {
      sigillum: true as const,
      schemaVersion: SIGILLUM_SCHEMA_VERSION,
      source: 'miniapp' as const,
      sdkVersion: SDK_VERSION,
      exportedAt: Date.now(),
      recording,
    };
    await this.retryWithBackoff(() => this.options.onUpload!(envelope));
  }

  /** 上传一个分段 */
  async uploadChunk(
    events: TrackEvent[],
    summary: MiniAppRecordingSummary,
    isFinal: boolean,
  ): Promise<void> {
    if (!this.options.onChunkUpload) return;

    const newEvents = events.slice(this.lastChunkEventIndex);
    if (newEvents.length === 0 && !isFinal) return;

    const chunk: MiniAppRecordingChunk = {
      sessionId: this.sessionId,
      chunkIndex: this.chunkIndex,
      isFinal,
      events: newEvents,
      startTime: this.chunkIndex === 0 ? this.startTime : (newEvents[0]?.timestamp || Date.now()),
      endTime: Date.now(),
      summary,
      metadata: this.chunkIndex === 0 ? (this.metadata || undefined) : undefined,
    };

    const prevLastChunkEventIndex = this.lastChunkEventIndex;
    const prevChunkIndex = this.chunkIndex;

    this.lastChunkEventIndex = events.length;
    this.chunkIndex++;

    const success = await this.retryWithBackoff(() => this.options.onChunkUpload!(chunk));
    if (!success) {
      this.lastChunkEventIndex = prevLastChunkEventIndex;
      this.chunkIndex = prevChunkIndex;
    }
  }

  private safeOnError(error: Error): void {
    try {
      this.options.onError?.(error);
    } catch {
      // Consumer onError must not break SDK internals
    }
  }

  reset(): void {
    this.sessionId = '';
    this.startTime = 0;
    this.endTime = 0;
    this.metadata = null;
    this.chunkIndex = 0;
    this.lastChunkEventIndex = 0;
  }
}
