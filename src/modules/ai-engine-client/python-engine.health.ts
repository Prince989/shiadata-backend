import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'node:net';

import type { PythonEngineConfig } from '@config/index';
import { PythonEngineClient } from './python-engine.client';

export type EngineProbeState = 'up' | 'degraded' | 'down';

export interface EngineProbeResult {
  state: EngineProbeState;
  tcpOk: boolean;
  httpOk: boolean;
  reason?: string;
}

/**
 * TCP fail → down (process not listening).
 * TCP ok + HTTP timeout/5xx → degraded (loop busy, still accepting).
 * HTTP 200 → up.
 *
 * Keep this OUT of /health/ready. Nest can serve auth/users/jobs with
 * Python offline.
 */
@Injectable()
export class PythonEngineHealth {
  constructor(
    private readonly client: PythonEngineClient,
    private readonly config: ConfigService,
  ) {}

  async probe(heavyJobActive = false): Promise<EngineProbeResult> {
    const engine = this.config.get<PythonEngineConfig>('pythonEngine')!;
    const tcpOk = await this.tcpConnect(engine.host, engine.port, 800);
    if (!tcpOk) {
      return { state: 'down', tcpOk: false, httpOk: false, reason: 'tcp' };
    }
    try {
      await this.client.health();
      return { state: 'up', tcpOk: true, httpOk: true };
    } catch {
      if (heavyJobActive) {
        return {
          state: 'up',
          tcpOk: true,
          httpOk: false,
          reason: 'busy',
        };
      }
      return {
        state: 'degraded',
        tcpOk: true,
        httpOk: false,
        reason: 'http',
      };
    }
  }

  private tcpConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ host, port });
      const done = (ok: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }
}
