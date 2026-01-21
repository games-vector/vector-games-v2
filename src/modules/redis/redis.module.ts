import { Module } from '@nestjs/common';
import { PubSubService } from './pub-sub.service';
import { RedisProvider } from './redis.provider';
import { RedisService } from './redis.service';
import { GameConfigModule } from '../game-config/game-config.module';

@Module({
  imports: [GameConfigModule],
  providers: [
    RedisProvider,
    RedisService,
    PubSubService,
  ],
  exports: [RedisService, PubSubService],
})
export class RedisModule {}
