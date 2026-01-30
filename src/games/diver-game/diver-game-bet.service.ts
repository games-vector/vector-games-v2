import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { WalletService, BetService as CoreBetService, BetStatus } from '@games-vector/game-core';
import { BetData, PendingBet } from '../shared/DTO/game-state.dto';
import { DiverGameService } from './diver-game.service';
import { RedisService } from '../../modules/redis/redis.service';
import { GameStatus } from '../shared/DTO/game-state.dto';
import { DIVER_ERROR_CODES, createErrorResponse, createSuccessResponse } from './errors/diver-game-errors';
import { DEFAULTS } from '../../config/defaults.config';

export interface PlaceBetPayload {
  betAmount: string;
  currency: string;
  coeffAuto?: string;
  betNumber?: number;
}

export interface PlaceBetResponse {
  success: boolean;
  error?: string;
  code?: string;
  betAmount?: string;
  currency?: string;
  playerGameId?: string;
  isNextRoundAddBet?: boolean;
  betNumber?: number;
  bet?: BetData;
  balance?: string;
  balanceCurrency?: string;
}

@Injectable()
export class DiverGameBetService {
  private readonly logger = new Logger(DiverGameBetService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly betService: CoreBetService,
    private readonly diverGameService: DiverGameService,
    private readonly redisService: RedisService,
  ) {}

  async placeBet(
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    payload: PlaceBetPayload,
    nickname: string,
    gameAvatar: number | null,
    userAvatar?: string | null,
  ): Promise<PlaceBetResponse> {
    try {
      const validationError = this.validateBetPayload(payload);
      if (validationError) {
        return validationError;
      }

      const activeRound = await this.diverGameService.getActiveRound();
      const normalizedUserAvatar = userAvatar ?? null;

      if (activeRound && activeRound.status === GameStatus.WAIT_GAME) {
        return await this.placeBetImmediately(
          userId,
          agentId,
          operatorId,
          gameCode,
          payload,
          nickname,
          gameAvatar,
          normalizedUserAvatar,
          activeRound,
        );
      }
      
      if (activeRound && (activeRound.status === GameStatus.IN_GAME || activeRound.status === GameStatus.FINISH_GAME)) {
        return await this.queueBetForNextRound(
          userId,
          agentId,
          operatorId,
          gameCode,
          payload,
          nickname,
          gameAvatar,
          normalizedUserAvatar,
        );
      }
      
      return await this.queueBetForNextRound(
        userId,
        agentId,
        operatorId,
        gameCode,
        payload,
        nickname,
        gameAvatar,
        normalizedUserAvatar,
      );
    } catch (error: any) {
      this.logger.error(`[BET_PLACE_ERROR] user=${userId} error=${error.message}`);
      return createErrorResponse(
        error.message || 'Failed to place bet',
        DIVER_ERROR_CODES.BET_REJECTED,
      );
    }
  }

  private validateBetPayload(payload: PlaceBetPayload): PlaceBetResponse | null {
    const betAmount = parseFloat(payload.betAmount);
    if (isNaN(betAmount) || betAmount <= 0) {
      return createErrorResponse(
        'Invalid bet amount',
        DIVER_ERROR_CODES.INVALID_BET_AMOUNT,
      );
    }

    const minBet = parseFloat(DEFAULTS.DIVER.BET_CONFIG.minBetAmount);
    const maxBet = parseFloat(DEFAULTS.DIVER.BET_CONFIG.maxBetAmount);
    if (betAmount < minBet || betAmount > maxBet) {
      return createErrorResponse(
        `Bet amount must be between ${minBet} and ${maxBet}`,
        DIVER_ERROR_CODES.INVALID_BET_AMOUNT,
      );
    }

    if (!payload.currency || payload.currency.length < 3 || payload.currency.length > 4) {
      return createErrorResponse(
        'Invalid currency code',
        DIVER_ERROR_CODES.INVALID_CURRENCY,
      );
    }

    const betNumber = payload.betNumber ?? 0;
    if (betNumber !== 0 && betNumber !== 1) {
      return createErrorResponse(
        'Bet number must be 0 or 1',
        DIVER_ERROR_CODES.INVALID_BET_NUMBER,
      );
    }

    if (payload.coeffAuto !== undefined && payload.coeffAuto !== null) {
      const coeffAuto = parseFloat(payload.coeffAuto);
      if (isNaN(coeffAuto) || coeffAuto < 1.00 || coeffAuto > 1000.00) {
        return createErrorResponse(
          'Auto cashout coefficient must be between 1.00 and 1000.00',
          DIVER_ERROR_CODES.INVALID_COEFF_AUTO,
        );
      }

      const decimalPlaces = (payload.coeffAuto.split('.')[1] || '').length;
      if (decimalPlaces > 2) {
        return createErrorResponse(
          'Auto cashout coefficient must have at most 2 decimal places',
          DIVER_ERROR_CODES.INVALID_COEFF_AUTO,
        );
      }
    }

    return null;
  }

