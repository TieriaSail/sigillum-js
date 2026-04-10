/**
 * 事件序列录制器
 *
 * 平台无关的核心录制逻辑：接收事件 → 缓冲 → 统计 → 分段/完整上传。
 * 不含任何平台 API，由平台适配器驱动。
 */

import type {
  TrackEvent,
  MiniAppRecordingStatus,
  MiniAppRecordingSummary,
  MiniAppRecorderOptions,
  MiniAppSessionMetadata,
  MiniAppRawRecordingData,
  SigillumRecording,
} from './types';
import { SIGILLUM_SCHEMA_VERSION } from './types';
import { SDK_VERSION } from '../version';
import { EventBuffer } from './EventBuffer';
import { SessionManager } from './SessionManager';

export class EventRecorder {
  private options: MiniAppRecorderOptions;
  private buffer: EventBuffer;
  private session: SessionManager;
  private status: MiniAppRecordingStatus = 'idle';

  private tapCount = 0;
  private inputCount = 0;
  private scrollCount = 0;
  private pageChanges: Array<{ from: string; to: string; timestamp: number }> = [];
  private visitedPages = new Set<string>();
  private currentPage = '';

  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private chunkTimer: ReturnType<typeof setInterval> | null = null;
  private recordingStartTime = 0;
  private elapsedBeforePause = 0;

  constructor(options: MiniAppRecorderOptions) {
    this.options = options;
    this.buffer = new EventBuffer(options.maxEvents ?? 50000);
    this.session = new SessionManager(options);
  }

  // ==================== 生命周期 ====================

  start(platform: string, appVersion?: string): void {
    if (this.status === 'recording') return;
    if (this.status === 'paused') return;

    this.resetCounters();
    this.buffer.clear();
    this.recordingStartTime = Date.now();
    this.elapsedBeforePause = 0;
    this.session.initSession({
      platform,
      sdkVersion: SDK_VERSION,
      appVersion,
    });

    this.setStatus('recording');

    this.captureEvent({
      type: 'session_start',
      timestamp: Date.now(),
      data: { platform, sdkVersion: SDK_VERSION, appVersion },
    });

    this.startMaxDurationTimer();
    this.startChunkTimer();
  }

  async stop(): Promise<void> {
    if (this.status !== 'recording' && this.status !== 'paused') return;

    const prev = this.status;
    this.status = 'stopped';

    const endEvent: TrackEvent = {
      type: 'session_end',
      timestamp: Date.now(),
      data: { reason: 'manual' as const },
    };
    if (!this.buffer.push(endEvent)) {
      this.buffer.forceAppend(endEvent);
    }

    this.clearTimers();
    this.session.markEnd();

    try {
      this.options.onStatusChange?.('stopped', prev);
    } catch {
      // silent
    }

    if (this.options.chunkedUpload?.enabled && this.options.onChunkUpload) {
      await this.session.uploadChunk(
        this.buffer.getEvents(),
        this.buildSummary(),
        true,
      );
    }

    if (this.options.onUpload) {
      await this.session.upload(
        this.buffer.getEvents(),
        this.buildSummary(),
      );
    }
  }

