import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  GeneratedContent,
  GeneratedContentSchema,
  IslamicCalendarEvent,
  IslamicCalendarEventSchema,
  NeedsMatrixTopic,
  NeedsMatrixTopicSchema,
} from './content-factory.schemas';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NeedsMatrixTopic.name, schema: NeedsMatrixTopicSchema },
      { name: IslamicCalendarEvent.name, schema: IslamicCalendarEventSchema },
      { name: GeneratedContent.name, schema: GeneratedContentSchema },
    ]),
  ],
})
export class ContentFactoryModule {}
