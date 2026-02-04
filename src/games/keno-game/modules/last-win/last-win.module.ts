import { Module } from '@nestjs/common';
import { KenoLastWinBroadcasterService } from './last-win-broadcaster.service';

@Module({
  providers: [KenoLastWinBroadcasterService],
  exports: [KenoLastWinBroadcasterService],
})
export class KenoLastWinModule {}
