import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { WalletService, BetService as CoreBetService, BetStatus } from '@games-vector/game-core';
import { WheelGameService } from './wheel-game.service';
import { RedisService } from '../../modules/redis/redis.service';
import { DEFAULTS } from '../../config/defaults.config';
import {
  GameStatus,
  WheelColor,
  WheelBetData,
  WheelPendingBet,
} from './DTO/game-state.dto';
import { WheelBetPayloadDto } from './DTO/bet-payload.dto';
import {
  WHEEL_ERROR_CODES,
  createErrorResponse,
  createSuccessResponse,
} from './errors/wheel-game-errors';

export interface WheelPlaceBetResponse {
  success: boolean;
  error?: string;
  code?: string;
  id?: string;
  playerGameId?: string;
  placedAt?: string;
  userId?: string;
  operatorId?: string;
  nickname?: string;
  gameAvatar?: number | null;
  betAmount?: string;
  color?: WheelColor;
  currency?: string;
  isNextRoundBet?: boolean;
  balance?: string;
  balanceCurrency?: string;
}

const VALID_COLORS = new Set([WheelColor.BLACK, WheelColor.RED, WheelColor.BLUE, WheelColor.GREEN]);

@Injectable()
export class WheelGameBetService {
  private readonly logger = new Logger(WheelGameBetService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly betService: CoreBetService,
    private readonly wheelGameService: WheelGameService,
    private readonly redisService: RedisService,
  ) {}

  async placeBet(
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    payload: WheelBetPayloadDto,
    nickname: string,
    gameAvatar: number | null,
    userAvatar?: string | null,
  ): Promise<WheelPlaceBetResponse> {
    try {
      const validationError = this.validateBetPayload(payload);
      if (validationError) return validationError;

      const activeRound = this.wheelGameService.getActiveRound();

      if (activeRound && activeRound.status === GameStatus.WAIT_GAME) {
        return await this.placeBetImmediately(
          userId, agentId, operatorId, gameCode, payload,
          nickname, gameAvatar, userAvatar ?? null, activeRound,
        );
      }

      if (activeRound && (activeRound.status === GameStatus.IN_GAME || activeRound.status === GameStatus.FINISH_GAME)) {
        return await this.queueBetForNextRound(
          userId, agentId, operatorId, gameCode, payload,
          nickname, gameAvatar, userAvatar ?? null,
        );
      }

      // No active round - queue for next round
      return await this.queueBetForNextRound(
        userId, agentId, operatorId, gameCode, payload,
        nickname, gameAvatar, userAvatar ?? null,
      );
    } catch (error: any) {
      this.logger.error(`[WHEEL_BET_PLACE_ERROR] user=${userId} error=${error.message}`);
      return createErrorResponse(error.message || 'Failed to place bet', WHEEL_ERROR_CODES.BET_REJECTED);
    }
  }

  private validateBetPayload(payload: WheelBetPayloadDto): WheelPlaceBetResponse | null {
    const betAmount = parseFloat(payload.betAmount);
    if (isNaN(betAmount) || betAmount <= 0) {
      return createErrorResponse('Invalid bet amount', WHEEL_ERROR_CODES.INVALID_BET_AMOUNT);
    }

    const minBet = parseFloat(DEFAULTS.WHEEL.BET_CONFIG.minBetAmount);
    const maxBet = parseFloat(DEFAULTS.WHEEL.BET_CONFIG.maxBetAmount);
    if (betAmount < minBet || betAmount > maxBet) {
      return createErrorResponse(
        `Bet amount must be between ${minBet} and ${maxBet}`,
        WHEEL_ERROR_CODES.INVALID_BET_AMOUNT,
      );
    }

    if (!payload.currency || payload.currency.length < 3 || payload.currency.length > 4) {
      return createErrorResponse('Invalid currency code', WHEEL_ERROR_CODES.INVALID_CURRENCY);
    }

    if (!VALID_COLORS.has(payload.color)) {
      return createErrorResponse(
        'Invalid color. Must be BLACK, RED, BLUE, or GREEN',
        WHEEL_ERROR_CODES.INVALID_COLOR,
      );
    }

    return null;
  }

