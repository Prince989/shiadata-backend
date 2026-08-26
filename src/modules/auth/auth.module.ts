import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthController } from './auth.controller';
import {
  RefreshTokenEntity,
  RefreshTokenEntitySchema,
  UserEntity,
  UserEntitySchema,
} from './auth.schemas';
import { AuthService, PasswordService } from './auth.service';
import { MongoUserStore } from './mongo-user.store';
import { USER_STORE } from './user-store';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserEntity.name, schema: UserEntitySchema },
      { name: RefreshTokenEntity.name, schema: RefreshTokenEntitySchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    PasswordService,
    AuthService,
    MongoUserStore,
    { provide: USER_STORE, useExisting: MongoUserStore },
  ],
  exports: [AuthService, USER_STORE, PasswordService],
})
export class AuthModule {}
