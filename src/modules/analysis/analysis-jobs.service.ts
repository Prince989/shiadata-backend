import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '@infra/redis/redis.module';
import { contentHash, pairHash } from '@common/utils/arabic-normalize';
import { NotFoundAppError, RequestTimeoutAppError } from '@common/errors/app.error';
import { PythonEngineClient } from '@modules/ai-engine-client/python-engine.client';

export type AnalysisKind = 'grand-ijtihad' | 'conflict-resolution' | 'rijal-validate';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AnalysisJob {
  jobId: string;
  kind: AnalysisKind;
  status: JobStatus;
  input: unknown;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitResult {
  jobId: string;
  status: JobStatus;
  result?: unknown;
  reused: boolean;
}

const JOB_TTL_SECONDS = 7 * 24 * 3600;

@Injectable()
export class AnalysisJobsService {
  private readonly logger = new Logger(AnalysisJobsService.name);
  private readonly role: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly engine: PythonEngineClient,
    config: ConfigService,
  ) {
    this.role = process.env.WORKER_ROLE ?? 'all';
  }

  jobIdFor(kind: AnalysisKind, input: unknown): string {
    if (kind === 'conflict-resolution') {
      const body = input as { hadith1: string; hadith2: string };
      return createHash('sha256')
        .update(`conflict:${pairHash(body.hadith1, body.hadith2)}`)
        .digest('hex');
    }
    const text =
      typeof input === 'string'
        ? input
        : JSON.stringify(input);
    return createHash('sha256')
      .update(`${kind}:${contentHash(text)}`)
      .digest('hex');
  }

  async submit(
    kind: AnalysisKind,
    input: unknown,
    waitMs = 0,
  ): Promise<SubmitResult> {
    const jobId = this.jobIdFor(kind, input);
    const cached = await this.readVerdict(kind, jobId);
    if (cached) {
      const existingCached = await this.get(jobId);
      if (!existingCached) {
        await this.save({
          jobId,
          kind,
          status: 'completed',
          input,
          result: cached,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      return { jobId, status: 'completed', result: cached, reused: true };
    }
    const existing = await this.get(jobId);
    if (existing?.status === 'completed') {
      return { jobId, status: 'completed', result: existing.result, reused: true };
    }
    if (!existing) {
      const job: AnalysisJob = {
        jobId,
        kind,
        status: 'queued',
        input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.save(job);
    }

    if (this.role !== 'api') {
      const run = this.process(jobId);
      if (waitMs > 0) {
        const finished = await this.waitFor(jobId, Math.min(waitMs, 25_000));
        if (finished) {
          const job = await this.require(jobId);
          return {
            jobId,
            status: job.status,
            result: job.result,
            reused: false,
          };
        }
      } else {
        void run.catch((err) => this.logger.error(err, 'analysis job failed'));
      }
    }

    return { jobId, status: 'queued', reused: false };
  }

  async get(jobId: string): Promise<AnalysisJob | null> {
    const raw = await this.redis.get(this.key(jobId));
    return raw ? (JSON.parse(raw) as AnalysisJob) : null;
  }

  async require(jobId: string): Promise<AnalysisJob> {
    const job = await this.get(jobId);
    if (!job) throw new NotFoundAppError('Job not found', { jobId });
    return job;
  }

  async waitFor(jobId: string, waitMs: number): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const job = await this.get(jobId);
      if (job && (job.status === 'completed' || job.status === 'failed')) {
        return true;
      }
      await new Promise((r) => {
        const t = setTimeout(r, 25);
        t.unref?.();
      });
    }
    return false;
  }

  async process(jobId: string): Promise<void> {
    const job = await this.require(jobId);
    if (job.status === 'completed') return;
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    await this.save(job);

    try {
      job.result = await this.runKind(job.kind, job.input);
      job.status = 'completed';
      await this.writeVerdict(job.kind, job.jobId, job.result);
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
    }
    job.updatedAt = new Date().toISOString();
    await this.save(job);
  }

  parseWait(raw: string | undefined): number {
    if (!raw) return 0;
    const match = /^(\d+)s$/i.exec(raw.trim());
    if (!match) return 0;
    return Math.min(Number(match[1]) * 1000, 25_000);
  }

  private async runKind(kind: AnalysisKind, input: unknown): Promise<unknown> {
    switch (kind) {
      case 'grand-ijtihad': {
        const { text } = input as { text: string };
        return this.engine.grandIjtihad(text);
      }
      case 'conflict-resolution': {
        const { hadith1, hadith2 } = input as {
          hadith1: string;
          hadith2: string;
        };
        return this.engine.resolveConflict(hadith1, hadith2);
      }
      case 'rijal-validate': {
        const { sanad_text } = input as { sanad_text: string[] };
        return this.engine.validateSanad(sanad_text);
      }
      default:
        throw new RequestTimeoutAppError();
    }
  }

  private key(jobId: string): string {
    return `analysis:job:${jobId}`;
  }

  private verdictKey(kind: AnalysisKind, jobId: string): string {
    return `engine_verdicts:${kind}:${jobId}`;
  }

  private async readVerdict(
    kind: AnalysisKind,
    jobId: string,
  ): Promise<unknown | null> {
    if (kind !== 'grand-ijtihad') return null;
    const raw = await this.redis.get(this.verdictKey(kind, jobId));
    return raw ? (JSON.parse(raw) as unknown) : null;
  }

  private async writeVerdict(
    kind: AnalysisKind,
    jobId: string,
    result: unknown,
  ): Promise<void> {
    if (kind !== 'grand-ijtihad') return;
    await this.redis.set(
      this.verdictKey(kind, jobId),
      JSON.stringify(result),
      'EX',
      90 * 24 * 3600,
    );
  }

  private async save(job: AnalysisJob): Promise<void> {
    await this.redis.set(this.key(job.jobId), JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
  }
}
