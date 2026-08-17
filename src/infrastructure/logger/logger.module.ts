import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AppConfig } from '@config/index';
import { PINO_REDACT_PATHS, scrubSecrets } from './redaction';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const app = config.get<AppConfig>('app')!;
        return {
          pinoHttp: {
            level: app.logLevel,
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const existing = req.headers['x-request-id'];
              const id =
                (Array.isArray(existing) ? existing[0] : existing) ??
                randomUUID();
              res.setHeader('X-Request-Id', id);
              return id;
            },
            customProps: (
              req: IncomingMessage & { user?: { userId?: string } },
            ) => ({
              userId: req.user?.userId,
            }),
            autoLogging: {
              ignore: (req: IncomingMessage) =>
                req.url?.startsWith('/health') ?? false,
            },
            redact: { paths: PINO_REDACT_PATHS, censor: '[REDACTED]' },
            formatters: {
              log(object: Record<string, unknown>) {
                const scrubbed: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(object)) {
                  scrubbed[key] =
                    typeof value === 'string' ? scrubSecrets(value) : value;
                }
                return scrubbed;
              },
            },
            transport: app.logPretty
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, colorize: true },
                }
              : undefined,
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
