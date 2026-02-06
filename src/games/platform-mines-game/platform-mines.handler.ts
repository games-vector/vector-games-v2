import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { WalletService, UserService } from '@games-vector/game-core';
import { GameAction } from './DTO/game-action.dto';
import { PlatformMinesService } from './platform-mines.service';
import { FairnessService } from '../chicken-road-game/modules/fairness/fairness.service';
import { GameService } from '../../modules/games/game.service';
import { DEFAULTS } from '../../config/defaults.config';
import { IGameHandler, GameConnectionContext } from '../interfaces/game-handler.interface';

const GAME_CODE = 'platform-mines';

const WS_EVENTS = {
  BALANCE_CHANGE: 'onBalanceChange',
  BET_CONFIG: 'betsConfig',
  BETS_RANGES: 'betsRanges',
  MY_DATA: 'myData',
  GAME_SERVICE: 'gameService',
  PING: 'ping',
  PONG: 'pong',
} as const;

const ERROR_RESPONSES = {
  MISSING_ACTION: 'missing_action',
  MISSING_CONTEXT: 'missing_context',
  MISSING_USER_OR_AGENT: 'missing_user_or_agent',
  PLAY_FAILED: 'play_failed',
  STEP_FAILED: 'step_failed',
  PAYOUT_FAILED: 'payout_failed',
  UNSUPPORTED_ACTION: 'unsupported_action',
} as const;

function formatErrorResponse(errorMessage: string): { error: { message: string } } {
  return { error: { message: errorMessage } };
}

const DEFAULT_BET_CONFIG = {
  minBetAmount: '0.01',
  maxBetAmount: '200.00',
  maxWinAmount: '20000.00',
  defaultBetAmount: '0.48',
  betPresets: ['0.5', '1', '2', '7'],
  decimalPlaces: '2',
  currency: 'INR',
};

@Injectable()
export class PlatformMinesHandler implements IGameHandler {
  readonly gameCode = GAME_CODE;

  private readonly logger = new Logger(PlatformMinesHandler.name);
  private server: Server | null = null;

  constructor(
    private readonly minesService: PlatformMinesService,
    private readonly walletService: WalletService,
    private readonly userService: UserService,
    private readonly fairnessService: FairnessService,
    private readonly gameService: GameService,
  ) {}

  onGatewayInit(server: Server): void {
    this.server = server;
    this.logger.log('[PLATFORM_MINES_HANDLER] Gateway initialized');
  }

  getServer(): Server | null {
    return this.server;
  }

  getGameConfigResponse(): any {
    return {
      betConfig: DEFAULT_BET_CONFIG,
      coefficients: {},
      lastWin: {
        username: 'Player',
        winAmount: '0',
        currency: 'INR',
      },
    };
  }

