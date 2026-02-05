import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { v4 as uuidv4 } from 'uuid';
import { BetService } from '@games-vector/game-core';
import { WalletService } from '@games-vector/game-core';

import { BetPayloadDto, CoinChoice, PlayMode } from './DTO/bet-payload.dto';
import { StepPayloadDto } from './DTO/step-payload.dto';
import { CoinFlipFairnessService } from './modules/fairness/fairness.service';
import { RedisService } from '../../modules/redis/redis.service';
import { CoinFlipGameSession, CoinFlipGameStateResponse } from './interfaces/game-session.interface';
import { COINFLIP_CONSTANTS, MULTIPLIERS } from './constants/coinflip.constants';
import { DEFAULTS } from '../../config/defaults.config';

// Combine platform and game-specific error messages
const ERROR_MESSAGES = {
  ...DEFAULTS.PLATFORM.ERROR_MESSAGES,
  ...DEFAULTS.GAMES.COINFLIP.ERROR_MESSAGES,
};

@Injectable()
export class CoinFlipGameService {
  private readonly logger = new Logger(CoinFlipGameService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly walletService: WalletService,
    private readonly betService: BetService,
    private readonly fairnessService: CoinFlipFairnessService,
  ) {}

  /**
   * Get game configuration
   */
  getGameConfig(): {
    betConfig: typeof DEFAULTS.GAMES.COINFLIP.BET_CONFIG;
    multipliers: typeof MULTIPLIERS;
    maxRounds: number;
    baseMultiplier: number;
  } {
    return {
      betConfig: DEFAULTS.GAMES.COINFLIP.BET_CONFIG,
      multipliers: MULTIPLIERS,
      maxRounds: COINFLIP_CONSTANTS.MAX_ROUNDS,
      baseMultiplier: COINFLIP_CONSTANTS.BASE_MULTIPLIER,
    };
  }

