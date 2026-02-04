import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WalletService, UserService, AgentsService } from '@games-vector/game-core';
import { GameAction } from './DTO/game-action.dto';
import { KenoGameService } from './keno-game.service';
import { GameService } from '../../modules/games/game.service';
import { GameRegistryService } from '../game-registry.service';
import { DEFAULTS } from '../../config/defaults.config';
import {
  IGameHandler,
  GameConnectionContext,
} from '../interfaces/game-handler.interface';

const GAME_CODE = 'keno';

const WS_EVENTS = {
  CONNECTION_ERROR: 'connection-error',
  BALANCE_CHANGE: 'onBalanceChange',
  BET_CONFIG: 'betsConfig',
  MY_DATA: 'myData',
  CURRENCIES: 'currencies',
  GAME_SERVICE: 'gameService',
  BETS_RANGES: 'betsRanges',
  PING: 'ping',
  PONG: 'pong',
} as const;

const ERROR_RESPONSES = {
  MISSING_ACTION: 'missing_action',
  CONFIG_FETCH_FAILED: 'config_fetch_failed',
  MISSING_CONTEXT: 'missing_context',
  BET_FAILED: 'bet_failed',
  MISSING_USER_OR_AGENT: 'missing_user_or_agent',
  UNSUPPORTED_ACTION: 'unsupported_action',
} as const;

interface BalanceEventPayload {
  currency: string;
  balance: string;
}

interface MyDataEvent {
  userId: string;
  nickname: string;
  gameAvatar: string | null;
}

function formatErrorResponse(errorMessage: string): { error: { message: string } } {
  return { error: { message: errorMessage } };
}

@Injectable()
export class KenoGameHandler implements IGameHandler {
  readonly gameCode = GAME_CODE;

  private readonly logger = new Logger(KenoGameHandler.name);
  private server: Server | null = null;

  constructor(
    private readonly kenoGameService: KenoGameService,
    private readonly walletService: WalletService,
    private readonly userService: UserService,
    private readonly gameService: GameService,
    private readonly agentsService: AgentsService,
    private readonly gameRegistry: GameRegistryService,
  ) {}

  onGatewayInit(server: Server): void {
    this.server = server;
    this.logger.log('[KENO_HANDLER] Gateway initialized, server instance stored');

    const gameCodes = this.gameRegistry.getGamesForHandler(this.gameCode);
    this.logger.log(
      `[KENO_HANDLER] Handler supports ${gameCodes.length} game code(s): ${gameCodes.join(', ')}`,
    );
  }

  getServer(): Server | null {
    return this.server;
  }

