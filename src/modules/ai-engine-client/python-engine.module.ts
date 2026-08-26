import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as http from 'node:http';

import type { PythonEngineConfig } from '@config/index';
import { EngineSemaphore } from './engine-semaphore';
import { PythonEngineClient } from './python-engine.client';
import { PythonEngineHealth } from './python-engine.health';

@Module({
  imports: [
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const engine = config.get<PythonEngineConfig>('pythonEngine')!;
        return {
          timeout: 15_000,
          maxRedirects: 0,
          httpAgent: new http.Agent({
            keepAlive: true,
            maxSockets: 8,
          }),
          baseURL: engine.baseUrl,
        };
      },
    }),
  ],
  providers: [EngineSemaphore, PythonEngineClient, PythonEngineHealth],
  exports: [PythonEngineClient, PythonEngineHealth],
})
export class PythonEngineModule {}