  private async placeBetImmediately(
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    payload: WheelBetPayloadDto,
    nickname: string,
    gameAvatar: number | null,
    userAvatar: string | null,
    activeRound: any,
  ): Promise<WheelPlaceBetResponse> {
    const betAmount = parseFloat(payload.betAmount);
    const roundId = String(activeRound.roundId);
    const platformTxId = uuidv4();
    const playerGameId = uuidv4();
    const placedAt = new Date().toISOString();

    this.logger.log(
      `[WHEEL_BET_PLACE] user=${userId} agent=${agentId} amount=${betAmount} color=${payload.color} currency=${payload.currency} roundId=${roundId} txId=${platformTxId}`,
    );

    // Deduct balance via wallet
    const walletResult = await this.walletService.placeBet({
      agentId,
      userId,
      amount: betAmount,
      roundId,
      platformTxId,
      currency: payload.currency,
      gameCode,
    });

    if (walletResult.status !== '0000') {
      this.logger.error(
        `Agent rejected bet: user=${userId} agent=${agentId} status=${walletResult.status} amount=${betAmount}`,
      );
      return createErrorResponse('Bet rejected by agent', WHEEL_ERROR_CODES.BET_REJECTED);
    }

    // Create bet record in DB
    try {
      await this.betService.createPlacement({
        externalPlatformTxId: platformTxId,
        userId,
        roundId,
        gameMetadata: { color: payload.color, playerGameId },
        betAmount: payload.betAmount,
        currency: payload.currency,
        gameCode,
        isPremium: false,
        betPlacedAt: walletResult.balanceTs ? new Date(walletResult.balanceTs) : undefined,
        balanceAfterBet: walletResult.balance ? String(walletResult.balance) : undefined,
        createdBy: userId,
        operatorId,
      });
    } catch (dbError) {
      this.logger.error(
        `[COMPENSATING_TX] DB write failed: user=${userId} txId=${platformTxId} error=${(dbError as Error).message}. Initiating refund.`,
      );

      try {
        await this.walletService.refundBet({
          agentId,
          userId,
          refundTransactions: [{
            platformTxId,
            refundPlatformTxId: platformTxId,
            betAmount,
            winAmount: 0,
            turnover: 0,
            betTime: walletResult.balanceTs ? new Date(walletResult.balanceTs).toISOString() : new Date().toISOString(),
            updateTime: new Date().toISOString(),
            roundId,
            gameCode,
          }],
        });
      } catch (refundError) {
        this.logger.error(
          `[COMPENSATING_TX] CRITICAL: Refund failed: user=${userId} txId=${platformTxId} error=${(refundError as Error).message}`,
        );
      }

      return createErrorResponse(
        'Bet placement failed. Your balance has been refunded.',
        WHEEL_ERROR_CODES.BET_REJECTED,
      );
    }

    // Store bet mapping in Redis
    const mappingKey = `wheel:bet:${playerGameId}`;
    await this.redisService.set(mappingKey, platformTxId, 60 * 60 * 24);

    // Add bet to active round
    const betData: WheelBetData = {
      id: `${operatorId}::${userId}`,
      playerGameId,
      placedAt,
      userId,
      operatorId,
      nickname,
      gameAvatar,
      betAmount: payload.betAmount,
      color: payload.color,
      currency: payload.currency,
      userAvatar,
    };

    await this.wheelGameService.addBet(betData);

    this.logger.log(
      `[WHEEL_BET_PLACED] user=${userId} playerGameId=${playerGameId} amount=${betAmount} color=${payload.color}`,
    );

    return createSuccessResponse({
      id: betData.id,
      playerGameId,
      placedAt,
      userId,
      operatorId,
      nickname,
      gameAvatar,
      betAmount: payload.betAmount,
      color: payload.color,
      currency: payload.currency,
      isNextRoundBet: false,
      balance: walletResult.balance ? String(walletResult.balance) : undefined,
      balanceCurrency: payload.currency,
    });
  }

