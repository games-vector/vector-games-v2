import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WalletService, UserService, AgentsService } from '@vector-games/game-core';
import { GameAction } from './DTO/game-action.dto';
import { ChickenRoadGameService } from './chicken-road-game.service';
import { LastWinBroadcasterService } from './modules/last-win/last-win-broadcaster.service';
import { FairnessService } from './modules/fairness/fairness.service';
import { GameService } from '../../modules/games/game.service';
import { GameRegistryService } from '../game-registry.service';
import { DEFAULTS } from '../../config/defaults.config';
import { IGameHandler, GameConnectionContext } from '../interfaces/game-handler.interface';

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
  INVALID_LINE_NUMBER: 'invalid_line_number',
  STEP_FAILED: 'step_failed',
  CASHOUT_FAILED: 'cashout_failed',
  GET_SESSION_FAILED: 'get_session_failed',
  UNSUPPORTED_ACTION: 'unsupported_action',
  MISSING_GAME_CODE: 'missing_game_code',
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
export class ChickenRoadGameHandler implements IGameHandler {
  readonly gameCode = DEFAULTS.GAMES.CHICKEN_ROAD.GAME_CODE;

  private readonly logger = new Logger(ChickenRoadGameHandler.name);
  private server: Server | null = null;

  constructor(
    private readonly chickenRoadGameService: ChickenRoadGameService,
    private readonly walletService: WalletService,
    private readonly userService: UserService,
    private readonly lastWinBroadcasterService: LastWinBroadcasterService,
    private readonly fairnessService: FairnessService,
    private readonly gameService: GameService,
    private readonly agentsService: AgentsService,
    private readonly gameRegistry: GameRegistryService,
  ) {}

  onGatewayInit(server: Server): void {
    this.server = server;
    this.logger.log('[CHICKEN_ROAD_HANDLER] Gateway initialized, server instance stored');
    
    // Get all game codes handled by this handler (including additional codes)
    const gameCodes = this.gameRegistry.getGamesForHandler(this.gameCode);
    this.logger.log(`[CHICKEN_ROAD_HANDLER] Handler supports ${gameCodes.length} game code(s): ${gameCodes.join(', ')}`);
    
    // Start broadcasting last-win notifications to all game codes handled by this handler
    this.lastWinBroadcasterService.startBroadcasting(server, gameCodes);
  }

  getServer(): Server | null {
    return this.server;
  }