  private async placeBetImmediately(
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    payload: PlaceBetPayload,
    nickname: string,
    gameAvatar: number | null,
    userAvatar: string | null,
    activeRound: any,
  ): Promise<PlaceBetResponse> {
    const betAmount = parseFloat(payload.betAmount);
    const betNumber = payload.betNumber ?? 0;

    const userBets = await this.diverGameService.getUserBets(userId);
    const existingBetWithSameNumber = userBets.find(bet => bet.betNumber === betNumber);
    
    if (existingBetWithSameNumber) {
      const mappingKey = `diver:bet:${existingBetWithSameNumber.playerGameId}`;
      const externalPlatformTxId = await this.redisService.get<string>(mappingKey);
      
      if (externalPlatformTxId) {
        const betRecord = await this.betService.getByExternalTxId(externalPlatformTxId, gameCode);
        if (betRecord && betRecord.status === BetStatus.REFUNDED) {
          this.logger.log(
            `[PLACE_BET] Found refunded bet with betNumber ${betNumber}, allowing new bet`,
          );
        } else {
          return createErrorResponse(
            `Bet already exists for betNumber ${betNumber}. Please cancel the existing bet first.`,
            DIVER_ERROR_CODES.DUPLICATE_BET_NUMBER,
          );
        }
      } else {
        this.logger.log(
          `[PLACE_BET] Found bet with betNumber ${betNumber} but no mapping, allowing new bet`,
        );
      }
    }

    const existingPendingBet = await this.diverGameService.getPendingBet(userId, betNumber);
    if (existingPendingBet) {
      return createErrorResponse(
        `Bet already exists for betNumber ${betNumber}. Please cancel the existing bet first.`,
        DIVER_ERROR_CODES.DUPLICATE_BET_NUMBER,
      );
    }

    const roundId = String(activeRound.roundId);
    const platformTxId = uuidv4();

    const idempotencyKey = this.redisService.generateIdempotencyKey(
      gameCode,
      userId,
      agentId,
      roundId,
      payload.betAmount,
      betNumber,
    );
    const idempotencyCheck = await this.redisService.checkIdempotencyKey<{
      platformTxId: string;
      response: PlaceBetResponse;
      timestamp: number;
    }>(idempotencyKey);

    if (idempotencyCheck.exists && idempotencyCheck.data) {
      const cachedPlayerGameId = idempotencyCheck.data.response.playerGameId;
      if (cachedPlayerGameId) {
        const cachedBet = await this.diverGameService.getBet(cachedPlayerGameId);
        if (cachedBet && cachedBet.userId === userId) {
          this.logger.log(
            `[IDEMPOTENCY] Duplicate bet request detected: user=${userId} agent=${agentId} roundId=${roundId} amount=${betAmount} betNumber=${betNumber}. Returning stored response.`,
          );
          return idempotencyCheck.data.response;
        } else {
          this.logger.log(
            `[IDEMPOTENCY] Cached bet with playerGameId=${cachedPlayerGameId} no longer exists (likely cancelled). Clearing idempotency key and creating new bet.`,
          );
          await this.redisService.del(idempotencyKey);
        }
      } else {
        this.logger.log(
          `[IDEMPOTENCY] Cached response has no playerGameId. Clearing idempotency key and creating new bet.`,
        );
        await this.redisService.del(idempotencyKey);
      }
    }

    this.logger.log(
      `[BET_PLACE] user=${userId} agent=${agentId} amount=${betAmount} currency=${payload.currency} roundId=${roundId} txId=${platformTxId} betNumber=${betNumber}`,
    );

    const walletResult = await this.walletService.placeBet({
      agentId,
      userId,
      amount: betAmount,
      roundId,
      platformTxId,
      currency: payload.currency,
      gameCode: gameCode,
    });

    if (walletResult.status !== '0000') {
      this.logger.error(
        `Agent rejected bet: user=${userId} agent=${agentId} status=${walletResult.status} amount=${betAmount}`,
      );
      return createErrorResponse(
        'Bet rejected by agent',
        DIVER_ERROR_CODES.BET_REJECTED,
      );
    }

    const walletAmount = betAmount;

    const playerGameId = uuidv4();
    
    try {
      await this.betService.createPlacement({
        externalPlatformTxId: platformTxId,
        userId,
        roundId,
        gameMetadata: {
          betNumber,
          coeffAuto: payload.coeffAuto,
          playerGameId,
        },
        betAmount: payload.betAmount,
        currency: payload.currency,
        gameCode: gameCode,
        isPremium: false,
        betPlacedAt: walletResult.balanceTs ? new Date(walletResult.balanceTs) : undefined,
        balanceAfterBet: walletResult.balance ? String(walletResult.balance) : undefined,
        createdBy: userId,
        operatorId,
      });
    } catch (dbError) {
      this.logger.error(
        `[COMPENSATING_TX] DB write failed after wallet deduction: user=${userId} txId=${platformTxId} error=${(dbError as Error).message}. Initiating refund.`,
        (dbError as Error).stack,
      );
      
      try {
        const refundResult = await this.walletService.refundBet({
          agentId,
          userId,
          refundTransactions: [{
            platformTxId: platformTxId,
            refundPlatformTxId: platformTxId,
            betAmount: walletAmount,
            winAmount: 0,
            turnover: 0,
            betTime: walletResult.balanceTs ? new Date(walletResult.balanceTs).toISOString() : new Date().toISOString(),
            updateTime: new Date().toISOString(),
            roundId: roundId,
            gameCode: gameCode,
          }],
        });
        
        if (refundResult.status !== '0000') {
          this.logger.error(
            `[COMPENSATING_TX] CRITICAL: Refund failed after DB write failure: user=${userId} txId=${platformTxId} refundStatus=${refundResult.status}. Manual intervention required!`,
          );
        } else {
          this.logger.log(
            `[COMPENSATING_TX] Successfully refunded user after DB write failure: user=${userId} txId=${platformTxId} amount=${walletAmount}`,
          );
        }
      } catch (refundError) {
        this.logger.error(
          `[COMPENSATING_TX] CRITICAL: Refund attempt failed: user=${userId} txId=${platformTxId} error=${(refundError as Error).message}. Manual intervention required!`,
          (refundError as Error).stack,
        );
      }
      
      return createErrorResponse(
        'Bet placement failed. Your balance has been refunded. Please try again.',
        DIVER_ERROR_CODES.BET_REJECTED,
      );
    }

    const mappingKey = `diver:bet:${playerGameId}`;
    await this.redisService.set(mappingKey, platformTxId, 60 * 60 * 24);

    const betData: BetData = {
      userId,
      operatorId,
      multiplayerGameId: activeRound.gameUUID,
      nickname,
      currency: payload.currency,
      betAmount: payload.betAmount,
      betNumber,
      gameAvatar,
      playerGameId,
      coeffAuto: payload.coeffAuto,
      userAvatar,
    };

    await this.diverGameService.addBet(betData);

    this.logger.log(
      `[BET_PLACED] user=${userId} playerGameId=${playerGameId} amount=${betAmount} currency=${payload.currency} betNumber=${betNumber}`,
    );

    const successResponse = createSuccessResponse({
      betAmount: payload.betAmount,
      currency: payload.currency,
      playerGameId,
      isNextRoundAddBet: false,
      betNumber,
      bet: betData,
      balance: walletResult.balance ? String(walletResult.balance) : undefined,
      balanceCurrency: payload.currency,
    });

    await this.redisService.setIdempotencyKey(idempotencyKey, {
      platformTxId: platformTxId,
      response: successResponse,
      timestamp: Date.now(),
    });

    return successResponse;
  }

