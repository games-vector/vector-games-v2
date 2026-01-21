import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { WalletService, BetService as CoreBetService, BetStatus } from '@games-vector/game-core';
import { BetData, PendingBet } from './DTO/game-state.dto';
import { SugarDaddyGameService } from './sugar-daddy-game.service';
import { RedisService } from '../../modules/redis/redis.service';
import { GameStatus } from './DTO/game-state.dto';
import { SUGAR_DADDY_ERROR_CODES, createErrorResponse, createSuccessResponse } from './errors/sugar-daddy-game-errors';
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
  isNextRoundAddBet?: boolean; // true if queued for next round
  betNumber?: number;
  bet?: BetData; // Keep for backward compatibility
}

@Injectable()
export class SugarDaddyGameBetService {
  private readonly logger = new Logger(SugarDaddyGameBetService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly betService: CoreBetService,
    private readonly sugarDaddyGameService: SugarDaddyGameService,
    private readonly redisService: RedisService,
  ) {}

  async placeBet(
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string, // Game code from WebSocket connection
    payload: PlaceBetPayload,
    nickname: string,
    gameAvatar: number | null,
    userAvatar?: string | null,
  ): Promise<PlaceBetResponse> {
    try {
      // Validate payload
      const validationError = this.validateBetPayload(payload);
      if (validationError) {
        return validationError;
      }

      const activeRound = await this.sugarDaddyGameService.getActiveRound();
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
        SUGAR_DADDY_ERROR_CODES.BET_REJECTED,
      );
    }
  }

  private validateBetPayload(payload: PlaceBetPayload): PlaceBetResponse | null {
    const betAmount = parseFloat(payload.betAmount);
    if (isNaN(betAmount) || betAmount <= 0) {
      return createErrorResponse(
        'Invalid bet amount',
        SUGAR_DADDY_ERROR_CODES.INVALID_BET_AMOUNT,
      );
    }

    const minBet = parseFloat(DEFAULTS.AVIATOR.BET_CONFIG.minBetAmount);
    const maxBet = parseFloat(DEFAULTS.AVIATOR.BET_CONFIG.maxBetAmount);
    if (betAmount < minBet || betAmount > maxBet) {
      return createErrorResponse(
        `Bet amount must be between ${minBet} and ${maxBet}`,
        SUGAR_DADDY_ERROR_CODES.INVALID_BET_AMOUNT,
      );
    }

    if (!payload.currency || payload.currency.length < 3 || payload.currency.length > 4) {
      return createErrorResponse(
        'Invalid currency code',
        SUGAR_DADDY_ERROR_CODES.INVALID_CURRENCY,
      );
    }

    const betNumber = payload.betNumber ?? 0;
    if (betNumber !== 0 && betNumber !== 1) {
      return createErrorResponse(
        'Bet number must be 0 or 1',
        SUGAR_DADDY_ERROR_CODES.INVALID_BET_NUMBER,
      );
    }

    if (payload.coeffAuto !== undefined && payload.coeffAuto !== null) {
      const coeffAuto = parseFloat(payload.coeffAuto);
      if (isNaN(coeffAuto) || coeffAuto < 1.00 || coeffAuto > 1000.00) {
        return createErrorResponse(
          'Auto cashout coefficient must be between 1.00 and 1000.00',
          SUGAR_DADDY_ERROR_CODES.INVALID_COEFF_AUTO,
        );
      }

      const decimalPlaces = (payload.coeffAuto.split('.')[1] || '').length;
      if (decimalPlaces > 2) {
        return createErrorResponse(
          'Auto cashout coefficient must have at most 2 decimal places',
          SUGAR_DADDY_ERROR_CODES.INVALID_COEFF_AUTO,
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

    const userBets = await this.sugarDaddyGameService.getUserBets(userId);
    const existingBetWithSameNumber = userBets.find(bet => bet.betNumber === betNumber);
    if (existingBetWithSameNumber) {
      return createErrorResponse(
        `Bet already exists for betNumber ${betNumber}. Please cancel the existing bet first.`,
        SUGAR_DADDY_ERROR_CODES.DUPLICATE_BET_NUMBER,
      );
    }

    const roundId = String(activeRound.roundId);
    const platformTxId = uuidv4();

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
        SUGAR_DADDY_ERROR_CODES.BET_REJECTED,
      );
    }

    const playerGameId = uuidv4();
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

    const mappingKey = `sugar-daddy:bet:${playerGameId}`;
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

    await this.sugarDaddyGameService.addBet(betData);

    this.logger.log(
      `[BET_PLACED] user=${userId} playerGameId=${playerGameId} amount=${betAmount} currency=${payload.currency} betNumber=${betNumber}`,
    );

    return createSuccessResponse({
      betAmount: payload.betAmount,
      currency: payload.currency,
      playerGameId,
      isNextRoundAddBet: false,
      betNumber,
      bet: betData,
    });
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
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
    const roundId = activeRound ? String(activeRound.roundId) : 'pending';
    const platformTxId = uuidv4();

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
        SUGAR_DADDY_ERROR_CODES.BET_REJECTED,
      );
    }

      const existingPendingBet = await this.sugarDaddyGameService.getPendingBet(userId);
    if (existingPendingBet) {
      this.logger.log(
        `[QUEUE_BET] Replacing existing pending bet for userId=${userId}`,
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
    };

    const pendingBetMappingKey = `sugar-daddy:pending_bet:${tempPlayerGameId}`;
    await this.redisService.set(pendingBetMappingKey, userId, 300);

    await this.sugarDaddyGameService.queueBetForNextRound(pendingBet);

    this.logger.log(
      `[BET_QUEUED] user=${userId} amount=${betAmount} currency=${payload.currency} platformTxId=${platformTxId} tempPlayerGameId=${tempPlayerGameId} - will be placed in next round`,
    );

    return createSuccessResponse({
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
    });
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
      const userIds = await this.sugarDaddyGameService.getAllPendingBetUsers();
      
      this.logger.log(
        `[PROCESS_PENDING_BETS] Found ${userIds.length} pending bets to process for roundId=${roundId}`,
      );

      for (const userId of userIds) {
        try {
          const pendingBet = await this.sugarDaddyGameService.getPendingBet(userId);
          
          if (!pendingBet) {
            await this.sugarDaddyGameService.removePendingBet(userId);
            continue;
          }

          const betAmount = parseFloat(pendingBet.betAmount);
          if (isNaN(betAmount) || betAmount <= 0) {
            this.logger.warn(
              `[PROCESS_PENDING_BET] Invalid bet amount for userId=${userId}, removing pending bet`,
            );
            await this.sugarDaddyGameService.removePendingBet(userId);
            result.failed++;
            result.errors.push({ userId, error: 'Invalid bet amount' });
            continue;
          }

          const userBets = await this.sugarDaddyGameService.getUserBets(userId);
          const existingBetWithSameNumber = userBets.find(bet => bet.betNumber === pendingBet.betNumber);
          if (existingBetWithSameNumber) {
            this.logger.warn(
              `[PROCESS_PENDING_BET] Duplicate betNumber ${pendingBet.betNumber} for userId=${userId}, removing pending bet`,
            );
            await this.sugarDaddyGameService.removePendingBet(userId);
            result.failed++;
            result.errors.push({ userId, error: `Duplicate betNumber ${pendingBet.betNumber}` });
            continue;
          }

          if (!pendingBet.platformTxId) {
            this.logger.error(
              `[PROCESS_PENDING_BET] Missing platformTxId for userId=${userId}, removing pending bet`,
            );
            await this.sugarDaddyGameService.removePendingBet(userId);
            result.failed++;
            result.errors.push({ userId, error: 'Missing platformTxId' });
            continue;
          }

          const platformTxId = pendingBet.platformTxId;

          this.logger.log(
            `[PROCESS_PENDING_BET] Processing: userId=${userId} amount=${betAmount} currency=${pendingBet.currency} platformTxId=${platformTxId}`,
          );

          const playerGameId = uuidv4();
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

          const mappingKey = `sugar-daddy:bet:${playerGameId}`;
          await this.redisService.set(mappingKey, platformTxId, 60 * 60 * 24);

          await this.sugarDaddyGameService.addPendingBetToRound(pendingBet, gameUUID);

          await this.sugarDaddyGameService.removePendingBet(userId);

          result.processed++;
          this.logger.log(
            `[PROCESS_PENDING_BET] ✅ Successfully processed: userId=${userId} playerGameId=${playerGameId} platformTxId=${platformTxId}`,
          );
        } catch (error: any) {
          this.logger.error(
            `[PROCESS_PENDING_BET] Error processing bet for userId=${userId}: ${error.message}`,
          );
          await this.sugarDaddyGameService.removePendingBet(userId);
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
  ): Promise<{ success: boolean; error?: string; code?: string; bet?: BetData }> {
    try {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (!activeRound || activeRound.status !== GameStatus.IN_GAME) {
        return createErrorResponse(
          'Cannot cash out: game not in IN_GAME state',
          SUGAR_DADDY_ERROR_CODES.INVALID_GAME_STATE,
        );
      }

      const bet = await this.sugarDaddyGameService.getBet(playerGameId);
      if (!bet) {
        return createErrorResponse(
          'Bet not found',
          SUGAR_DADDY_ERROR_CODES.BET_NOT_FOUND,
        );
      }

      if (bet.userId !== userId) {
        return createErrorResponse(
          'Bet does not belong to user',
          SUGAR_DADDY_ERROR_CODES.BET_NOT_FOUND,
        );
      }

      if (bet.coeffWin && bet.winAmount) {
        return createErrorResponse(
          'Bet already cashed out',
          SUGAR_DADDY_ERROR_CODES.BET_ALREADY_CASHED_OUT,
        );
      }

      const currentCoeff = activeRound.currentCoeff;
      const cashedOutBet = await this.sugarDaddyGameService.cashOutBet(playerGameId, currentCoeff);

      if (!cashedOutBet) {
        return createErrorResponse(
          'Failed to cash out bet',
          SUGAR_DADDY_ERROR_CODES.BET_REJECTED,
        );
      }

      const winAmount = parseFloat(cashedOutBet.winAmount || '0');
      const roundId = String(activeRound.roundId);

      this.logger.log(
        `[CASHOUT] user=${userId} playerGameId=${playerGameId} coeff=${cashedOutBet.coeffWin} winAmount=${winAmount}`,
      );

      const mappingKey = `sugar-daddy:bet:${playerGameId}`;
      const externalPlatformTxId = await this.redisService.get<string>(mappingKey);

      if (!externalPlatformTxId) {
        this.logger.error(
          `[CASHOUT] Could not find externalPlatformTxId for playerGameId=${playerGameId}`,
        );
        return createErrorResponse(
          'Bet record not found',
          SUGAR_DADDY_ERROR_CODES.BET_NOT_FOUND,
        );
      }

      const betRecord = await this.betService.getByExternalTxId(externalPlatformTxId, gameCode);

      if (!betRecord) {
        this.logger.error(
          `[CASHOUT] Bet record not found in database: externalPlatformTxId=${externalPlatformTxId}`,
        );
        return createErrorResponse(
          'Bet record not found',
          SUGAR_DADDY_ERROR_CODES.BET_NOT_FOUND,
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
      }

      await this.redisService.del(mappingKey);

      return createSuccessResponse({ bet: cashedOutBet });
    } catch (error: any) {
      this.logger.error(`[CASHOUT_ERROR] user=${userId} error=${error.message}`);
      return createErrorResponse(
        error.message || 'Failed to cash out',
        SUGAR_DADDY_ERROR_CODES.BET_REJECTED,
      );
    }
  }

  async cancelBet(
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    playerGameId: string,
  ): Promise<{ success: boolean; error?: string; code?: string }> {
    try {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      
      // Check if bet exists in current round
      let bet: BetData | null = null;
      if (activeRound) {
        bet = await this.sugarDaddyGameService.getBet(playerGameId);
      }

      // Check if bet exists in pending queue (using temp playerGameId mapping)
      let pendingBet: PendingBet | null = null;
      if (!bet) {
        // Check if this playerGameId maps to a pending bet
        const pendingBetMappingKey = `sugar-daddy:pending_bet:${playerGameId}`;
        const pendingBetUserId = await this.redisService.get<string>(pendingBetMappingKey);
        
        if (pendingBetUserId && pendingBetUserId === userId) {
          // This is a pending bet - get it
          pendingBet = await this.sugarDaddyGameService.getPendingBet(userId);
          
          // Remove the mapping
          await this.redisService.del(pendingBetMappingKey);
        }
      }

      if (!bet && !pendingBet) {
        return createErrorResponse(
          'Bet not found',
          SUGAR_DADDY_ERROR_CODES.BET_NOT_FOUND,
        );
      }

      // If bet is in current round
      if (bet) {
        // Verify bet belongs to user
        if (bet.userId !== userId) {
          return createErrorResponse(
            'Bet does not belong to user',
            SUGAR_DADDY_ERROR_CODES.BET_NOT_FOUND,
          );
        }

        // Check if bet can be cancelled
        if (bet.coeffWin && bet.winAmount) {
          return createErrorResponse(
            'Cannot cancel bet: already cashed out',
            SUGAR_DADDY_ERROR_CODES.CANNOT_CANCEL_BET,
          );
        }

        if (activeRound?.status === GameStatus.FINISH_GAME) {
          return createErrorResponse(
            'Cannot cancel bet: round already finished',
            SUGAR_DADDY_ERROR_CODES.CANNOT_CANCEL_BET,
          );
        }

        // Get platformTxId from Redis
        const mappingKey = `sugar-daddy:bet:${playerGameId}`;
        const externalPlatformTxId = await this.redisService.get<string>(mappingKey);

        if (!externalPlatformTxId) {
          this.logger.error(
            `[CANCEL_BET] Could not find externalPlatformTxId for playerGameId=${playerGameId}`,
          );
          return createErrorResponse(
            'Bet record not found',
            SUGAR_DADDY_ERROR_CODES.BET_NOT_FOUND,
          );
        }

        // Get bet record from database
        const betRecord = await this.betService.getByExternalTxId(externalPlatformTxId, gameCode);
        if (!betRecord) {
          this.logger.error(
            `[CANCEL_BET] Bet record not found in database: externalPlatformTxId=${externalPlatformTxId}`,
          );
          return createErrorResponse(
            'Bet record not found',
            SUGAR_DADDY_ERROR_CODES.BET_NOT_FOUND,
          );
        }

        // Refund balance via Wallet API
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
            SUGAR_DADDY_ERROR_CODES.BET_REJECTED,
          );
        }

        // Update bet status to REFUNDED
        await this.betService.updateStatus({
          externalPlatformTxId,
          status: BetStatus.REFUNDED,
          updatedBy: userId,
        });

        // Remove bet from current round
        if (activeRound) {
          activeRound.bets.delete(playerGameId);
        }

        // Remove Redis mapping
        await this.redisService.del(mappingKey);

        this.logger.log(
          `[CANCEL_BET] ✅ Successfully cancelled bet: user=${userId} playerGameId=${playerGameId} amount=${betAmount}`,
        );

        return createSuccessResponse();
      }

      // If bet is in pending queue
      if (pendingBet) {
        // Verify it's for this user
        if (pendingBet.userId !== userId) {
          return createErrorResponse(
            'Bet does not belong to user',
            SUGAR_DADDY_ERROR_CODES.BET_NOT_FOUND,
          );
        }

        // Refund balance via Wallet API
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
            SUGAR_DADDY_ERROR_CODES.BET_REJECTED,
          );
        }

        // Remove from pending queue
        await this.sugarDaddyGameService.removePendingBet(userId);

        this.logger.log(
          `[CANCEL_BET] ✅ Successfully cancelled pending bet: user=${userId} amount=${betAmount}`,
        );

        return createSuccessResponse();
      }

      return createErrorResponse(
        'Bet not found',
        SUGAR_DADDY_ERROR_CODES.BET_NOT_FOUND,
      );
    } catch (error: any) {
      this.logger.error(`[CANCEL_BET_ERROR] user=${userId} error=${error.message}`);
      return createErrorResponse(
        error.message || 'Failed to cancel bet',
        SUGAR_DADDY_ERROR_CODES.BET_REJECTED,
      );
    }
  }

  async settleUncashedBets(roundId: number, gameCode: string): Promise<void> {
    try {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
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
          const mappingKey = `sugar-daddy:bet:${playerGameId}`;
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
