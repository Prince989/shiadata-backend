import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { UnauthorizedAppError } from '@common/errors/app.error';
import { IUserStore, USER_STORE } from '@modules/auth/user-store';
import type { UserRecord } from '@modules/auth/auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(USER_STORE) private readonly users: IUserStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: UserRecord & { userId: string };
    }>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token.startsWith('access.')) {
      throw new UnauthorizedAppError();
    }
    const userId = token.slice('access.'.length);
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedAppError();
    request.user = { ...user, userId: user.id };
    return true;
  }
}