  async handleConnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, operatorId, gameCode } = context;

    this.logger.log(
      `[WS_CONNECT] socketId=${client.id} user=${userId} agent=${agentId} gameCode=${gameCode}`,
    );

    // Get balance
    const balance: { currency: string; balance: string } = {
      currency: DEFAULTS.PLATFORM.CURRENCY.DEFAULT,
      balance: DEFAULTS.PLATFORM.CURRENCY.DEFAULT_BALANCE,
    };
    try {
      const walletBalance = await this.walletService.getBalance(agentId, userId);
      balance.balance = walletBalance.balance.toString();
    } catch (e) {
      this.logger.warn(`Failed to get balance for user=${userId}: ${(e as Error).message}`);
    }

    // Get bet config from DB or use defaults
    const dbBetConfig = await this.minesService.getGameConfigPayload(gameCode);
    const betConfig = {
      minBetAmount: dbBetConfig?.minBetAmount || DEFAULT_BET_CONFIG.minBetAmount,
      maxBetAmount: dbBetConfig?.maxBetAmount || DEFAULT_BET_CONFIG.maxBetAmount,
      maxWinAmount: dbBetConfig?.maxWinAmount || DEFAULT_BET_CONFIG.maxWinAmount,
      defaultBetAmount: dbBetConfig?.defaultBetAmount || DEFAULT_BET_CONFIG.defaultBetAmount,
      betPresets: dbBetConfig?.betPresets || DEFAULT_BET_CONFIG.betPresets,
      decimalPlaces: dbBetConfig?.decimalPlaces || DEFAULT_BET_CONFIG.decimalPlaces,
      currency: DEFAULT_BET_CONFIG.currency,
    };

    const betsRanges = {
      [DEFAULT_BET_CONFIG.currency]: [
        betConfig.minBetAmount,
        betConfig.maxBetAmount,
      ],
    };

    // Get user data
    let myData = { role: 'player', userId, nickname: userId, gameAvatar: null as string | null };
    try {
      const userData = await this.userService.findOne(userId, agentId);
      myData.nickname = userData.username || userId;
      myData.gameAvatar = userData?.avatar || null;
    } catch (e) {
      this.logger.warn(`Failed to get user data for user=${userId}: ${(e as Error).message}`);
    }

    // Initialize fairness seeds
    try {
      await this.fairnessService.getOrCreateFairness(userId, agentId);
    } catch (e) {
      this.logger.warn(`Failed to init fairness seeds: user=${userId}: ${(e as Error).message}`);
    }

    // Emit initial events
    client.emit(WS_EVENTS.BALANCE_CHANGE, balance);
    client.emit(WS_EVENTS.BET_CONFIG, betConfig);
    client.emit(WS_EVENTS.BETS_RANGES, betsRanges);
    client.emit(WS_EVENTS.MY_DATA, myData);
  }

  async handleDisconnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId } = context;
    this.logger.log(`[WS_DISCONNECT] socketId=${client.id} user=${userId}`);
  }

  registerMessageHandlers(context: GameConnectionContext): void {
    const { client, userId, agentId, gameCode } = context;

    client.on(WS_EVENTS.PING, () => {
      client.emit(WS_EVENTS.PONG, { ts: Date.now() });
    });

    const ackHandler = (data: any, ack?: Function) => {
      if (typeof ack !== 'function') return;

      const rawAction: string | undefined = data?.action;
      if (!rawAction) {
        return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_ACTION));
      }

      // Skip get-game-config - handled by CriticalHandlersService
      if (rawAction === GameAction.GET_GAME_CONFIG || rawAction === 'get-game-config') {
        return;
      }

      // ----------------------------------------------------------------
      // GET GAME STATE
      // ----------------------------------------------------------------
      if (rawAction === GameAction.GET_GAME_STATE) {
        if (!userId || !agentId) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.minesService
          .performGetGameStateFlow(userId, agentId, gameCode)
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Get game state failed: ${e}`);
            ack({ status: 'none' });
          });
        return;
      }

      // ----------------------------------------------------------------
      // GET GAME SEEDS
      // ----------------------------------------------------------------
      if (rawAction === GameAction.GET_GAME_SEEDS) {
        if (!userId || !agentId) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.minesService
          .getGameSeeds(userId, agentId)
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Get game seeds failed: ${e}`);
            ack(formatErrorResponse('get_game_seeds_failed'));
          });
        return;
      }

      // ----------------------------------------------------------------
      // SET USER SEED
      // ----------------------------------------------------------------
      if (rawAction === GameAction.SET_USER_SEED) {
        if (!userId || !agentId) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        const userSeed = data?.payload?.userSeed;
        if (!userSeed || typeof userSeed !== 'string') {
          return ack(formatErrorResponse('missing_user_seed'));
        }
        this.minesService
          .setUserSeed(userId, agentId, userSeed)
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Set user seed failed: ${e}`);
            ack(formatErrorResponse(e.message || 'set_user_seed_failed'));
          });
        return;
      }

      // ----------------------------------------------------------------
      // GET RATES
      // ----------------------------------------------------------------
      if (rawAction === GameAction.GET_RATES) {
        this.minesService
          .getRates()
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Get rates failed: ${e}`);
            ack(formatErrorResponse('get_rates_failed'));
          });
        return;
      }

      // ----------------------------------------------------------------
      // GET GAME HISTORY
      // ----------------------------------------------------------------
      if (rawAction === GameAction.GET_GAME_HISTORY) {
        if (!userId || !agentId) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.minesService
          .getMyBetsHistory(userId, agentId, gameCode)
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Get game history failed: ${e}`);
            ack(formatErrorResponse('get_game_history_failed'));
          });
        return;
      }

      // ----------------------------------------------------------------
      // PLAY (Start Game)
      // ----------------------------------------------------------------
      if (rawAction === GameAction.PLAY) {
        if (!userId || !agentId || !gameCode) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_CONTEXT));
        }
        this.minesService
          .performPlayFlow(userId, agentId, gameCode, data?.payload)
          .then(async (resp) => {
            if ('error' in resp) {
              ack(formatErrorResponse((resp as any).error));
            } else {
              ack(resp);
              // Update balance
              try {
                const walletBalance = await this.walletService.getBalance(agentId, userId);
                client.emit(WS_EVENTS.BALANCE_CHANGE, {
                  currency: DEFAULTS.PLATFORM.CURRENCY.DEFAULT,
                  balance: walletBalance.balance.toString(),
                });
              } catch (e) {
                this.logger.warn(`Balance update after play failed: ${(e as Error).message}`);
              }
            }
          })
          .catch((e) => {
            this.logger.error(`Play flow failed: ${e}`);
            ack(formatErrorResponse(ERROR_RESPONSES.PLAY_FAILED));
          });
        return;
      }

      // ----------------------------------------------------------------
      // STEP (Reveal Cell)
      // ----------------------------------------------------------------
      if (rawAction === GameAction.STEP) {
        if (!userId || !agentId || !gameCode) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        const cellPosition = Number(data?.payload?.cellPosition);
        if (!isFinite(cellPosition)) {
          return ack(formatErrorResponse('invalid_cell_position'));
        }
        this.minesService
          .performStepFlow(userId, agentId, gameCode, cellPosition)
          .then(async (resp) => {
            if ('error' in resp) {
              ack(formatErrorResponse((resp as any).error));
            } else {
              ack(resp);
              // Update balance if game finished
              if (resp.isFinished) {
                try {
                  const walletBalance = await this.walletService.getBalance(agentId, userId);
                  client.emit(WS_EVENTS.BALANCE_CHANGE, {
                    currency: DEFAULTS.PLATFORM.CURRENCY.DEFAULT,
                    balance: walletBalance.balance.toString(),
                  });
                } catch (e) {
                  this.logger.warn(`Balance update after step failed: ${(e as Error).message}`);
                }
              }
            }
          })
          .catch((e) => {
            this.logger.error(`Step flow failed: ${e}`);
            ack(formatErrorResponse(ERROR_RESPONSES.STEP_FAILED));
          });
        return;
      }

      // ----------------------------------------------------------------
      // PAYOUT (Cash Out)
      // ----------------------------------------------------------------
      if (rawAction === GameAction.PAYOUT) {
        if (!userId || !agentId || !gameCode) {
          return ack(formatErrorResponse(ERROR_RESPONSES.MISSING_USER_OR_AGENT));
        }
        this.minesService
          .performPayoutFlow(userId, agentId, gameCode)
          .then(async (resp) => {
            if ('error' in resp) {
              ack(formatErrorResponse((resp as any).error));
            } else {
              ack(resp);
              // Update balance
              try {
                const walletBalance = await this.walletService.getBalance(agentId, userId);
                client.emit(WS_EVENTS.BALANCE_CHANGE, {
                  currency: DEFAULTS.PLATFORM.CURRENCY.DEFAULT,
                  balance: walletBalance.balance.toString(),
                });
              } catch (e) {
                this.logger.warn(`Balance update after payout failed: ${(e as Error).message}`);
              }
            }
          })
          .catch((e) => {
            this.logger.error(`Payout flow failed: ${e}`);
            ack(formatErrorResponse(ERROR_RESPONSES.PAYOUT_FAILED));
          });
        return;
      }

      return ack(formatErrorResponse(ERROR_RESPONSES.UNSUPPORTED_ACTION));
    };

    client.removeAllListeners(WS_EVENTS.GAME_SERVICE);
    client.prependListener(WS_EVENTS.GAME_SERVICE, ackHandler);
  }
}
