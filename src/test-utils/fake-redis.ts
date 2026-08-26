/**
 * In-memory Redis subset used by unit tests. Covers the commands the
 * AI gateway and (later) the Python-engine semaphore actually issue.
 * Not a full ioredis stand-in -- do not use it for integration tests
 * that need real Lua / pubsub / streams.
 */

interface Entry {
  value: string;
  expiresAt?: number;
}

export class FakeRedis {
  private readonly store = new Map<string, Entry>();

  private live(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key);
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map((key) => this.live(key));
  }

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<'OK' | null> {
    let px: number | undefined;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const token = args[i];
      if (token === 'PX' || token === 'px') {
        px = Number(args[i + 1]);
        i++;
      } else if (token === 'EX' || token === 'ex') {
        px = Number(args[i + 1]) * 1000;
        i++;
      } else if (token === 'NX' || token === 'nx') {
        nx = true;
      }
    }
    if (nx && this.live(key) !== null) return null;
    this.store.set(key, {
      value,
      expiresAt: px !== undefined ? Date.now() + px : undefined,
    });
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    return this.incrby(key, 1);
  }

  async incrby(key: string, delta: number): Promise<number> {
    const next = Number(this.live(key) ?? 0) + delta;
    const existing = this.store.get(key);
    this.store.set(key, {
      value: String(next),
      expiresAt: existing?.expiresAt,
    });
    return next;
  }

  async incrbyfloat(key: string, delta: number): Promise<string> {
    const next = Number(this.live(key) ?? 0) + delta;
    const existing = this.store.get(key);
    this.store.set(key, {
      value: String(next),
      expiresAt: existing?.expiresAt,
    });
    return String(next);
  }

  async decrby(key: string, delta: number): Promise<number> {
    return this.incrby(key, -delta);
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed++;
    }
    return removed;
  }

  async pexpire(key: string, ttlMs: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || this.live(key) === null) return 0;
    this.store.set(key, { ...entry, expiresAt: Date.now() + ttlMs });
    return 1;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    return this.pexpire(key, ttlSeconds * 1000);
  }

  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    token: string,
  ): Promise<number> {
    const current = this.live(key);
    if (current === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}