  private async queueBetForNextRound(
    userId: string,
    agentId: string,
    operatorId: string,
    gameCode: string,
    payload: WheelBetPayloadDto,
    nickname: string,
    gameAvatar: number | null,
    userAvatar: string | null,
  ): Promise<WheelPlaceBetResponse> {
    const betAmount = parseFloat(payload.betAmount);
    const activeRound = this.wheelGameService.getActiveRound();
    const roundId = activeRound ? String(activeRound.roundId) : 'pending';
    const platformTxId = uuidv4();
    const playerGameId = uuidv4();
    const placedAt = new Date().toISOString();

    this.logger.log(
      `[WHEEL_QUEUE_BET] Deducting balance for queued bet: user=${userId} amount=${betAmount} color=${payload.color}`,
    );

    // Deduct balance immediately even for queued bets
    const walletResult = await this.walletService.placeBet({
      agentId,
      userId,
      amount: betAmount,
      roundId,
      platformTxId,
      currency: payload.currency,
      gameCode,
    });

    if (walletResult.status !== '0000') {
      this.logger.error(
        `Agent rejected queued bet: user=${userId} agent=${agentId} status=${walletResult.status} amount=${betAmount}`,
      );
      return createErrorResponse('Bet rejected by agent', WHEEL_ERROR_CODES.BET_REJECTED);
    }

    const pendingBet: WheelPendingBet = {
      userId,
      agentId,
      operatorId,
      betAmount: payload.betAmount,
      color: payload.color,
      currency: payload.currency,
      nickname,
      gameAvatar,
      userAvatar,
      queuedAt: Date.now(),
      platformTxId,
      gameCode,
      playerGameId,
    };

    try {
      await this.wheelGameService.queueBetForNextRound(pendingBet);
    } catch (storageError) {
      this.logger.error(
        `[COMPENSATING_TX] Pending bet storage failed: user=${userId} txId=${platformTxId} error=${(storageError as Error).message}`,
      );

      try {
        await this.walletService.refundBet({
          agentId,
          userId,
          refundTransactions: [{
            platformTxId,
            refundPlatformTxId: platformTxId,
            betAmount,
            winAmount: 0,
            turnover: 0,
            betTime: new Date().toISOString(),
            updateTime: new Date().toISOString(),
            roundId,
            gameCode,
          }],
        });
      } catch (refundError) {
        this.logger.error(
          `[COMPENSATING_TX] CRITICAL: Refund failed: user=${userId} txId=${platformTxId} error=${(refundError as Error).message}`,
        );
      }

      return createErrorResponse(
        'Bet queuing failed. Your balance has been refunded.',
        WHEEL_ERROR_CODES.BET_REJECTED,
      );
    }

    this.logger.log(
      `[WHEEL_BET_QUEUED] user=${userId} amount=${betAmount} color=${payload.color} playerGameId=${playerGameId}`,
    );

    return createSuccessResponse({
      id: `${operatorId}::${userId}`,
      playerGameId,
      placedAt,
      userId,
      operatorId,
      nickname,
      gameAvatar,
      betAmount: payload.betAmount,
      color: payload.color,
      currency: payload.currency,
      isNextRoundBet: true,
      balance: walletResult.balance ? String(walletResult.balance) : undefined,
      balanceCurrency: payload.currency,
    });
  }

  // =============================================
  // PENDING BETS PROCESSING
  // =============================================

  async processPendingBets(roundId: number, gameUUID: string): Promise<{
    processed: number;
    failed: number;
    errors: Array<{ userId: string; error: string }>;
  }> {
    const result = { processed: 0, failed: 0, errors: [] as Array<{ userId: string; error: string }> };

    try {
      const identifiers = await this.wheelGameService.getAllPendingBetIdentifiers();

      this.logger.log(
        `[WHEEL_PROCESS_PENDING] Found ${identifiers.length} pending bets for roundId=${roundId}`,
      );

      for (const identifier of identifiers) {
        const [userId, ...rest] = identifier.split(':');
        const playerGameId = rest.join(':');

        try {
          const pendingBet = await this.wheelGameService.getPendingBet(userId, playerGameId);
          if (!pendingBet) {
            await this.wheelGameService.removePendingBet(userId, playerGameId);
            continue;
          }

          const betAmount = parseFloat(pendingBet.betAmount);
          if (isNaN(betAmount) || betAmount <= 0) {
            await this.wheelGameService.removePendingBet(userId, playerGameId);
            result.failed++;
            result.errors.push({ userId, error: 'Invalid bet amount' });
            continue;
          }

          // Create DB record
          await this.betService.createPlacement({
            externalPlatformTxId: pendingBet.platformTxId,
            userId: pendingBet.userId,
            roundId: String(roundId),
            gameMetadata: { color: pendingBet.color, playerGameId },
            betAmount: pendingBet.betAmount,
            currency: pendingBet.currency,
            gameCode: pendingBet.gameCode,
            isPremium: false,
            betPlacedAt: new Date(pendingBet.queuedAt),
            balanceAfterBet: undefined,
            createdBy: pendingBet.userId,
            operatorId: pendingBet.operatorId,
          });

          // Store bet mapping
          const mappingKey = `wheel:bet:${playerGameId}`;
          await this.redisService.set(mappingKey, pendingBet.platformTxId, 60 * 60 * 24);

          // Add bet to active round
          const betData: WheelBetData = {
            id: `${pendingBet.operatorId}::${pendingBet.userId}`,
            playerGameId,
            placedAt: new Date(pendingBet.queuedAt).toISOString(),
            userId: pendingBet.userId,
            operatorId: pendingBet.operatorId,
            nickname: pendingBet.nickname,
            gameAvatar: pendingBet.gameAvatar,
            betAmount: pendingBet.betAmount,
            color: pendingBet.color,
            currency: pendingBet.currency,
            userAvatar: pendingBet.userAvatar,
          };

          await this.wheelGameService.addBet(betData);
          await this.wheelGameService.removePendingBet(userId, playerGameId);

          result.processed++;
          this.logger.log(
            `[WHEEL_PENDING_PROCESSED] userId=${userId} playerGameId=${playerGameId} color=${pendingBet.color}`,
          );
        } catch (error: any) {
          this.logger.error(
            `[WHEEL_PENDING_ERROR] userId=${userId} error=${error.message}`,
          );
          await this.wheelGameService.removePendingBet(userId, playerGameId);
          result.failed++;
          result.errors.push({ userId, error: error.message });
        }
      }

      this.logger.log(
        `[WHEEL_PROCESS_PENDING] Completed: processed=${result.processed} failed=${result.failed}`,
      );

      return result;
    } catch (error: any) {
      this.logger.error(`[WHEEL_PROCESS_PENDING] Fatal error: ${error.message}`);
      throw error;
    }
  }