  private async queueBetForNextRound(
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    payload: PlaceBetPayload,
    nickname: string,
    gameAvatar: number | null,
    userAvatar: string | null,
  ): Promise<PlaceBetResponse> {
    const betAmount = parseFloat(payload.betAmount);
    const betNumber = payload.betNumber ?? 0;
    const activeRound = await this.diverGameService.getActiveRound();
    const roundId = activeRound ? String(activeRound.roundId) : 'pending';
    const platformTxId = uuidv4();

    const idempotencyKey = this.redisService.generateIdempotencyKey(
      gameCode,
      userId,
      agentId,
      roundId,
      payload.betAmount,
      betNumber,
    );
    const idempotencyCheck = await this.redisService.checkIdempotencyKey<{
      platformTxId: string;
      response: PlaceBetResponse;
      timestamp: number;
    }>(idempotencyKey);

    if (idempotencyCheck.exists && idempotencyCheck.data) {
      const cachedPlayerGameId = idempotencyCheck.data.response.playerGameId;
      if (cachedPlayerGameId) {
        const allPendingBets = await this.diverGameService.getAllPendingBetsForUser(userId);
        const cachedPendingBet = allPendingBets.find(bet => bet.playerGameId === cachedPlayerGameId);
        if (cachedPendingBet && cachedPendingBet.userId === userId) {
          this.logger.log(
            `[IDEMPOTENCY] Duplicate queued bet request detected: user=${userId} agent=${agentId} roundId=${roundId} amount=${betAmount} betNumber=${betNumber}. Returning stored response.`,
          );
          return idempotencyCheck.data.response;
        } else {
          this.logger.log(
            `[IDEMPOTENCY] Cached pending bet with playerGameId=${cachedPlayerGameId} no longer exists (likely cancelled). Clearing idempotency key and creating new bet.`,
          );
          await this.redisService.del(idempotencyKey);
        }
      } else {
        this.logger.log(
          `[IDEMPOTENCY] Cached response has no playerGameId. Clearing idempotency key and creating new bet.`,
        );
        await this.redisService.del(idempotencyKey);
      }
    }

    this.logger.log(
      `[QUEUE_BET] Deducting balance for queued bet: user=${userId} amount=${betAmount} currency=${payload.currency}`,
    );

    const walletResult = await this.walletService.placeBet({
      agentId,
      userId,
      amount: betAmount,
      roundId,
      platformTxId,
      currency: payload.currency,
      gameCode: gameCode,
    });

    if (walletResult.status !== '0000') {
      this.logger.error(
        `Agent rejected queued bet: user=${userId} agent=${agentId} status=${walletResult.status} amount=${betAmount}`,
      );
      return createErrorResponse(
        'Bet rejected by agent',
        DIVER_ERROR_CODES.BET_REJECTED,
      );
    }

    const walletAmount = betAmount;

    const existingPendingBet = await this.diverGameService.getPendingBet(userId, betNumber);
    if (existingPendingBet) {
      this.logger.log(
        `[QUEUE_BET] Replacing existing pending bet for userId=${userId} betNumber=${betNumber}`,
      );
    }

    const tempPlayerGameId = uuidv4();

    const pendingBet: PendingBet = {
      userId,
      agentId,
      operatorId,
      betAmount: payload.betAmount,
      currency: payload.currency,
      coeffAuto: payload.coeffAuto,
      betNumber,
      nickname,
      gameAvatar,
      userAvatar,
      queuedAt: Date.now(),
      platformTxId,
      gameCode,
      playerGameId: tempPlayerGameId,
    };

    try {
      const pendingBetMappingKey = `diver:pending_bet:${tempPlayerGameId}`;
      await this.redisService.set(pendingBetMappingKey, userId, 300);

      await this.diverGameService.queueBetForNextRound(pendingBet);
    } catch (storageError) {
      this.logger.error(
        `[COMPENSATING_TX] Pending bet storage failed after wallet deduction: user=${userId} txId=${platformTxId} error=${(storageError as Error).message}. Initiating refund.`,
        (storageError as Error).stack,
      );
      
      try {
        const refundResult = await this.walletService.refundBet({
          agentId,
          userId,
          refundTransactions: [{
            platformTxId: platformTxId,
            refundPlatformTxId: platformTxId,
            betAmount: walletAmount,
            winAmount: 0,
            turnover: 0,
            betTime: walletResult.balanceTs ? new Date(walletResult.balanceTs).toISOString() : new Date().toISOString(),
            updateTime: new Date().toISOString(),
            roundId: roundId,
            gameCode: gameCode,
          }],
        });
        
        if (refundResult.status !== '0000') {
          this.logger.error(
            `[COMPENSATING_TX] CRITICAL: Refund failed after pending bet storage failure: user=${userId} txId=${platformTxId} refundStatus=${refundResult.status}. Manual intervention required!`,
          );
        } else {
          this.logger.log(
            `[COMPENSATING_TX] Successfully refunded user after pending bet storage failure: user=${userId} txId=${platformTxId} amount=${walletAmount}`,
          );
        }
      } catch (refundError) {
        this.logger.error(
          `[COMPENSATING_TX] CRITICAL: Refund attempt failed: user=${userId} txId=${platformTxId} error=${(refundError as Error).message}. Manual intervention required!`,
          (refundError as Error).stack,
        );
      }
      
      return createErrorResponse(
        'Bet queuing failed. Your balance has been refunded. Please try again.',
        DIVER_ERROR_CODES.BET_REJECTED,
      );
    }

    this.logger.log(
      `[BET_QUEUED] user=${userId} amount=${betAmount} currency=${payload.currency} platformTxId=${platformTxId} tempPlayerGameId=${tempPlayerGameId} - will be placed in next round`,
    );

    const successResponse = createSuccessResponse({
      betAmount: payload.betAmount,
      currency: payload.currency,
      playerGameId: tempPlayerGameId,
      isNextRoundAddBet: true,
      betNumber,
      bet: {
        userId,
        operatorId,
        multiplayerGameId: '',
        nickname,
        currency: payload.currency,
        betAmount: payload.betAmount,
        betNumber,
        gameAvatar,
        playerGameId: tempPlayerGameId,
        coeffAuto: payload.coeffAuto,
        userAvatar,
      },
      balance: walletResult.balance ? String(walletResult.balance) : undefined,
      balanceCurrency: payload.currency,
    });

    await this.redisService.setIdempotencyKey(idempotencyKey, {
      platformTxId: platformTxId,
      response: successResponse,
      timestamp: Date.now(),
    });

    return successResponse;
  }

