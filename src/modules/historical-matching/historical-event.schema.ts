import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'historical_events' })
export class HistoricalEvent {
  @Prop({ required: true, unique: true })
  historicalEventId!: string;

  @Prop({ required: true })
  title!: string;

  @Prop()
  yearHijri?: number;
}

export const HistoricalEventSchema =
  SchemaFactory.createForClass(HistoricalEvent);
