import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'llm_call_logs' })
export class LlmCallLog {
  @Prop({ required: true, index: true }) requestId: string;
  @Prop() traceId?: string;
  @Prop() userId?: string;
  @Prop({ required: true, index: true }) feature: string;

  @Prop({ required: true }) provider: string;
  @Prop({ required: true }) model: string;
  @Prop({ required: true }) keyId: string;

  @Prop({ required: true }) inputTokens: number;
  @Prop({ required: true }) outputTokens: number;
  @Prop({ required: true }) costUsd: number;
  @Prop({ required: true }) latencyMs: number;

  @Prop({ default: false }) cacheHit: boolean;
  @Prop({ default: false }) repaired: boolean;
  @Prop({ required: true, index: true }) outcome: 'success' | 'error';
  @Prop() errorCode?: string;
}

export type LlmCallLogDocument = HydratedDocument<LlmCallLog>;
export const LlmCallLogSchema = SchemaFactory.createForClass(LlmCallLog);

// TTL index: default 90-day retention, configurable at the service layer by
// rebuilding this index -- kept simple here since call logs are diagnostic,
// not the record a scholar would ever need to audit (that's EngineVerdict,
// added in the ijtihad module).
LlmCallLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 },
);
LlmCallLogSchema.index({ userId: 1, createdAt: -1 });