  // =============================================
  // SETTLEMENT
  // =============================================

  async settleRound(gameCode: string): Promise<void> {
    const activeRound = this.wheelGameService.getActiveRound();
    if (!activeRound) {
      this.logger.warn('[WHEEL_SETTLE] No active round');
      return;
    }

    const roundId = activeRound.roundId;
    const winningColor = activeRound.cellColor;
    const multiplier = this.wheelGameService.getMultiplierForColor(winningColor);

    this.logger.log(
      `[WHEEL_SETTLE] Settling round ${roundId}: winningColor=${winningColor} multiplier=${multiplier} totalBets=${activeRound.bets.size}`,
    );

    for (const [playerGameId, bet] of activeRound.bets.entries()) {
      try {
        const mappingKey = `wheel:bet:${playerGameId}`;
        const externalPlatformTxId = await this.redisService.get<string>(mappingKey);

        if (!externalPlatformTxId) {
          this.logger.warn(`[WHEEL_SETTLE] No platformTxId for playerGameId=${playerGameId}`);
          continue;
        }

        const betRecord = await this.betService.getByExternalTxId(externalPlatformTxId, gameCode);
        if (!betRecord) {
          this.logger.warn(`[WHEEL_SETTLE] No bet record for txId=${externalPlatformTxId}`);
          continue;
        }

        if (betRecord.status !== BetStatus.PLACED) {
          this.logger.debug(`[WHEEL_SETTLE] Bet already settled: txId=${externalPlatformTxId} status=${betRecord.status}`);
          continue;
        }

        const isWin = bet.color === winningColor;
        const betAmount = parseFloat(bet.betAmount);
        const winAmount = isWin ? betAmount * multiplier : 0;
        const winAmountStr = winAmount.toFixed(2);

        // Record settlement in DB
        await this.betService.recordSettlement({
          externalPlatformTxId,
          winAmount: winAmountStr,
          settleType: isWin ? 'win' : 'loss',
          settledAt: new Date(),
          updatedBy: 'system',
          withdrawCoeff: isWin ? String(multiplier) : '0',
          finalCoeff: String(multiplier),
        });

        // Settle with wallet
        await this.walletService.settleBet({
          agentId: bet.operatorId,
          userId: bet.userId,
          platformTxId: externalPlatformTxId,
          winAmount,
          roundId: String(roundId),
          betAmount,
          gameCode,
        });

        // Clean up Redis mapping
        await this.redisService.del(mappingKey);

        this.logger.log(
          `[WHEEL_SETTLE] ${isWin ? 'WIN' : 'LOSS'}: userId=${bet.userId} playerGameId=${playerGameId} color=${bet.color} betAmount=${betAmount} winAmount=${winAmount}`,
        );
      } catch (error: any) {
        this.logger.error(
          `[WHEEL_SETTLE] Error settling bet ${playerGameId}: ${error.message}`,
        );
      }
    }

    this.logger.log(`[WHEEL_SETTLE] Completed settling round ${roundId}`);
  }

  // =============================================
  // BET HISTORY
  // =============================================

  async getUserBetsHistory(userId: string, gameCode: string, limit: number = 100): Promise<any[]> {
    try {
      const bets = await this.betService.listUserBets(userId, gameCode, limit);

      const settledBets = bets.filter(
        (bet) => bet.status === BetStatus.WON || bet.status === BetStatus.LOST,
      );

      const betHistory = settledBets.map((bet) => {
        const gameMetadata = bet.gameMetadata || {};
        return {
          id: bet.id,
          createdAt: bet.createdAt.toISOString(),
          gameId: parseInt(bet.roundId) || 0,
          color: gameMetadata.color || 'UNKNOWN',
          betAmount: parseFloat(bet.betAmount),
          win: bet.winAmount ? parseFloat(bet.winAmount) : 0,
          withdrawCoeff: bet.withdrawCoeff ? parseFloat(bet.withdrawCoeff) : 0,
          operatorId: bet.operatorId,
          userId: bet.userId,
          currency: bet.currency,
        };
      });

      this.logger.log(
        `[WHEEL_BET_HISTORY] user=${userId} found ${betHistory.length} bets`,
      );

      return betHistory;
    } catch (error: any) {
      this.logger.error(`[WHEEL_BET_HISTORY] Error: ${error.message}`);
      throw error;
    }
  }
}
