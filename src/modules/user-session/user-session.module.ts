import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { UserSessionService } from './user-session.service';

@Module({
  imports: [RedisModule],
  providers: [UserSessionService],
  exports: [UserSessionService],
})
export class UserSessionModule {}
