import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';

import type { RefreshRecord, UserRecord } from './auth.types';
import {
  RefreshTokenEntity,
  UserEntity,
} from './auth.schemas';
import type { IUserStore } from './user-store';

@Injectable()
export class MongoUserStore implements IUserStore {
  constructor(
    @InjectModel(UserEntity.name)
    private readonly users: Model<UserEntity>,
    @InjectModel(RefreshTokenEntity.name)
    private readonly refresh: Model<RefreshTokenEntity>,
  ) {}

  async createUser(
    email: string,
    passwordHash: string,
    extras: { countryCode?: string } = {},
  ): Promise<UserRecord> {
    const userId = randomUUID();
    const doc = await this.users.create({
      userId,
      email: email.toLowerCase(),
      passwordHash,
      countryCode: extras.countryCode ?? '*',
      locale: 'fa',
      counselingConsent: false,
    });
    return this.toUser(doc);
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const doc = await this.users.findOne({ email: email.toLowerCase() }).exec();
    return doc ? this.toUser(doc) : undefined;
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    const doc = await this.users.findOne({ userId: id }).exec();
    return doc ? this.toUser(doc) : undefined;
  }

  async saveUser(user: UserRecord): Promise<void> {
    await this.users
      .updateOne(
        { userId: user.id },
        {
          email: user.email,
          passwordHash: user.passwordHash,
          countryCode: user.countryCode,
          locale: user.locale,
          counselingConsent: user.counselingConsent,
        },
      )
      .exec();
  }

  async findRefreshByHash(
    tokenHash: string,
  ): Promise<RefreshRecord | undefined> {
    const doc = await this.refresh.findOne({ tokenHash }).exec();
    return doc ? this.toRefresh(doc) : undefined;
  }

  async saveRefresh(record: RefreshRecord): Promise<void> {
    await this.refresh
      .updateOne(
        { tokenId: record.id },
        {
          tokenId: record.id,
          userId: record.userId,
          tokenHash: record.tokenHash,
          replacedBy: record.replacedBy ?? null,
          revoked: record.revoked,
        },
        { upsert: true },
      )
      .exec();
  }

  async revokeFamily(userId: string): Promise<void> {
    await this.refresh
      .updateMany({ userId }, { $set: { revoked: true } })
      .exec();
  }

  private toUser(doc: UserEntity): UserRecord {
    return {
      id: doc.userId,
      email: doc.email,
      passwordHash: doc.passwordHash,
      countryCode: doc.countryCode,
      locale: doc.locale,
      counselingConsent: doc.counselingConsent,
    };
  }

  private toRefresh(doc: RefreshTokenEntity): RefreshRecord {
    return {
      id: doc.tokenId,
      userId: doc.userId,
      tokenHash: doc.tokenHash,
      replacedBy: doc.replacedBy ?? undefined,
      revoked: doc.revoked,
    };
  }
}