  async processPendingBets(roundId: number, gameUUID: string): Promise<{
    processed: number;
    failed: number;
    errors: Array<{ userId: string; error: string }>;
  }> {
    const result = {
      processed: 0,
      failed: 0,
      errors: [] as Array<{ userId: string; error: string }>,
    };

    try {
      const betIdentifiers = await this.diverGameService.getAllPendingBetIdentifiers();
      
      this.logger.log(
        `[PROCESS_PENDING_BETS] Found ${betIdentifiers.length} pending bets to process for roundId=${roundId}`,
      );

      for (const betIdentifier of betIdentifiers) {
        const [userId, betNumberStr] = betIdentifier.split(':');
        const betNumber = parseInt(betNumberStr, 10);
        
        if (isNaN(betNumber)) {
          this.logger.warn(
            `[PROCESS_PENDING_BET] Invalid betIdentifier format: ${betIdentifier}, skipping`,
          );
          continue;
        }

        try {
          const pendingBet = await this.diverGameService.getPendingBet(userId, betNumber);
          
          if (!pendingBet) {
            await this.diverGameService.removePendingBet(userId, betNumber);
            continue;
          }

          const betAmount = parseFloat(pendingBet.betAmount);
          if (isNaN(betAmount) || betAmount <= 0) {
            this.logger.warn(
              `[PROCESS_PENDING_BET] Invalid bet amount for userId=${userId} betNumber=${betNumber}, removing pending bet`,
            );
            await this.diverGameService.removePendingBet(userId, betNumber);
            result.failed++;
            result.errors.push({ userId, error: 'Invalid bet amount' });
            continue;
          }

          const userBets = await this.diverGameService.getUserBets(userId);
          const existingBetWithSameNumber = userBets.find(bet => bet.betNumber === pendingBet.betNumber);
          if (existingBetWithSameNumber) {
            this.logger.warn(
              `[PROCESS_PENDING_BET] Duplicate betNumber ${pendingBet.betNumber} for userId=${userId}, removing pending bet`,
            );
            await this.diverGameService.removePendingBet(userId, betNumber);
            result.failed++;
            result.errors.push({ userId, error: `Duplicate betNumber ${pendingBet.betNumber}` });
            continue;
          }

          if (!pendingBet.platformTxId) {
            this.logger.error(
              `[PROCESS_PENDING_BET] Missing platformTxId for userId=${userId} betNumber=${betNumber}, removing pending bet`,
            );
            await this.diverGameService.removePendingBet(userId, betNumber);
            result.failed++;
            result.errors.push({ userId, error: 'Missing platformTxId' });
            continue;
          }

          const platformTxId = pendingBet.platformTxId;
          const playerGameId = pendingBet.playerGameId || uuidv4();

          this.logger.log(
            `[PROCESS_PENDING_BET] Processing: userId=${userId} betNumber=${betNumber} amount=${betAmount} currency=${pendingBet.currency} platformTxId=${platformTxId} playerGameId=${playerGameId}`,
          );

          await this.betService.createPlacement({
            externalPlatformTxId: platformTxId,
            userId: pendingBet.userId,
            roundId: String(roundId),
            gameMetadata: {
              betNumber: pendingBet.betNumber,
              coeffAuto: pendingBet.coeffAuto,
              playerGameId,
            },
            betAmount: pendingBet.betAmount,
            currency: pendingBet.currency,
            gameCode: pendingBet.gameCode,
            isPremium: false,
            betPlacedAt: new Date(pendingBet.queuedAt),
            balanceAfterBet: undefined,
            createdBy: pendingBet.userId,
            operatorId: pendingBet.operatorId,
          });

          const mappingKey = `diver:bet:${playerGameId}`;
          await this.redisService.set(mappingKey, platformTxId, 60 * 60 * 24);

          await this.diverGameService.addPendingBetToRound(pendingBet, gameUUID, playerGameId);

          await this.diverGameService.removePendingBet(userId, betNumber);

          result.processed++;
          this.logger.log(
            `[PROCESS_PENDING_BET] ✅ Successfully processed: userId=${userId} betNumber=${betNumber} playerGameId=${playerGameId} platformTxId=${platformTxId}`,
          );
        } catch (error: any) {
          this.logger.error(
            `[PROCESS_PENDING_BET] Error processing bet for userId=${userId} betNumber=${betNumber}: ${error.message}`,
          );
          await this.diverGameService.removePendingBet(userId, betNumber);
          result.failed++;
          result.errors.push({ userId, error: error.message || 'Failed to process bet' });
        }
      }

      this.logger.log(
        `[PROCESS_PENDING_BETS] Completed: processed=${result.processed} failed=${result.failed}`,
      );

      return result;
    } catch (error: any) {
      this.logger.error(`[PROCESS_PENDING_BETS] Fatal error: ${error.message}`);
      throw error;
    }
  }

