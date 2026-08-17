import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import type { LlmConfig } from '@config/index';
import { LlmCallLog } from '../schemas/llm-call-log.schema';

export interface CallLogEntry {
  requestId: string;
  traceId?: string;
  userId?: string;
  feature: string;
  provider: string;
  model: string;
  keyId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  cacheHit: boolean;
  repaired: boolean;
  outcome: 'success' | 'error';
  errorCode?: string;
}

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_BATCH_SIZE = 100;

/**
 * Buffered, best-effort writer for the durable call log. Every call to
 * `record` returns immediately -- a Mongo hiccup must never fail (or even
 * slow down) an LLM call that already succeeded and already cost money.
 * Flushed on a timer or when the buffer fills, whichever comes first.
 */
@Injectable()
export class CallLogService implements OnModuleDestroy {
  private readonly logger = new Logger(CallLogService.name);
  private readonly enabled: boolean;
  private buffer: CallLogEntry[] = [];
  private timer: NodeJS.Timeout;

  constructor(
    @InjectModel(LlmCallLog.name) private readonly model: Model<LlmCallLog>,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<LlmConfig>('llm')!.callLogEnabled;
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  record(entry: CallLogEntry): void {
    if (!this.enabled) return;
    this.buffer.push(entry);
    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.model.insertMany(batch, { ordered: false });
    } catch (err) {
      this.logger.warn(
        `Failed to flush ${batch.length} call log entries: ${String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
