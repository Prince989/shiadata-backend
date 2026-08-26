import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { CONTENT_STATUSES, type ContentStatus } from './content-status';

@Schema({ collection: 'needs_matrix_topics' })
export class NeedsMatrixTopic {
  @Prop({ required: true })
  topic!: string;

  @Prop({ required: true, min: 0 })
  weight!: number;

  @Prop({ default: null, type: Date })
  claimedAt!: Date | null;

  @Prop({ default: 0 })
  claimVersion!: number;
}

export const NeedsMatrixTopicSchema =
  SchemaFactory.createForClass(NeedsMatrixTopic);

@Schema({ collection: 'islamic_calendar_events' })
export class IslamicCalendarEvent {
  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  gregorianDate!: string;

  @Prop({ default: false })
  confirmed!: boolean;
}

export const IslamicCalendarEventSchema =
  SchemaFactory.createForClass(IslamicCalendarEvent);

@Schema({ collection: 'generated_contents' })
export class GeneratedContent {
  @Prop({ required: true })
  title!: string;

  @Prop({ required: true, type: String, enum: CONTENT_STATUSES })
  status!: ContentStatus;

  @Prop({ type: [String], default: [] })
  citationIds!: string[];
}

export const GeneratedContentSchema =
  SchemaFactory.createForClass(GeneratedContent);
