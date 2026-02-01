import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WalletService, UserService, AgentsService } from '@games-vector/game-core';
import { GameService } from '../../modules/games/game.service';
import { CoinFlipGameService } from './coinflip-game.service';
import { CoinFlipFairnessService } from './modules/fairness/fairness.service';
import { GameConnectionContext, IGameHandler } from '../interfaces/game-handler.interface';
import { GameAction } from './DTO/game-action.dto';
import { COINFLIP_CONSTANTS, WS_EVENTS } from './constants/coinflip.constants';
import { DEFAULTS } from '../../config/defaults.config';

function formatErrorResponse(message: string): { error: { message: string } } {
  return { error: { message } };
}

@Injectable()
export class CoinFlipGameHandler implements IGameHandler {
  readonly gameCode = COINFLIP_CONSTANTS.GAME_CODE;

  private readonly logger = new Logger(CoinFlipGameHandler.name);
  private server: Server | null = null;

  constructor(
    private readonly coinFlipGameService: CoinFlipGameService,
    private readonly walletService: WalletService,
    private readonly userService: UserService,
    private readonly gameService: GameService,
    private readonly agentsService: AgentsService,
    private readonly fairnessService: CoinFlipFairnessService,
  ) {}

  onGatewayInit(server: Server): void {
    this.server = server;
    this.logger.log('[COINFLIP_HANDLER] Gateway initialized, server instance stored');
  }

  getServer(): Server | null {
    return this.server;
  }

  getGameConfigResponse(): any {
    const defaultBetConfig = DEFAULTS.GAMES.COINFLIP.BET_CONFIG;
    const defaultLastWin = DEFAULTS.GAMES.COINFLIP.LAST_WIN;
    return {
      betConfig: {
        minBetAmount: defaultBetConfig.minBetAmount,
        maxBetAmount: defaultBetConfig.maxBetAmount,
        maxWinAmount: defaultBetConfig.maxWinAmount,
        defaultBetAmount: defaultBetConfig.defaultBetAmount,
        betPresets: defaultBetConfig.betPresets,
        decimalPlaces: defaultBetConfig.decimalPlaces,
        currency: defaultBetConfig.currency,
      },
      coefficients: {},
      lastWin: {
        username: defaultLastWin.DEFAULT_USERNAME,
        winAmount: defaultLastWin.DEFAULT_WIN_AMOUNT,
        currency: defaultBetConfig.currency,
      },
    };
  }

