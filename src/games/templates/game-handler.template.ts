/**
 * GAME HANDLER TEMPLATE
 * 
 * Copy this template to create a new game handler.
 * Replace all instances of:
 * - YourGameHandler with your handler class name
 * - your-game with your game name (kebab-case)
 * - YOUR_GAME with your game config key
 */

import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WalletService, UserService } from '@vector-games/game-core';
import { IGameHandler, GameConnectionContext } from '../interfaces/game-handler.interface';
import { DEFAULTS } from '../../config/defaults.config';
import { YourGameService } from './your-game.service';

const WS_EVENTS = {
  BALANCE_CHANGE: 'onBalanceChange',
  BET_CONFIG: 'betsConfig',
  MY_DATA: 'myData',
  CURRENCIES: 'currencies',
  GAME_SERVICE: 'gameService',
  // Add your game-specific events here
} as const;

@Injectable()
export class YourGameHandler implements IGameHandler {
  readonly gameCode = DEFAULTS.GAMES.YOUR_GAME.GAME_CODE;

  private readonly logger = new Logger(YourGameHandler.name);
  private server: Server | null = null;

  constructor(
    private readonly yourGameService: YourGameService,
    private readonly walletService: WalletService,
    private readonly userService: UserService,
    // Add other dependencies as needed
  ) {}

  onGatewayInit(server: Server): void {
    this.server = server;
    this.logger.log('[YOUR_GAME_HANDLER] Gateway initialized, server instance stored');
    
    // Initialize game-specific services here:
    // - Start schedulers
    // - Start broadcasters
    // - Initialize game state
  }

  getServer(): Server | null {
    return this.server;
  }

  async handleConnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, operatorId, gameCode } = context;

    this.logger.log(
      `[WS_CONNECT] socketId=${client.id} user=${userId} agent=${agentId} gameCode=${gameCode}`,
    );

    try {
      // 1. Get wallet balance
      const walletBalance = await this.walletService.getBalance(agentId, userId);
      const balance = {
        currency: DEFAULTS.GAMES.YOUR_GAME.DEFAULT_CURRENCY,
        balance: walletBalance.balance.toString(),
      };

      // 2. Get bet configuration
      const betConfig = {
        // Your game-specific bet config
      };

      // 3. Get user data
      const userData = await this.userService.findOne(userId, agentId);
      const myData = {
        userId: userId,
        nickname: userData.username || userId,
        gameAvatar: userData?.avatar || DEFAULTS.PLATFORM.USER.DEFAULT_AVATAR,
      };

      // 4. Get currencies (if needed)
      const currencies = {}; // Your game-specific currencies

      // 5. Send initial data to client
      client.emit(WS_EVENTS.BALANCE_CHANGE, balance);
      client.emit(WS_EVENTS.BET_CONFIG, betConfig);
      client.emit(WS_EVENTS.MY_DATA, myData);
      client.emit(WS_EVENTS.CURRENCIES, currencies);

      // 6. Initialize game-specific state if needed
      // await this.yourGameService.initializeUserState(userId, agentId, gameCode);

      this.logger.log(
        `[YOUR_GAME] Connection established: socket=${client.id} user=${userId} gameCode=${gameCode}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[YOUR_GAME] Connection error: socket=${client.id} user=${userId} error=${error.message}`,
      );
      // Don't throw - let connection continue, client can retry
    }
  }

  async handleDisconnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId } = context;

    this.logger.log(
      `[WS_DISCONNECT] socketId=${client.id} user=${userId || 'N/A'} agent=${agentId || 'N/A'}`,
    );

    try {
      // Cleanup game-specific resources:
      // - Save game state
      // - Cleanup timers
      // - Release locks
      // await this.yourGameService.cleanupUserState(userId, agentId);
    } catch (error: any) {
      this.logger.error(
        `[YOUR_GAME] Disconnection cleanup error: socket=${client.id} user=${userId} error=${error.message}`,
      );
    }
  }

  registerMessageHandlers(context: GameConnectionContext): void {
    const { client, userId, agentId, gameCode } = context;

    // Register game service ACK handler
    client.on(WS_EVENTS.GAME_SERVICE, async (data: any, ack?: Function) => {
      if (typeof ack !== 'function') return;

      const action = data?.action;
      if (!action) {
        return ack({ error: { message: 'missing_action' } });
      }

      try {
        switch (action) {
          case 'bet':
            // Handle bet action
            // const betResult = await this.yourGameService.placeBet(userId, agentId, gameCode, data.payload);
            // ack(betResult);
            break;

          case 'cashout':
            // Handle cashout action
            // const cashoutResult = await this.yourGameService.cashOut(userId, agentId, gameCode);
            // ack(cashoutResult);
            break;

          case 'get-game-config':
            // Return game configuration
            // const config = await this.yourGameService.getGameConfig(gameCode);
            // ack(config);
            break;

          default:
            ack({ error: { message: 'unsupported_action' } });
        }
      } catch (error: any) {
        this.logger.error(
          `[YOUR_GAME] Action error: action=${action} user=${userId} error=${error.message}`,
        );
        ack({ error: { message: error.message || 'action_failed' } });
      }
    });

    // Register other game-specific event handlers as needed
    // Example:
    // client.on('customEvent', async (data) => {
    //   // Handle custom event
    // });
  }
}
