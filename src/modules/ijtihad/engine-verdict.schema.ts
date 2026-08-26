import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Durable cache of Python grand-ijtihad output, keyed the same way as
 * analysis jobs. Redis holds a copy for fast reuse; this collection is
 * the Mongo counterpart for later persistence.
 */
@Schema({ collection: 'engine_verdicts', timestamps: true })
export class EngineVerdict {
  @Prop({ required: true, unique: true })
  jobId!: string;

  @Prop({ required: true, type: String, enum: ['grand-ijtihad'] })
  kind!: 'grand-ijtihad';

  @Prop({ type: Object, required: true })
  result!: Record<string, unknown>;
}

export const EngineVerdictSchema = SchemaFactory.createForClass(EngineVerdict);
