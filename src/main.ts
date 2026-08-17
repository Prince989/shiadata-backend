import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger, PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfig } from '@config/index';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { RequestIdInterceptor } from '@common/interceptors/request-id.interceptor';
import { TimeoutInterceptor } from '@common/interceptors/timeout.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const app_ = config.get<AppConfig>('app')!;
  const isProd = app_.nodeEnv === 'production';

  app.useLogger(app.get(Logger));

  app.setGlobalPrefix(app_.apiPrefix, {
    exclude: [{ path: 'health/*path', method: RequestMethod.GET }],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.use(
    helmet({
      // Swagger UI needs a relaxed CSP in dev; lock it down in production.
      contentSecurityPolicy: isProd ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Never ['*'] with credentials -- that is the exact CORS misconfiguration
  // the Python engine had (main.py previously combined allow_origins=["*"]
  // with allow_credentials=True, which browsers reject anyway).
  app.enableCors({
    origin: app_.corsOrigins.length > 0 ? app_.corsOrigins : false,
    credentials: app_.corsCredentials,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'Location'],
    maxAge: 86400,
  });

  // Only trust X-Forwarded-* if a real reverse proxy is actually in front of
  // this process. Enabling it without one lets any client forge its own IP
  // and walk straight through every IP-keyed rate limit.
  if (app_.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  app.useGlobalFilters(
    new AllExceptionsFilter(config, await app.resolve(PinoLogger)),
  );
  app.useGlobalInterceptors(
    new RequestIdInterceptor(),
    new TimeoutInterceptor(config),
  );

  app.enableShutdownHooks();

  const httpServer = app.getHttpServer();
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 70_000;

  if (app_.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('SHIA-DATA Backend')
        .setDescription('NestJS product layer for the SHIA-DATA AI Engine')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(app_.swaggerPath, app, document);
  }

  await app.listen(app_.port, '0.0.0.0');
}

void bootstrap();
