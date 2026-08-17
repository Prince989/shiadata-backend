import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '@infra/redis/redis.module';
import type { LlmConfig, ProviderName } from '@config/index';
import {
  CoolingKey,
  IKeyPool,
  KeyFailureKind,
  KeyPoolSnapshot,
  LlmKey,
} from '../interfaces/key-pool.interface';

interface CooldownRecord {
  reason: KeyFailureKind;
  strikes: number;
  retryAtMs: number;
}

// Failure kinds that mean "this key is unhealthy right now" and should
// therefore cool down and rotate away from. BadRequest/ContentFiltered are
// deliberately absent: they are our fault (schema/prompt) or the provider's
// safety system doing its job, not evidence the key itself is bad. Cooling
// the key on either would burn through the whole pool retrying a request
// that is going to fail identically on every key -- converting one bad
// prompt into a full outage. Malformed output is handled entirely by
// StructuredOutputService's repair path and never reaches here either.
const COOLING_KINDS = new Set<KeyFailureKind>([
  KeyFailureKind.RateLimited,
  KeyFailureKind.QuotaExhausted,
  KeyFailureKind.AuthInvalid,
  KeyFailureKind.Timeout,
  KeyFailureKind.ServerError,
]);

const PROBE_WINDOW_MS = 10_000;

/**
 * Round-robin key pool with per-failure-kind cooldowns, backed by Redis so
 * the rotation state (and the health of a key) is shared across every
 * replica -- an in-process counter would mean every replica hammers key #1
 * first, and one replica cooling a key would be invisible to the others.
 */
