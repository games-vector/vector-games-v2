import { Module } from '@nestjs/common';
import { LastWinBroadcasterService } from './last-win-broadcaster.service';

@Module({
  providers: [LastWinBroadcasterService],
  exports: [LastWinBroadcasterService],
})
export class LastWinModule {}
