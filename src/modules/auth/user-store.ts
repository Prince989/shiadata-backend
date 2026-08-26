import { randomUUID } from 'node:crypto';

import type { RefreshRecord, UserRecord } from './auth.types';

export const USER_STORE = Symbol('USER_STORE');

export interface IUserStore {
  createUser(
    email: string,
    passwordHash: string,
    extras?: { countryCode?: string },
  ): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | undefined>;
  findById(id: string): Promise<UserRecord | undefined>;
  saveUser(user: UserRecord): Promise<void>;
  findRefreshByHash(tokenHash: string): Promise<RefreshRecord | undefined>;
  saveRefresh(record: RefreshRecord): Promise<void>;
  revokeFamily(userId: string): Promise<void>;
}

export class MemoryUserStore implements IUserStore {
  users = new Map<string, UserRecord>();
  byEmail = new Map<string, string>();
  refresh = new Map<string, RefreshRecord>();

  async createUser(
    email: string,
    passwordHash: string,
    extras: { countryCode?: string } = {},
  ): Promise<UserRecord> {
    const id = randomUUID();
    const user: UserRecord = {
      id,
      email: email.toLowerCase(),
      passwordHash,
      countryCode: extras.countryCode ?? '*',
      locale: 'fa',
      counselingConsent: false,
    };
    this.users.set(id, user);
    this.byEmail.set(user.email, id);
    return user;
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const id = this.byEmail.get(email.toLowerCase());
    return id ? this.users.get(id) : undefined;
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    return this.users.get(id);
  }

  async saveUser(user: UserRecord): Promise<void> {
    this.users.set(user.id, user);
    this.byEmail.set(user.email, user.id);
  }

  async findRefreshByHash(
    tokenHash: string,
  ): Promise<RefreshRecord | undefined> {
    return [...this.refresh.values()].find((r) => r.tokenHash === tokenHash);
  }

  async saveRefresh(record: RefreshRecord): Promise<void> {
    this.refresh.set(record.id, record);
  }

  async revokeFamily(userId: string): Promise<void> {
    for (const rec of this.refresh.values()) {
      if (rec.userId === userId) rec.revoked = true;
    }
  }
}
