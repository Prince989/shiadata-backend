import { of, throwError, Observable } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';

import { FakeRedis } from '@/test-utils/fake-redis';
import {
  EngineInvalidResponseError,
  EngineUnavailableError,
} from '@common/errors/app.error';
import { ENGINE_FORBIDDEN_PATHS } from './engine-endpoints';
import { EngineSemaphore } from './engine-semaphore';
import { PythonEngineClient } from './python-engine.client';

function engineConfig() {
  return {
    get: () => ({
      baseUrl: 'http://127.0.0.1:8000',
      internalApiKey: 'secret',
      host: '127.0.0.1',
      port: 8000,
    }),
  } as unknown as ConfigService;
}

function buildClient(http: { request: jest.Mock }) {
  const redis = new FakeRedis();
  const semaphore = new EngineSemaphore(redis as never, engineConfig());
  return {
    client: new PythonEngineClient(
      http as unknown as HttpService,
      semaphore,
      engineConfig(),
    ),
    redis,
    http,
  };
}

const searchOk = {
  collection: 'hadith',
  query: 'صلاة',
  total_found: 1,
  documents: [
    {
      content: 'عن زرارة',
      metadata: { book_title: 'الكافي' },
      distance: 0.2,
      book_title: 'الكافي',
      chapter: 'باب',
      domain: 'fiqh',
    },
  ],
};

describe('PythonEngineClient', () => {
  it('deny-lists the broken storyteller path', () => {
    expect(ENGINE_FORBIDDEN_PATHS).toContain('/api/v1/story/generate-step');
    expect(ENGINE_FORBIDDEN_PATHS).not.toContain('/api/v1/chat');
  });

  it('returns a Zod-parsed search payload', async () => {
    const http = { request: jest.fn().mockReturnValue(of({ status: 200, data: searchOk })) };
    const { client } = buildClient(http);
    const result = await client.search({ query: 'صلاة', collection: 'hadith' });
    expect(result.documents[0]?.book_title).toBe('الكافي');
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('maps Python 500 detail to a generic EngineUnavailableError', async () => {
    const http = {
      request: jest.fn().mockReturnValue(
        of({
          status: 500,
          data: { detail: 'C:\\secrets\\chroma failed: sk-abc' },
        }),
      ),
    };
    const { client } = buildClient(http);
    await expect(
      client.search({ query: 'x', collection: 'hadith' }),
    ).rejects.toBeInstanceOf(EngineUnavailableError);

    try {
      await client.search({ query: 'x', collection: 'hadith' });
    } catch (err) {
      expect((err as EngineUnavailableError).safeMessage).not.toContain('chroma');
      expect((err as EngineUnavailableError).safeMessage).not.toContain('sk-');
    }
  });

  it('rejects a 200 body that does not match the contract', async () => {
    const http = {
      request: jest.fn().mockReturnValue(of({ status: 200, data: { nope: true } })),
    };
    const { client } = buildClient(http);
    await expect(
      client.search({ query: 'x', collection: 'hadith' }),
    ).rejects.toBeInstanceOf(EngineInvalidResponseError);
  });

  it('does not retry heavy ijtihad on timeout', async () => {
    const http = {
      request: jest
        .fn()
        .mockReturnValue(throwError(() => Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))),
    };
    const { client } = buildClient(http);
    await expect(
      client.grandIjtihad('عن أبي عبد الله عليه السلام قال'),
    ).rejects.toBeInstanceOf(EngineUnavailableError);
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('retries a light search once on transport failure', async () => {
    const http = {
      request: jest
        .fn()
        .mockReturnValueOnce(
          throwError(() => Object.assign(new Error('reset'), { code: 'ECONNRESET' })),
        )
        .mockReturnValueOnce(of({ status: 200, data: searchOk })),
    };
    const { client } = buildClient(http);
    const result = await client.search({ query: 'صلاة', collection: 'hadith' });
    expect(result.total_found).toBe(1);
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it('serializes two heavy calls through the semaphore', async () => {
    let inflight = 0;
    let max = 0;
    const http = {
      request: jest.fn().mockImplementation(
        () =>
          new Observable((subscriber) => {
            inflight++;
            max = Math.max(max, inflight);
            setTimeout(() => {
              inflight--;
              subscriber.next({
                status: 200,
                data: {
                  overall_status: 'صحیح',
                  narrators: [],
                  detailed_analysis: 'ok',
                },
              });
              subscriber.complete();
            }, 30);
          }),
      ),
    };
    const { client } = buildClient(http);
    await Promise.all([
      client.validateSanad(['زرارة']),
      client.validateSanad(['محمد بن مسلم']),
    ]);
    expect(max).toBe(1);
  });
});
