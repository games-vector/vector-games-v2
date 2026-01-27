import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtTokenService, UserTokenPayload, WalletService, UserService, AgentsService } from '@games-vector/game-core';
import { SugarDaddyGameService } from './sugar-daddy-game.service';
import { SugarDaddyGameBetService, PlaceBetPayload } from './sugar-daddy-game-bet.service';
import { GameService } from '../../modules/games/game.service';
import { GameStatus, CoefficientChangePayload, GameStateChangePayload, LatencyTestPayload, OnConnectGamePayload, BetData } from './DTO/game-state.dto';
import { JoinChatRoomPayload, ChatMessage } from './DTO/chat.dto';
import { DEFAULTS } from '../../config/defaults.config';
import { IGameHandler, GameConnectionContext } from '../interfaces/game-handler.interface';

const WS_EVENTS = {
  GAME_SERVICE_ON_CHANGE_COEFF: 'gameService-onChangeCoeffGame',
  GAME_SERVICE_ON_CHANGE_STATE: 'gameService-onChangeStateGame',
  GAME_SERVICE_ON_CONNECT_GAME: 'gameService-onConnectGame',
  GAME_SERVICE_ON_GAME_CONFIG: 'gameService-onGameConfig',
  GAME_SERVICE_ON_GAME_SEEDS: 'gameService-onGameSeeds',
  GAME_SERVICE_LATENCY_TEST: 'gameService-latencyTest',
  CHAT_SERVICE_JOIN_ROOM: 'chatService-joinRoom',
  CHAT_SERVICE_MESSAGES: 'chatService-messages',
  BALANCE_CHANGE: 'onBalanceChange',
  BETS_RANGES: 'betsRanges',
  BET_CONFIG: 'betsConfig',
  MY_DATA: 'myData',
  CURRENCIES: 'currencies',
  CONNECTION_ERROR: 'connection-error',
  BET: 'bet',
  CASHOUT: 'cashout',
  WITHDRAW: 'withdraw',
} as const;

@Injectable()
export class SugarDaddyGameHandler implements IGameHandler {
  readonly gameCode = DEFAULTS.AVIATOR.GAME_CODE; // Note: AVIATOR config key is used for Sugar Daddy

  private readonly logger = new Logger(SugarDaddyGameHandler.name);
  private server: Server | null = null;
  private coefficientUpdateInterval: NodeJS.Timeout | null = null;
  private gameStateBroadcastInterval: NodeJS.Timeout | null = null;
  private onRoundEndCallback: (() => void) | null = null;

  constructor(
    private readonly jwtTokens: JwtTokenService,
    private readonly sugarDaddyGameService: SugarDaddyGameService,
    private readonly sugarDaddyGameBetService: SugarDaddyGameBetService,
    private readonly walletService: WalletService,
    private readonly userService: UserService,
    private readonly gameService: GameService,
    private readonly agentsService: AgentsService,
  ) { }

  setOnRoundEndCallback(callback: () => void): void {
    this.onRoundEndCallback = callback;
  }

  onGatewayInit(server: Server): void {
    this.server = server;
    this.logger.log('[SUGAR_DADDY_HANDLER] Gateway initialized, server instance stored');
  }

  getServer(): Server | null {
    return this.server;
  }

  getGameConfigResponse(): any {
    try {
      const defaultBetConfig = DEFAULTS.GAMES.SUGAR_DADDY.BET_CONFIG;

      const response = {
        betConfig: {
          minBetAmount: defaultBetConfig.minBetAmount,
          maxBetAmount: defaultBetConfig.maxBetAmount,
          maxWinAmount: defaultBetConfig.maxWinAmount,
          defaultBetAmount: defaultBetConfig.defaultBetAmount,
          betPresets: defaultBetConfig.betPresets,
          decimalPlaces: defaultBetConfig.decimalPlaces,
          currency: defaultBetConfig.currency || DEFAULTS.GAMES.SUGAR_DADDY.DEFAULT_CURRENCY,
        },
        coefficients: {},
        lastWin: {
          username: 'Player',
          winAmount: '0',
          currency: defaultBetConfig.currency || DEFAULTS.GAMES.SUGAR_DADDY.DEFAULT_CURRENCY,
        },
      };

      this.logger.debug(`[getGameConfigResponse] Returning config for gameCode=${this.gameCode}`);
      return response;
    } catch (error: any) {
      this.logger.error(`[getGameConfigResponse] Error: ${error.message}`, error.stack);
      throw error;
    }
  }