  async handleConnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, operatorId, gameCode } = context;

    this.logger.log(
      `[WS_CONNECT] socketId=${client.id} user=${userId} agent=${agentId} gameCode=${gameCode} operatorId=${operatorId}`,
    );

    const defaultBetConfig = DEFAULTS.GAMES.COINFLIP.BET_CONFIG;
    const defaultCurrency = defaultBetConfig.currency;

    const sendFallbackPayload = async () => {
      const balance = {
        currency: defaultCurrency,
        balance: DEFAULTS.PLATFORM.CURRENCY.DEFAULT_BALANCE,
      };
      const betsRanges = {
        [defaultCurrency]: [
          defaultBetConfig.minBetAmount,
          defaultBetConfig.maxBetAmount,
        ],
      };
      const betConfig = {
        [defaultCurrency]: {
          minBetAmount: defaultBetConfig.minBetAmount,
          maxBetAmount: defaultBetConfig.maxBetAmount,
          maxWinAmount: defaultBetConfig.maxWinAmount,
          defaultBetAmount: defaultBetConfig.defaultBetAmount,
          betPresets: defaultBetConfig.betPresets,
          decimalPlaces: defaultBetConfig.decimalPlaces,
        },
      };
      const myData = {
        userId,
        nickname: userId,
        gameAvatar: DEFAULTS.PLATFORM.USER.DEFAULT_AVATAR,
      };
      const currencies = await this.coinFlipGameService.getCurrencies();
      client.emit(WS_EVENTS.BALANCE_CHANGE, balance);
      client.emit(WS_EVENTS.BETS_RANGES, betsRanges);
      client.emit(WS_EVENTS.BET_CONFIG, betConfig);
      client.emit(WS_EVENTS.MY_DATA, myData);
      client.emit(WS_EVENTS.CURRENCIES, currencies);
    };

    try {
      const walletBalance = await this.walletService.getBalance(agentId, userId);
      const balance = {
        currency: defaultCurrency,
        balance: walletBalance.balance.toString(),
      };

      const betsRanges = {
        [defaultCurrency]: [
          defaultBetConfig.minBetAmount,
          defaultBetConfig.maxBetAmount,
        ],
      };

      const betConfig = {
        [defaultCurrency]: {
          minBetAmount: defaultBetConfig.minBetAmount,
          maxBetAmount: defaultBetConfig.maxBetAmount,
          maxWinAmount: defaultBetConfig.maxWinAmount,
          defaultBetAmount: defaultBetConfig.defaultBetAmount,
          betPresets: defaultBetConfig.betPresets,
          decimalPlaces: defaultBetConfig.decimalPlaces,
        },
      };

      const userData = await this.userService.findOne(userId, agentId);
      const myData = {
        userId,
        nickname: userData?.username || userId,
        gameAvatar: userData?.avatar ?? DEFAULTS.PLATFORM.USER.DEFAULT_AVATAR,
      };

      const currencies = await this.coinFlipGameService.getCurrencies();

      try {
        await this.fairnessService.getOrCreateFairness(userId, agentId);
      } catch (err: any) {
        this.logger.warn(
          `Failed to initialize fairness seeds for user=${userId} agent=${agentId}: ${err.message}`,
        );
      }

      client.emit(WS_EVENTS.BALANCE_CHANGE, balance);
      client.emit(WS_EVENTS.BETS_RANGES, betsRanges);
      client.emit(WS_EVENTS.BET_CONFIG, betConfig);
      client.emit(WS_EVENTS.MY_DATA, myData);
      client.emit(WS_EVENTS.CURRENCIES, currencies);
    } catch (err: any) {
      this.logger.error(
        `[WS_CONNECT] Failed to send platform data: ${err.message}`,
        err.stack,
      );
      await sendFallbackPayload();
    }
  }

  async handleDisconnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, gameCode } = context;
    this.logger.log(
      `[WS_DISCONNECT] socketId=${client.id} user=${userId ?? 'N/A'} agent=${agentId ?? 'N/A'} gameCode=${gameCode ?? 'N/A'}`,
    );
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
        return ack(formatErrorResponse('missing_action'));
      }

      if (rawAction === GameAction.GET_GAME_CONFIG || rawAction === 'get-game-config') {
        return;
      }

      if (rawAction === GameAction.GET_GAME_SEEDS) {
        if (!userId || !agentId) {
          return ack(formatErrorResponse('missing_user_or_agent'));
        }
        this.coinFlipGameService
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
          return ack(formatErrorResponse('missing_user_or_agent'));
        }
        const userSeed: string | undefined = data?.payload?.userSeed;
        if (!userSeed || typeof userSeed !== 'string') {
          return ack(formatErrorResponse('missing_user_seed'));
        }
        this.coinFlipGameService
          .setUserSeed(userId, agentId, userSeed)
          .then((r) => ack(r))
          .catch((e) => {
            this.logger.error(`Set user seed failed: ${e}`);
            ack(formatErrorResponse(e?.message || 'set_user_seed_failed'));
          });
        return;
      }

      if (rawAction === GameAction.BET) {
        if (!userId || !agentId || !gameCode) {
          return ack(formatErrorResponse('missing_context'));
        }
        this.coinFlipGameService
          .performBetFlow(userId, agentId, gameCode, data?.payload)
          .then(async (resp) => {
            if (resp && 'error' in resp) {
              ack(formatErrorResponse(resp.error));
            } else {
              ack(resp);
              const walletBalance = await this.walletService.getBalance(agentId, userId);
              const currency = resp && 'currency' in resp ? resp.currency : DEFAULTS.PLATFORM.CURRENCY.DEFAULT;
              client.emit(WS_EVENTS.BALANCE_CHANGE, {
                currency,
                balance: walletBalance.balance.toString(),
              });
            }
          })
          .catch((e) => {
            this.logger.error(`Bet flow failed: ${e}`);
            ack(formatErrorResponse('bet_failed'));
          });
        return;
      }

      if (rawAction === GameAction.STEP) {
        if (!userId || !agentId || !gameCode) {
          return ack(formatErrorResponse('missing_user_or_agent'));
        }
        this.coinFlipGameService
          .performStepFlow(userId, agentId, gameCode, data?.payload)
          .then(async (r) => {
            if (r && 'error' in r) {
              ack(formatErrorResponse(r.error));
            } else if (r?.isFinished) {
              const walletBalance = await this.walletService.getBalance(agentId, userId);
              client.emit(WS_EVENTS.BALANCE_CHANGE, {
                currency: r.currency,
                balance: walletBalance.balance.toString(),
              });
              ack(r);
            } else {
              ack(r);
            }
          })
          .catch((e) => {
            this.logger.error(`Step flow failed: ${e}`);
            ack(formatErrorResponse('step_failed'));
          });
        return;
      }

      if (rawAction === GameAction.WITHDRAW) {
        if (!userId || !agentId || !gameCode) {
          return ack(formatErrorResponse('missing_user_or_agent'));
        }
        this.coinFlipGameService
          .performCashOutFlow(userId, agentId, gameCode)
          .then(async (r) => {
            if (r && 'error' in r) {
              ack(formatErrorResponse(r.error));
            } else {
              ack(r);
              const walletBalance = await this.walletService.getBalance(agentId, userId);
              const currency = r && 'currency' in r ? r.currency : DEFAULTS.PLATFORM.CURRENCY.DEFAULT;
              client.emit(WS_EVENTS.BALANCE_CHANGE, {
                currency,
                balance: walletBalance.balance.toString(),
              });
            }
          })
          .catch((e) => {
            this.logger.error(`Cashout flow failed: ${e}`);
            ack(formatErrorResponse('cashout_failed'));
          });
        return;
      }

      if (rawAction === GameAction.GET_GAME_STATE || rawAction === 'get-game-state') {
        if (!userId || !agentId || !gameCode) {
          return ack(formatErrorResponse('missing_user_or_agent'));
        }
        this.coinFlipGameService
          .getGameState(userId, agentId, gameCode)
          .then((r) => ack(r)) // Returns null if no active session per requirements
          .catch((e) => {
            this.logger.error(`Get game state failed: ${e}`);
            ack(null);
          });
        return;
      }

      if (rawAction === GameAction.GET_MY_BETS_HISTORY) {
        if (!userId || !agentId) {
          return ack(formatErrorResponse('missing_user_or_agent'));
        }
        this.coinFlipGameService
          .getMyBetsHistory(userId, agentId, gameCode)
          .then((bets) => ack(bets))
          .catch((e) => {
            this.logger.error(`Get bet history failed: ${e}`);
            ack(formatErrorResponse('get_bet_history_failed'));
          });
        return;
      }

      ack(formatErrorResponse('unsupported_action'));
    };

    client.on(WS_EVENTS.GAME_SERVICE, ackHandler);
  }
}
