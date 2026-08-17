export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full jitter backoff: delay = random(0, min(max, base * 2^attempt)).
 * Full jitter (not equal jitter) matters here specifically because many
 * replicas rotate the same shared key pool -- synchronized retries across
 * replicas is the exact failure mode this avoids.
 */
export function fullJitterBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * cap);
}
