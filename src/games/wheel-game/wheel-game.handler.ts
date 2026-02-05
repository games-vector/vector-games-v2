import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtTokenService, UserTokenPayload, WalletService, UserService, AgentsService } from '@games-vector/game-core';
import { WheelGameService } from './wheel-game.service';
import { WheelGameBetService, WheelPlaceBetResponse } from './wheel-game-bet.service';
import { WheelLastWinBroadcasterService } from './modules/last-win/last-win-broadcaster.service';
import { GameService } from '../../modules/games/game.service';
import { DEFAULTS } from '../../config/defaults.config';
import { IGameHandler, GameConnectionContext } from '../interfaces/game-handler.interface';
import {
  GameStatus,
  WheelColor,
  WheelBetListPayload,
  GameStatusChangedPayload,
  WithdrawResultPayload,
} from './DTO/game-state.dto';
import { WheelBetPayloadDto } from './DTO/bet-payload.dto';

const WS_EVENTS = {
  BALANCE_CHANGE: 'onBalanceChange',
  BETS_RANGES: 'betsRanges',
  BET_CONFIG: 'betsConfig',
  MY_DATA: 'myData',
  CURRENCIES: 'currencies',
  GAME_STATUS_CHANGED: 'gameService-game-status-changed',
  BET_LIST_UPDATED: 'gameService-bet-list-updated',
  WITHDRAW_RESULT: 'gameService-withdraw-result',
  EXCEPTION: 'gameService-exception',
  GAME_SEEDS: 'gameService-onGameSeeds',
} as const;

@Injectable()
export class WheelGameHandler implements IGameHandler {
  readonly gameCode = DEFAULTS.WHEEL.GAME_CODE;

  private readonly logger = new Logger(WheelGameHandler.name);
  private server: Server | null = null;
  private betListBroadcastInterval: NodeJS.Timeout | null = null;
  private onRoundEndCallback: (() => void) | null = null;

  constructor(
    private readonly jwtTokens: JwtTokenService,
    private readonly wheelGameService: WheelGameService,
    private readonly wheelGameBetService: WheelGameBetService,
    private readonly walletService: WalletService,
    private readonly userService: UserService,
    private readonly gameService: GameService,
    private readonly agentsService: AgentsService,
    private readonly lastWinBroadcaster: WheelLastWinBroadcasterService,
  ) {}

  setOnRoundEndCallback(callback: () => void): void {
    this.onRoundEndCallback = callback;
  }

  onGatewayInit(server: Server): void {
    this.server = server;
    this.lastWinBroadcaster.setServer(server);
    this.lastWinBroadcaster.startBroadcasting(this.gameCode);
    this.logger.log('[WHEEL_HANDLER] Gateway initialized, server instance stored');
  }

  getServer(): Server | null {
    return this.server;
  }

  getGameConfigResponse(): any {
    try {
      const defaultBetConfig = DEFAULTS.GAMES.WHEEL.BET_CONFIG;
      return {
        betConfig: {
          minBetAmount: defaultBetConfig.minBetAmount,
          maxBetAmount: defaultBetConfig.maxBetAmount,
          maxWinAmount: defaultBetConfig.maxWinAmount,
          defaultBetAmount: defaultBetConfig.defaultBetAmount,
          betPresets: defaultBetConfig.betPresets,
          decimalPlaces: defaultBetConfig.decimalPlaces,
          currency: defaultBetConfig.currency || DEFAULTS.GAMES.WHEEL.DEFAULT_CURRENCY,
        },
        coefficients: DEFAULTS.GAMES.WHEEL.MULTIPLIERS,
        lastWin: {
          username: DEFAULTS.GAMES.WHEEL.LAST_WIN.DEFAULT_USERNAME,
          winAmount: DEFAULTS.GAMES.WHEEL.LAST_WIN.DEFAULT_WIN_AMOUNT,
          currency: defaultBetConfig.currency || DEFAULTS.GAMES.WHEEL.DEFAULT_CURRENCY,
        },
      };
    } catch (error: any) {
      this.logger.error(`[getGameConfigResponse] Error: ${error.message}`);
      throw error;
    }
  }

