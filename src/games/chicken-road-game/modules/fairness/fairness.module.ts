import { Module } from '@nestjs/common';
import { FairnessService } from './fairness.service';
import { RedisModule } from '../../../../modules/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [FairnessService],
  exports: [FairnessService],
})
export class FairnessModule {}
