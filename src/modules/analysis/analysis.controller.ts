import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { IsArray, IsString, MinLength } from 'class-validator';
import type { Response } from 'express';

import { Public } from '@common/decorators/public.decorator';
import { analysisResponse } from './analysis-http';
import { AnalysisJobsService } from './analysis-jobs.service';

class IjtihadDto {
  @IsString()
  @MinLength(10)
  text!: string;
}

class ConflictDto {
  @IsString()
  @MinLength(10)
  hadith1!: string;

  @IsString()
  @MinLength(10)
  hadith2!: string;
}

class RijalDto {
  @IsArray()
  @IsString({ each: true })
  sanad_text!: string[];
}

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly jobs: AnalysisJobsService) {}

  @Post('ijtihad')
  @Public()
  async ijtihad(
    @Body() body: IjtihadDto,
    @Query('wait') wait: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const submitted = await this.jobs.submit(
      'grand-ijtihad',
      { text: body.text },
      this.jobs.parseWait(wait),
    );
    return this.present(res, submitted);
  }

  @Post('conflict')
  @Public()
  async conflict(
    @Body() body: ConflictDto,
    @Query('wait') wait: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const submitted = await this.jobs.submit(
      'conflict-resolution',
      { hadith1: body.hadith1, hadith2: body.hadith2 },
      this.jobs.parseWait(wait),
    );
    return this.present(res, submitted);
  }

  @Post('rijal')
  @Public()
  async rijal(
    @Body() body: RijalDto,
    @Query('wait') wait: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const submitted = await this.jobs.submit(
      'rijal-validate',
      { sanad_text: body.sanad_text },
      this.jobs.parseWait(wait),
    );
    return this.present(res, submitted);
  }

  @Get('jobs/:jobId')
  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async getJob(@Param('jobId') jobId: string) {
    const job = await this.jobs.require(jobId);
    return {
      jobId: job.jobId,
      status: job.status,
      result: job.result ?? null,
      error: job.error ?? null,
    };
  }

  private present(
    res: Response,
    submitted: Awaited<ReturnType<AnalysisJobsService['submit']>>,
  ) {
    const mapped = analysisResponse(submitted);
    res.status(mapped.status);
    if (mapped.location) {
      res.setHeader('Location', mapped.location);
    }
    return mapped.body;
  }
}
