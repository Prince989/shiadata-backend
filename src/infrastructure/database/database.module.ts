import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { MongoConfig } from '@config/index';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const mongo = config.get<MongoConfig>('mongo')!;
        return {
          uri: mongo.uri,
          dbName: mongo.dbName,
          maxPoolSize: mongo.maxPoolSize,
          serverSelectionTimeoutMS: mongo.serverSelectionTimeoutMs,
          autoIndex: mongo.autoIndex,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