  async handleConnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, operatorId, gameCode } = context;

    this.logger.log(
      `[WS_CONNECT] socketId=${client.id} user=${userId} agent=${agentId} gameCode=${gameCode} operatorId=${operatorId}`,
    );

    // Get balance
    const balance: BalanceEventPayload = {
      currency: 'USD',
      balance: '0',
    };

    try {
      const walletBalance = await this.walletService.getBalance(agentId, userId);
      balance.balance = walletBalance.balance.toString();
      balance.currency = 'USD';
    } catch (error) {
      this.logger.warn(`Failed to get balance for user=${userId}: ${error}`);
    }

    // Bet ranges
    const betsRanges = {
      USD: ['0.01', '200.00'],
    };

    // Bet config
    const { betConfig: dbBetConfig } =
      await this.kenoGameService.getGameConfigPayload(gameCode);

    const defaultBetConfig = {
      minBetAmount: '0.01',
      maxBetAmount: '200.00',
      maxWinAmount: '20000.00',
      defaultBetAmount: '0.06',
      betPresets: ['0.5', '1', '2', '7'],
      decimalPlaces: '2',
      currency: 'USD',
    };

    const betConfig = {
      USD: {
        minBetAmount: dbBetConfig?.minBetAmount || defaultBetConfig.minBetAmount,
        maxBetAmount: dbBetConfig?.maxBetAmount || defaultBetConfig.maxBetAmount,
        maxWinAmount: dbBetConfig?.maxWinAmount || defaultBetConfig.maxWinAmount,
        defaultBetAmount:
          dbBetConfig?.defaultBetAmount || defaultBetConfig.defaultBetAmount,
        betPresets: dbBetConfig?.betPresets || defaultBetConfig.betPresets,
        decimalPlaces: dbBetConfig?.decimalPlaces || defaultBetConfig.decimalPlaces,
        currency: defaultBetConfig.currency,
      },
    };

    // User data
    let myData: MyDataEvent = {
      userId: userId,
      nickname: userId,
      gameAvatar: null,
    };

    try {
      const userData = await this.userService.findOne(userId, agentId);
      myData = {
        userId: userId,
        nickname: userData.username || userId,
        gameAvatar: userData?.avatar || null,
      };
    } catch (error) {
      this.logger.warn(`Failed to get user data for user=${userId}: ${error}`);
    }

    // Get currencies
    const currencies = await this.kenoGameService.getCurrencies();

    // Initialize fairness seeds
    try {
      await this.kenoGameService.getOrCreateFairness(userId, agentId);
    } catch (error: any) {
      this.logger.warn(
        `Failed to initialize fairness seeds for user=${userId}: ${error.message}`,
      );
    }

    // Emit initial data
    client.emit(WS_EVENTS.BALANCE_CHANGE, balance);
    client.emit(WS_EVENTS.BETS_RANGES, betsRanges);
    client.emit(WS_EVENTS.BET_CONFIG, betConfig);
    client.emit(WS_EVENTS.MY_DATA, myData);
    client.emit(WS_EVENTS.CURRENCIES, currencies);

    this.logger.log(
      `Keno socket connected id=${client.id} userId=${userId} agentId=${agentId} gameCode=${gameCode}`,
    );
  }

  async handleDisconnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId } = context;
    this.logger.log(
      `[WS_DISCONNECT] socketId=${client.id} user=${userId || 'N/A'} agent=${agentId || 'N/A'}`,
    );
  }

  getGameConfigResponse(): any {
    try {
      const defaultBetConfig = {
        minBetAmount: '0.01',
        maxBetAmount: '200.00',
        maxWinAmount: '20000.00',
        defaultBetAmount: '0.06',
        betPresets: ['0.5', '1', '2', '7'],
        decimalPlaces: '2',
        currency: 'USD',
      };

      const response = {
        betConfig: defaultBetConfig,
        payoutTables: this.kenoGameService['payoutService']?.getAllPayoutTables() || {},
        lastWin: {
          username: 'Lucky Player',
          winAmount: '50.00',
          currency: 'USD',
        },
      };

      this.logger.debug(
        `[getGameConfigResponse] Returning config for gameCode=${this.gameCode}`,
      );
      return response;
    } catch (error: any) {
      this.logger.error(
        `[getGameConfigResponse] Error: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  registerMessageHandlers(context: GameConnectionContext): void {
    const { client, userId, agentId, gameCode } = context;

    // Ping handler
    client.on(WS_EVENTS.PING, () => {
      client.emit(WS_EVENTS.PONG, { ts: Date.now() });
    });

    // Main game service handler
    const ackHandler = (data: any, ack?: Function) => {
      if (typeof ack !== 'function') return;

      const rawAction: string | undefined = data?.action;
      if (!rawAction) {
        return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_ACTION));
      }

      // Skip get-game-config as it's handled by critical handlers
      if (rawAction === GameAction.GET_GAME_CONFIG || rawAction === 'get-game-config') {
        return;
      }

      // Get game seeds
      if (rawAction === GameAction.GET_GAME_SEEDS || rawAction === 'get-game-seeds') {
        if (!userId || !agentId) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.kenoGameService
          .getGameSeeds(userId, agentId)
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Get game seeds failed: ${e}`);
            ack(formatErrorResponse('get_game_seeds_failed'));
          });
        return;
      }

      // Set user seed
      if (rawAction === GameAction.SET_USER_SEED || rawAction === 'set-user-seed') {
        if (!userId || !agentId) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        const userSeed: string | undefined = data?.payload?.userSeed;
        if (!userSeed || typeof userSeed !== 'string') {
          return ack(formatErrorResponse('missing_user_seed'));
        }
        this.kenoGameService
          .setUserSeed(userId, agentId, userSeed)
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Set user seed failed: ${e}`);
            ack(formatErrorResponse(e.message || 'set_user_seed_failed'));
          });
        return;
      }

      // Place bet
      if (rawAction === GameAction.BET || rawAction === 'bet') {
        if (!userId || !agentId || !gameCode) {
          this.logger.warn(
            `Bet action missing context: socket=${client.id} userId=${userId} agentId=${agentId} gameCode=${gameCode}`,
          );
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_CONTEXT));
        }

        this.logger.debug(
          `Bet action received: socket=${client.id} user=${userId} payload=${JSON.stringify(data?.payload)}`,
        );

        this.kenoGameService
          .performBetFlow(userId, agentId, gameCode, data?.payload)
          .then(async (resp) => {
            if ('error' in resp) {
              ack(formatErrorResponse(resp.error));
              this.logger.warn(
                `Bet failed: socket=${client.id} user=${userId} error=${resp.error}`,
              );
            } else {
              ack(resp);
              // Update balance after bet
              try {
                const walletBalance = await this.walletService.getBalance(
                  agentId,
                  userId,
                );
                const balanceEvent: BalanceEventPayload = {
                  currency: 'USD',
                  balance: walletBalance.balance.toString(),
                };
                client.emit(WS_EVENTS.BALANCE_CHANGE, balanceEvent);
                this.logger.log(
                  `Balance updated after bet: socket=${client.id} user=${userId} balance=${walletBalance.balance}`,
                );
              } catch (balanceError) {
                this.logger.warn(
                  `Failed to update balance after bet: ${balanceError}`,
                );
              }
            }
          })
          .catch((e) => {
            this.logger.error(`Bet flow failed for socket ${client.id}: ${e}`);
            ack(formatErrorResponse(ERROR_RESPONSES.BET_FAILED));
          });
        return;
      }

      // Get my bets history
      if (
        rawAction === GameAction.GET_MY_BETS_HISTORY ||
        rawAction === 'gameService-get-my-bets-history'
      ) {
        if (!userId || !agentId) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.kenoGameService
          .getMyBetsHistory(userId, agentId, gameCode)
          .then((bets) => ack(bets))
          .catch((e) => {
            this.logger.error(`Get bet history failed: ${e}`);
            ack(formatErrorResponse('get_bet_history_failed'));
          });
        return;
      }

      return ack(formatErrorResponse(ERROR_RESPONSES.UNSUPPORTED_ACTION));
    };

    client.removeAllListeners(WS_EVENTS.GAME_SERVICE);
    client.prependListener(WS_EVENTS.GAME_SERVICE, ackHandler);

    // Separate bet history handler
    const betHistoryHandler = (data: any, ack?: Function) => {
      if (typeof ack !== 'function') return;

      this.logger.log(
        `Bet history request received: socket=${client.id} user=${userId} agent=${agentId}`,
      );

      if (!userId || !agentId) {
        return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
      }

      this.kenoGameService
        .getMyBetsHistory(userId, agentId, gameCode)
        .then((bets) => ack(bets))
        .catch((e) => {
          this.logger.error(`Get bet history failed: ${e}`);
          ack(formatErrorResponse('get_bet_history_failed'));
        });
    };

    client.prependListener('gameService-get-my-bets-history', betHistoryHandler);
  }
}
