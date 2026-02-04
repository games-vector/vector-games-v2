import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { v4 as uuidv4 } from 'uuid';
import { BetService, WalletService } from '@games-vector/game-core';
import { BetPayloadDto, Risk } from './DTO/bet-payload.dto';
import { RngService } from './modules/rng/rng.service';
import { PayoutService } from './modules/payout/payout.service';
import { RedisService } from '../../modules/redis/redis.service';
import { GameConfigService } from '../../modules/game-config/game-config.service';
import { DEFAULTS } from '../../config/defaults.config';

// Game constants
const GAME_CONSTANTS = {
  GRID_SIZE: 40,
  MIN_SELECTION: 1,
  MAX_SELECTION: 10,
  NUMBERS_DRAWN: 10,
  DECIMAL_PLACES: 2,
  BET_HISTORY_LIMIT: 30,
  BET_HISTORY_DAYS: 7,
  GAME_CODE: 'keno',
} as const;

// Error messages
const ERROR_MESSAGES = {
  ...DEFAULTS.PLATFORM.ERROR_MESSAGES,
  INVALID_SELECTION_COUNT: 'invalid_selection_count',
  INVALID_NUMBER_RANGE: 'invalid_number_range',
  DUPLICATE_NUMBERS: 'duplicate_numbers',
  INVALID_RISK_LEVEL: 'invalid_risk_level',
  VALIDATION_FAILED: 'validation_failed',
  INVALID_BET_AMOUNT: 'invalid_bet_amount',
  AGENT_REJECTED: 'agent_rejected',
  BET_PLACEMENT_FAILED: 'bet_placement_failed',
} as const;

export interface KenoBetResponse {
  winAmount: string;
  currency: string;
  risk: string;
  chosenNumbers: number[];
  kenoNumbers: number[];
}

