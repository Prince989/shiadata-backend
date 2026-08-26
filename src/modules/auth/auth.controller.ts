import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, MinLength } from 'class-validator';

import { Public } from '@common/decorators/public.decorator';
import { SWAGGER_BEARER_AUTH } from '@common/swagger/swagger.constants';
import {
  UnauthorizedAppError,
  ValidationFailedError,
} from '@common/errors/app.error';
import { AuthService, UserRecord } from './auth.service';

class CredentialsDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;
}

class RefreshDto {
  @IsString()
  @MinLength(16)
  refreshToken!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  async register(@Body() body: CredentialsDto) {
    try {
      return await this.auth.register(body.email, body.password, {
        countryCode: body.countryCode,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'email-taken') {
        throw new ValidationFailedError('Email is already registered');
      }
      throw err;
    }
  }

  @Post('login')
  @Public()
  async login(@Body() body: CredentialsDto) {
    try {
      return await this.auth.login(body.email, body.password);
    } catch {
      throw new UnauthorizedAppError();
    }
  }

  @Post('refresh')
  @Public()
  async refresh(@Body() body: RefreshDto) {
    try {
      return await this.auth.rotateRefresh(body.refreshToken);
    } catch (err) {
      if (err instanceof Error && err.message === 'refresh-reuse') {
        throw new UnauthorizedAppError();
      }
      throw new UnauthorizedAppError();
    }
  }

  @Post('counseling-consent')
  @ApiBearerAuth(SWAGGER_BEARER_AUTH)
  async counselingConsent(@Req() req: { user?: UserRecord }) {
    if (!req.user) throw new UnauthorizedAppError();
    const user = await this.auth.grantCounselingConsent(req.user.id);
    return { counselingConsent: user.counselingConsent };
  }
}
