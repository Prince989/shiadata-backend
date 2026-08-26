import { ConfigService } from '@nestjs/config';

import { FakeRedis } from '@/test-utils/fake-redis';
import { pairHash } from '@common/utils/arabic-normalize';
import { PythonEngineClient } from '@modules/ai-engine-client/python-engine.client';
import { AnalysisJobsService } from './analysis-jobs.service';

const verdict = {
  narrators_status: [{ name: 'زرارة', status: 'ثقة' }],
  sanad_status: 'صحیح',
  quran_alignment: 'موافق',
  shawahid_status: 'موجود',
  final_verdict: 'حجت',
  detailed_reasoning: 'استدلال',
};

describe('AnalysisJobsService', () => {
  function build(
    engine: Partial<PythonEngineClient> = {},
  ): {
    jobs: AnalysisJobsService;
    engine: { grandIjtihad: jest.Mock };
    redis: FakeRedis;
  } {
    const redis = new FakeRedis();
    const grandIjtihad = jest.fn().mockResolvedValue(verdict);
    const client = {
      grandIjtihad,
      resolveConflict: jest.fn(),
      validateSanad: jest.fn(),
      ...engine,
    } as unknown as PythonEngineClient;
    const config = { get: () => ({}) } as unknown as ConfigService;
    process.env.WORKER_ROLE = 'all';
    const jobs = new AnalysisJobsService(redis as never, client, config);
    return { jobs, engine: { grandIjtihad }, redis };
  }

  it('collapses two identical submissions to one jobId', () => {
    const { jobs } = build();
    const a = jobs.jobIdFor('grand-ijtihad', { text: 'مُحَمَّدُ بْنُ يَحْيَى' });
    const b = jobs.jobIdFor('grand-ijtihad', { text: 'محمد بن يحيى' });
    expect(a).toBe(b);
  });

  it('does not treat swapped conflict hadiths as the same cache key', () => {
    const { jobs } = build();
    const forward = jobs.jobIdFor('conflict-resolution', {
      hadith1: 'حديث اول',
      hadith2: 'حديث دوم',
    });
    const swapped = jobs.jobIdFor('conflict-resolution', {
      hadith1: 'حديث دوم',
      hadith2: 'حديث اول',
    });
    expect(forward).not.toBe(swapped);
    expect(pairHash('حديث اول', 'حديث دوم')).not.toBe(
      pairHash('حديث دوم', 'حديث اول'),
    );
  });

  it('reuses a completed result without calling Python again', async () => {
    const { jobs, engine } = build();
    const first = await jobs.submit(
      'grand-ijtihad',
      { text: 'عن أبي عبد الله قال كذا' },
      5_000,
    );
    expect(first.status).toBe('completed');
    expect(engine.grandIjtihad).toHaveBeenCalledTimes(1);

    const second = await jobs.submit(
      'grand-ijtihad',
      { text: 'عن أبي عبد الله قال كذا' },
      5_000,
    );
    expect(second.reused).toBe(true);
    expect(engine.grandIjtihad).toHaveBeenCalledTimes(1);
  });

  it('caps wait at 25 seconds', () => {
    const { jobs } = build();
    expect(jobs.parseWait('180s')).toBe(25_000);
    expect(jobs.parseWait('10s')).toBe(10_000);
    expect(jobs.parseWait(undefined)).toBe(0);
  });

  it('reuses an ijtihad verdict after the job document expires', async () => {
    const { jobs, engine, redis } = build();
    const input = { text: 'عن أبي عبد الله قال كذا' };
    const first = await jobs.submit('grand-ijtihad', input, 5_000);
    expect(first.status).toBe('completed');
    await redis.del(`analysis:job:${first.jobId}`);
    expect(await jobs.get(first.jobId)).toBeNull();

    const second = await jobs.submit('grand-ijtihad', input, 5_000);
    expect(second.reused).toBe(true);
    expect(second.result).toEqual(verdict);
    expect(engine.grandIjtihad).toHaveBeenCalledTimes(1);
  });
});
