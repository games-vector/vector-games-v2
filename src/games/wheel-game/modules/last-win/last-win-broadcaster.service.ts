import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { WHEEL_LAST_WIN_DATA, WheelLastWinData } from './last-win.constants';

@Injectable()
export class WheelLastWinBroadcasterService {
  private readonly logger = new Logger(WheelLastWinBroadcasterService.name);
  private broadcastInterval: NodeJS.Timeout | null = null;
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  startBroadcasting(gameCode: string): void {
    if (this.broadcastInterval) {
      this.stopBroadcasting();
    }

    this.broadcastInterval = setInterval(() => {
      this.broadcastNext(gameCode);
    }, 5000);
  }

  stopBroadcasting(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  private broadcastNext(gameCode: string): void {
    if (!this.server) return;

    const randomIndex = Math.floor(Math.random() * WHEEL_LAST_WIN_DATA.length);
    const lastWinData = WHEEL_LAST_WIN_DATA[randomIndex];

    this.server.to(`game:${gameCode}`).emit('gameService-last-win', {
      username: lastWinData.username,
      avatar: lastWinData.avatar,
      countryCode: lastWinData.countryCode,
      winAmount: lastWinData.winAmount,
      currency: lastWinData.currency,
      color: lastWinData.color,
      multiplier: lastWinData.multiplier,
    });
  }

  broadcastRealWin(gameCode: string, data: Partial<WheelLastWinData>): void {
    if (!this.server) return;

    this.server.to(`game:${gameCode}`).emit('gameService-last-win', data);
  }
}