  async cashOut(
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    playerGameId: string,
  ): Promise<{ success: boolean; error?: string; code?: string; bet?: BetData; balance?: string; balanceCurrency?: string }> {
    try {
      const activeRound = await this.diverGameService.getActiveRound();
      if (!activeRound || activeRound.status !== GameStatus.IN_GAME) {
        return createErrorResponse(
          'Cannot cash out: game not in IN_GAME state',
          DIVER_ERROR_CODES.INVALID_GAME_STATE,
        );
      }

      let bet = await this.diverGameService.getBet(playerGameId);
      
      if (!bet) {
        this.logger.debug(
          `[CASHOUT] Bet not found in active round, checking if it's pending: playerGameId=${playerGameId}`,
        );
        
        const pendingBetMappingKey = `diver:pending_bet:${playerGameId}`;
        const pendingBetUserId = await this.redisService.get<string>(pendingBetMappingKey);
        
        if (pendingBetUserId && pendingBetUserId === userId) {
          const allPendingBets = await this.diverGameService.getAllPendingBetsForUser(userId);
          const pendingBet = allPendingBets.find(bet => bet.playerGameId === playerGameId) || null;
          
          if (pendingBet) {
            this.logger.warn(
              `[CASHOUT] Bet is still pending (queued for next round): playerGameId=${playerGameId} userId=${userId}`,
            );
            return createErrorResponse(
              'Bet is still pending and will be placed in the next round. You can cancel it instead of cashing out.',
              DIVER_ERROR_CODES.BET_NOT_FOUND,
            );
          }
        }
        
        const mappingKey = `diver:bet:${playerGameId}`;
        const platformTxId = await this.redisService.get<string>(mappingKey);
        
        if (platformTxId) {
          this.logger.debug(
            `[CASHOUT] Found platformTxId mapping: playerGameId=${playerGameId} platformTxId=${platformTxId}`,
          );
          
          const betRecord = await this.betService.getByExternalTxId(platformTxId, gameCode);
          
          if (betRecord && betRecord.userId === userId) {
            const allBets = Array.from(activeRound.bets.values());
            bet = allBets.find(b => {
              const betAmountMatch = Math.abs(parseFloat(b.betAmount) - parseFloat(betRecord.betAmount)) < 0.01;
              const currencyMatch = b.currency === betRecord.currency;
              const userIdMatch = b.userId === userId;
              const roundIdMatch = String(activeRound.roundId) === betRecord.roundId;
              
              return userIdMatch && betAmountMatch && currencyMatch && roundIdMatch;
            }) || null;
            
            if (bet) {
              this.logger.log(
                `[CASHOUT] Found bet by matching properties: playerGameId=${bet.playerGameId} originalPlayerGameId=${playerGameId} platformTxId=${platformTxId}`,
              );
            } else {
              this.logger.warn(
                `[CASHOUT] Bet found in database but not in active round: playerGameId=${playerGameId} platformTxId=${platformTxId} roundId=${betRecord.roundId} activeRoundId=${activeRound.roundId}`,
              );
            }
          }
        } else {
          const allBets = Array.from(activeRound.bets.values());
          const userBets = allBets.filter(b => b.userId === userId);
          
          if (userBets.length > 0) {
            this.logger.debug(
              `[CASHOUT] Found ${userBets.length} bet(s) for userId=${userId}, but playerGameId=${playerGameId} doesn't match any of them`,
            );
            this.logger.debug(
              `[CASHOUT] User's bet playerGameIds: ${userBets.map(b => b.playerGameId).join(', ')}`,
            );
          }
        }
      }
      
      if (!bet) {
        this.logger.warn(
          `[CASHOUT] Bet not found: playerGameId=${playerGameId} userId=${userId} activeRound=${activeRound ? `exists (status=${activeRound.status}, roundId=${activeRound.roundId}, betsCount=${activeRound.bets.size})` : 'null'}`,
        );
        return createErrorResponse(
          'Bet not found',
          DIVER_ERROR_CODES.BET_NOT_FOUND,
        );
      }
      
      this.logger.log(
        `[CASHOUT] Bet found: playerGameId=${playerGameId} userId=${bet.userId} betAmount=${bet.betAmount} currency=${bet.currency}`,
      );

      if (bet.userId !== userId) {
        return createErrorResponse(
          'Bet does not belong to user',
          DIVER_ERROR_CODES.BET_NOT_FOUND,
        );
      }

      if (bet.coeffWin && bet.winAmount) {
        return createErrorResponse(
          'Bet already cashed out',
          DIVER_ERROR_CODES.BET_ALREADY_CASHED_OUT,
        );
      }

      const currentCoeff = activeRound.currentCoeff;
      const cashedOutBet = await this.diverGameService.cashOutBet(playerGameId, currentCoeff);

      if (!cashedOutBet) {
        return createErrorResponse(
          'Failed to cash out bet',
          DIVER_ERROR_CODES.BET_REJECTED,
        );
      }

      const winAmount = parseFloat(cashedOutBet.winAmount || '0');
      const roundId = String(activeRound.roundId);

      this.logger.log(
        `[CASHOUT] user=${userId} playerGameId=${playerGameId} coeff=${cashedOutBet.coeffWin} winAmount=${winAmount}`,
      );

      const mappingKey = `diver:bet:${playerGameId}`;
      const externalPlatformTxId = await this.redisService.get<string>(mappingKey);

      if (!externalPlatformTxId) {
        this.logger.error(
          `[CASHOUT] Could not find externalPlatformTxId for playerGameId=${playerGameId}`,
        );
        return createErrorResponse(
          'Bet record not found',
          DIVER_ERROR_CODES.BET_NOT_FOUND,
        );
      }

      const betRecord = await this.betService.getByExternalTxId(externalPlatformTxId, gameCode);

      if (!betRecord) {
        this.logger.error(
          `[CASHOUT] Bet record not found in database: externalPlatformTxId=${externalPlatformTxId}`,
        );
        return createErrorResponse(
          'Bet record not found',
          DIVER_ERROR_CODES.BET_NOT_FOUND,
        );
      }

      await this.betService.recordSettlement({
        externalPlatformTxId,
        winAmount: cashedOutBet.winAmount || '0',
        settleType: 'cashout',
        settledAt: new Date(),
        updatedBy: userId,
        withdrawCoeff: cashedOutBet.coeffWin,
        finalCoeff: cashedOutBet.coeffWin,
      });

      const betAmount = parseFloat(cashedOutBet.betAmount);
      const settleResult = await this.walletService.settleBet({
        agentId,
        userId,
        platformTxId: externalPlatformTxId,
        winAmount,
        roundId,
        betAmount,
        gameCode: gameCode,
      });

      if (settleResult.status !== '0000') {
        this.logger.error(
          `[CASHOUT] Wallet settlement failed: user=${userId} status=${settleResult.status}`,
        );
        return createErrorResponse(
          'Wallet settlement failed',
          DIVER_ERROR_CODES.BET_REJECTED,
        );
      }

      await this.redisService.del(mappingKey);

      return createSuccessResponse({ 
        bet: cashedOutBet,
        balance: settleResult.balance ? String(settleResult.balance) : undefined,
        balanceCurrency: cashedOutBet.currency,
      });
    } catch (error: any) {
      this.logger.error(`[CASHOUT_ERROR] user=${userId} error=${error.message}`);
      return createErrorResponse(
        error.message || 'Failed to cash out',
        DIVER_ERROR_CODES.BET_REJECTED,
      );
    }
  }

