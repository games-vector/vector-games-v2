import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AgentsModule } from '@games-vector/game-core';
import { GameConfigModule } from '../game-config/game-config.module';
import { WalletNotificationService } from './wallet-notification.service';
import { WalletFailureTrackingService } from './wallet-failure-tracking.service';
import { WalletErrorInterceptor } from './wallet-error.interceptor';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AgentsModule,
    GameConfigModule,
  ],
  providers: [
    WalletNotificationService,
    WalletFailureTrackingService,
    WalletErrorInterceptor,
  ],
  exports: [WalletNotificationService, WalletFailureTrackingService],
})
export class WalletNotificationModule {}
