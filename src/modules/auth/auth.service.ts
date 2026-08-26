import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { RefreshRecord, UserRecord } from './auth.types';
import { IUserStore, USER_STORE } from './user-store';

export type { RefreshRecord, UserRecord } from './auth.types';
export { MemoryUserStore, USER_STORE } from './user-store';
export type { IUserStore } from './user-store';

@Injectable()
export class PasswordService {
  /**
   * Uses scrypt (stdlib) so tests/Windows don't need native argon2 bindings.
   * Production can swap to @node-rs/argon2 without changing AuthService.
   */
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const { scrypt } = await import('node:crypto');
    const { promisify } = await import('node:util');
    const buf = (await promisify(scrypt)(plain, salt, 32)) as Buffer;
    return `scrypt:${salt}:${buf.toString('hex')}`;
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const [scheme, salt, hex] = stored.split(':');
    if (scheme !== 'scrypt' || !salt || !hex) return false;
    const { scrypt, timingSafeEqual } = await import('node:crypto');
    const { promisify } = await import('node:util');
    const buf = (await promisify(scrypt)(plain, salt, 32)) as Buffer;
    const expected = Buffer.from(hex, 'hex');
    if (buf.length !== expected.length) return false;
    return timingSafeEqual(buf, expected);
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_STORE) private readonly users: IUserStore,
    private readonly passwords: PasswordService,
  ) {}

  async register(
    email: string,
    password: string,
    extras: { countryCode?: string } = {},
  ) {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new Error('email-taken');
    const passwordHash = await this.passwords.hash(password);
    const user = await this.users.createUser(email, passwordHash, extras);
    return this.issue(user);
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !(await this.passwords.verify(password, user.passwordHash))) {
      throw new Error('invalid-credentials');
    }
    return this.issue(user);
  }

  async rotateRefresh(presented: string) {
    const hash = this.passwords.hashRefresh(presented);
    const found = await this.users.findRefreshByHash(hash);
    if (!found || found.revoked) throw new Error('invalid-refresh');
    if (found.replacedBy) {
      await this.users.revokeFamily(found.userId);
      throw new Error('refresh-reuse');
    }
    const user = await this.users.findById(found.userId);
    if (!user) throw new Error('invalid-refresh');
    const next = await this.issue(user);
    found.replacedBy = this.passwords.hashRefresh(next.refreshToken);
    await this.users.saveRefresh(found);
    return next;
  }

  async grantCounselingConsent(userId: string): Promise<UserRecord> {
    const user = await this.users.findById(userId);
    if (!user) throw new Error('invalid-user');
    user.counselingConsent = true;
    await this.users.saveUser(user);
    return user;
  }

  private async issue(user: UserRecord) {
    const refreshToken = randomBytes(32).toString('hex');
    const rec: RefreshRecord = {
      id: randomUUID(),
      userId: user.id,
      tokenHash: this.passwords.hashRefresh(refreshToken),
      revoked: false,
    };
    await this.users.saveRefresh(rec);
    return {
      userId: user.id,
      email: user.email,
      accessToken: `access.${user.id}`,
      refreshToken,
    };
  }
}
