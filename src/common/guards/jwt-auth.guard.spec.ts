import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UnauthorizedAppError } from '@common/errors/app.error';
import { AuthService, PasswordService } from '@modules/auth/auth.service';
import { MemoryUserStore } from '@modules/auth/user-store';
import { JwtAuthGuard } from './jwt-auth.guard';

function ctx(
  _isPublic: boolean,
  authorization?: string,
): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authorization ? { authorization } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  async function setup() {
    const users = new MemoryUserStore();
    const auth = new AuthService(users, new PasswordService());
    const issued = await auth.register('g@h.com', 'password-long-enough');
    const reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector, users);
    return { guard, reflector, issued };
  }

  it('allows @Public routes without a token', async () => {
    const { guard, reflector } = await setup();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    await expect(guard.canActivate(ctx(true))).resolves.toBe(true);
  });

  it('rejects a missing bearer token on a private route', async () => {
    const { guard, reflector } = await setup();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    await expect(guard.canActivate(ctx(false))).rejects.toBeInstanceOf(
      UnauthorizedAppError,
    );
  });

  it('accepts a valid access token issued at login', async () => {
    const { guard, reflector, issued } = await setup();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    await expect(
      guard.canActivate(ctx(false, `Bearer ${issued.accessToken}`)),
    ).resolves.toBe(true);
  });
});