export interface FairnessData {
  userSeed: string;
  serverSeed: string;
  hashedServerSeed: string;
  nonce: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class KenoGameService {
  private readonly logger = new Logger(KenoGameService.name);
  private readonly FAIRNESS_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

  constructor(
    private readonly redisService: RedisService,
    private readonly walletService: WalletService,
    private readonly betService: BetService,
    private readonly rngService: RngService,
    private readonly payoutService: PayoutService,
    private readonly gameConfigService: GameConfigService,
  ) {}

  /**
   * Main bet flow for Keno game
   * 1. Validate bet parameters
   * 2. Deduct balance
   * 3. Generate drawn numbers
   * 4. Calculate hits and payout
   * 5. Credit winnings (if any)
   * 6. Record bet
   * 7. Return result
   */
  async performBetFlow(
    userId: string,
    agentId: string,
    gameCode: string,
    incoming: any,
  ): Promise<KenoBetResponse | { error: string; details?: any[] }> {
    // Acquire distributed lock to prevent concurrent bet placement
    const lockKey = `bet-lock:keno:${userId}-${agentId}`;
    const lockAcquired = await this.redisService.acquireLock(lockKey, 30);

    if (!lockAcquired) {
      this.logger.warn(
        `Concurrent bet placement attempt blocked: user=${userId} agent=${agentId}`,
      );
      return { error: ERROR_MESSAGES.ACTIVE_SESSION_EXISTS };
    }

    try {
      // 1. Validate input
      const dto = plainToInstance(BetPayloadDto, incoming);
      const errors = await validate(dto, { whitelist: true });
      if (errors.length) {
        return {
          error: ERROR_MESSAGES.VALIDATION_FAILED,
          details: errors.map((e) => Object.values(e.constraints || {})),
        };
      }

      // Additional validations
      const validationError = this.validateBetPayload(dto);
      if (validationError) {
        return { error: validationError };
      }

      const betNumber = parseFloat(dto.betAmount);
      if (!isFinite(betNumber) || betNumber <= 0) {
        this.logger.warn(
          `Invalid bet amount: user=${userId} amount=${dto.betAmount}`,
        );
        return { error: ERROR_MESSAGES.INVALID_BET_AMOUNT };
      }

      const betAmountStr = betNumber.toFixed(GAME_CONSTANTS.DECIMAL_PLACES);
      const currencyUC = dto.currency.toUpperCase();
      const roundId = `${userId}${Date.now()}`;
      const platformTxId = uuidv4();

      // Check idempotency
      const idempotencyKey = this.redisService.generateIdempotencyKey(
        gameCode,
        userId,
        agentId,
        roundId,
        betAmountStr,
      );
      const idempotencyCheck = await this.redisService.checkIdempotencyKey<{
        response: KenoBetResponse;
        timestamp: number;
      }>(idempotencyKey);

      if (idempotencyCheck.exists && idempotencyCheck.data) {
        this.logger.log(
          `[IDEMPOTENCY] Duplicate bet request detected: user=${userId}. Returning stored response.`,
        );
        return idempotencyCheck.data.response;
      }

      this.logger.log(
        `[KENO_BET] user=${userId} agent=${agentId} amount=${betAmountStr} currency=${currencyUC} risk=${dto.risk} selections=${dto.chosenNumbers.length} numbers=[${dto.chosenNumbers.join(',')}]`,
      );

      // 2. Place bet (deduct balance)
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
          `Agent rejected bet: user=${userId} agent=${agentId} status=${agentResult.status}`,
        );
        return { error: ERROR_MESSAGES.AGENT_REJECTED };
      }

      const { balance, balanceTs } = agentResult;

      // 3. Get fairness seeds and generate drawn numbers
      const fairnessData = await this.getOrCreateFairness(userId, agentId);
      const kenoNumbers = this.rngService.generateKenoNumbers(
        fairnessData.serverSeed,
        fairnessData.userSeed,
        fairnessData.nonce,
      );

      // 4. Calculate payout
      const payoutResult = this.payoutService.calculatePayout(
        dto.chosenNumbers,
        kenoNumbers,
        betNumber,
        dto.risk,
      );

      const winAmountStr = payoutResult.winAmount.toFixed(
        GAME_CONSTANTS.DECIMAL_PLACES,
      );

      this.logger.log(
        `[KENO_RESULT] user=${userId} drawn=[${kenoNumbers.join(',')}] hits=[${payoutResult.hits.join(',')}] hitCount=${payoutResult.hitCount} multiplier=${payoutResult.multiplier} win=${winAmountStr}`,
      );

      // 5. Create bet record
      try {
        await this.betService.createPlacement({
          externalPlatformTxId: platformTxId,
          userId,
          roundId,
          gameMetadata: {
            risk: dto.risk,
            chosenNumbers: dto.chosenNumbers,
            kenoNumbers: kenoNumbers,
            coeff: payoutResult.multiplier.toString(),
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
        // DB write failed - refund user
        this.logger.error(
          `[COMPENSATING_TX] DB write failed after wallet deduction: user=${userId} txId=${platformTxId}. Initiating refund.`,
          (dbError as Error).stack,
        );

        try {
          const refundResult = await this.walletService.refundBet({
            agentId,
            userId,
            refundTransactions: [
              {
                platformTxId,
                refundPlatformTxId: platformTxId,
                betAmount: betNumber,
                winAmount: 0,
                turnover: 0,
                betTime: balanceTs
                  ? new Date(balanceTs).toISOString()
                  : new Date().toISOString(),
                updateTime: new Date().toISOString(),
                roundId,
                gameCode,
              },
            ],
          });

          if (refundResult.status !== '0000') {
            this.logger.error(
              `[COMPENSATING_TX] CRITICAL: Refund failed: user=${userId} txId=${platformTxId}. Manual intervention required!`,
            );
          }
        } catch (refundError) {
          this.logger.error(
            `[COMPENSATING_TX] CRITICAL: Refund attempt failed: user=${userId} txId=${platformTxId}`,
            (refundError as Error).stack,
          );
        }

        return { error: ERROR_MESSAGES.BET_PLACEMENT_FAILED };
      }

      // 6. Settle bet (credit winnings)
      try {
        const settleResult = await this.walletService.settleBet({
          agentId,
          platformTxId,
          userId,
          winAmount: payoutResult.winAmount,
          roundId,
          betAmount: betNumber,
          gameCode,
        });

        this.logger.log(
          `[KENO_SETTLE] user=${userId} txId=${platformTxId} winAmount=${winAmountStr} newBalance=${settleResult.balance}`,
        );

        // Generate fairness data for bet history
        const fairnessDataForBet = this.generateFairnessDataForBet(
          fairnessData.userSeed,
          fairnessData.serverSeed,
        );

        // Record settlement
        const withdrawCoeff =
          betNumber > 0 && payoutResult.winAmount > 0
            ? (payoutResult.winAmount / betNumber).toFixed(3)
            : '0';

        await this.betService.recordSettlement({
          externalPlatformTxId: platformTxId,
          winAmount: winAmountStr,
          settledAt: new Date(),
          balanceAfterSettlement: settleResult.balance
            ? String(settleResult.balance)
            : undefined,
          updatedBy: userId,
          finalCoeff: payoutResult.multiplier.toString(),
          withdrawCoeff,
          fairnessData: fairnessDataForBet,
        });

        // Rotate seeds after bet
        await this.rotateSeeds(userId, agentId);
      } catch (settleError) {
        this.logger.error(
          `[KENO_SETTLE_ERROR] Settlement failed: user=${userId} txId=${platformTxId}`,
          (settleError as Error).stack,
        );
        // Don't throw - bet is placed, settlement will be retried
      }

      // 7. Build response
      const response: KenoBetResponse = {
        winAmount: winAmountStr,
        currency: currencyUC,
        risk: dto.risk,
        chosenNumbers: dto.chosenNumbers,
        kenoNumbers: kenoNumbers,
      };

      // Store idempotency key
      await this.redisService.setIdempotencyKey(idempotencyKey, {
        response,
        timestamp: Date.now(),
      });

      return response;
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  /**
   * Validate bet payload beyond DTO validation
   */
  private validateBetPayload(dto: BetPayloadDto): string | null {
    // Check selection count
    if (
      dto.chosenNumbers.length < GAME_CONSTANTS.MIN_SELECTION ||
      dto.chosenNumbers.length > GAME_CONSTANTS.MAX_SELECTION
    ) {
      return ERROR_MESSAGES.INVALID_SELECTION_COUNT;
    }

    // Check number range (1-40)
    for (const num of dto.chosenNumbers) {
      if (num < 1 || num > GAME_CONSTANTS.GRID_SIZE) {
        return ERROR_MESSAGES.INVALID_NUMBER_RANGE;
      }
    }

    // Check for duplicates
    const uniqueNumbers = new Set(dto.chosenNumbers);
    if (uniqueNumbers.size !== dto.chosenNumbers.length) {
      return ERROR_MESSAGES.DUPLICATE_NUMBERS;
    }

    // Check risk level
    if (!Object.values(Risk).includes(dto.risk)) {
      return ERROR_MESSAGES.INVALID_RISK_LEVEL;
    }

    return null;
  }

  /**
   * Get or create fairness data for a user
   */
  async getOrCreateFairness(
    userId: string,
    agentId: string,
  ): Promise<FairnessData> {
    const key = this.getFairnessKey(userId, agentId);
    const existing = await this.redisService.get<FairnessData>(key);

    if (existing) {
      return existing;
    }

    const userSeed = this.rngService.generateClientSeed();
    const serverSeed = this.rngService.generateServerSeed();
    const hashedServerSeed = this.rngService.hashServerSeed(serverSeed);
    const now = new Date();

    const fairnessData: FairnessData = {
      userSeed,
      serverSeed,
      hashedServerSeed,
      nonce: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.redisService.set(key, fairnessData, this.FAIRNESS_TTL);

    this.logger.log(
      `Created new fairness data for user=${userId} agent=${agentId}`,
    );

    return fairnessData;
  }

  /**
   * Get game seeds for user
   */
  async getGameSeeds(
    userId: string,
    agentId: string,
  ): Promise<{
    userSeed: string;
    hashedServerSeed: string;
    nonce: string;
  }> {
    const fairnessData = await this.getOrCreateFairness(userId, agentId);

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
    // Validate user seed format (16 hex characters)
    if (!/^[0-9a-fA-F]{16}$/.test(userSeed)) {
      throw new Error(
        'Invalid user seed format. Must be 16 hexadecimal characters.',
      );
    }

    const key = this.getFairnessKey(userId, agentId);
    const existing = await this.getOrCreateFairness(userId, agentId);

    const updated: FairnessData = {
      ...existing,
      userSeed: userSeed.toLowerCase(),
      updatedAt: new Date(),
    };

    await this.redisService.set(key, updated, this.FAIRNESS_TTL);

    this.logger.log(`Updated user seed for user=${userId} agent=${agentId}`);

    return {
      success: true,
      userSeed: updated.userSeed,
    };
  }

  /**
   * Rotate seeds after bet
   */
  private async rotateSeeds(
    userId: string,
    agentId: string,
  ): Promise<FairnessData> {
    const key = this.getFairnessKey(userId, agentId);
    const existing = await this.getOrCreateFairness(userId, agentId);

    const newServerSeed = this.rngService.generateServerSeed();
    const newHashedServerSeed = this.rngService.hashServerSeed(newServerSeed);

    const rotated: FairnessData = {
      ...existing,
      serverSeed: newServerSeed,
      hashedServerSeed: newHashedServerSeed,
      nonce: existing.nonce + 1,
      updatedAt: new Date(),
    };

    await this.redisService.set(key, rotated, this.FAIRNESS_TTL);

    this.logger.debug(
      `Rotated seeds for user=${userId} agent=${agentId} newNonce=${rotated.nonce}`,
    );

    return rotated;
  }

  /**
   * Generate fairness data for bet history
   */
  private generateFairnessDataForBet(
    userSeed: string,
    serverSeed: string,
  ): {
    decimal: string;
    clientSeed: string;
    serverSeed: string;
    combinedHash: string;
    hashedServerSeed: string;
  } {
    const combinedHash = this.rngService.calculateCombinedHash(
      userSeed,
      serverSeed,
    );
    const hashedServerSeed = this.rngService.hashServerSeed(serverSeed);
    const decimal = this.rngService.calculateDecimal(combinedHash);

    return {
      decimal,
      clientSeed: userSeed,
      serverSeed,
      combinedHash,
      hashedServerSeed,
    };
  }

  private getFairnessKey(userId: string, agentId: string): string {
    return `fairness:keno:${userId}-${agentId}`;
  }

  /**
   * Get bet history for user
   */
  async getMyBetsHistory(
    userId: string,
    agentId: string,
    gameCode?: string,
  ): Promise<any[]> {
    this.logger.debug(`Fetching bet history: user=${userId} agent=${agentId}`);

    const lastWeek = new Date(
      Date.now() - GAME_CONSTANTS.BET_HISTORY_DAYS * 24 * 60 * 60 * 1000,
    );

    const bets = await this.betService.listUserBetsByTimeRange(
      userId,
      lastWeek,
      new Date(),
      gameCode || GAME_CONSTANTS.GAME_CODE,
      GAME_CONSTANTS.BET_HISTORY_LIMIT,
    );

    return bets.map((bet) => {
      const betAmount = parseFloat(bet.betAmount || '0');
      const winAmount = parseFloat(bet.winAmount || '0');

      const withdrawCoeff = bet.withdrawCoeff
        ? parseFloat(bet.withdrawCoeff)
        : betAmount > 0 && winAmount > 0
          ? winAmount / betAmount
          : 0;

      const gameMetaCoeff = bet.finalCoeff
        ? bet.finalCoeff
        : betAmount > 0 && winAmount > 0
          ? (winAmount / betAmount).toFixed(2)
          : '0';

      const fairness =
        bet.fairnessData ||
        this.generateFairnessDataForBet(
          DEFAULTS.PLATFORM.ERROR_MESSAGES.VALIDATION_FAILED, // fallback
          this.rngService.generateServerSeed(),
        );

      return {
        id: bet.id,
        createdAt: bet.createdAt.toISOString(),
        gameId: 0,
        finishCoeff: 0,
        fairness,
        betAmount: betAmount,
        win: winAmount,
        withdrawCoeff: withdrawCoeff,
        operatorId: bet.operatorId || agentId,
        userId: bet.userId,
        currency: bet.currency,
        gameMeta: {
          risk: bet.gameMetadata?.risk as Risk,
          chosenNumbers: bet.gameMetadata?.chosenNumbers || [],
          kenoNumbers: bet.gameMetadata?.kenoNumbers || [],
          coeff: gameMetaCoeff,
        },
      };
    });
  }

  /**
   * Get game config payload
   */
  async getGameConfigPayload(gameCode: string): Promise<{
    betConfig: Record<string, any>;
    payoutTables: Record<string, any>;
    lastWin: { username: string; winAmount: string; currency: string };
  }> {
    try {
      const betConfigRaw = await this.safeGetConfig(gameCode, 'betConfig');
      const betConfig = this.tryParseJson(betConfigRaw) || {};

      return {
        betConfig,
        payoutTables: this.payoutService.getAllPayoutTables(),
        lastWin: {
          username: 'Lucky Player',
          winAmount: '50.00',
          currency: 'USD',
        },
      };
    } catch (e) {
      this.logger.error(`Failed building game config payload: ${e}`);
      return {
        betConfig: {},
        payoutTables: this.payoutService.getAllPayoutTables(),
        lastWin: {
          username: 'UNKNOWN',
          winAmount: '0',
          currency: 'USD',
        },
      };
    }
  }

  /**
   * Get currencies (exchange rates)
   */
  async getCurrencies(): Promise<Record<string, number>> {
    return {
      USD: 1,
      EUR: 0.8755,
      GBP: 0.7571,
      INR: 87.503,
      BTC: 0.000012050399374548936,
      ETH: 0.00036986204295658424,
      // Add more currencies as needed
    };
  }

  private async safeGetConfig(gameCode: string, key: string): Promise<string> {
    try {
      const raw = await this.gameConfigService.getConfig(gameCode, key);
      return typeof raw === 'string' ? raw : JSON.stringify(raw);
    } catch (e) {
      this.logger.warn(`Config key ${key} not available: ${e}`);
      return '{}';
    }
  }

  private tryParseJson(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}