  async getUserBetsHistory(userId: string, gameCode: string, limit: number = 100): Promise<any[]> {
    try {
      const bets = await this.betService.listUserBets(userId, gameCode, limit);
      
      const coefficientsHistory = await this.diverGameService.getCoefficientsHistory(1000);
      const coeffHistoryMap = new Map<number, any>();
      coefficientsHistory.forEach((coeff) => {
        coeffHistoryMap.set(coeff.gameId, coeff);
      });
      
      const betHistory = bets.map((bet) => {
        const gameMetadata = bet.gameMetadata || {};
        const fairnessData = bet.fairnessData || {};
        
        const gameId = parseInt(bet.roundId) || 0;
        
        const coeffHistory = coeffHistoryMap.get(gameId);
        
        const serverSeed = coeffHistory?.serverSeed || fairnessData.serverSeed || '';
        
        let hashedServerSeed = fairnessData.hashedServerSeed || '';
        if (!hashedServerSeed && serverSeed) {
          const crypto = require('crypto');
          hashedServerSeed = crypto
            .createHash('sha256')
            .update(serverSeed)
            .digest('hex');
        }
        
        let fairness: any = {
          serverSeed: serverSeed,
          hashedServerSeed: hashedServerSeed,
          clientsSeeds: coeffHistory?.clientsSeeds || [],
          combinedHash: coeffHistory?.combinedHash || fairnessData.combinedHash || '',
          decimal: coeffHistory?.decimal || fairnessData.decimal || '',
          maxCoefficient: 1000000,
        };
        
        if (fairness.clientsSeeds.length === 0 && bet.gameInfo) {
          try {
            const gameInfo = typeof bet.gameInfo === 'string' ? JSON.parse(bet.gameInfo) : bet.gameInfo;
            if (gameInfo.clientsSeeds && Array.isArray(gameInfo.clientsSeeds)) {
              fairness.clientsSeeds = gameInfo.clientsSeeds;
            }
          } catch (e) {
          }
        }
        
        if (
          !fairness.serverSeed &&
          !fairness.hashedServerSeed &&
          (!fairness.clientsSeeds || fairness.clientsSeeds.length === 0) &&
          !fairness.combinedHash &&
          !fairness.decimal
        ) {
          fairness = {};
        }
        
        return {
          id: bet.id,
          createdAt: bet.createdAt.toISOString(),
          gameId: gameId,
          finishCoeff: bet.finalCoeff ? parseFloat(bet.finalCoeff) : (bet.withdrawCoeff ? parseFloat(bet.withdrawCoeff) : 0),
          fairness: fairness,
          betAmount: parseFloat(bet.betAmount),
          win: bet.winAmount ? parseFloat(bet.winAmount) : 0,
          withdrawCoeff: bet.withdrawCoeff ? parseFloat(bet.withdrawCoeff) : null,
          operatorId: bet.operatorId,
          userId: bet.userId,
          currency: bet.currency,
          gameMeta: {
            betNumber: gameMetadata.betNumber || 0,
          },
        };
      });

      this.logger.log(
        `[GET_BETS_HISTORY] user=${userId} gameCode=${gameCode} found ${betHistory.length} bets`,
      );

      return betHistory;
    } catch (error: any) {
      this.logger.error(`[GET_BETS_HISTORY] Error: ${error.message}`);
      throw error;
    }
  }