  async handleConnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, operatorId, gameCode } = context;

    const gameRoom = `game:${gameCode}`;
    client.join(gameRoom);

    this.logger.log(
      `[WS_CONNECT] socketId=${client.id} user=${userId} agent=${agentId} gameCode=${gameCode}`,
    );

    try {
      const configPayload = await this.wheelGameService.getGameConfigPayload(gameCode);
      const dbBetConfig = configPayload.betConfig;
      const defaultBetConfig = DEFAULTS.GAMES.WHEEL.BET_CONFIG;

      const defaultCurrency = dbBetConfig.currency || defaultBetConfig.currency || DEFAULTS.GAMES.WHEEL.DEFAULT_CURRENCY;

      const betConfig = {
        [defaultCurrency]: {
          betPresets: dbBetConfig.betPresets || defaultBetConfig.betPresets,
          minBetAmount: dbBetConfig.minBetAmount || defaultBetConfig.minBetAmount,
          maxBetAmount: dbBetConfig.maxBetAmount || defaultBetConfig.maxBetAmount,
          maxWinAmount: dbBetConfig.maxWinAmount || defaultBetConfig.maxWinAmount,
          defaultBetAmount: dbBetConfig.defaultBetAmount || defaultBetConfig.defaultBetAmount,
          decimalPlaces: dbBetConfig.decimalPlaces || defaultBetConfig.decimalPlaces,
        },
      };

      const betsRanges = {
        [defaultCurrency]: [
          dbBetConfig.minBetAmount || defaultBetConfig.minBetAmount,
          dbBetConfig.maxBetAmount || defaultBetConfig.maxBetAmount,
        ],
      };

      const walletBalance = await this.walletService.getBalance(agentId, userId);
      const balance = {
        currency: defaultCurrency,
        balance: walletBalance.balance.toString(),
      };

      const userData = await this.userService.findOne(userId, agentId);
      const myData = {
        userId,
        nickname: userData.username || userId,
        gameAvatar: userData.avatar || DEFAULTS.USER.DEFAULT_AVATAR,
      };

      const currencies = this.getCurrencies();

      client.emit(WS_EVENTS.BALANCE_CHANGE, balance);
      client.emit(WS_EVENTS.BETS_RANGES, betsRanges);
      client.emit(WS_EVENTS.BET_CONFIG, betConfig);
      client.emit(WS_EVENTS.MY_DATA, myData);
      client.emit(WS_EVENTS.CURRENCIES, currencies);
    } catch (error) {
      this.logger.error(`[WS_PLATFORM_MESSAGES] Failed: ${(error as Error).message}`);

      const defaultCurrency = DEFAULTS.WHEEL.DEFAULT_CURRENCY;
      client.emit(WS_EVENTS.BALANCE_CHANGE, { currency: defaultCurrency, balance: DEFAULTS.CURRENCY.DEFAULT_BALANCE });
      client.emit(WS_EVENTS.BETS_RANGES, { [defaultCurrency]: [DEFAULTS.WHEEL.BET_CONFIG.minBetAmount, DEFAULTS.WHEEL.BET_CONFIG.maxBetAmount] });
      client.emit(WS_EVENTS.BET_CONFIG, {
        [defaultCurrency]: {
          betPresets: DEFAULTS.WHEEL.BET_CONFIG.betPresets,
          minBetAmount: DEFAULTS.WHEEL.BET_CONFIG.minBetAmount,
          maxBetAmount: DEFAULTS.WHEEL.BET_CONFIG.maxBetAmount,
          maxWinAmount: DEFAULTS.WHEEL.BET_CONFIG.maxWinAmount,
          defaultBetAmount: DEFAULTS.WHEEL.BET_CONFIG.defaultBetAmount,
          decimalPlaces: DEFAULTS.WHEEL.BET_CONFIG.decimalPlaces,
        },
      });
      client.emit(WS_EVENTS.MY_DATA, { userId, nickname: userId, gameAvatar: DEFAULTS.USER.DEFAULT_AVATAR });
      client.emit(WS_EVENTS.CURRENCIES, this.getCurrencies());
    }
  }

  async handleDisconnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, gameCode } = context;

    this.logger.log(
      `[WS_DISCONNECT] socketId=${client.id} user=${userId || 'N/A'} gameCode=${gameCode || 'N/A'}`,
    );

    if (gameCode) {
      client.leave(`game:${gameCode}`);
    }
  }

  registerMessageHandlers(context: GameConnectionContext): void {
    const { client, userId, agentId, operatorId, gameCode, authPayload } = context;

    client.on('gameService', async (data: any, ack?: Function) => {
      if (!data?.action) return;

      if (data.action === 'get-game-config') {
        // Handled by CriticalHandlersService
        return;
      }

      if (data.action === 'get-game-state') {
        const gameState = await this.wheelGameService.getGameStateResponse();
        if (typeof ack === 'function') {
          ack(gameState || { gameId: 0, status: GameStatus.WAIT_GAME, allBets: { sumInUSD: 0, bets: { BLACK: [], RED: [], BLUE: [], GREEN: [] } } });
        }

        // Also send current game status
        const activeRound = this.wheelGameService.getActiveRound();
        if (activeRound) {
          let statusPayload: GameStatusChangedPayload;
          if (activeRound.status === GameStatus.WAIT_GAME) {
            const prevResults = await this.wheelGameService.getPrevRoundResults();
            statusPayload = this.wheelGameService.getWaitGamePayload(prevResults);
          } else if (activeRound.status === GameStatus.IN_GAME) {
            statusPayload = this.wheelGameService.getInGamePayload();
          } else {
            statusPayload = this.wheelGameService.getFinishGamePayload();
          }
          client.emit(WS_EVENTS.GAME_STATUS_CHANGED, statusPayload);
        }
        return;
      }

      if (data.action === 'make-bet') {
        const payload = data.payload || data;
        const betPayload: WheelBetPayloadDto = {
          betAmount: payload.betAmount || '',
          color: payload.color || '',
          currency: payload.currency || '',
        };

        await this.handleMakeBet(client, betPayload, userId, agentId, operatorId, gameCode, authPayload, ack);
        return;
      }

      if (data.action === 'get-my-bets-history' || data.action === 'getMyBetsHistory') {
        await this.handleGetBetsHistory(client, userId, gameCode, ack);
        return;
      }

      if (data.action === 'getGameSeeds') {
        if (typeof ack === 'function') {
          ack({ userSeed: '', hashedServerSeed: '' });
        }
        return;
      }
    });

    // Also handle legacy direct event
    client.on('gameService-get-my-bets-history', async (data: any, ack?: Function) => {
      await this.handleGetBetsHistory(client, userId, gameCode, ack);
    });
  }

  // =============================================
  // ACTION HANDLERS
  // =============================================

  private async handleMakeBet(
    client: Socket,
    payload: WheelBetPayloadDto,
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    authPayload: UserTokenPayload,
    ack?: Function,
  ): Promise<void> {
    if (!userId || !agentId || !operatorId) {
      if (typeof ack === 'function') {
        ack({ success: false, error: 'Missing user information', code: 'MISSING_USER_INFO' });
      }
      return;
    }

    const nickname = (authPayload as any).nickname || `user${userId}`;
    const gameAvatar = (authPayload as any).gameAvatar || null;
    const userAvatar = (authPayload as any).userAvatar || null;

    this.logger.log(
      `[WS_BET] user=${userId} amount=${payload.betAmount} color=${payload.color} currency=${payload.currency}`,
    );

    const result = await this.wheelGameBetService.placeBet(
      userId, agentId, operatorId, gameCode, payload,
      nickname, gameAvatar, userAvatar,
    );

    // Send ACK response (matches PRD format)
    if (typeof ack === 'function') {
      if (result.success) {
        ack({
          id: result.id,
          playerGameId: result.playerGameId,
          placedAt: result.placedAt,
          userId: result.userId,
          operatorId: result.operatorId,
          nickname: result.nickname,
          gameAvatar: result.gameAvatar,
          betAmount: result.betAmount,
          color: result.color,
          currency: result.currency,
          isNextRoundBet: result.isNextRoundBet || false,
        });
      } else {
        ack({ error: { message: result.error || 'Bet failed' } });
      }
    }

    // Send balance change
    if (result.success && result.balance && result.balanceCurrency) {
      client.emit(WS_EVENTS.BALANCE_CHANGE, {
        currency: result.balanceCurrency,
        balance: result.balance,
      });
    }

    // Broadcast updated bet list if bet placed immediately
    if (result.success && !result.isNextRoundBet) {
      await this.broadcastBetListUpdate(gameCode);
    }
  }

  private async handleGetBetsHistory(
    client: Socket,
    userId: string,
    gameCode: string,
    ack?: Function,
  ): Promise<void> {
    if (!userId) {
      if (typeof ack === 'function') {
        ack({ success: false, error: 'Missing user information', bets: [] });
      }
      return;
    }

    try {
      const betHistory = await this.wheelGameBetService.getUserBetsHistory(userId, gameCode);
      if (typeof ack === 'function') {
        ack(betHistory);
      }
    } catch (error: any) {
      this.logger.error(`[WS_GET_BETS_HISTORY] Error: ${error.message}`);
      if (typeof ack === 'function') {
        ack({ success: false, error: error.message, bets: [] });
      }
    }
  }

  // =============================================
  // BROADCASTING
  // =============================================

  broadcastGameStatusChanged(gameCode: string, payload: GameStatusChangedPayload): void {
    if (!this.server) return;
    this.server.to(`game:${gameCode}`).emit(WS_EVENTS.GAME_STATUS_CHANGED, payload);
  }

  async broadcastBetListUpdate(gameCode: string): Promise<void> {
    if (!this.server) return;
    const betList = await this.wheelGameService.getBetListPayload();
    this.server.to(`game:${gameCode}`).emit(WS_EVENTS.BET_LIST_UPDATED, betList);
  }

  broadcastWithdrawResult(userId: string, gameCode: string, payload: WithdrawResultPayload): void {
    if (!this.server) return;

    // Send withdraw-result only to the winning user's sockets
    let socketsMap: Map<string, any> | undefined;

    if (this.server.sockets instanceof Map) {
      socketsMap = this.server.sockets as Map<string, any>;
    } else if (this.server.sockets?.sockets instanceof Map) {
      socketsMap = this.server.sockets.sockets as Map<string, any>;
    }

    if (!socketsMap) {
      // Fallback: broadcast with targetUserId filter
      this.server.to(`game:${gameCode}`).emit(WS_EVENTS.WITHDRAW_RESULT, {
        ...payload,
        targetUserId: userId,
      });
      return;
    }

    try {
      socketsMap.forEach((socket) => {
        if (socket.data?.userId === userId) {
          socket.emit(WS_EVENTS.WITHDRAW_RESULT, payload);
        }
      });
    } catch (error: any) {
      this.logger.error(`[WITHDRAW_BROADCAST] Error: ${error.message}`);
      this.server.to(`game:${gameCode}`).emit(WS_EVENTS.WITHDRAW_RESULT, {
        ...payload,
        targetUserId: userId,
      });
    }
  }

  emitBalanceChange(userId: string, gameCode: string, currency: string, balance: string): void {
    if (!this.server) return;

    let socketsMap: Map<string, any> | undefined;
    if (this.server.sockets instanceof Map) {
      socketsMap = this.server.sockets as Map<string, any>;
    } else if (this.server.sockets?.sockets instanceof Map) {
      socketsMap = this.server.sockets.sockets as Map<string, any>;
    }

    if (!socketsMap) return;

    try {
      socketsMap.forEach((socket) => {
        if (socket.data?.userId === userId) {
          socket.emit(WS_EVENTS.BALANCE_CHANGE, { currency, balance });
        }
      });
    } catch (error: any) {
      this.logger.error(`[BALANCE_BROADCAST] Error: ${error.message}`);
    }
  }

  // =============================================
  // BET LIST PERIODIC BROADCAST
  // =============================================

  startBetListBroadcast(gameCode: string): void {
    if (this.betListBroadcastInterval) {
      this.stopBetListBroadcast();
    }

    this.betListBroadcastInterval = setInterval(async () => {
      try {
        const activeRound = this.wheelGameService.getActiveRound();
        if (!activeRound || activeRound.status !== GameStatus.WAIT_GAME) {
          return;
        }
        await this.broadcastBetListUpdate(gameCode);
      } catch (error) {
        this.logger.error(`[BET_LIST_BROADCAST] Error: ${(error as Error).message}`);
      }
    }, DEFAULTS.WHEEL.GAME.BET_LIST_BROADCAST_INTERVAL_MS);
  }

  stopBetListBroadcast(): void {
    if (this.betListBroadcastInterval) {
      clearInterval(this.betListBroadcastInterval);
      this.betListBroadcastInterval = null;
    }
  }

  triggerRoundEnd(): void {
    if (this.onRoundEndCallback) {
      this.onRoundEndCallback();
    }
  }

  // =============================================
  // CURRENCIES
  // =============================================

  private getCurrencies(): Record<string, number> {
    return {
      "ADA": 2.49, "AED": 3.6725, "AFN": 70, "ALL": 85.295, "AMD": 383.82,
      "ANG": 1.80, "AOA": 918.65, "ARS": 1371.48, "AUD": 1.5559, "AWG": 1.79,
      "AZN": 1.7, "BAM": 1.70, "BBD": 2.02, "BCH": 0.002, "BDT": 122.25,
      "BGN": 1.712, "BHD": 0.377, "BIF": 2981, "BMD": 1, "BNB": 0.0012,
      "BND": 1.30, "BOB": 6.91, "BRL": 5.60, "BSD": 1.00, "BTC": 0.000012,
      "BTN": 89.65, "BWP": 13.66, "BYN": 3.27, "BZD": 2.01, "CAD": 1.39,
      "CDF": 2277.50, "CHF": 0.814, "CLP": 972.65, "COP": 4186.71, "CRC": 505.29,
      "CZK": 21.51, "DKK": 6.54, "DOP": 61, "DZD": 130.92, "EGP": 48.57,
      "ETH": 0.00037, "EUR": 0.8755, "GBP": 0.7571, "GEL": 2.70, "GHS": 10.5,
      "HKD": 7.85, "HUF": 350.19, "IDR": 16443.4, "ILS": 3.40, "INR": 87.50,
      "JPY": 150.81, "KES": 129.2, "KRW": 1392.51, "KWD": 0.306, "MXN": 18.87,
      "MYR": 4.27, "NGN": 1532.39, "NOK": 10.33, "NZD": 1.70, "PHP": 58.27,
      "PKR": 283.25, "PLN": 3.74, "QAR": 3.64, "RON": 4.44, "RUB": 79.88,
      "SAR": 3.75, "SEK": 9.79, "SGD": 1.30, "THB": 32.75, "TRY": 40.67,
      "TWD": 29.92, "UAH": 41.70, "UGX": 3583.3, "USD": 1, "USDT": 1,
      "VND": 26199, "ZAR": 18.22,
    };
  }
}
