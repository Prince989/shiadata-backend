import { Module } from '@nestjs/common';

import { AiGatewayModule } from '@modules/ai-gateway/ai-gateway.module';
import { PythonEngineModule } from '@modules/ai-engine-client/python-engine.module';
import { SafetyModule } from '@modules/safety/safety.module';
import { CounselingOrchestrator } from './counseling-orchestrator';
import { GatewayLifestyleAgents } from './gateway-lifestyle-agents';
import { LIFESTYLE_AGENTS } from './lifestyle-agents';
import { LifestyleController } from './lifestyle.controller';

@Module({
  imports: [SafetyModule, PythonEngineModule, AiGatewayModule],
  controllers: [LifestyleController],
  providers: [
    CounselingOrchestrator,
    { provide: LIFESTYLE_AGENTS, useClass: GatewayLifestyleAgents },
  ],
  exports: [CounselingOrchestrator],
})
export class LifestyleModule {}