  async cancelBet(
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    playerGameId: string,
  ): Promise<{ 
    success: boolean; 
    error?: string; 
    code?: string;
    userId?: string;
    operatorId?: string;
    playerGameId?: string;
    balance?: string;
    balanceCurrency?: string;
  }> {
    try {
      const activeRound = await this.diverGameService.getActiveRound();
      
      let bet: BetData | null = null;
      if (activeRound) {
        bet = await this.diverGameService.getBet(playerGameId);
      }

      let pendingBet: PendingBet | null = null;
      if (!bet) {
        const pendingBetMappingKey = `diver:pending_bet:${playerGameId}`;
        const pendingBetUserId = await this.redisService.get<string>(pendingBetMappingKey);
        
        if (pendingBetUserId && pendingBetUserId === userId) {
          const allPendingBets = await this.diverGameService.getAllPendingBetsForUser(userId);
          pendingBet = allPendingBets.find(bet => bet.playerGameId === playerGameId) || null;
        }
      }

      if (!bet && !pendingBet) {
        const mappingKey = `diver:bet:${playerGameId}`;
        const externalPlatformTxId = await this.redisService.get<string>(mappingKey);
        
        if (externalPlatformTxId) {
          if (activeRound) {
            const userBets = await this.diverGameService.getUserBets(userId);
            try {
              const betRecord = await this.betService.getByExternalTxId(externalPlatformTxId, gameCode);
              if (betRecord && betRecord.userId === userId && betRecord.status !== BetStatus.REFUNDED) {
                const allBets = Array.from(activeRound.bets.values());
                bet = allBets.find(b => {
                  const betAmountMatch = Math.abs(parseFloat(b.betAmount) - parseFloat(betRecord.betAmount)) < 0.01;
                  const currencyMatch = b.currency === betRecord.currency;
                  const userIdMatch = b.userId === userId;
                  const roundIdMatch = String(activeRound.roundId) === betRecord.roundId;
                  
                  return userIdMatch && betAmountMatch && currencyMatch && roundIdMatch;
                }) || null;
                
                if (bet) {
                  this.logger.log(
                    `[CANCEL_BET] Found bet via fallback lookup: playerGameId=${bet.playerGameId} originalPlayerGameId=${playerGameId} platformTxId=${externalPlatformTxId}`,
                  );
                }
              }
            } catch (dbError) {
              this.logger.debug(
                `[CANCEL_BET] Could not fetch bet record for fallback: ${(dbError as Error).message}`,
              );
            }
          }
        }
      }

      if (!bet && !pendingBet) {
        const allPendingBets = await this.diverGameService.getAllPendingBetsForUser(userId);
        pendingBet = allPendingBets.find(bet => bet.playerGameId === playerGameId) || null;
      }

      if (!bet && !pendingBet) {
        this.logger.warn(
          `[CANCEL_BET] Bet not found: playerGameId=${playerGameId} userId=${userId} activeRound=${activeRound ? `exists (status=${activeRound.status}, roundId=${activeRound.roundId}, betsCount=${activeRound.bets.size})` : 'null'}`,
        );
        return createErrorResponse(
          'Bet not found',
          DIVER_ERROR_CODES.BET_NOT_FOUND,
        );
      }

      if (bet) {
        if (bet.userId !== userId) {
          return createErrorResponse(
            'Bet does not belong to user',
            DIVER_ERROR_CODES.BET_NOT_FOUND,
          );
        }

        if (bet.coeffWin && bet.winAmount) {
          return createErrorResponse(
            'Cannot cancel bet: already cashed out',
            DIVER_ERROR_CODES.CANNOT_CANCEL_BET,
          );
        }

        if (activeRound?.status === GameStatus.FINISH_GAME) {
          return createErrorResponse(
            'Cannot cancel bet: round already finished',
            DIVER_ERROR_CODES.CANNOT_CANCEL_BET,
          );
        }

        const betPlayerGameId = bet.playerGameId || playerGameId;
        let mappingKey = `diver:bet:${betPlayerGameId}`;
        let externalPlatformTxId = await this.redisService.get<string>(mappingKey);

        if (!externalPlatformTxId && betPlayerGameId !== playerGameId) {
          const fallbackMappingKey = `diver:bet:${playerGameId}`;
          const fallbackPlatformTxId = await this.redisService.get<string>(fallbackMappingKey);
          if (fallbackPlatformTxId) {
            this.logger.log(
              `[CANCEL_BET] Found mapping with original playerGameId: betPlayerGameId=${betPlayerGameId} original=${playerGameId}`,
            );
            externalPlatformTxId = fallbackPlatformTxId;
            mappingKey = fallbackMappingKey;
            bet.playerGameId = playerGameId;
          }
        }

        if (!externalPlatformTxId) {
          this.logger.error(
            `[CANCEL_BET] Could not find externalPlatformTxId for playerGameId=${playerGameId} or betPlayerGameId=${betPlayerGameId}`,
          );
          return createErrorResponse(
            'Bet record not found',
            DIVER_ERROR_CODES.BET_NOT_FOUND,
          );
        }

        const betRecord = await this.betService.getByExternalTxId(externalPlatformTxId, gameCode);
        if (!betRecord) {
          this.logger.error(
            `[CANCEL_BET] Bet record not found in database: externalPlatformTxId=${externalPlatformTxId}`,
          );
          return createErrorResponse(
            'Bet record not found',
            DIVER_ERROR_CODES.BET_NOT_FOUND,
          );
        }

        const betAmount = parseFloat(bet.betAmount);
        const refundResult = await this.walletService.refundBet({
          agentId,
          userId,
          refundTransactions: [
            {
              platformTxId: externalPlatformTxId,
              refundPlatformTxId: externalPlatformTxId,
              betAmount,
              winAmount: 0,
              turnover: 0,
              betTime: betRecord.betPlacedAt?.toISOString() || betRecord.createdAt.toISOString(),
              updateTime: new Date().toISOString(),
              roundId: betRecord.roundId,
              gameCode: gameCode,
            },
          ],
        });

        if (refundResult.status !== '0000') {
          this.logger.error(
            `[CANCEL_BET] Wallet refund failed: user=${userId} status=${refundResult.status}`,
          );
          return createErrorResponse(
            'Failed to refund bet',
            DIVER_ERROR_CODES.BET_REJECTED,
          );
        }

        await this.betService.updateStatus({
          externalPlatformTxId,
          status: BetStatus.REFUNDED,
          updatedBy: userId,
        });

        const currentActiveRound = await this.diverGameService.getActiveRound();
        if (currentActiveRound) {
          const finalPlayerGameId = bet.playerGameId || playerGameId;
          currentActiveRound.bets.delete(finalPlayerGameId);
          
          if (finalPlayerGameId !== playerGameId) {
            currentActiveRound.bets.delete(playerGameId);
          }
          
          await this.diverGameService.saveActiveRoundToRedis();
        }

        await this.redisService.del(mappingKey);

        const currentRoundForIdempotency = await this.diverGameService.getActiveRound();
        if (currentRoundForIdempotency) {
          const roundId = String(currentRoundForIdempotency.roundId);
          const idempotencyKey = this.redisService.generateIdempotencyKey(
            gameCode,
            userId,
            agentId,
            roundId,
            bet.betAmount,
            bet.betNumber ?? 0,
          );
          await this.redisService.del(idempotencyKey);
          this.logger.log(
            `[CANCEL_BET] Cleared idempotency key for cancelled bet: roundId=${roundId} betNumber=${bet.betNumber ?? 0}`,
          );
        }

        this.logger.log(
          `[CANCEL_BET] ✅ Successfully cancelled bet: user=${userId} playerGameId=${playerGameId} amount=${betAmount}`,
        );

        return createSuccessResponse({
          userId,
          operatorId,
          playerGameId,
          balance: refundResult.balance ? String(refundResult.balance) : undefined,
          balanceCurrency: bet.currency,
        });
      }

      if (pendingBet) {
        if (pendingBet.userId !== userId) {
          return createErrorResponse(
            'Bet does not belong to user',
            DIVER_ERROR_CODES.BET_NOT_FOUND,
          );
        }

        const betAmount = parseFloat(pendingBet.betAmount);
        const refundResult = await this.walletService.refundBet({
          agentId,
          userId,
          refundTransactions: [
            {
              platformTxId: pendingBet.platformTxId,
              refundPlatformTxId: pendingBet.platformTxId,
              betAmount,
              winAmount: 0,
              turnover: 0,
              betTime: new Date(pendingBet.queuedAt).toISOString(),
              updateTime: new Date().toISOString(),
              roundId: 'pending',
              gameCode: gameCode,
            },
          ],
        });

        if (refundResult.status !== '0000') {
          this.logger.error(
            `[CANCEL_BET] Wallet refund failed for pending bet: user=${userId} status=${refundResult.status}`,
          );
          return createErrorResponse(
            'Failed to refund bet',
            DIVER_ERROR_CODES.BET_REJECTED,
          );
        }

        if (pendingBet.betNumber !== undefined) {
          await this.diverGameService.removePendingBet(userId, pendingBet.betNumber);
        } else {
          await this.diverGameService.removePendingBet(userId);
        }

        const currentRoundForPending = await this.diverGameService.getActiveRound();
        const roundIdForPending = currentRoundForPending ? String(currentRoundForPending.roundId) : 'pending';
        const idempotencyKeyForPending = this.redisService.generateIdempotencyKey(
          gameCode,
          userId,
          agentId,
          roundIdForPending,
          pendingBet.betAmount,
          pendingBet.betNumber ?? 0,
        );
        await this.redisService.del(idempotencyKeyForPending);
        this.logger.log(
          `[CANCEL_BET] Cleared idempotency key for cancelled pending bet: roundId=${roundIdForPending} betNumber=${pendingBet.betNumber ?? 0}`,
        );

        this.logger.log(
          `[CANCEL_BET] ✅ Successfully cancelled pending bet: user=${userId} amount=${betAmount}`,
        );

        return createSuccessResponse({
          userId,
          operatorId,
          playerGameId,
          balance: refundResult.balance ? String(refundResult.balance) : undefined,
          balanceCurrency: pendingBet.currency,
        });
      }

      return createErrorResponse(
        'Bet not found',
        DIVER_ERROR_CODES.BET_NOT_FOUND,
      );
    } catch (error: any) {
      this.logger.error(`[CANCEL_BET_ERROR] user=${userId} error=${error.message}`);
      return createErrorResponse(
        error.message || 'Failed to cancel bet',
        DIVER_ERROR_CODES.BET_REJECTED,
      );
    }
  }