  async handleConnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, operatorId, gameCode } = context;

    const gameRoom = `game:${gameCode}`;
    client.join(gameRoom);

    const rooms = Array.from(client.rooms);
    this.logger.log(
      `[WS_CONNECT] socketId=${client.id} user=${userId} agent=${agentId} gameCode=${gameCode} operatorId=${operatorId} joinedRoom=${gameRoom} allRooms=[${rooms.join(', ')}]`,
    );

    try {
      const configPayload = await this.sugarDaddyGameService.getGameConfigPayload(gameCode);
      const dbBetConfig = configPayload.betConfig;
      const defaultBetConfig = DEFAULTS.GAMES.SUGAR_DADDY.BET_CONFIG;

      const betConfig = {
        [defaultBetConfig.currency || DEFAULTS.GAMES.SUGAR_DADDY.DEFAULT_CURRENCY]: {
          betPresets: dbBetConfig.betPresets || defaultBetConfig.betPresets,
          minBetAmount: dbBetConfig.minBetAmount || defaultBetConfig.minBetAmount,
          maxBetAmount: dbBetConfig.maxBetAmount || defaultBetConfig.maxBetAmount,
          maxWinAmount: dbBetConfig.maxWinAmount || defaultBetConfig.maxWinAmount,
          defaultBetAmount: dbBetConfig.defaultBetAmount || defaultBetConfig.defaultBetAmount,
          decimalPlaces: dbBetConfig.decimalPlaces || defaultBetConfig.decimalPlaces,
        },
      };

      const defaultCurrency = defaultBetConfig.currency || DEFAULTS.GAMES.SUGAR_DADDY.DEFAULT_CURRENCY;
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
        userId: userId,
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
      this.logger.error(
        `[WS_PLATFORM_MESSAGES] Failed to send platform messages: ${error.message}`,
      );
      const balance = {
        currency: DEFAULTS.AVIATOR.DEFAULT_CURRENCY,
        balance: DEFAULTS.CURRENCY.DEFAULT_BALANCE,
      };
      const defaultCurrency = DEFAULTS.AVIATOR.DEFAULT_CURRENCY;
      const betsRanges = {
        [defaultCurrency]: DEFAULTS.AVIATOR.BET_RANGES[defaultCurrency] || [
          DEFAULTS.AVIATOR.BET_CONFIG.minBetAmount,
          DEFAULTS.AVIATOR.BET_CONFIG.maxBetAmount,
        ],
      };
      const betConfig = {
        [defaultCurrency]: {
          betPresets: DEFAULTS.AVIATOR.BET_CONFIG.betPresets,
          minBetAmount: DEFAULTS.AVIATOR.BET_CONFIG.minBetAmount,
          maxBetAmount: DEFAULTS.AVIATOR.BET_CONFIG.maxBetAmount,
          maxWinAmount: DEFAULTS.AVIATOR.BET_CONFIG.maxWinAmount,
          defaultBetAmount: DEFAULTS.AVIATOR.BET_CONFIG.defaultBetAmount,
          decimalPlaces: DEFAULTS.AVIATOR.BET_CONFIG.decimalPlaces,
        },
      };
      const myData = {
        userId: userId,
        nickname: userId,
        gameAvatar: DEFAULTS.USER.DEFAULT_AVATAR,
      };
      const currencies = this.getCurrencies();

      client.emit(WS_EVENTS.BALANCE_CHANGE, balance);
      client.emit(WS_EVENTS.BETS_RANGES, betsRanges);
      client.emit(WS_EVENTS.BET_CONFIG, betConfig);
      client.emit(WS_EVENTS.MY_DATA, myData);
      client.emit(WS_EVENTS.CURRENCIES, currencies);
    }
  }

  async handleDisconnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, gameCode } = context;

    this.logger.log(
      `[WS_DISCONNECT] socketId=${client.id} user=${userId || 'N/A'} agent=${agentId || 'N/A'} gameCode=${gameCode || 'N/A'}`,
    );

    if (gameCode) {
      client.leave(`game:${gameCode}`);
    }
  }

  registerMessageHandlers(context: GameConnectionContext): void {
    const { client, userId, agentId, operatorId, gameCode, authPayload } = context;

    // Latency test handler
    client.on(WS_EVENTS.GAME_SERVICE_LATENCY_TEST, (data: LatencyTestPayload, ack?: Function) => {
      if (typeof ack === 'function') {
        ack({ date: data.date });
      }
    });

    // Chat handler
    client.on(WS_EVENTS.CHAT_SERVICE_JOIN_ROOM, (data: JoinChatRoomPayload) => {
      // Support both 'language' and 'chatRoom' fields for compatibility
      const chatRoom = data.chatRoom || data.language || 'en';
      this.logger.log(`[WS_CHAT] Client ${client.id} joined chat room: ${chatRoom}`);
      this.sendChatMessages(client, chatRoom);
    });

    // Bet history handler
    client.on('gameService-get-my-bets-history', async (data: any, ack?: (response: any) => void) => {
      this.logger.log(`[WS_GET_BETS_HISTORY] Client ${client.id} requested bet history`);
      await this.handleGetBetsHistory(client, userId, gameCode, ack);
    });

    // Game service handler
    client.on('gameService', async (data: { action?: string; payload?: any; betAmount?: string; currency?: string; coeffAuto?: string; betNumber?: number; playerGameId?: string }) => {
      if (data?.action === 'join') {
        this.logger.log(`[WS_JOIN] Client ${client.id} joined game`);
        this.sendOnConnectGame(client, userId).catch((error) => {
          this.logger.error(`[WS_JOIN] Error sending onConnectGame: ${error.message}`);
        });

        const gameState = await this.sugarDaddyGameService.getCurrentGameState();
        if (gameState) {
          this.logger.log(`[WS_JOIN] Sending current game state to client ${client.id}: status=${gameState.status} roundId=${gameState.roundId}`);
          client.emit(WS_EVENTS.GAME_SERVICE_ON_CHANGE_STATE, gameState);
        } else {
          const defaultGameState: GameStateChangePayload = {
            status: GameStatus.WAIT_GAME,
            roundId: 0,
            waitTime: null,
            bets: {
              totalBetsAmount: 0,
              values: [],
            },
            previousBets: {
              totalBetsAmount: 0,
              values: [],
            },
          };
          this.logger.log(`[WS_JOIN] Sending default game state to client ${client.id} (no active game)`);
          client.emit(WS_EVENTS.GAME_SERVICE_ON_CHANGE_STATE, defaultGameState);
        }
      } else if (data?.action === 'get-game-config') {
        this.logger.log(`[WS_GET_CONFIG] Client ${client.id} requested game config`);
        const configPayload = {};
        this.logger.debug(`[WS_GET_CONFIG] Emitting ${WS_EVENTS.GAME_SERVICE_ON_GAME_CONFIG} with payload: ${JSON.stringify(configPayload)}`);
        client.emit(WS_EVENTS.GAME_SERVICE_ON_GAME_CONFIG, configPayload);
      } else if (data?.action === 'getGameSeeds') {
        this.logger.log(`[WS_GET_SEEDS] Client ${client.id} requested game seeds`);
        await this.handleGetGameSeeds(client, userId);
      } else if (data?.action === 'bet') {
        // Extract bet data - support both payload object and top-level fields
        const payload = data.payload || data;
        const betPayload: PlaceBetPayload = {
          betAmount: payload.betAmount || data.betAmount || '',
          currency: payload.currency || data.currency || '',
          coeffAuto: payload.coeffAuto || data.coeffAuto,
          betNumber: payload.betNumber !== undefined ? payload.betNumber : (data.betNumber !== undefined ? data.betNumber : 0),
        };
        this.logger.log(`[WS_BET] Received bet action: ${JSON.stringify(betPayload)}`);
        await this.handleBetAction(client, betPayload, userId, agentId, operatorId, gameCode, authPayload);
      } else if (data?.action === 'cashout' || data?.action === 'withdraw') {
        // Extract playerGameId - support both payload object and top-level field
        const payload = data.payload || {};
        const playerGameId = payload.playerGameId || data.playerGameId;
        const cashoutPayload = { playerGameId };
        this.logger.log(`[WS_CASHOUT] Received cashout/withdraw action: playerGameId=${playerGameId}`);
        await this.handleCashoutAction(client, cashoutPayload, userId, agentId, operatorId, gameCode);
      } else if (data?.action === 'cancelBet') {
        // Extract cancel bet payload from data object
        const cancelPayload = data.payload || {};
        await this.handleCancelBetAction(client, cancelPayload, userId, agentId, operatorId, gameCode);
      }
    });

    // Direct bet/cashout/withdraw handlers (for compatibility)
    client.on(WS_EVENTS.BET, async (payload: PlaceBetPayload) => {
      await this.handleBetAction(client, payload, userId, agentId, operatorId, gameCode, authPayload);
    });

    client.on(WS_EVENTS.CASHOUT, async (payload: { playerGameId: string }) => {
      await this.handleCashoutAction(client, payload, userId, agentId, operatorId, gameCode);
    });

    client.on(WS_EVENTS.WITHDRAW, async (payload: { playerGameId: string }) => {
      await this.handleCashoutAction(client, payload, userId, agentId, operatorId, gameCode);
    });
  }

  private async handleBetAction(
    client: Socket,
    payload: PlaceBetPayload,
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    authPayload: UserTokenPayload,
  ): Promise<void> {
    if (!userId || !agentId || !operatorId) {
      client.emit('gameService-onBetGame', {
        success: false,
        error: 'Missing user information',
        code: 'MISSING_USER_INFO',
      });
      return;
    }

    const nickname = (authPayload as any).nickname || `user${userId}`;
    const gameAvatar = (authPayload as any).gameAvatar || null;
    const userAvatar = (authPayload as any).userAvatar || null;

    this.logger.log(
      `[WS_BET] user=${userId} agent=${agentId} amount=${payload.betAmount} currency=${payload.currency}`,
    );

    const result = await this.sugarDaddyGameBetService.placeBet(
      userId,
      agentId,
      operatorId,
      gameCode,
      payload,
      nickname,
      gameAvatar,
      userAvatar,
    );

    const {
      success,
      error,
      code,
      betAmount,
      currency,
      playerGameId,
      isNextRoundAddBet,
      betNumber,
    } = result;

    client.emit('gameService-onBetGame', {
      success,
      betAmount,
      currency,
      playerGameId,
      isNextRoundAddBet,
      betNumber,
      ...(success ? {} : { error, code }),
    });

    if (result.success && result.balance && result.balanceCurrency) {
      client.emit(WS_EVENTS.BALANCE_CHANGE, {
        currency: result.balanceCurrency,
        balance: result.balance,
      });
      this.logger.debug(`[BALANCE_CHANGE] Emitted after bet: balance=${result.balance} currency=${result.balanceCurrency}`);
    }

    if (result.success && result.bet) {
      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.broadcastGameStateChange(gameCode, gameState);
      }
    }
  }

  private async handleCashoutAction(
    client: Socket,
    payload: { playerGameId: string },
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
  ): Promise<void> {
    if (!userId || !agentId || !operatorId) {
      client.emit('gameService-onWithdrawGame', {
        success: false,
        error: 'Missing user information',
        code: 'MISSING_USER_INFO',
      });
      return;
    }

    if (!payload?.playerGameId) {
      client.emit('gameService-onWithdrawGame', {
        success: false,
        error: 'Missing playerGameId',
        code: 'MISSING_PLAYER_GAME_ID',
      });
      return;
    }

    this.logger.log(
      `[WS_CASHOUT] user=${userId} playerGameId=${payload.playerGameId}`,
    );

    const result = await this.sugarDaddyGameBetService.cashOut(
      userId,
      agentId,
      operatorId,
      gameCode,
      payload.playerGameId,
    );

    if (result.success && result.bet) {
      const winAmount = result.bet.winAmount || '0';
      const coeffWin = result.bet.coeffWin || '0';
      
      client.emit('gameService-onWithdrawGame', {
        success: true,
        result: winAmount,
        coeffWin: coeffWin,
        currency: result.bet.currency,
        userId: userId,
        playerGameId: result.bet.playerGameId,
      });
      
      this.logger.log(
        `[WS_CASHOUT_SUCCESS] user=${userId} playerGameId=${result.bet.playerGameId} winAmount=${winAmount} coeffWin=${coeffWin}`,
      );
      
      let balance: string | undefined = result.balance;
      let balanceCurrency: string | undefined = result.balanceCurrency;
      
      if (!balance || !balanceCurrency) {
        try {
          const walletBalance = await this.walletService.getBalance(agentId, userId);
          balance = walletBalance.balance ? String(walletBalance.balance) : undefined;
          balanceCurrency = result.bet.currency;
          this.logger.debug(`[BALANCE_CHANGE] Fetched balance via getBalance: balance=${balance} currency=${balanceCurrency}`);
        } catch (error: any) {
          this.logger.warn(
            `[BALANCE_CHANGE] Failed to fetch balance after cashout: user=${userId} error=${error.message}`,
          );
        }
      }
      
      if (balance && balanceCurrency) {
        client.emit(WS_EVENTS.BALANCE_CHANGE, {
          currency: balanceCurrency,
          balance: balance,
        });
        this.logger.debug(`[BALANCE_CHANGE] Emitted after cashout: balance=${balance} currency=${balanceCurrency}`);
      } else {
        this.logger.warn(
          `[BALANCE_CHANGE] Could not emit balance change after cashout: user=${userId} balance=${balance} currency=${balanceCurrency}`,
        );
      }
      
      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.broadcastGameStateChange(gameCode, gameState);
      }
    } else {
      client.emit('gameService-onWithdrawGame', {
        success: false,
        error: result.error || 'Failed to cash out',
        code: result.code || 'BET_REJECTED',
      });
    }
  }

  private async handleGetBetsHistory(
    client: Socket,
    userId: string,
    gameCode: string,
    ack?: (response: any) => void,
  ): Promise<void> {
    if (!userId) {
      const errorResponse = {
        success: false,
        error: 'Missing user information',
        code: 'MISSING_USER_INFO',
        bets: [],
      };
      if (typeof ack === 'function') {
        ack(errorResponse);
      }
      return;
    }

    try {
      const betHistory = await this.sugarDaddyGameBetService.getUserBetsHistory(userId, gameCode);
      
      // Response format: [[bet1, bet2, ...]] - array containing array of bets
      this.logger.log(
        `[WS_GET_BETS_HISTORY] user=${userId} found ${betHistory[0]?.length || 0} bets`,
      );

      if (typeof ack === 'function') {
        ack(betHistory);
      }
    } catch (error: any) {
      this.logger.error(`[WS_GET_BETS_HISTORY] Error: ${error.message}`);
      const errorResponse = {
        success: false,
        error: error.message || 'Failed to get bet history',
        code: 'BET_HISTORY_ERROR',
        bets: [],
      };
      if (typeof ack === 'function') {
        ack(errorResponse);
      }
    }
  }

  private async handleGetGameSeeds(
    client: Socket,
    userId: string,
  ): Promise<void> {
    if (!userId) {
      this.logger.warn(`[WS_GET_SEEDS] Missing userId for client ${client.id}`);
      client.emit(WS_EVENTS.GAME_SERVICE_ON_GAME_SEEDS, {
        userSeed: '',
        hashedServerSeed: '',
      });
      return;
    }

    try {
      const seeds = await this.sugarDaddyGameService.getGameSeeds(userId);
      
      if (!seeds) {
        this.logger.warn(`[WS_GET_SEEDS] No active round found for userId=${userId}`);
        client.emit(WS_EVENTS.GAME_SERVICE_ON_GAME_SEEDS, {
          userSeed: '',
          hashedServerSeed: '',
        });
        return;
      }

      this.logger.log(
        `[WS_GET_SEEDS] Sending seeds for userId=${userId} userSeed=${seeds.userSeed.substring(0, 8)}...`,
      );

      client.emit(WS_EVENTS.GAME_SERVICE_ON_GAME_SEEDS, {
        userSeed: seeds.userSeed,
        hashedServerSeed: seeds.hashedServerSeed,
      });
    } catch (error: any) {
      this.logger.error(`[WS_GET_SEEDS] Error: ${error.message}`);
      client.emit(WS_EVENTS.GAME_SERVICE_ON_GAME_SEEDS, {
        userSeed: '',
        hashedServerSeed: '',
      });
    }
  }

  private async handleCancelBetAction(
    client: Socket,
    payload: { playerGameId: string },
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
  ): Promise<void> {
    if (!userId || !agentId || !operatorId) {
      client.emit('gameService-onCancelBet', {
        success: false,
        error: 'Missing user information',
        code: 'MISSING_USER_INFO',
      });
      return;
    }

    if (!gameCode) {
      client.emit('gameService-onCancelBet', {
        success: false,
        error: 'Missing game code',
        code: 'MISSING_GAME_CODE',
      });
      return;
    }

    if (!payload?.playerGameId) {
      client.emit('gameService-onCancelBet', {
        success: false,
        error: 'Missing playerGameId',
        code: 'MISSING_PLAYER_GAME_ID',
      });
      return;
    }

    this.logger.log(
      `[WS_CANCEL_BET] user=${userId} playerGameId=${payload.playerGameId} gameCode=${gameCode}`,
    );

    const result = await this.sugarDaddyGameBetService.cancelBet(
      userId,
      agentId,
      operatorId,
      gameCode,
      payload.playerGameId,
    );

    client.emit('gameService-onCancelBet', result);

    if (result.success && result.balance && result.balanceCurrency) {
      client.emit(WS_EVENTS.BALANCE_CHANGE, {
        currency: result.balanceCurrency,
        balance: result.balance,
      });
      this.logger.debug(`[BALANCE_CHANGE] Emitted after cancel bet: balance=${result.balance} currency=${result.balanceCurrency}`);
    }

    if (result.success) {
      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.broadcastGameStateChange(gameCode, gameState);
      }
    }
  }

  broadcastCoefficientUpdate(gameCode: string | null, payload: CoefficientChangePayload): void {
    if (!this.server || !this.server.sockets) {
      this.logger.warn(`[BROADCAST] Server not ready, skipping coefficient broadcast`);
      return;
    }

    const eventName = WS_EVENTS.GAME_SERVICE_ON_CHANGE_COEFF;
    const room = gameCode ? `game:${gameCode}` : null;
    this.logger.debug(`[BROADCAST] Sending ${eventName} to room=${room || 'all'} coeff=${payload.coeff} gameCode=${gameCode || 'N/A'}`);

    if (room) {
      this.server.to(room).emit(eventName, payload);
    } else {
      this.server.emit(eventName, payload);
    }
  }

  broadcastGameStateChange(gameCode: string | null, payload: GameStateChangePayload): void {
    if (!this.server || !this.server.sockets) {
      this.logger.warn(`[BROADCAST] Server not ready, skipping game state broadcast`);
      return;
    }

    const eventName = WS_EVENTS.GAME_SERVICE_ON_CHANGE_STATE;
    const room = gameCode ? `game:${gameCode}` : null;
    this.logger.debug(`[BROADCAST] Sending ${eventName} to room=${room || 'all'} status=${payload.status} roundId=${payload.roundId} gameCode=${gameCode || 'N/A'}`);

    if (room) {
      this.server.to(room).emit(eventName, payload);
    } else {
      this.server.emit(eventName, payload);
    }
  }

  // Helper methods
  private async sendOnConnectGame(client: Socket, userId: string): Promise<void> {
    if (!userId) {
      this.logger.warn('[SEND_ON_CONNECT_GAME] No userId provided');
      return;
    }

    const allUserBets = await this.sugarDaddyGameService.getUserBets(userId);
    
    const myBets = allUserBets.filter(bet => {
      const isCashedOut = bet.coeffWin && bet.winAmount;
      return !isCashedOut;
    });

    const pendingBets = await this.sugarDaddyGameService.getAllPendingBetsForUser(userId);
    const myNextGameBets: BetData[] = [];

    for (const pendingBet of pendingBets) {
      myNextGameBets.push({
        userId: pendingBet.userId,
        operatorId: pendingBet.operatorId,
        multiplayerGameId: '',
        nickname: pendingBet.nickname,
        currency: pendingBet.currency,
        betAmount: pendingBet.betAmount,
        betNumber: pendingBet.betNumber,
        gameAvatar: pendingBet.gameAvatar,
        playerGameId: pendingBet.playerGameId || '',
        coeffAuto: pendingBet.coeffAuto,
        userAvatar: pendingBet.userAvatar,
      });
    }

    const isNextRoundBetExist = myNextGameBets.length > 0;

    const gameState = await this.sugarDaddyGameService.getCurrentGameState();
    const currentCoeff = await this.sugarDaddyGameService.getCurrentCoefficient();

    const state = {
      bets: gameState?.bets || {
        totalBetsAmount: 0,
        values: [],
      },
      roundId: gameState?.roundId || 0,
      status: gameState?.status || GameStatus.WAIT_GAME,
      waitTime: gameState?.waitTime ?? null,
      coeffCrash: gameState?.coeffCrash ?? (currentCoeff?.coeff || null),
    };

    const coefficients = await this.sugarDaddyGameService.getCoefficientsHistory(50);

    const payload: OnConnectGamePayload = {
      success: true,
      myBets: myBets,
      myNextGameBets: myNextGameBets,
      isNextRoundBetExist: isNextRoundBetExist,
      state: state,
      coefficients: coefficients,
    };

    this.logger.debug(
      `[SEND_ON_CONNECT_GAME] userId=${userId} myBets=${myBets.length} myNextGameBets=${myNextGameBets.length}`,
    );

    client.emit(WS_EVENTS.GAME_SERVICE_ON_CONNECT_GAME, payload);
  }

  private sendChatMessages(client: Socket, language: string): void {
    // Format chat room as "sugar-daddy-chat-{language}"
    const chatRoom = `sugar-daddy-chat-${language}`;
    
    // Mock chat messages for testing
    const messages: ChatMessage[] = [
      {
        chatRoom: chatRoom,
        message: "Welcome to Sugar Daddy! Good luck! 🍀",
        author: {
          id: "system::system",
          userId: "system",
          operatorId: "system",
          nickname: "System",
          gameAvatar: null,
        },
      },
      {
        chatRoom: chatRoom,
        message: "Let's play! 🎮",
        author: {
          id: "mock-operator-1::mock-user-1",
          userId: "mock-user-1",
          operatorId: "mock-operator-1",
          nickname: "Player1",
          gameAvatar: null,
        },
      },
      {
        chatRoom: chatRoom,
        message: "Good luck everyone! 🍀",
        author: {
          id: "mock-operator-2::mock-user-2",
          userId: "mock-user-2",
          operatorId: "mock-operator-2",
          nickname: "LuckyPlayer",
          gameAvatar: null,
        },
      },
    ];

    this.logger.debug(`[SEND_CHAT_MESSAGES] Sending ${messages.length} mock messages for room: ${chatRoom}`);
    client.emit(WS_EVENTS.CHAT_SERVICE_MESSAGES, messages);
  }

  startCoefficientBroadcast(gameCode: string | null = null): void {
    if (this.coefficientUpdateInterval) {
      this.stopCoefficientBroadcast();
    }

    this.logger.log(`[SUGAR_DADDY] Starting coefficient broadcast (gameCode: ${gameCode || 'all'})`);

    this.coefficientUpdateInterval = setInterval(async () => {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();

      if (activeRound && activeRound.status === GameStatus.IN_GAME && activeRound.isRunning) {
        const updated = await this.sugarDaddyGameService.updateCoefficient();

        const coeff = await this.sugarDaddyGameService.getCurrentCoefficient();
        if (coeff) {
          this.logger.debug(`[COEFF_BROADCAST] Broadcasting coefficient: ${coeff.coeff}`);
          this.broadcastCoefficientUpdate(gameCode, coeff);
        }

        const autoCashoutBets = await this.sugarDaddyGameService.getAutoCashoutBets();
        if (autoCashoutBets.length > 0) {
          this.logger.debug(
            `[COEFF_BROADCAST] Found ${autoCashoutBets.length} bets for auto-cashout`,
          );
          for (const { playerGameId, bet } of autoCashoutBets) {
            this.processAutoCashout(playerGameId, bet, gameCode).catch((error) => {
              this.logger.error(
                `[AUTO_CASHOUT_ERROR] Failed to process auto-cashout for playerGameId=${playerGameId}: ${error.message}`,
              );
            });
          }
        }

        if (!updated) {
          this.logger.log(`[COEFF_BROADCAST] Round ended, stopping coefficient broadcast`);
          this.stopCoefficientBroadcast();
          const gameState = await this.sugarDaddyGameService.getCurrentGameState();
          if (gameState) {
            this.broadcastGameStateChange(gameCode, gameState);
          }
          if (this.onRoundEndCallback) {
            this.onRoundEndCallback();
          }
        }
      } else {
        this.logger.debug(`[COEFF_BROADCAST] Not in IN_GAME state (status=${activeRound?.status}, isRunning=${activeRound?.isRunning}), stopping coefficient broadcast`);
        this.stopCoefficientBroadcast();
      }
    }, 200);
  }

  stopCoefficientBroadcast(): void {
    if (this.coefficientUpdateInterval) {
      clearInterval(this.coefficientUpdateInterval);
      this.coefficientUpdateInterval = null;
      this.logger.log('[SUGAR_DADDY] Stopped coefficient broadcast');
    }
  }

  startGameStateBroadcast(gameCode: string | null = null): void {
    if (this.gameStateBroadcastInterval) {
      this.stopGameStateBroadcast();
    }

    this.logger.log(`[SUGAR_DADDY] Starting game state broadcast (gameCode: ${gameCode || 'all'}) - polling every 3 seconds for all states`);

    this.sugarDaddyGameService.getCurrentGameState().then((initialGameState) => {
      if (initialGameState) {
        this.logger.log(`[SUGAR_DADDY] Broadcasting initial game state: status=${initialGameState.status} roundId=${initialGameState.roundId}`);
        this.broadcastGameStateChange(gameCode, initialGameState);
      }
    });

    this.gameStateBroadcastInterval = setInterval(async () => {
      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.logger.debug(`[SUGAR_DADDY] Periodic broadcast: status=${gameState.status} roundId=${gameState.roundId} waitTime=${gameState.waitTime}`);
        this.broadcastGameStateChange(gameCode, gameState);
      } else {
        this.logger.warn(`[SUGAR_DADDY] No game state available for broadcast`);
      }
    }, 3000);
  }

  stopGameStateBroadcast(): void {
    if (this.gameStateBroadcastInterval) {
      clearInterval(this.gameStateBroadcastInterval);
      this.gameStateBroadcastInterval = null;
      this.logger.log('[SUGAR_DADDY] Stopped game state broadcast');
    }
  }

  private async processAutoCashout(
    playerGameId: string,
    bet: BetData,
    gameCode: string | null,
  ): Promise<void> {
    try {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (!activeRound) {
        return;
      }

      if (bet.coeffWin && bet.winAmount) {
        return;
      }

      const autoCoeff = parseFloat(bet.coeffAuto || '0');
      const cashedOutBet = await this.sugarDaddyGameService.cashOutBet(playerGameId, autoCoeff);

      if (!cashedOutBet) {
        this.logger.error(
          `[AUTO_CASHOUT] Failed to cash out bet: playerGameId=${playerGameId}`,
        );
        return;
      }

      if (!gameCode) {
        this.logger.error(
          `[AUTO_CASHOUT] Missing gameCode for playerGameId=${playerGameId}`,
        );
        return;
      }

      const settleResult = await this.sugarDaddyGameBetService.cashOut(
        bet.userId,
        bet.operatorId,
        bet.operatorId,
        gameCode,
        playerGameId,
      );

      if (settleResult.success && settleResult.bet) {
        this.sendAutoCashoutEvent(bet.userId, settleResult.bet);

        const gameState = await this.sugarDaddyGameService.getCurrentGameState();
        if (gameState) {
          this.broadcastGameStateChange(gameCode, gameState);
        }

        this.logger.log(
          `[AUTO_CASHOUT] ✅ Successfully processed: userId=${bet.userId} playerGameId=${playerGameId} coeff=${autoCoeff} winAmount=${settleResult.bet.winAmount}`,
        );
      } else {
        this.logger.error(
          `[AUTO_CASHOUT] Settlement failed: userId=${bet.userId} playerGameId=${playerGameId} error=${settleResult.error}`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `[AUTO_CASHOUT] Error processing auto-cashout: playerGameId=${playerGameId} error=${error.message}`,
      );
    }
  }

  private sendAutoCashoutEvent(userId: string, bet: BetData): void {
    if (!this.server) {
      return;
    }

    this.server.sockets.sockets.forEach((socket) => {
      if (socket.data?.userId === userId) {
        socket.emit('gameService-onWithdrawGame', {
          success: true,
          result: bet.winAmount,
          coeffWin: bet.coeffWin,
          currency: bet.currency,
          userId: bet.userId,
          playerGameId: bet.playerGameId,
        });
      }
    });
  }

  private getCurrencies(): Record<string, number> {
    return {
      "ADA": 2.493846558309699,
      "AED": 3.6725,
      "AFN": 70,
      "ALL": 85.295,
      "AMD": 383.82,
      "ANG": 1.8022999999999998,
      "AOA": 918.65,
      "ARS": 1371.4821,
      "AUD": 1.5559,
      "AWG": 1.79,
      "AZN": 1.7,
      "BAM": 1.7004695059,
      "BBD": 2.0181999999999998,
      "BCH": 0.0020396093727826324,
      "BDT": 122.24999999999999,
      "BGN": 1.712,
      "BHD": 0.377,
      "BIF": 2981,
      "BMD": 1,
      "BNB": 0.0012299246747673688,
      "BND": 1.2974999999999999,
      "BOB": 6.907100000000001,
      "BRL": 5.6015,
      "BSD": 0.9997,
      "BTC": 0.000012050399374548936,
      "BTN": 89.6467799909,
      "BUSD": 0.9996936638705801,
      "BWP": 13.6553,
      "BYN": 3.2712,
      "BZD": 2.0078,
      "CAD": 1.3858,
      "CDF": 2277.4996633416,
      "CHF": 0.8140000000000001,
      "CLF": 0.0238335343,
      "CLP": 972.65,
      "COP": 4186.71,
      "CRC": 505.29,
      "CSC": 33830.23149660104,
      "CUP": 23.990199999999998,
      "CVE": 95.8727355712,
      "CZK": 21.5136,
      "DASH": 0.015423150141854353,
      "DJF": 178.08,
      "DKK": 6.5351,
      "DLS": 33.333333333333336,
      "DOGE": 7.249083135964963,
      "DOP": 61,
      "DZD": 130.923,
      "EGP": 48.57,
      "EOS": 1.2787330681036353,
      "ERN": 15,
      "ETB": 138.20000000000002,
      "ETC": 0.07559846492841533,
      "ETH": 0.00036986204295658424,
      "EUR": 0.8755000000000001,
      "FJD": 2.2723999999999998,
      "FKP": 0.7642057337999999,
      "GBP": 0.7571,
      "GC": 1,
      "GEL": 2.7035,
      "GHS": 10.5,
      "GIP": 0.7642057337999999,
      "GMD": 72.815,
      "GMS": 1,
      "GNF": 8674.5,
      "GTQ": 7.675,
      "GYD": 209.143149197,
      "HKD": 7.849799999999999,
      "HNL": 26.2787,
      "HRK": 6.550767445000001,
      "HTG": 131.16899999999998,
      "HUF": 350.19,
      "IDR": 16443.4,
      "ILS": 3.3960999999999997,
      "INR": 87.503,
      "IQD": 1310,
      "IRR": 42112.5,
      "ISK": 124.46999999999998,
      "JMD": 159.94400000000002,
      "JOD": 0.709,
      "JPY": 150.81,
      "KES": 129.2,
      "KGS": 87.45,
      "KHR": 4015,
      "KMF": 431.5,
      "KPW": 899.9849041373,
      "KRW": 1392.51,
      "KWD": 0.30610000000000004,
      "KYD": 0.8315739408,
      "KZT": 540.8199999999999,
      "LAK": 21580,
      "LBP": 89550,
      "LKR": 302.25,
      "LRD": 181.4831374426,
      "LSL": 18.2179,
      "LTC": 0.01219800670691517,
      "LYD": 5.415,
      "MAD": 9.154300000000001,
      "MDL": 17.08,
      "MGA": 4430,
      "MKD": 52.885000000000005,
      "MMK": 3247.961,
      "MNT": 3590,
      "MOP": 8.089,
      "MRU": 39.626114384800005,
      "MUR": 46.65,
      "MVR": 15.459999999999999,
      "MWK": 1733.67,
      "MXN": 18.869,
      "MYR": 4.265,
      "MZN": 63.910000000000004,
      "NAD": 18.2179,
      "NGN": 1532.39,
      "NIO": 36.75,
      "NOK": 10.3276,
      "NPR": 140.07,
      "NZD": 1.6986,
      "OMR": 0.385,
      "PAB": 1.0009,
      "PEN": 3.569,
      "PGK": 4.1303,
      "PHP": 58.27,
      "PKR": 283.25,
      "PLN": 3.7442,
      "PYG": 7486.400000000001,
      "QAR": 3.6408,
      "R$": 476.1904761904762,
      "RON": 4.440300000000001,
      "RSD": 102.56500000000001,
      "RUB": 79.87530000000001,
      "RWF": 1440,
      "SAR": 3.7513,
      "SBD": 8.2464031996,
      "SC": 1,
      "SCR": 14.1448,
      "SDG": 600.5,
      "SEK": 9.7896,
      "SGD": 1.2979,
      "SHIB": 128205.1282051282,
      "SHP": 0.7642057337999999,
      "SLE": 22.830015851400002,
      "SOL": 0.007978209381592608,
      "SOS": 571.5,
      "SRD": 38.553892635900006,
      "SSP": 130.26,
      "SVC": 8.7464,
      "SYP": 13005,
      "SZL": 18.01,
      "THB": 32.752,
      "TND": 2.88,
      "TON": 0.6662012207757025,
      "TRX": 3.6218917423077635,
      "TRY": 40.6684,
      "TWD": 29.918000000000003,
      "TZS": 2570,
      "UAH": 41.6966,
      "uBTC": 12.050399374548936,
      "UGX": 3583.3,
      "USD": 1,
      "USDC": 0.999303605303536,
      "USDT": 1,
      "UYU": 40.0886,
      "UZS": 12605,
      "VEF": 23922474.033511065,
      "VES": 123.7216,
      "VND": 26199,
      "XAF": 573.151,
      "XLM": 4.4032459143712215,
      "XMR": 0.008457936691358008,
      "XOF": 566.5,
      "XRP": 0.5234373962121788,
      "ZAR": 18.2178,
      "ZEC": 0.0016208628014450959,
      "ZMW": 23.1485244936,
      "ZWL": 26.852999999999998,
    };
  }
}
