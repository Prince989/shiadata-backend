import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as not requiring authentication. Once JwtAuthGuard is
 * registered globally (milestone 6), it is secure-by-default: a route
 * missing this decorator is guarded even if someone forgets to add a guard
 * explicitly. /health uses this from milestone 2 onward so liveness/readiness
 * probes never depend on a token.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
