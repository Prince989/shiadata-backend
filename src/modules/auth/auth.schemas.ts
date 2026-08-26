import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'users', timestamps: true })
export class UserEntity {
  @Prop({ required: true, unique: true })
  userId!: string;

  @Prop({ required: true, unique: true, lowercase: true })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ default: '*' })
  countryCode!: string;

  @Prop({ default: 'fa' })
  locale!: string;

  @Prop({ default: false })
  counselingConsent!: boolean;
}

export const UserEntitySchema = SchemaFactory.createForClass(UserEntity);

@Schema({ collection: 'refresh_tokens', timestamps: true })
export class RefreshTokenEntity {
  @Prop({ required: true, unique: true })
  tokenId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ default: null, type: String })
  replacedBy!: string | null;

  @Prop({ default: false })
  revoked!: boolean;
}

export const RefreshTokenEntitySchema =
  SchemaFactory.createForClass(RefreshTokenEntity);
