import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { GameConnectionContext } from '../interfaces/game-handler.interface';
import { DEFAULTS } from '../../config/defaults.config';

/**
 * Service for registering critical handlers that must be available immediately
 * upon connection to prevent race conditions.
 * 
 * These handlers are registered synchronously before any async operations
 * in handleConnection, ensuring they're ready even if clients send requests immediately.
 */
@Injectable()
export class CriticalHandlersService {
  private readonly logger = new Logger(CriticalHandlersService.name);

  /**
   * Register critical gameService handlers for get-game-config action
   * This prevents race conditions where clients send get-game-config before
   * handlers are fully registered.
   * 
   * @param context - Connection context
   * @param getGameConfigResponse - Function that returns the game config response
   *                                If not provided, uses default values from DEFAULTS
   */
  registerGetGameConfigHandler(
    context: GameConnectionContext,
    getGameConfigResponse?: () => any,
  ): void {
    const { client, gameCode } = context;

    const handler = (data: any, ack?: Function) => {
      if (typeof ack !== 'function') {
        this.logger.warn(`[CRITICAL_HANDLER] No ACK function provided for get-game-config: socket=${client.id}`);
        return;
      }

      const rawAction: string | undefined = data?.action;
      if (!rawAction || (rawAction !== 'get-game-config' && rawAction !== 'GET_GAME_CONFIG')) {
        return; // Not our action, let other handlers process it
      }

      this.logger.log(`[CRITICAL_HANDLER] Handling get-game-config: socket=${client.id} gameCode=${gameCode}`);

      try {
        if (!gameCode) {
          this.logger.warn(`[CRITICAL_HANDLER] Missing gameCode: socket=${client.id}`);
          return ack({ error: { message: 'missing_game_code' } });
        }

        const response = getGameConfigResponse 
          ? getGameConfigResponse()
          : this.getDefaultGameConfigResponse(gameCode);

        this.logger.log(`[CRITICAL_HANDLER] Sending get-game-config response: socket=${client.id} gameCode=${gameCode}`);
        ack(response);
      } catch (error: any) {
        this.logger.error(`[CRITICAL_HANDLER] Error handling get-game-config: socket=${client.id} error=${error.message}`, error.stack);
        ack({ error: { message: 'get_game_config_failed' } });
      }
    };

    client.prependListener('gameService', handler);
    this.logger.log(`[CRITICAL_HANDLER] Registered get-game-config handler: socket=${client.id} gameCode=${gameCode}`);
  }

  /**
   * Get default game config response based on game code
   * Falls back to Chicken Road defaults if game-specific config not found
   */
  private getDefaultGameConfigResponse(gameCode: string): any {
    // Try to get game-specific config
    const gameConfig = this.getGameConfigByCode(gameCode);
    
    if (gameConfig) {
      const currency = gameConfig.betConfig?.currency || 'INR';
      return {
        betConfig: {
          minBetAmount: gameConfig.betConfig?.minBetAmount || '0.01',
          maxBetAmount: gameConfig.betConfig?.maxBetAmount || '100.00',
          maxWinAmount: gameConfig.betConfig?.maxWinAmount || '10000.00',
          defaultBetAmount: gameConfig.betConfig?.defaultBetAmount || '1.00',
          betPresets: gameConfig.betConfig?.betPresets || ['0.5', '1', '2', '7'],
          decimalPlaces: gameConfig.betConfig?.decimalPlaces || '2',
          currency: currency,
        },
        coefficients: gameConfig.coefficients || {},
        lastWin: {
          username: gameConfig.LAST_WIN?.DEFAULT_USERNAME || 'Player',
          winAmount: gameConfig.LAST_WIN?.DEFAULT_WIN_AMOUNT || '0',
          currency: currency,
        },
      };
    }

    const defaultBetConfig = DEFAULTS.GAMES.CHICKEN_ROAD.betConfig;
    const defaultCoefficients = DEFAULTS.GAMES.CHICKEN_ROAD.coefficients;
    const defaultLastWin = DEFAULTS.GAMES.CHICKEN_ROAD.LAST_WIN;

    return {
      betConfig: {
        minBetAmount: defaultBetConfig.minBetAmount,
        maxBetAmount: defaultBetConfig.maxBetAmount,
        maxWinAmount: defaultBetConfig.maxWinAmount || '10000.00',
        defaultBetAmount: defaultBetConfig.defaultBetAmount,
        betPresets: defaultBetConfig.betPresets,
        decimalPlaces: defaultBetConfig.decimalPlaces,
        currency: defaultBetConfig.currency,
      },
      coefficients: defaultCoefficients,
      lastWin: {
        username: defaultLastWin.DEFAULT_USERNAME,
        winAmount: defaultLastWin.DEFAULT_WIN_AMOUNT,
        currency: defaultBetConfig.currency,
      },
    };
  }

  private getGameConfigByCode(gameCode: string): any {
    const games = DEFAULTS.GAMES;
    
    if (gameCode === games.SUGAR_DADDY.GAME_CODE) {
      return {
        betConfig: games.SUGAR_DADDY.BET_CONFIG,
        LAST_WIN: {
          DEFAULT_USERNAME: 'Player',
          DEFAULT_WIN_AMOUNT: '0',
          DEFAULT_CURRENCY: games.SUGAR_DADDY.BET_CONFIG.currency || 'INR',
        },
      };
    }

    if (gameCode === games.CHICKEN_ROAD.GAME_CODE) {
      return {
        betConfig: games.CHICKEN_ROAD.betConfig,
        coefficients: games.CHICKEN_ROAD.coefficients,
        LAST_WIN: games.CHICKEN_ROAD.LAST_WIN,
      };
    }

    return null;
  }
}
