import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { EngineVerdict, EngineVerdictSchema } from './engine-verdict.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EngineVerdict.name, schema: EngineVerdictSchema },
    ]),
  ],
})
export class IjtihadModule {}
