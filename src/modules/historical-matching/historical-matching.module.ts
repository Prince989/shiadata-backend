import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  HistoricalEvent,
  HistoricalEventSchema,
} from './historical-event.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HistoricalEvent.name, schema: HistoricalEventSchema },
    ]),
  ],
})
export class HistoricalMatchingModule {}
