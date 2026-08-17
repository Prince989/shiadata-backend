import { Injectable } from '@nestjs/common';

interface Counters {
  calls: number;
  errors: number;
  cacheHits: number;
  cacheMisses: number;
  repairs: number;
  truncations: number;
  keyRotations: number;
  cooldowns: number;
}

/**
 * Plain in-memory counters -- intentionally not Prometheus-backed yet. This
 * is what /internal/llm/spend and the admin controller read; wiring a real
 * metrics exporter is a drop-in replacement behind the same interface later.
 */
@Injectable()
export class LlmMetricsService {
  private byOutcome: Record<string, Counters> = {};
  private latencies: number[] = [];
  private readonly maxLatencySamples = 1000;

  private bucket(feature: string): Counters {
    return (this.byOutcome[feature] ??= {
      calls: 0,
      errors: 0,
      cacheHits: 0,
      cacheMisses: 0,
      repairs: 0,
      truncations: 0,
      keyRotations: 0,
      cooldowns: 0,
    });
  }

  recordCall(
    feature: string,
    outcome: 'success' | 'error',
    latencyMs: number,
  ): void {
    const b = this.bucket(feature);
    b.calls++;
    if (outcome === 'error') b.errors++;
    this.latencies.push(latencyMs);
    if (this.latencies.length > this.maxLatencySamples) this.latencies.shift();
  }

  recordCache(feature: string, hit: boolean): void {
    const b = this.bucket(feature);
    if (hit) b.cacheHits++;
    else b.cacheMisses++;
  }

  recordRepair(feature: string): void {
    this.bucket(feature).repairs++;
  }

  recordTruncation(feature: string): void {
    this.bucket(feature).truncations++;
  }

  recordKeyRotation(feature: string): void {
    this.bucket(feature).keyRotations++;
  }

  recordCooldown(feature: string): void {
    this.bucket(feature).cooldowns++;
  }

  snapshot(): {
    byFeature: Record<string, Counters>;
    latencyPercentiles: Record<string, number>;
  } {
    return {
      byFeature: this.byOutcome,
      latencyPercentiles: this.percentiles([50, 95, 99]),
    };
  }

  private percentiles(ps: number[]): Record<string, number> {
    if (this.latencies.length === 0) return {};
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const out: Record<string, number> = {};
    for (const p of ps) {
      const idx = Math.min(
        sorted.length - 1,
        Math.floor((p / 100) * sorted.length),
      );
      out[`p${p}`] = sorted[idx]!;
    }
    return out;
  }
}