  /**
   * Get game config payload for connection (betConfig, lastWin).
   * Aligns with chicken-road: allows DB/config override in future via GameConfigModule.
   */
  async getGameConfigPayload(gameCode: string): Promise<{
    betConfig: Record<string, any>;
    coefficients: Record<string, any>;
    lastWin: { username: string; winAmount: string; currency: string };
  }> {
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
        currency: defaultLastWin.DEFAULT_CURRENCY,
      },
    };
  }

  /**
   * Get current game state for a user (for reconnection)
   */
  async getGameState(
    userId: string,
    agentId: string,
    gameCode: string,
  ): Promise<CoinFlipGameStateResponse | null> {
    const session = await this.getSession(userId, agentId, gameCode);

    if (!session || !session.isActive) {
      return null;
    }

    return this.buildGameStateResponse(session, false);
  }

  /**
   * Perform bet flow - handles both QUICK and ROUNDS mode
   */
  async performBetFlow(
    userId: string,
    agentId: string,
    gameCode: string,
    incoming: any,
  ): Promise<CoinFlipGameStateResponse | { error: string; details?: any[] }> {
    // Acquire distributed lock to prevent concurrent bet placement
    const lockKey = `coinflip:bet-lock:${userId}-${agentId}`;
    const lockAcquired = await this.redisService.acquireLock(lockKey, 30);

    if (!lockAcquired) {
      this.logger.warn(
        `Concurrent bet placement attempt blocked: user=${userId} agent=${agentId}`,
      );
      return { error: ERROR_MESSAGES.ACTIVE_SESSION_EXISTS };
    }

    try {
      // Check for existing active session
      const existingSession = await this.getSession(userId, agentId, gameCode);
      if (existingSession && existingSession.isActive) {
        this.logger.warn(
          `User ${userId} attempted to place bet while having active session`,
        );
        return { error: ERROR_MESSAGES.ACTIVE_SESSION_EXISTS };
      }

      // Validate DTO
      const dto = plainToInstance(BetPayloadDto, incoming);
      const errors = await validate(dto, { whitelist: true });
      if (errors.length) {
        return {
          error: ERROR_MESSAGES.VALIDATION_FAILED,
          details: errors.map((e) => Object.values(e.constraints || {})),
        };
      }

      // Validate bet amount
      const betNumber = parseFloat(dto.betAmount);
      if (!isFinite(betNumber) || betNumber <= 0) {
        this.logger.warn(
          `Invalid bet amount: user=${userId} amount=${dto.betAmount}`,
        );
        return { error: ERROR_MESSAGES.INVALID_BET_AMOUNT };
      }
      const betAmountStr = betNumber.toFixed(COINFLIP_CONSTANTS.DECIMAL_PLACES);

      // Validate play mode
      if (!COINFLIP_CONSTANTS.PLAY_MODES.includes(dto.playMode as any)) {
        return { error: ERROR_MESSAGES.INVALID_PLAY_MODE };
      }

      // Validate choice for QUICK mode
      if (dto.playMode === PlayMode.QUICK && !dto.choice) {
        return { error: ERROR_MESSAGES.INVALID_CHOICE };
      }

      const currencyUC = dto.currency.toUpperCase();
      const roundId = `${userId}${Date.now()}`;
      const platformTxId = uuidv4();

      // Check idempotency before wallet API call (align with chicken-road)
      const idempotencyKey = this.redisService.generateIdempotencyKey(
        gameCode,
        userId,
        agentId,
        roundId,
        betAmountStr,
      );
      const idempotencyCheck = await this.redisService.checkIdempotencyKey<{
        platformTxId: string;
        response: CoinFlipGameStateResponse | { error: string; details?: any[] };
        timestamp: number;
      }>(idempotencyKey);

      if (idempotencyCheck.exists && idempotencyCheck.data) {
        this.logger.log(
          `[IDEMPOTENCY] Duplicate bet request: user=${userId} agent=${agentId} roundId=${roundId} amount=${betAmountStr}. Returning stored response.`,
        );
        return idempotencyCheck.data.response;
      }

      this.logger.log(
        `[BET_PLACED] user=${userId} agent=${agentId} amount=${betAmountStr} currency=${currencyUC} playMode=${dto.playMode} roundId=${roundId} txId=${platformTxId}`,
      );

      // Place bet via WalletService
      const agentResult = await this.walletService.placeBet({
        agentId,
        userId,
        amount: betNumber,
        roundId,
        platformTxId,
        currency: currencyUC,
        gameCode,
      });

      if (agentResult.status !== '0000') {
        this.logger.error(
          `Agent rejected bet: user=${userId} agent=${agentId} status=${agentResult.status} amount=${betAmountStr}`,
        );
        return { error: ERROR_MESSAGES.AGENT_REJECTED };
      }

      const { balance, balanceTs } = agentResult;

      // Record bet placement in database
      try {
        await this.betService.createPlacement({
          externalPlatformTxId: platformTxId,
          userId,
          roundId,
          gameMetadata: {
            playMode: dto.playMode,
            choice: dto.choice,
          },
          betAmount: betAmountStr,
          currency: currencyUC,
          gameCode,
          isPremium: false,
          betPlacedAt: balanceTs ? new Date(balanceTs) : undefined,
          balanceAfterBet: balance ? String(balance) : undefined,
          createdBy: userId,
          operatorId: agentId,
        });
      } catch (dbError) {
        this.logger.error(
          `[COMPENSATING_TX] DB write failed after wallet deduction: user=${userId} txId=${platformTxId} error=${(dbError as Error).message}`,
        );
        // Attempt refund
        try {
          await this.walletService.refundBet({
            agentId,
            userId,
            refundTransactions: [{
              platformTxId,
              refundPlatformTxId: platformTxId,
              betAmount: betNumber,
              winAmount: 0,
              turnover: 0,
              betTime: balanceTs ? new Date(balanceTs).toISOString() : new Date().toISOString(),
              updateTime: new Date().toISOString(),
              roundId,
              gameCode,
            }],
          });
        } catch (refundError) {
          this.logger.error(
            `[COMPENSATING_TX] CRITICAL: Refund failed: user=${userId} txId=${platformTxId}`,
          );
          return {
            error:
              'Bet placement failed. A refund was attempted but could not be completed. Please contact support with transaction ID: ' +
              platformTxId,
          };
        }
        return { error: 'Bet placement failed. Your balance has been refunded. Please try again.' };
      }

      // Get fairness data
      const fairnessData = await this.fairnessService.getOrCreateFairness(userId, agentId);

      // Handle QUICK mode - instant result
      if (dto.playMode === PlayMode.QUICK) {
        const quickResponse = await this.handleQuickMode(
          userId,
          agentId,
          gameCode,
          dto,
          betNumber,
          currencyUC,
          platformTxId,
          roundId,
          fairnessData,
        );
        await this.redisService.setIdempotencyKey(idempotencyKey, {
          platformTxId,
          response: quickResponse,
          timestamp: Date.now(),
        });
        return quickResponse;
      }

      // Handle ROUNDS mode - create session
      const session: CoinFlipGameSession = {
        userId,
        agentId,
        currency: currencyUC,
        playMode: dto.playMode,
        betAmount: betNumber,
        currentRound: 0,
        choices: [],
        results: [],
        isActive: true,
        isWin: false,
        currentCoeff: '1',
        winAmount: 0,
        platformBetTxId: platformTxId,
        roundId,
        gameCode,
        createdAt: new Date(),
        serverSeed: fairnessData.serverSeed,
        userSeed: fairnessData.userSeed,
        hashedServerSeed: fairnessData.hashedServerSeed,
        nonce: fairnessData.nonce,
      };

      await this.saveSession(session);

      this.logger.log(
        `[ROUNDS_SESSION_CREATED] user=${userId} agent=${agentId} roundId=${roundId}`,
      );

      const roundsResponse = this.buildGameStateResponse(session, false);
      await this.redisService.setIdempotencyKey(idempotencyKey, {
        platformTxId,
        response: roundsResponse,
        timestamp: Date.now(),
      });
      return roundsResponse;

    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  /**
   * Handle QUICK mode bet - immediate result
   */
  private async handleQuickMode(
    userId: string,
    agentId: string,
    gameCode: string,
    dto: BetPayloadDto,
    betAmount: number,
    currency: string,
    platformTxId: string,
    roundId: string,
    fairnessData: any,
  ): Promise<CoinFlipGameStateResponse | { error: string }> {
    // Generate result
    const result = this.fairnessService.generateCoinFlipResult(
      fairnessData.serverSeed,
      fairnessData.userSeed,
      fairnessData.nonce,
    );

    const isWin = result === dto.choice;
    const winAmount = isWin ? betAmount * COINFLIP_CONSTANTS.BASE_MULTIPLIER : 0;

    this.logger.log(
      `[QUICK_RESULT] user=${userId} choice=${dto.choice} result=${result} isWin=${isWin} winAmount=${winAmount}`,
    );

    // Settle bet
    try {
      const settleResult = await this.walletService.settleBet({
        agentId,
        platformTxId,
        userId,
        winAmount,
        roundId,
        betAmount,
        gameCode,
        gameSession: { playMode: PlayMode.QUICK, choice: dto.choice, result },
      });

      // Record settlement in database
      const fairnessProof = this.fairnessService.generateFairnessDataForBet(
        fairnessData.userSeed,
        fairnessData.serverSeed,
        fairnessData.nonce,
      );

      await this.betService.recordSettlement({
        externalPlatformTxId: platformTxId,
        winAmount: winAmount.toFixed(COINFLIP_CONSTANTS.DECIMAL_PLACES),
        settledAt: new Date(),
        balanceAfterSettlement: settleResult.balance ? String(settleResult.balance) : undefined,
        updatedBy: userId,
        finalCoeff: isWin ? COINFLIP_CONSTANTS.BASE_MULTIPLIER.toString() : '0',
        withdrawCoeff: isWin ? COINFLIP_CONSTANTS.BASE_MULTIPLIER.toString() : '0',
        fairnessData: fairnessProof,
      });

      // Rotate seeds
      await this.fairnessService.rotateSeeds(userId, agentId);

    } catch (error: any) {
      this.logger.error(
        `Settlement failed for QUICK mode: user=${userId} txId=${platformTxId}`,
        error,
      );
      throw new Error(ERROR_MESSAGES.SETTLEMENT_FAILED);
    }

    return {
      isFinished: true,
      isWin,
      currency,
      betAmount: betAmount.toFixed(COINFLIP_CONSTANTS.DECIMAL_PLACES),
      coeff: COINFLIP_CONSTANTS.BASE_MULTIPLIER.toString(),
      choices: [dto.choice!],
      roundNumber: 0,
      playMode: PlayMode.QUICK,
      winAmount: winAmount.toFixed(COINFLIP_CONSTANTS.DECIMAL_PLACES),
    };
  }

  /**
   * Perform step flow for ROUNDS mode
   */
  async performStepFlow(
    userId: string,
    agentId: string,
    gameCode: string,
    incoming: any,
  ): Promise<CoinFlipGameStateResponse | { error: string }> {
    const session = await this.getSession(userId, agentId, gameCode);

    if (!session || !session.isActive) {
      this.logger.warn(
        `No active session for step: user=${userId} agent=${agentId}`,
      );
      return { error: ERROR_MESSAGES.NO_ACTIVE_SESSION };
    }

    // Validate step payload
    const dto = plainToInstance(StepPayloadDto, incoming);
    const errors = await validate(dto, { whitelist: true });
    if (errors.length) {
      return { error: ERROR_MESSAGES.VALIDATION_FAILED };
    }

    // Validate round number (should be currentRound + 1)
    const expectedRound = session.currentRound + 1;
    if (dto.roundNumber !== expectedRound) {
      this.logger.warn(
        `Invalid round number: user=${userId} expected=${expectedRound} received=${dto.roundNumber}`,
      );
      return { error: ERROR_MESSAGES.INVALID_ROUND_NUMBER };
    }

    // Validate choice
    if (!COINFLIP_CONSTANTS.CHOICES.includes(dto.choice as any)) {
      return { error: ERROR_MESSAGES.INVALID_CHOICE };
    }

    // Generate result using current nonce
    const currentNonce = (session.nonce || 0) + session.currentRound;
    const result = this.fairnessService.generateCoinFlipResult(
      session.serverSeed!,
      session.userSeed!,
      currentNonce,
    );

    const isWin = result === dto.choice;

    // Update session
    session.choices.push(dto.choice);
    session.results.push(result);
    session.currentRound = dto.roundNumber;

    this.logger.log(
      `[STEP_RESULT] user=${userId} round=${dto.roundNumber} choice=${dto.choice} result=${result} isWin=${isWin}`,
    );

    if (!isWin) {
      // Player lost - settle with 0 winnings
      session.isActive = false;
      session.isWin = false;
      session.winAmount = 0;

      try {
        const settleResult = await this.walletService.settleBet({
          agentId: session.agentId,
          platformTxId: session.platformBetTxId,
          userId,
          winAmount: 0,
          roundId: session.roundId,
          betAmount: session.betAmount,
          gameCode,
          gameSession: session,
        });

        const fairnessProof = this.fairnessService.generateFairnessDataForBet(
          session.userSeed!,
          session.serverSeed!,
          (session.nonce ?? 0) + session.currentRound - 1,
        );

        await this.betService.recordSettlement({
          externalPlatformTxId: session.platformBetTxId,
          winAmount: '0',
          settledAt: new Date(),
          balanceAfterSettlement: settleResult.balance ? String(settleResult.balance) : undefined,
          updatedBy: userId,
          finalCoeff: '0',
          withdrawCoeff: '0',
          fairnessData: fairnessProof,
        });

        await this.fairnessService.rotateSeeds(userId, agentId);
        await this.deleteSession(userId, agentId, gameCode);

      } catch (error: any) {
        this.logger.error(
          `Settlement failed for STEP (loss): user=${userId} txId=${session.platformBetTxId}`,
          error,
        );
        throw new Error(ERROR_MESSAGES.SETTLEMENT_FAILED);
      }

      return this.buildGameStateResponse(session, true, 0);
    }

    // Player won this round
    session.isWin = true;
    const multiplierIndex = session.currentRound - 1; // 0-indexed
    session.currentCoeff = MULTIPLIERS[multiplierIndex];
    session.winAmount = session.betAmount * parseFloat(session.currentCoeff);

    // Check if max rounds reached (round 20)
    if (session.currentRound >= COINFLIP_CONSTANTS.MAX_ROUNDS) {
      // Auto-settle at max rounds
      session.isActive = false;

      try {
        const settleResult = await this.walletService.settleBet({
          agentId: session.agentId,
          platformTxId: session.platformBetTxId,
          userId,
          winAmount: session.winAmount,
          roundId: session.roundId,
          betAmount: session.betAmount,
          gameCode,
          gameSession: session,
        });

        const fairnessProof = this.fairnessService.generateFairnessDataForBet(
          session.userSeed!,
          session.serverSeed!,
          (session.nonce ?? 0) + session.currentRound - 1,
        );

        await this.betService.recordSettlement({
          externalPlatformTxId: session.platformBetTxId,
          winAmount: session.winAmount.toFixed(COINFLIP_CONSTANTS.DECIMAL_PLACES),
          settledAt: new Date(),
          balanceAfterSettlement: settleResult.balance ? String(settleResult.balance) : undefined,
          updatedBy: userId,
          finalCoeff: session.currentCoeff,
          withdrawCoeff: session.currentCoeff,
          fairnessData: fairnessProof,
        });

        await this.fairnessService.rotateSeeds(userId, agentId);
        await this.deleteSession(userId, agentId, gameCode);

        this.logger.log(
          `[MAX_ROUNDS_WIN] user=${userId} round=${session.currentRound} winAmount=${session.winAmount}`,
        );

      } catch (error: any) {
        this.logger.error(
          `Settlement failed for STEP (max win): user=${userId} txId=${session.platformBetTxId}`,
          error,
        );
        throw new Error(ERROR_MESSAGES.SETTLEMENT_FAILED);
      }

      return this.buildGameStateResponse(session, true, session.winAmount);
    }

    // Continue game - save session
    await this.saveSession(session);

    return this.buildGameStateResponse(session, false);
  }

  /**
   * Perform cash out flow
   */
  async performCashOutFlow(
    userId: string,
    agentId: string,
    gameCode: string,
  ): Promise<CoinFlipGameStateResponse | { error: string }> {
    const session = await this.getSession(userId, agentId, gameCode);

    if (!session || !session.isActive) {
      this.logger.warn(
        `No active session for cashout: user=${userId} agent=${agentId}`,
      );
      return { error: ERROR_MESSAGES.NO_ACTIVE_SESSION };
    }

    // Can only cashout if at least one round won
    if (session.currentRound < 1 || !session.isWin) {
      return { error: ERROR_MESSAGES.CASHOUT_FAILED };
    }

    session.isActive = false;
    const winAmount = session.winAmount;

    this.logger.log(
      `[CASHOUT] user=${userId} round=${session.currentRound} coeff=${session.currentCoeff} winAmount=${winAmount}`,
    );

    try {
      const settleResult = await this.walletService.settleBet({
        agentId: session.agentId,
        platformTxId: session.platformBetTxId,
        userId,
        winAmount,
        roundId: session.roundId,
        betAmount: session.betAmount,
        gameCode,
        gameSession: session,
      });

      const fairnessProof = this.fairnessService.generateFairnessDataForBet(
        session.userSeed!,
        session.serverSeed!,
        (session.nonce ?? 0) + session.currentRound - 1,
      );

      await this.betService.recordSettlement({
        externalPlatformTxId: session.platformBetTxId,
        winAmount: winAmount.toFixed(COINFLIP_CONSTANTS.DECIMAL_PLACES),
        settledAt: new Date(),
        balanceAfterSettlement: settleResult.balance ? String(settleResult.balance) : undefined,
        updatedBy: userId,
        finalCoeff: session.currentCoeff,
        withdrawCoeff: session.currentCoeff,
        fairnessData: fairnessProof,
      });

      await this.fairnessService.rotateSeeds(userId, agentId);
      await this.deleteSession(userId, agentId, gameCode);

    } catch (error: any) {
      this.logger.error(
        `Cashout settlement failed: user=${userId} txId=${session.platformBetTxId}`,
        error,
      );
      throw new Error(ERROR_MESSAGES.SETTLEMENT_FAILED);
    }

    return this.buildGameStateResponse(session, true, winAmount);
  }

  /**
   * Get game seeds for a user
   */
  async getGameSeeds(
    userId: string,
    agentId: string,
  ): Promise<{
    userSeed: string;
    hashedServerSeed: string;
    nonce: string;
  }> {
    const fairnessData = await this.fairnessService.getOrCreateFairness(userId, agentId);

    return {
      userSeed: fairnessData.userSeed,
      hashedServerSeed: fairnessData.hashedServerSeed,
      nonce: fairnessData.nonce.toString(),
    };
  }

  /**
   * Set user seed
   */
  async setUserSeed(
    userId: string,
    agentId: string,
    userSeed: string,
  ): Promise<{ success: boolean; userSeed: string }> {
    const fairnessData = await this.fairnessService.setUserSeed(userId, agentId, userSeed);

    return {
      success: true,
      userSeed: fairnessData.userSeed,
    };
  }

  /**
   * Get bet history for user
   */
  async getMyBetsHistory(
    userId: string,
    agentId: string,
    gameCode?: string,
  ): Promise<any[]> {
    const lastWeek = new Date(
      Date.now() - DEFAULTS.GAMES.COINFLIP.GAME.BET_HISTORY_DAYS * 24 * 60 * 60 * 1000,
    );

    const bets = await this.betService.listUserBetsByTimeRange(
      userId,
      lastWeek,
      new Date(),
      gameCode,
      DEFAULTS.GAMES.COINFLIP.GAME.BET_HISTORY_LIMIT,
    );

    return bets.map((bet) => {
      const betAmount = parseFloat(bet.betAmount || '0');
      const winAmount = parseFloat(bet.winAmount || '0');
      const withdrawCoeff = bet.withdrawCoeff
        ? parseFloat(bet.withdrawCoeff)
        : (betAmount > 0 && winAmount > 0 ? winAmount / betAmount : 0);
      const gameMetaCoeff = bet.finalCoeff
        ? bet.finalCoeff
        : (betAmount > 0 && winAmount > 0 ? (winAmount / betAmount).toFixed(2) : '0');
      // Fallback fairness when missing (align with chicken-road)
      const fairness = bet.fairnessData ?? {
        decimal: '',
        clientSeed: '',
        serverSeed: '',
        combinedHash: '',
        hashedServerSeed: '',
        nonce: 0,
      };

      return {
        id: bet.id,
        createdAt: bet.createdAt.toISOString(),
        gameId: 0,
        finishCoeff: 0,
        fairness,
        betAmount,
        win: winAmount,
        withdrawCoeff,
        operatorId: bet.operatorId || agentId,
        userId: bet.userId,
        currency: bet.currency,
        gameMeta: {
          coeff: gameMetaCoeff,
          playMode: bet.gameMetadata?.playMode,
        },
      };
    });
  }

  /**
   * Get currencies (placeholder - should be fetched from config)
   */
  async getCurrencies(): Promise<Record<string, number>> {
    return {
      INR: 1,
      USD: 0.012,
      EUR: 0.011,
      // Add more as needed
    };
  }

  // ==================== Helper Methods ====================

  private getRedisKey(userId: string, agentId: string, gameCode: string): string {
    return `${DEFAULTS.GAMES.COINFLIP.REDIS_KEY}${userId}-${agentId}-${gameCode}`;
  }

  private async getSession(
    userId: string,
    agentId: string,
    gameCode: string,
  ): Promise<CoinFlipGameSession | null> {
    const key = this.getRedisKey(userId, agentId, gameCode);
    return await this.redisService.get<CoinFlipGameSession>(key);
  }

  private async saveSession(session: CoinFlipGameSession): Promise<void> {
    const key = this.getRedisKey(session.userId, session.agentId, session.gameCode);
    const ttl = await this.redisService.getSessionTTL(session.gameCode);
    await this.redisService.set(key, session, ttl);
  }

  private async deleteSession(
    userId: string,
    agentId: string,
    gameCode: string,
  ): Promise<void> {
    const key = this.getRedisKey(userId, agentId, gameCode);
    await this.redisService.del(key);
  }

  private buildGameStateResponse(
    session: CoinFlipGameSession,
    isFinished: boolean,
    winAmount?: number,
  ): CoinFlipGameStateResponse {
    const response: CoinFlipGameStateResponse = {
      isFinished,
      isWin: session.isWin,
      currency: session.currency,
      betAmount: session.betAmount.toFixed(COINFLIP_CONSTANTS.DECIMAL_PLACES),
      choices: session.choices,
      roundNumber: session.currentRound,
      playMode: session.playMode,
    };

    if (session.currentRound > 0 && session.isWin) {
      response.coeff = session.currentCoeff;
    }

    if (isFinished && winAmount !== undefined) {
      response.winAmount = winAmount.toFixed(COINFLIP_CONSTANTS.DECIMAL_PLACES);
    }

    return response;
  }
}
