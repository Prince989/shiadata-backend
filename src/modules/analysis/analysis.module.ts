import { Module } from '@nestjs/common';

import { PythonEngineModule } from '@modules/ai-engine-client/python-engine.module';
import { AnalysisJobsService } from './analysis-jobs.service';
import { AnalysisController } from './analysis.controller';

@Module({
  imports: [PythonEngineModule],
  controllers: [AnalysisController],
  providers: [AnalysisJobsService],
  exports: [AnalysisJobsService],
})
export class AnalysisModule {}
