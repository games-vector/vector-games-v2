import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import { LAST_WIN_DATA, LastWinData } from './last-win.constants';

@Injectable()
export class LastWinBroadcasterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LastWinBroadcasterService.name);
  private intervalId: NodeJS.Timeout | null = null;
  private server: Server | null = null;
  private gameCodes: string[] = []; // Game codes this broadcaster should target

  setServer(server: Server) {
    this.server = server;
  }

  /**
   * Set the game codes this broadcaster should target
   * @param gameCodes Array of game codes (e.g., ['chicken-road-two', 'chicken-road-vegas'])
   */
  setGameCodes(gameCodes: string[]): void {
    this.gameCodes = gameCodes;
    this.logger.log(`[LastWinBroadcaster] Set game codes: ${gameCodes.join(', ')}`);
  }

  onModuleInit() {
    this.logger.log('LastWinBroadcasterService initialized');
  }

  onModuleDestroy() {
    this.stopBroadcasting();
  }

  startBroadcasting(server: Server, gameCodes: string[] = []) {
    if (this.intervalId) {
      this.logger.warn('Broadcasting already started');
      return;
    }

    this.server = server;
    this.gameCodes = gameCodes.length > 0 ? gameCodes : ['chicken-road-two']; // Default fallback
    this.logger.log(`Starting last-win broadcasting for game codes: ${this.gameCodes.join(', ')} (every 4 seconds)`);

    // Broadcast immediately on start
    this.broadcastNext();

    // Then broadcast every 4 seconds
    this.intervalId = setInterval(() => {
      this.broadcastNext();
    }, 4000);
  }

  stopBroadcasting() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.log('Stopped last-win broadcasting');
    }
  }

  private broadcastNext() {
    if (!this.server) {
      this.logger.warn('Server not set, cannot broadcast');
      return;
    }

    if (this.gameCodes.length === 0) {
      this.logger.warn('No game codes set, cannot broadcast');
      return;
    }

    // Pick a random item from the array
    const randomIndex = Math.floor(Math.random() * LAST_WIN_DATA.length);
    const winData = LAST_WIN_DATA[randomIndex];

    // Broadcast to all Chicken Road game rooms (supports multiple game codes)
    // This prevents Sugar Daddy and other games from receiving this event
    for (const gameCode of this.gameCodes) {
      const room = `game:${gameCode}`;
      this.server.to(room).emit('gameService-last-win', winData);
    }
  }
}
