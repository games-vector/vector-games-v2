import { Module } from '@nestjs/common';
import { GameConfigModule } from '../../../../modules/game-config/game-config.module';
import { RedisModule } from '../../../../modules/redis/redis.module';
import { HazardGeneratorService } from './hazard-generator.service';
import { HazardSchedulerService } from './hazard-scheduler.service';

/**
 * Hazard module managing global hazard column rotation system
 * Provides services for generating, scheduling, and validating hazard patterns
 */
@Module({
  imports: [RedisModule, GameConfigModule],
  providers: [HazardSchedulerService, HazardGeneratorService],
  exports: [HazardSchedulerService, HazardGeneratorService],
})
export class HazardModule {}
