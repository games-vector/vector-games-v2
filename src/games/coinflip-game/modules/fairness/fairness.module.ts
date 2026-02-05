import { Module } from '@nestjs/common';
import { CoinFlipFairnessService } from './fairness.service';
import { RedisModule } from '../../../../modules/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [CoinFlipFairnessService],
  exports: [CoinFlipFairnessService],
})
export class CoinFlipFairnessModule {}