@Injectable()
export class KeyPoolService implements IKeyPool, OnModuleInit {
  private readonly logger = new Logger(KeyPoolService.name);
  private readonly config: LlmConfig;
  private pools = new Map<ProviderName, LlmKey[]>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    this.config = configService.get<LlmConfig>('llm')!;
  }

  onModuleInit(): void {
    this.pools.set('gemini', this.loadKeys('gemini', 'GOOGLE_API_KEY'));
    this.pools.set('openai', this.loadKeys('openai', 'OPENAI_API_KEY'));

    for (const [provider, keys] of this.pools) {
      if (keys.length === 0) {
        this.logger.warn(`No ${provider} keys configured`);
      } else {
        this.logger.log(`Loaded ${keys.length} distinct ${provider} key(s)`);
        if (keys.length === 1) {
          this.logger.warn(
            `Only one distinct ${provider} key is configured. Rotation ` +
              `provides failover only, not additional quota.`,
          );
        }
      }
    }
  }

  poolSize(provider: ProviderName): number {
    return this.pools.get(provider)?.length ?? 0;
  }

  async acquire(provider: ProviderName): Promise<LlmKey | null> {
    const pool = this.pools.get(provider) ?? [];
    if (pool.length === 0) return null;

    const cooldowns = await this.readCooldowns(pool.map((k) => k.id));
    const now = Date.now();

    const candidates = pool.filter((key) => {
      const record = cooldowns.get(key.id);
      return !record || record.retryAtMs <= now;
    });
    if (candidates.length === 0) return null;

    // Round-robin over the healthy subset via a shared Redis counter.
    const counterKey = `aigw:rr:${provider}`;
    const counter = await this.redis.incr(counterKey);
    const chosen = candidates[counter % candidates.length]!;

    // Half-open: a key whose cooldown JUST expired gets a single probe.
    // Concurrent callers that lose the race skip it this round rather than
    // all piling onto a key that might still be exhausted.
    const wasRecoveringCooldown = cooldowns.get(chosen.id);
    if (wasRecoveringCooldown) {
      const probeLockKey = `aigw:probing:${chosen.id}`;
      const acquiredLock = await this.redis.set(
        probeLockKey,
        '1',
        'PX',
        PROBE_WINDOW_MS,
        'NX',
      );
      if (acquiredLock === null) {
        // Someone else is already probing this key -- try the next candidate.
        const others = candidates.filter((k) => k.id !== chosen.id);
        if (others.length === 0) return null;
        return others[counter % others.length]!;
      }
    }

    return chosen;
  }

  async reportSuccess(keyId: string): Promise<void> {
    const successKey = `aigw:success:${keyId}`;
    const strikesKey = `aigw:cool:${keyId}`;
    const successes = await this.redis.incr(successKey);
    await this.redis.pexpire(successKey, 3_600_000);

    if (successes >= this.config.keySuccessResetCount) {
      await this.redis.del(strikesKey, successKey);
    }
  }

  async reportFailure(
    keyId: string,
    kind: KeyFailureKind,
    retryAfterMs?: number,
  ): Promise<void> {
    if (!COOLING_KINDS.has(kind)) return;

    await this.redis.del(`aigw:success:${keyId}`);

    const strikesKey = `aigw:cool:${keyId}`;
    const raw = await this.redis.get(strikesKey);
    const previous = raw ? (JSON.parse(raw) as CooldownRecord) : null;
    const strikes = (previous?.strikes ?? 0) + 1;

    const cooldownMs = this.computeCooldownMs(kind, strikes, retryAfterMs);
    const record: CooldownRecord = {
      reason: kind,
      strikes,
      retryAtMs: Date.now() + cooldownMs,
    };

    if (kind === KeyFailureKind.AuthInvalid) {
      this.logger.error(
        `Key ${keyId} marked AuthInvalid -- disabling until restart`,
      );
    }

    await this.redis.set(strikesKey, JSON.stringify(record), 'PX', cooldownMs);
  }

  async snapshot(provider?: ProviderName): Promise<KeyPoolSnapshot[]> {
    const providers = provider
      ? [provider]
      : (['gemini', 'openai'] as ProviderName[]);
    const results: KeyPoolSnapshot[] = [];

    for (const p of providers) {
      const pool = this.pools.get(p) ?? [];
      const cooldowns = await this.readCooldowns(pool.map((k) => k.id));
      const now = Date.now();

      const cooling: CoolingKey[] = [];
      const disabled: string[] = [];
      let healthy = 0;

      for (const key of pool) {
        const record = cooldowns.get(key.id);
        if (!record || record.retryAtMs <= now) {
          healthy++;
        } else if (record.reason === KeyFailureKind.AuthInvalid) {
          disabled.push(key.id);
        } else {
          cooling.push({
            keyId: key.id,
            reason: record.reason,
            retryAtIso: new Date(record.retryAtMs).toISOString(),
          });
        }
      }

      results.push({
        provider: p,
        total: pool.length,
        healthy,
        cooling,
        disabled,
      });
    }

    return results;
  }

  private async readCooldowns(
    keyIds: string[],
  ): Promise<Map<string, CooldownRecord>> {
    if (keyIds.length === 0) return new Map();
    const raws = await this.redis.mget(
      ...keyIds.map((id) => `aigw:cool:${id}`),
    );
    const out = new Map<string, CooldownRecord>();
    keyIds.forEach((id, i) => {
      const raw = raws[i];
      if (raw) out.set(id, JSON.parse(raw) as CooldownRecord);
    });
    return out;
  }

  private computeCooldownMs(
    kind: KeyFailureKind,
    strikes: number,
    retryAfterMs?: number,
  ): number {
    if (kind === KeyFailureKind.RateLimited && retryAfterMs) {
      return Math.min(retryAfterMs, this.config.keyCooldownMaxMs);
    }
    if (kind === KeyFailureKind.QuotaExhausted) {
      return this.config.keyQuotaCooldownMs;
    }
    if (kind === KeyFailureKind.AuthInvalid) {
      // Effectively permanent: re-cooled on every subsequent failure anyway.
      return this.config.keyQuotaCooldownMs * 4;
    }

    const exponential = this.config.keyCooldownBaseMs * 2 ** (strikes - 1);
    const ceiling =
      kind === KeyFailureKind.Timeout || kind === KeyFailureKind.ServerError
        ? Math.min(this.config.keyCooldownMaxMs, 5 * 60_000)
        : this.config.keyCooldownMaxMs;

    return Math.min(exponential, ceiling);
  }

  private loadKeys(provider: ProviderName, envPrefix: string): LlmKey[] {
    const pattern = new RegExp(`^${envPrefix}(\\d*)$`);
    const found = new Map<number, string>();

    for (const [name, value] of Object.entries(process.env)) {
      const match = pattern.exec(name);
      if (!match || !value?.trim()) continue;
      const index = match[1] ? Number(match[1]) : 0;
      found.set(index, value.trim());
    }

    const seen = new Set<string>();
    const keys: LlmKey[] = [];
    for (const index of [...found.keys()].sort((a, b) => a - b)) {
      const secret = found.get(index)!;
      if (seen.has(secret)) continue; // de-duplicate repeated keys
      seen.add(secret);
      keys.push({ id: `${provider}#${index}`, provider, index, secret });
    }
    return keys;
  }
}
