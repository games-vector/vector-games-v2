import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import { KENO_LAST_WIN_DATA, KenoLastWinData } from './last-win.constants';

@Injectable()
export class KenoLastWinBroadcasterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KenoLastWinBroadcasterService.name);
  private intervalId: NodeJS.Timeout | null = null;
  private server: Server | null = null;
  private gameCodes: string[] = ['keno'];
  private broadcastIntervalMs = 5000; // 5 seconds

  setServer(server: Server): void {
    this.server = server;
  }

  /**
   * Set the game codes this broadcaster should target
   * @param gameCodes Array of game codes (e.g., ['keno'])
   */
  setGameCodes(gameCodes: string[]): void {
    this.gameCodes = gameCodes;
    this.logger.log(`[KenoLastWinBroadcaster] Set game codes: ${gameCodes.join(', ')}`);
  }

  onModuleInit(): void {
    this.logger.log('KenoLastWinBroadcasterService initialized');
  }

  onModuleDestroy(): void {
    this.stopBroadcasting();
  }

  /**
   * Start broadcasting last win data at regular intervals
   */
  startBroadcasting(server: Server, gameCodes: string[] = []): void {
    if (this.intervalId) {
      this.logger.warn('Broadcasting already started');
      return;
    }

    this.server = server;
    if (gameCodes.length > 0) {
      this.gameCodes = gameCodes;
    }

    this.logger.log(
      `Starting Keno last-win broadcasting for game codes: ${this.gameCodes.join(', ')} (every ${this.broadcastIntervalMs / 1000} seconds)`,
    );

    // Broadcast immediately on start
    this.broadcastNext();

    // Then broadcast at regular intervals
    this.intervalId = setInterval(() => {
      this.broadcastNext();
    }, this.broadcastIntervalMs);
  }

  /**
   * Stop broadcasting
   */
  stopBroadcasting(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.log('Stopped Keno last-win broadcasting');
    }
  }

  /**
   * Broadcast a real win (called after a player wins)
   */
  broadcastRealWin(winData: KenoLastWinData): void {
    if (!this.server) {
      this.logger.warn('Server not set, cannot broadcast real win');
      return;
    }

    for (const gameCode of this.gameCodes) {
      const room = `game:${gameCode}`;
      this.server.to(room).emit('gameService-last-win', winData);
    }

    this.logger.debug(`Broadcasted real Keno win: ${winData.username} won ${winData.winAmount} ${winData.currency}`);
  }

  /**
   * Broadcast mock last win data
   */
  private broadcastNext(): void {
    if (!this.server) {
      this.logger.warn('Server not set, cannot broadcast');
      return;
    }

    if (this.gameCodes.length === 0) {
      this.logger.warn('No game codes set, cannot broadcast');
      return;
    }

    // Pick a random item from the mock data
    const randomIndex = Math.floor(Math.random() * KENO_LAST_WIN_DATA.length);
    const winData = KENO_LAST_WIN_DATA[randomIndex];

    // Broadcast to all Keno game rooms
    for (const gameCode of this.gameCodes) {
      const room = `game:${gameCode}`;
      this.server.to(room).emit('gameService-last-win', winData);
    }
  }
}
