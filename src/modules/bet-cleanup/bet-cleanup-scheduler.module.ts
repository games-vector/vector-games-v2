import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BetCleanupSchedulerService } from './bet-cleanup-scheduler.service';
import { BetConfigModule } from '../bet-config/bet-config.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BetConfigModule, // Provides BetService
    RedisModule,
  ],
  providers: [BetCleanupSchedulerService],
  exports: [BetCleanupSchedulerService],
})
export class BetCleanupSchedulerModule {}