  async handleConnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, operatorId, gameCode } = context;

    this.logger.log(
      `[WS_CONNECT] socketId=${client.id} user=${userId} agent=${agentId} gameCode=${gameCode} operatorId=${operatorId}`,
    );

    const balance: BalanceEventPayload = {
      currency: DEFAULTS.PLATFORM.CURRENCY.DEFAULT,
      balance: DEFAULTS.PLATFORM.CURRENCY.DEFAULT_BALANCE,
    };

    const walletBalance = await this.walletService.getBalance(agentId, userId);
    balance.balance = walletBalance.balance.toString();
    balance.currency = DEFAULTS.PLATFORM.CURRENCY.DEFAULT;

    const betsRanges = {
      [DEFAULTS.GAMES.CHICKEN_ROAD.betConfig.currency]: [
        DEFAULTS.GAMES.CHICKEN_ROAD.betConfig.minBetAmount,
        DEFAULTS.GAMES.CHICKEN_ROAD.betConfig.maxBetAmount,
      ],
    };

    let { betConfig } = await this.chickenRoadGameService.getGameConfigPayload(gameCode);

    betConfig = {
      INR: {
        ...betConfig,
      },
    };

    const userData = await this.userService.findOne(userId, agentId);

    const myData: MyDataEvent = {
      userId: userId,
      nickname: userData.username || userId,
      gameAvatar: userData?.avatar || DEFAULTS.PLATFORM.USER.DEFAULT_AVATAR,
    };

    const currencies = await this.chickenRoadGameService.getCurrencies();

    // Generate or retrieve fairness seeds for user
    try {
      await this.fairnessService.getOrCreateFairness(userId, agentId);
    } catch (error: any) {
      this.logger.warn(
        `Failed to initialize fairness seeds for user=${userId} agent=${agentId}: ${error.message}`,
      );
      // Continue without failing connection
    }

    client.emit(WS_EVENTS.BALANCE_CHANGE, balance);
    client.emit(WS_EVENTS.BETS_RANGES, betsRanges);
    client.emit(WS_EVENTS.BET_CONFIG, betConfig);
    client.emit(WS_EVENTS.MY_DATA, myData);
    client.emit(WS_EVENTS.CURRENCIES, currencies);

    this.logger.log(
      `Chicken Road socket connected id=${client.id} userId=${userId} agentId=${agentId} gameCode=${gameCode} operatorId=${operatorId}`,
    );
  }

  async handleDisconnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId } = context;
    this.logger.log(
      `[WS_DISCONNECT] socketId=${client.id} user=${userId || 'N/A'} agent=${agentId || 'N/A'}`,
    );
    // Note: cleanupOnDisconnect is commented out in the original service
    // await this.chickenRoadGameService.cleanupOnDisconnect();
  }

  registerMessageHandlers(context: GameConnectionContext): void {
    const { client, userId, agentId, gameCode } = context;

    // Ping handler
    client.on(WS_EVENTS.PING, () => {
      client.emit(WS_EVENTS.PONG, { ts: Date.now() });
    });

    // Game service ACK handler
    const ackHandler = (data: any, ack?: Function, ...rest: any[]) => {
      if (typeof ack !== 'function') return;

      const rawAction: string | undefined = data?.action;
      if (!rawAction) return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_ACTION));

      if (rawAction === GameAction.GET_GAME_CONFIG) {
        if (!gameCode) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_GAME_CODE));
        }

        this.chickenRoadGameService
          .getGameConfigPayload(gameCode)
          .then((payload) => {
            this.logger.log(`Returning game config (ACK) to ${client.id}`);
            const { betConfig, ...rest } = payload;
            ack({ ...rest });
          })
          .catch((e) => {
            this.logger.error(`ACK game config failed: ${e}`);
            ack(formatErrorResponse(ERROR_RESPONSES.CONFIG_FETCH_FAILED));
          });
        return;
      }

      if (rawAction === GameAction.GET_GAME_SEEDS) {
        if (!userId || !agentId) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.chickenRoadGameService
          .getGameSeeds(userId, agentId)
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Get game seeds failed: ${e}`);
            ack(formatErrorResponse('get_game_seeds_failed'));
          });
        return;
      }

      if (rawAction === GameAction.SET_USER_SEED) {
        if (!userId || !agentId) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        const userSeed: string | undefined = data?.payload?.userSeed;
        if (!userSeed || typeof userSeed !== 'string') {
          return ack(formatErrorResponse('missing_user_seed'));
        }
        this.chickenRoadGameService
          .setUserSeed(userId, agentId, userSeed)
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Set user seed failed: ${e}`);
            ack(formatErrorResponse(e.message || 'set_user_seed_failed'));
          });
        return;
      }

      if (rawAction === GameAction.BET) {
        if (!userId || !agentId || !gameCode) {
          this.logger.warn(
            `Bet action missing context: socket=${client.id} userId=${userId} agentId=${agentId} gameCode=${gameCode}`,
          );
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_CONTEXT));
        }
        this.logger.debug(
          `Bet action received: socket=${client.id} user=${userId} agent=${agentId} payload=${JSON.stringify(data?.payload)}`,
        );
        this.chickenRoadGameService
          .performBetFlow(userId, agentId, gameCode, data?.payload)
          .then(async (resp) => {
            if ('error' in resp) {
              ack(formatErrorResponse(resp.error));
              this.logger.warn(
                `Bet failed - no balance update: socket=${client.id} user=${userId} error=${resp.error}`,
              );
            } else {
              ack(resp);
              const walletBalance = await this.walletService.getBalance(agentId, userId);
              const balanceEvent: BalanceEventPayload = {
                currency: DEFAULTS.PLATFORM.CURRENCY.DEFAULT,
                balance: walletBalance.balance.toString(),
              };
              client.emit(WS_EVENTS.BALANCE_CHANGE, balanceEvent);
              this.logger.log(
                `Balance updated after bet: socket=${client.id} user=${userId} balance=${walletBalance.balance} currency=${DEFAULTS.PLATFORM.CURRENCY.DEFAULT}`,
              );
            }
          })
          .catch((e) => {
            this.logger.error(`Bet flow failed for socket ${client.id}: ${e}`);
            ack(formatErrorResponse(ERROR_RESPONSES.BET_FAILED));
          });
        return;
      }

      if (rawAction === GameAction.STEP) {
        if (!userId || !agentId || !gameCode) {
          this.logger.warn(
            `Step action missing user/agent/gameCode: socket=${client.id} userId=${userId} agentId=${agentId} gameCode=${gameCode}`,
          );
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        const lineNumber = Number(data?.payload?.lineNumber);
        if (!isFinite(lineNumber)) {
          this.logger.warn(
            `Invalid line number: socket=${client.id} user=${userId} lineNumber=${data?.payload?.lineNumber}`,
          );
          return ack(formatErrorResponse(ERROR_RESPONSES.INVALID_LINE_NUMBER));
        }

        this.logger.debug(
          `Step action received: socket=${client.id} user=${userId} agent=${agentId} lineNumber=${lineNumber}`,
        );
        this.chickenRoadGameService
          .performStepFlow(userId, agentId, gameCode, lineNumber)
          .then(async (r) => {
            if ('error' in r) {
              ack(formatErrorResponse(r.error));
            } else if (r.isFinished) {
              const walletBalance = await this.walletService.getBalance(agentId, userId);
              const balanceEvent: BalanceEventPayload = {
                currency: r.currency,
                balance: walletBalance.balance.toString(),
              };
              client.emit(WS_EVENTS.BALANCE_CHANGE, balanceEvent);
              ack(r);
              this.logger.log(
                `Balance updated after step (finished): socket=${client.id} user=${userId} balance=${walletBalance.balance} currency=${r.currency} endReason=${r.endReason || 'N/A'}`,
              );
            } else {
              ack(r);
            }
          })
          .catch((e) => {
            this.logger.error(`Step flow failed: ${e}`);
            ack(formatErrorResponse(ERROR_RESPONSES.STEP_FAILED));
          });
        return;
      }

      if (rawAction === GameAction.CASHOUT || rawAction === GameAction.WITHDRAW) {
        if (!userId || !agentId || !gameCode) {
          this.logger.warn(
            `Cashout action missing user/agent/gameCode: socket=${client.id} userId=${userId} agentId=${agentId} gameCode=${gameCode}`,
          );
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.logger.debug(
          `Cashout action received: socket=${client.id} user=${userId} agent=${agentId}`,
        );
        this.chickenRoadGameService
          .performCashOutFlow(userId, agentId, gameCode)
          .then(async (r) => {
            if ('error' in r) {
              ack(formatErrorResponse(r.error));
              this.logger.warn(
                `Cashout failed - no balance update: socket=${client.id} user=${userId} error=${r.error}`,
              );
            } else {
              ack(r);
              const walletBalance = await this.walletService.getBalance(agentId, userId);
              const balanceEvent: BalanceEventPayload = {
                currency: DEFAULTS.PLATFORM.CURRENCY.DEFAULT,
                balance: walletBalance.balance.toString(),
              };
              client.emit(WS_EVENTS.BALANCE_CHANGE, balanceEvent);
              this.logger.log(
                `Balance updated after cashout: socket=${client.id} user=${userId} balance=${walletBalance.balance} currency=${DEFAULTS.PLATFORM.CURRENCY.DEFAULT}`,
              );
            }
          })
          .catch((e) => {
            this.logger.error(`Cashout flow failed: ${e}`);
            ack(formatErrorResponse(ERROR_RESPONSES.CASHOUT_FAILED));
          });
        return;
      }

      if (rawAction === GameAction.GET_GAME_SESSION) {
        this.logger.log(`Get game session action received: socket=${client.id} user=${userId} agent=${agentId}`);
        if (!userId || !agentId || !gameCode) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.chickenRoadGameService
          .performGetSessionFlow(userId, agentId, gameCode)
          .then((r) => {
            if ('error' in r) {
              ack(formatErrorResponse(r.error));
            } else {
              ack(r);
            }
          })
          .catch((e) => {
            this.logger.error(`Get session flow failed: ${e}`);
            ack(formatErrorResponse(ERROR_RESPONSES.GET_SESSION_FAILED));
          });
        return;
      }

      if (rawAction === GameAction.GET_GAME_STATE) {
        this.logger.log(`Get game state action received: socket=${client.id} user=${userId} agent=${agentId} gameCode=${gameCode}`);
        if (!userId || !agentId || !gameCode) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.chickenRoadGameService
          .performGetGameStateFlow(userId, agentId, gameCode)
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Get game state flow failed: ${e}`);
            ack(null);
          });
        return;
      }

      if (rawAction === GameAction.GET_MY_BETS_HISTORY) {
        if (!userId || !agentId) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.chickenRoadGameService
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

    client.prependListener(WS_EVENTS.GAME_SERVICE, ackHandler);

    // Handle direct event for bet history
    const betHistoryHandler = (data: any, ack?: Function) => {
      if (typeof ack !== 'function') return;

      this.logger.log(`Bet history request received: socket=${client.id} user=${userId} agent=${agentId}`);

      if (!userId || !agentId) {
        return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
      }

      this.chickenRoadGameService
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