  pause(): void {
    if (this.status !== 'recording') return;
    this.elapsedBeforePause += Date.now() - this.recordingStartTime;
    this.clearTimers();
    this.setStatus('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;

    this.recordingStartTime = Date.now();
    this.setStatus('recording');
    this.startMaxDurationTimer();
    this.startChunkTimer();
  }

  destroy(): void {
    this.clearTimers();
    this.setStatus('stopped');
    this.buffer.clear();
    this.session.reset();
    this.resetCounters();
  }

  // ==================== 事件采集 ====================

  captureEvent(event: TrackEvent): void {
    if (this.status !== 'recording') return;

    if (this.options.maskInputs !== false && event.type === 'input' && event.data) {
      const original = event.data as Record<string, unknown>;
      const masked = { ...original };
      if (typeof masked.value === 'string') {
        masked.value = '*'.repeat(masked.value.length);
      } else if (masked.value != null) {
        masked.value = '***';
      }
      event = { ...event, data: masked };
    }

    const accepted = this.buffer.push(event);
    if (!accepted) {
      this.buffer.forceAppend({
        type: 'session_end',
        timestamp: Date.now(),
        data: { reason: 'buffer_full' as const },
      });
      this.clearTimers();
      this.session.markEnd();
      this.setStatus('stopped');
      this.flushUploads();
      return;
    }

    this.analyzeEvent(event);

    try {
      this.options.onEventEmit?.(event, this.buffer.getEventCount());
    } catch {
      // silent
    }
  }

  // ==================== 公开 API ====================

  getStatus(): MiniAppRecordingStatus {
    return this.status;
  }

  getSessionId(): string {
    return this.session.getSessionId();
  }

  getEventCount(): number {
    return this.buffer.getEventCount();
  }

  getSummary(): MiniAppRecordingSummary | null {
    if (this.status === 'idle') return null;
    return this.buildSummary();
  }

  getMetadata(): MiniAppSessionMetadata | null {
    return this.session.getMetadata();
  }

  exportRecording(): SigillumRecording<MiniAppRawRecordingData> | null {
    if (this.status !== 'stopped') return null;
    if (this.buffer.getEventCount() === 0) return null;

    const recording = this.session.buildRecordingData(
      this.buffer.getEvents(),
      this.buildSummary(),
    );

    return {
      sigillum: true,
      schemaVersion: SIGILLUM_SCHEMA_VERSION,
      source: 'miniapp',
      sdkVersion: SDK_VERSION,
      exportedAt: Date.now(),
      recording,
    };
  }

  getCurrentPage(): string {
    return this.currentPage;
  }

  setCurrentPage(page: string): void {
    this.currentPage = page;
    this.visitedPages.add(page);
  }

  // ==================== 内部逻辑 ====================

  private analyzeEvent(event: TrackEvent): void {
    switch (event.type) {
      case 'tap':
      case 'longpress':
        this.tapCount++;
        break;
      case 'input':
        this.inputCount++;
        break;
      case 'scroll':
        this.scrollCount++;
        break;
      case 'page_enter': {
        const data = event.data as { page: string; from?: string };
        if (data.from && data.page !== data.from) {
          this.pageChanges.push({
            from: data.from,
            to: data.page,
            timestamp: event.timestamp,
          });
        }
        this.currentPage = data.page;
        this.visitedPages.add(data.page);
        break;
      }
    }
  }

  private getRecordingDuration(): number {
    if (this.session.getStartTime() === 0) return 0;
    const currentSegment = this.status === 'recording'
      ? Date.now() - this.recordingStartTime
      : 0;
    return this.elapsedBeforePause + currentSegment;
  }

  private buildSummary(): MiniAppRecordingSummary {
    return {
      totalEvents: this.buffer.getEventCount(),
      tapCount: this.tapCount,
      inputCount: this.inputCount,
      scrollCount: this.scrollCount,
      pageChangeCount: this.pageChanges.length,
      pageChanges: [...this.pageChanges],
      duration: this.getRecordingDuration(),
      visitedPages: Array.from(this.visitedPages),
    };
  }

  private setStatus(newStatus: MiniAppRecordingStatus): void {
    const prev = this.status;
    this.status = newStatus;
    if (prev !== newStatus) {
      try {
        this.options.onStatusChange?.(newStatus, prev);
      } catch {
        // silent
      }
    }
  }

  private startMaxDurationTimer(): void {
    const maxDuration = this.options.maxDuration ?? 30 * 60 * 1000;
    const remaining = Math.max(0, maxDuration - this.elapsedBeforePause);
    this.maxDurationTimer = setTimeout(() => {
      if (this.status === 'recording') {
        this.captureEvent({
          type: 'session_end',
          timestamp: Date.now(),
          data: { reason: 'max_duration' as const },
        });
        if (this.status as string === 'stopped') return;
        this.clearTimers();
        this.session.markEnd();
        this.setStatus('stopped');
        this.flushUploads();
      }
    }, remaining);
  }

  private startChunkTimer(): void {
    const config = this.options.chunkedUpload;
    if (!config?.enabled || !this.options.onChunkUpload) return;

    const interval = config.interval ?? 60000;
    this.chunkTimer = setInterval(() => {
      this.session.uploadChunk(
        this.buffer.getEvents(),
        this.buildSummary(),
        false,
      ).catch((error) => {
        try {
          this.options.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        } catch {
          // silent
        }
      });
    }, interval);
  }

  private flushUploads(): void {
    const allEvents = [...this.buffer.getEvents()];
    const summary = this.buildSummary();
    const snapshot = this.session.buildRecordingData(allEvents, summary);
    const finalChunkIndex = this.session.getChunkIndex();
    const { onUpload, onChunkUpload, chunkedUpload, onError } = this.options;

    const doUpload = async () => {
      try {
        if (chunkedUpload?.enabled && onChunkUpload) {
          await onChunkUpload({
            sessionId: snapshot.sessionId,
            chunkIndex: finalChunkIndex,
            isFinal: true,
            events: allEvents,
            startTime: snapshot.startTime,
            endTime: snapshot.endTime,
            summary,
            metadata: finalChunkIndex === 0 ? snapshot.metadata : undefined,
          });
        }
        if (onUpload) {
          await onUpload({
            sigillum: true,
            schemaVersion: SIGILLUM_SCHEMA_VERSION,
            source: 'miniapp',
            sdkVersion: SDK_VERSION,
            exportedAt: Date.now(),
            recording: snapshot,
          });
        }
      } catch (error) {
        try {
          onError?.(error instanceof Error ? error : new Error(String(error)));
        } catch {
          // silent
        }
      }
    };

    doUpload();
  }

  private clearTimers(): void {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }
  }

  private resetCounters(): void {
    this.tapCount = 0;
    this.inputCount = 0;
    this.scrollCount = 0;
    this.pageChanges = [];
    this.visitedPages.clear();
    this.currentPage = '';
  }
}
