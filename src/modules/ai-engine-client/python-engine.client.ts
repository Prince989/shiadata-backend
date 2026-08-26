import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import type { z } from 'zod';

import type { PythonEngineConfig } from '@config/index';
import { getRequestId } from '@common/utils/request-context';
import {
  EngineInvalidResponseError,
  EngineUnavailableError,
  ForbiddenAppError,
} from '@common/errors/app.error';
import {
  ENGINE_ENDPOINTS,
  ENGINE_FORBIDDEN_PATHS,
  type EngineEndpointDef,
  type EngineEndpointId,
} from './engine-endpoints';
import { EngineSemaphore } from './engine-semaphore';
import type {
  ChatResponse,
  CollectionInfo,
  ConflictResolutionResponse,
  EngineHealthResponse,
  IjtihadVerdictResponse,
  SanadExtractionResponse,
  SanadValidationResponse,
  SearchResponse,
} from './contracts/engine-responses';

export interface VectorSearchInput {
  query: string;
  collection: 'theology' | 'hadith' | 'rijal' | 'quran';
  top_k?: number;
  filters?: Record<string, string | number | boolean>;
  search_type?: 'similarity' | 'mmr';
  fetch_k?: number;
  lambda_mult?: number;
  include_distances?: boolean;
}

@Injectable()
export class PythonEngineClient {
  private readonly logger = new Logger(PythonEngineClient.name);
  private readonly engine: PythonEngineConfig;

  constructor(
    private readonly http: HttpService,
    private readonly semaphore: EngineSemaphore,
    config: ConfigService,
  ) {
    this.engine = config.get<PythonEngineConfig>('pythonEngine')!;
  }

  search(input: VectorSearchInput): Promise<SearchResponse> {
    return this.call('search', input);
  }

  listCollections(): Promise<CollectionInfo[]> {
    return this.call('collections');
  }

  chat(body: {
    question: string;
    collection?: VectorSearchInput['collection'];
    top_k?: number;
  }): Promise<ChatResponse> {
    return this.call('chat', body);
  }

  extractSanad(text: string): Promise<SanadExtractionResponse> {
    return this.call('extractSanad', { text });
  }

  validateSanad(sanad_text: string[]): Promise<SanadValidationResponse> {
    return this.call('validateSanad', { sanad_text });
  }

  grandIjtihad(text: string): Promise<IjtihadVerdictResponse> {
    return this.call('grandIjtihad', { text });
  }

  resolveConflict(
    hadith1: string,
    hadith2: string,
  ): Promise<ConflictResolutionResponse> {
    return this.call('conflictResolution', { hadith1, hadith2 });
  }

  health(): Promise<EngineHealthResponse> {
    return this.call('health');
  }

  async call<K extends EngineEndpointId>(
    id: K,
    body?: unknown,
  ): Promise<z.infer<(typeof ENGINE_ENDPOINTS)[K]['schema']>> {
    const endpoint = ENGINE_ENDPOINTS[id];
    this.assertAllowed(endpoint.path);

    const exec = () => this.dispatch(endpoint, body);
    const result =
      endpoint.weight === 'heavy'
        ? await this.semaphore.withLock(exec)
        : await exec();
    return result as z.infer<(typeof ENGINE_ENDPOINTS)[K]['schema']>;
  }

  private assertAllowed(path: string): void {
    if (ENGINE_FORBIDDEN_PATHS.includes(path)) {
      throw new ForbiddenAppError();
    }
  }

  private async dispatch(
    endpoint: EngineEndpointDef,
    body: unknown,
  ): Promise<unknown> {
    const url = `${this.engine.baseUrl.replace(/\/$/, '')}${endpoint.path}`;
    const headers: Record<string, string> = {
      'X-Request-Id': getRequestId() ?? 'engine',
    };
    if (this.engine.internalApiKey) {
      headers['X-Internal-API-Key'] = this.engine.internalApiKey;
    }

    const config: AxiosRequestConfig = {
      method: endpoint.method,
      url,
      headers,
      timeout: endpoint.timeoutMs,
      validateStatus: () => true,
      ...(endpoint.method === 'POST' ? { data: body } : {}),
    };

    let lastError: unknown;
    const attempts = endpoint.retries + 1;
    for (let i = 0; i < attempts; i++) {
      try {
        const response = await firstValueFrom(this.http.request(config));
        if (response.status >= 500) {
          lastError = response.data;
          this.logger.error(
            {
              path: endpoint.path,
              status: response.status,
              // Log Python detail server-side only; never return it.
              pythonDetail: this.extractDetail(response.data),
            },
            'python engine 5xx',
          );
          if (i < attempts - 1) continue;
          throw new EngineUnavailableError();
        }
        if (response.status >= 400) {
          this.logger.warn(
            {
              path: endpoint.path,
              status: response.status,
              pythonDetail: this.extractDetail(response.data),
            },
            'python engine 4xx',
          );
          throw new EngineUnavailableError();
        }
        const parsed = endpoint.schema.safeParse(response.data);
        if (!parsed.success) {
          this.logger.error(
            { path: endpoint.path, issues: parsed.error.issues },
            'python engine schema mismatch',
          );
          throw new EngineInvalidResponseError();
        }
        return parsed.data;
      } catch (err) {
        if (
          err instanceof EngineUnavailableError ||
          err instanceof EngineInvalidResponseError
        ) {
          throw err;
        }
        lastError = err;
        const axiosErr = err as AxiosError;
        this.logger.error(
          {
            path: endpoint.path,
            code: axiosErr.code,
            message: axiosErr.message,
          },
          'python engine transport error',
        );
        if (i >= attempts - 1) throw new EngineUnavailableError();
      }
    }
    this.logger.error({ lastError: String(lastError) }, 'python engine exhausted retries');
    throw new EngineUnavailableError();
  }

  private extractDetail(data: unknown): string | undefined {
    if (data && typeof data === 'object' && 'detail' in data) {
      const detail = (data as { detail: unknown }).detail;
      return typeof detail === 'string' ? detail : JSON.stringify(detail);
    }
    return undefined;
  }
}
