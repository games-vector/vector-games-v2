import { Module } from '@nestjs/common';
import { WheelLastWinBroadcasterService } from './last-win-broadcaster.service';

@Module({
  providers: [WheelLastWinBroadcasterService],
  exports: [WheelLastWinBroadcasterService],
})
export class WheelLastWinModule {}
