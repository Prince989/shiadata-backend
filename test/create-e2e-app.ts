import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Logger, PinoLogger } from 'nestjs-pino';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { TimeoutInterceptor } from '../src/common/interceptors/timeout.interceptor';

export async function createE2eApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health/*path', method: RequestMethod.GET }],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const config = app.get(ConfigService);
  app.useGlobalFilters(
    new AllExceptionsFilter(config, await app.resolve(PinoLogger)),
  );
  app.useGlobalInterceptors(
    new RequestIdInterceptor(),
    new TimeoutInterceptor(config),
  );
  await app.init();
  return app;
}
