import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MongooseHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '@common/decorators/public.decorator';
import { RedisHealthIndicator } from './redis-health.indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /**
   * Process-only liveness. Never touches Mongo, Redis, or (once it exists)
   * the Python engine -- an orchestrator restarting Nest because a
   * downstream dependency is slow is a self-inflicted outage.
   */
  @Get('live')
  @Version(VERSION_NEUTRAL)
  @Public()
  live() {
    return { status: 'ok' };
  }

  /**
   * Deliberately excludes the Python engine (added in milestone 4). Nest can
   * serve auth, users, sessions, and jobs with the Python engine completely
   * offline, so coupling readiness to it would mean a busy/degraded Python
   * process takes this API out of rotation for no reason.
   */
  @Get('ready')
  @Version(VERSION_NEUTRAL)
  @Public()
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.mongoose.pingCheck('mongo'),
      () => this.redis.check('redis'),
    ]);
  }
}
