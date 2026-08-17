import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

interface TrackableRequest {
  ip?: string;
  user?: { userId?: string };
}

/**
 * Tracks by authenticated user, falling back to IP for anonymous requests.
 *
 * IP-based limiting alone is close to worthless for LLM cost control: mobile
 * carrier NAT puts thousands of legitimate users behind one IP (so a shared
 * IP throttles innocents), while an attacker rotates IPs trivially. Once auth
 * exists (milestone 6) this reads `req.user.userId`; until then it always
 * falls back to IP, which is still strictly better than nothing for the
 * unauthenticated surface this module protects today.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: TrackableRequest): Promise<string> {
    const userId = req.user?.userId;
    return Promise.resolve(userId ? `u:${userId}` : `ip:${req.ip}`);
  }
}
