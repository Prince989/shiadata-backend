import { Body, Controller, Post, Query, Req, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { Observable } from 'rxjs';

import { SWAGGER_BEARER_AUTH } from '@common/swagger/swagger.constants';

import { ForbiddenAppError } from '@common/errors/app.error';
import type { UserRecord } from '@modules/auth/auth.service';
import { CounselingOrchestrator } from './counseling-orchestrator';

class CounselingDto {
  @IsString()
  @MinLength(1)
  message!: string;
}

type AuthedRequest = { user?: UserRecord & { userId?: string } };

@ApiTags('lifestyle')
@ApiBearerAuth(SWAGGER_BEARER_AUTH)
@Controller('lifestyle')
export class LifestyleController {
  constructor(private readonly orch: CounselingOrchestrator) {}

  @Post('counseling')
  @ApiOperation({
    summary: 'One counseling turn',
    description:
      'Requires a Bearer token **and** a prior POST /api/v1/auth/counseling-consent. ' +
      'Register/login alone is not enough.',
  })
  async counseling(@Body() body: CounselingDto, @Req() req: AuthedRequest) {
    this.assertConsent(req.user);
    return this.orch.turn(body.message, this.ctx(req.user));
  }

  @Sse('counseling/stream')
  stream(
    @Query('message') message: string,
    @Req() req: AuthedRequest,
  ): Observable<{ data: unknown; type: string }> {
    this.assertConsent(req.user);
    const ctx = this.ctx(req.user);
    return new Observable((subscriber) => {
      void (async () => {
        try {
          for await (const chunk of this.orch.streamTurn(message ?? '', ctx)) {
            subscriber.next({ type: chunk.event, data: chunk.data });
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  }

  private assertConsent(user?: UserRecord) {
    if (!user?.counselingConsent) {
      throw new ForbiddenAppError(
        'Counseling consent is required. Call POST /api/v1/auth/counseling-consent with the same Bearer token first.',
      );
    }
  }

  private ctx(user?: UserRecord) {
    return {
      userId: user?.id,
      countryCode: user?.countryCode ?? '*',
    };
  }
}