  async settleUncashedBets(roundId: number, gameCode: string): Promise<void> {
    try {
      const activeRound = await this.diverGameService.getActiveRound();
      if (!activeRound) {
        return;
      }

      const crashCoeff = activeRound.crashCoeff || 1.0;
      const uncashedBets: Array<{ playerGameId: string; bet: BetData }> = [];

      for (const [playerGameId, bet] of activeRound.bets.entries()) {
        if (!bet.coeffWin || !bet.winAmount) {
          uncashedBets.push({ playerGameId, bet });
        }
      }

      if (uncashedBets.length === 0) {
        this.logger.log(`[SETTLE_UNCASHED] No uncashed bets to settle for roundId=${roundId}`);
        return;
      }

      this.logger.log(
        `[SETTLE_UNCASHED] Settling ${uncashedBets.length} uncashed bets for roundId=${roundId} crashCoeff=${crashCoeff}`,
      );

      for (const { playerGameId, bet } of uncashedBets) {
        try {
          const mappingKey = `diver:bet:${playerGameId}`;
          const externalPlatformTxId = await this.redisService.get<string>(mappingKey);

          if (!externalPlatformTxId) {
            this.logger.warn(
              `[SETTLE_UNCASHED] No externalPlatformTxId found for playerGameId=${playerGameId}, skipping`,
            );
            continue;
          }

          const betRecord = await this.betService.getByExternalTxId(externalPlatformTxId, gameCode);
          if (!betRecord) {
            this.logger.warn(
              `[SETTLE_UNCASHED] Bet record not found in DB: externalPlatformTxId=${externalPlatformTxId}, skipping`,
            );
            continue;
          }

          if (betRecord.status !== BetStatus.PLACED) {
            this.logger.debug(
              `[SETTLE_UNCASHED] Bet already settled: externalPlatformTxId=${externalPlatformTxId} status=${betRecord.status}, skipping`,
            );
            continue;
          }

          const winAmount = '0';
          const finalCoeff = crashCoeff.toFixed(2);

          await this.betService.recordSettlement({
            externalPlatformTxId,
            winAmount,
            settleType: 'crash',
            settledAt: new Date(),
            updatedBy: 'system',
            withdrawCoeff: '0.00',
            finalCoeff,
          });

          const betAmount = parseFloat(bet.betAmount);
          await this.walletService.settleBet({
            agentId: bet.operatorId,
            userId: bet.userId,
            platformTxId: externalPlatformTxId,
            winAmount: 0,
            roundId: String(roundId),
            betAmount,
            gameCode,
          });

          await this.redisService.del(mappingKey);

          this.logger.log(
            `[SETTLE_UNCASHED] ✅ Settled uncashed bet: userId=${bet.userId} playerGameId=${playerGameId} winAmount=0`,
          );
        } catch (error: any) {
          this.logger.error(
            `[SETTLE_UNCASHED] Error settling bet playerGameId=${playerGameId}: ${error.message}`,
          );
        }
      }

      this.logger.log(
        `[SETTLE_UNCASHED] Completed settling uncashed bets for roundId=${roundId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[SETTLE_UNCASHED] Fatal error settling uncashed bets: ${error.message}`,
      );
    }
  }
}
