import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { GameStatus, GameStateChangePayload, CoefficientChangePayload, BetData, CoefficientHistory, PendingBet } from './DTO/game-state.dto';
import { RedisService } from '../../modules/redis/redis.service';
import { DEFAULTS } from '../../config/defaults.config';
import { GAME_CONSTANTS } from '../../common/game-constants';
import { GameConfigService } from '../../modules/game-config/game-config.service';
import { generateMockBets, scheduleMockBetsCashouts, MockBetsConfig } from '../shared/mock-bets.service';

interface ActiveRound {
  roundId: number;
  gameUUID: string;
  status: GameStatus;
  currentCoeff: number;
  crashCoeff: number | null;
  startTime: number;
  bets: Map<string, BetData>;
  mockBetsCashoutSchedule: Map<string, { playerGameId: string; cashoutCoeff: number }>;
  serverSeed: string;
  clientsSeeds: Array<{
    userId: string;
    seed: string;
    nickname: string;
    gameAvatar: number | null;
  }>;
  combinedHash: string;
  decimal: string;
  isRunning: boolean;
  version?: number;
  lastSavedAt?: number;
}

@Injectable()
export class SugarDaddyGameService {
  private readonly logger = new Logger(SugarDaddyGameService.name);
  private activeRound: ActiveRound | null = null;
  private previousRoundBets: BetData[] = [];
  private roundCounter = 0;
  private pendingMockBets: BetData[] = [];
  private readonly ROUND_DURATION_MS = GAME_CONSTANTS.SUGAR_DADDY.ROUND_DURATION_MS;
  private readonly COEFF_UPDATE_INTERVAL_MS = GAME_CONSTANTS.SUGAR_DADDY.COEFF_UPDATE_INTERVAL_MS;
  private readonly MIN_COEFF = GAME_CONSTANTS.SUGAR_DADDY.MIN_COEFF;
  private readonly MAX_COEFF = GAME_CONSTANTS.SUGAR_DADDY.MAX_COEFF;
  private readonly COEFF_INCREMENT = GAME_CONSTANTS.SUGAR_DADDY.COEFF_INCREMENT;
  private readonly REDIS_KEY_PENDING_BETS = GAME_CONSTANTS.REDIS_KEYS.SUGAR_DADDY_PENDING_BETS;
  private readonly PENDING_BET_TTL = GAME_CONSTANTS.SUGAR_DADDY.PENDING_BET_TTL;
  private readonly REDIS_KEY_COEFFICIENT_HISTORY = GAME_CONSTANTS.REDIS_KEYS.SUGAR_DADDY_COEFFICIENT_HISTORY;
  private readonly REDIS_KEY_CURRENT_STATE = GAME_CONSTANTS.REDIS_KEYS.SUGAR_DADDY_CURRENT_STATE;
  private readonly REDIS_KEY_CURRENT_COEFF = GAME_CONSTANTS.REDIS_KEYS.SUGAR_DADDY_CURRENT_COEFF;
  private readonly REDIS_KEY_ACTIVE_ROUND = GAME_CONSTANTS.REDIS_KEYS.SUGAR_DADDY_ACTIVE_ROUND;
  private readonly REDIS_KEY_PREVIOUS_BETS = GAME_CONSTANTS.REDIS_KEYS.SUGAR_DADDY_PREVIOUS_BETS;
  private readonly REDIS_KEY_LEADER_LOCK = GAME_CONSTANTS.REDIS_KEYS.SUGAR_DADDY_LEADER_LOCK;
  private readonly COEFFICIENT_HISTORY_LIMIT = GAME_CONSTANTS.SUGAR_DADDY.COEFFICIENT_HISTORY_LIMIT;
  private readonly LEADER_LOCK_TTL = GAME_CONSTANTS.SUGAR_DADDY.LEADER_LOCK_TTL;
  private rtp: number | null = null;
  private redisLoadCache: {
    data: ActiveRound | null;
    timestamp: number;
    version: number;
  } = { data: null, timestamp: 0, version: 0 };
  private readonly REDIS_CACHE_TTL_MS = 100;

  constructor(
    private readonly redisService: RedisService,
    private readonly gameConfigService: GameConfigService,
  ) { }

  async startNewRound(): Promise<ActiveRound> {
    if(this.rtp === null) {
      await this.loadRTP('sugar-daddy');
    }

    this.roundCounter++;
    const roundId = Date.now();
    const gameUUID = uuidv4();
    const serverSeed = this.generateServerSeed();

    this.activeRound = {
      roundId,
      gameUUID,
      status: GameStatus.WAIT_GAME,
      currentCoeff: this.MIN_COEFF,
      crashCoeff: null,
      startTime: Date.now(),
      bets: new Map(),
      mockBetsCashoutSchedule: new Map(),
      serverSeed,
      clientsSeeds: [],
      combinedHash: '',
      decimal: '',
      isRunning: false,
      version: 0,
      lastSavedAt: Date.now(),
    };

    this.activeRound.crashCoeff = await this.calculateCrashCoefficient(serverSeed);

    // Generate mock bets using shared service
    const mockBetsConfig: Partial<MockBetsConfig> = {
      currency: 'INR',
    };
    const mockBets = generateMockBets(mockBetsConfig);
    
    // Ensure we have at least 15 mock bets
    if (mockBets.length < 15) {
      const additionalBets = generateMockBets(mockBetsConfig);
      mockBets.push(...additionalBets.slice(0, 15 - mockBets.length));
    }
    
    // Schedule cashouts for mock bets
    if (this.activeRound.crashCoeff && mockBets.length > 0) {
      const cashoutSchedule = scheduleMockBetsCashouts(mockBets, this.activeRound.crashCoeff);
      this.activeRound.mockBetsCashoutSchedule = cashoutSchedule;
    }
    
    this.pendingMockBets = mockBets;

    await this.saveActiveRoundToRedis();

    return this.activeRound;
  }

  async startGame(): Promise<void> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound || this.activeRound.status !== GameStatus.WAIT_GAME) {
      throw new Error('Cannot start game: not in WAIT_GAME state');
    }

    this.activeRound.status = GameStatus.IN_GAME;
    this.activeRound.isRunning = true;
    this.activeRound.startTime = Date.now();
    this.activeRound.currentCoeff = this.MIN_COEFF;

    await this.saveActiveRoundToRedis();
  }

  async getCurrentGameState(): Promise<GameStateChangePayload | null> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return null;
    }

    return await this.buildGameStatePayload();
  }

  async getCurrentCoefficient(): Promise<CoefficientChangePayload | null> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound || !this.activeRound.isRunning) {
      return null;
    }

    return {
      coeff: this.activeRound.currentCoeff,
    };
  }

  async updateCoefficient(): Promise<boolean> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound || !this.activeRound.isRunning) {
      return false;
    }

    const elapsed = Date.now() - this.activeRound.startTime;
    const elapsedSeconds = elapsed / 1000;
    const crashCoeff = this.activeRound.crashCoeff || this.MAX_COEFF;

    const speed = await this.loadCoefficientSpeed('sugar-daddy');

    const newCoeff = Math.min(
      this.MIN_COEFF + (elapsedSeconds * speed),
      crashCoeff,
    );

    this.activeRound.currentCoeff = parseFloat(newCoeff.toFixed(2));

    await this.saveActiveRoundToRedis();
    await this.saveCurrentCoefficientToRedis();

    if (this.activeRound.currentCoeff >= crashCoeff) {
      await this.endRound();
      return false;
    }

    return true;
  }

  /**
   * Check and return bets that should be auto-cashed out
   * Returns array of bets that need auto-cashout processing
   */
  async getAutoCashoutBets(): Promise<Array<{ playerGameId: string; bet: BetData; isMockBet?: boolean }>> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return [];
    }

    const currentCoeff = this.activeRound.currentCoeff;
    const autoCashoutBets: Array<{ playerGameId: string; bet: BetData; isMockBet?: boolean }> = [];

    // Check all bets (real and mock) in the bets Map
    for (const [playerGameId, bet] of this.activeRound.bets.entries()) {
      if (bet.coeffWin && bet.winAmount) {
        continue;
      }

      const isMockBet = bet.userId.startsWith('mock_');

      if (isMockBet) {
        const schedule = this.activeRound.mockBetsCashoutSchedule.get(playerGameId);
        if (schedule) {
          const roundedCurrentCoeff = Math.round(currentCoeff * GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION) / GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION;
          const roundedCashoutCoeff = Math.round(schedule.cashoutCoeff * GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION) / GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION;
          
          if (roundedCurrentCoeff >= roundedCashoutCoeff) {
            this.logger.debug(
              `[AUTO_CASHOUT_CHECK] Mock bet eligible: playerGameId=${playerGameId} currentCoeff=${roundedCurrentCoeff} cashoutCoeff=${roundedCashoutCoeff}`,
            );
            autoCashoutBets.push({ playerGameId, bet, isMockBet: true });
          }
        }
      } else {
        if (bet.coeffAuto) {
          const autoCoeff = parseFloat(bet.coeffAuto);
          const roundedCurrentCoeff = Math.round(currentCoeff * GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION) / GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION;
          const roundedAutoCoeff = Math.round(autoCoeff * GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION) / GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION;
          
          if (roundedCurrentCoeff >= roundedAutoCoeff) {
            this.logger.debug(
              `[AUTO_CASHOUT_CHECK] Bet eligible: playerGameId=${playerGameId} betNumber=${bet.betNumber} currentCoeff=${roundedCurrentCoeff} autoCoeff=${roundedAutoCoeff}`,
            );
            autoCashoutBets.push({ playerGameId, bet, isMockBet: false });
          }
        }
      }
    }

    return autoCashoutBets;
  }

  async markBetAsAutoCashedOut(playerGameId: string, coeffWin: string, winAmount: string): Promise<void> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return;
    }

    const bet = this.activeRound.bets.get(playerGameId);
    if (bet) {
      bet.coeffWin = coeffWin;
      bet.winAmount = winAmount;
      this.activeRound.bets.set(playerGameId, bet);

      await this.saveActiveRoundToRedis();
    }
  }

  async endRound(): Promise<void> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return;
    }

    this.activeRound.status = GameStatus.FINISH_GAME;
    this.activeRound.isRunning = false;
    this.activeRound.currentCoeff = this.activeRound.crashCoeff || this.MIN_COEFF;

    this.calculateWins();

    const finishedBets = Array.from(this.activeRound.bets.values());
    await this.savePreviousBetsToRedis(finishedBets);
    await this.storeFinishedRound();
    await this.saveActiveRoundToRedis();
  }

  private calculateWins(): void {
    if (!this.activeRound) {
      return;
    }

    const crashCoeff = this.activeRound.crashCoeff || this.MIN_COEFF;

    for (const [playerGameId, bet] of this.activeRound.bets.entries()) {
      if (bet.coeffWin && bet.winAmount) {
        continue;
      }

      const isMockBet = bet.userId.startsWith('mock_');
      
      if (isMockBet) {
        bet.coeffWin = '0.00';
        bet.winAmount = '0';
        continue;
      }

      if (bet.betNumber === 1 && bet.coeffAuto) {
        const autoCoeff = parseFloat(bet.coeffAuto);
        if (autoCoeff <= crashCoeff) {
          bet.coeffWin = bet.coeffAuto;
          bet.winAmount = (parseFloat(bet.betAmount) * autoCoeff).toFixed(2);
        } else {
          bet.coeffWin = '0.00';
          bet.winAmount = '0.00';
        }
      } else {
        bet.coeffWin = '0.00';
        bet.winAmount = '0.00';
      }
    }
  }

  async addBet(bet: BetData): Promise<void> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound || this.activeRound.status !== GameStatus.WAIT_GAME) {
      throw new Error('Bets can only be placed during WAIT_GAME state');
    }

    this.activeRound.bets.set(bet.playerGameId, bet);

    const existingClientSeed = this.activeRound.clientsSeeds.find(
      (clientSeed) => clientSeed.userId === bet.userId,
    );
    
    if (!existingClientSeed) {
      const userSeed = crypto.randomBytes(8).toString('hex');
      
      this.activeRound.clientsSeeds.push({
        userId: bet.userId,
        seed: userSeed,
        nickname: bet.nickname || `user${bet.userId}`,
        gameAvatar: bet.gameAvatar || null,
      });
      
      this.logger.debug(`[ADD_BET] Generated client seed for userId=${bet.userId}`);
    }

    await this.saveActiveRoundToRedis();
  }

  async cashOutBet(playerGameId: string, currentCoeff: number): Promise<BetData | null> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound || this.activeRound.status !== GameStatus.IN_GAME) {
      throw new Error('Cannot cash out: game not in IN_GAME state');
    }

    const bet = this.activeRound.bets.get(playerGameId);
    if (!bet) {
      return null;
    }

    if (bet.coeffWin && bet.winAmount) {
      return bet;
    }

    const winCoeff = currentCoeff;
    const winAmount = parseFloat(bet.betAmount) * winCoeff;

    bet.coeffWin = winCoeff.toFixed(2);
    bet.winAmount = winAmount.toFixed(2);

    this.activeRound.bets.set(playerGameId, bet);

    await this.saveActiveRoundToRedis();

    this.logger.log(
      `[SUGAR_DADDY] Bet cashed out: playerGameId=${playerGameId} coeff=${winCoeff} winAmount=${winAmount}`,
    );

    return bet;
  }

  async getBet(playerGameId: string): Promise<BetData | null> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return null;
    }
    
    return this.activeRound.bets.get(playerGameId) || null;
  }

  async getUserBets(userId: string): Promise<BetData[]> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return [];
    }
    const userBets: BetData[] = [];
    for (const bet of this.activeRound.bets.values()) {
      if (bet.userId === userId) {
        userBets.push(bet);
      }
    }
    return userBets;
  }

  /**
   * Get game seeds for a user (userSeed and hashedServerSeed)
   * Returns the user's client seed from the active round and the hashed server seed
   */
  async getGameSeeds(userId: string): Promise<{ userSeed: string; hashedServerSeed: string } | null> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return null;
    }

    const userClientSeed = this.activeRound.clientsSeeds.find(
      (clientSeed) => clientSeed.userId === userId,
    );

    let userSeed: string;
    if (userClientSeed) {
      userSeed = userClientSeed.seed;
    } else {
      userSeed = crypto.randomBytes(8).toString('hex');
      
      this.activeRound.clientsSeeds.push({
        userId,
        seed: userSeed,
        nickname: `user${userId}`,
        gameAvatar: null,
      });
      
      await this.saveActiveRoundToRedis();
    }

    const hashedServerSeed = crypto
      .createHash('sha256')
      .update(this.activeRound.serverSeed)
      .digest('hex');

    return {
      userSeed,
      hashedServerSeed,
    };
  }

  async getActiveRound(): Promise<ActiveRound | null> {
    await this.loadActiveRoundFromRedis();
    return this.activeRound;
  }

  async addMockBetsBatch(bets: BetData[]): Promise<void> {
    await this.loadActiveRoundFromRedis();
    if (!this.activeRound) {
      return;
    }

    for (const bet of bets) {
      this.activeRound.bets.set(bet.playerGameId, bet);

      // CRITICAL: Add client seed for mock bets (treat them as real bets except wallet/DB)
      // This ensures they can be included in fairness calculations and coefficient history
      const existingClientSeed = this.activeRound.clientsSeeds.find(
        (clientSeed) => clientSeed.userId === bet.userId,
      );
      
      if (!existingClientSeed) {
        const userSeed = crypto.randomBytes(8).toString('hex');
        
      this.activeRound.clientsSeeds.push({
        userId: bet.userId,
        seed: userSeed,
        nickname: bet.nickname || `user${bet.userId}`,
        gameAvatar: bet.gameAvatar || null,
      });
    }
  }

  await this.saveActiveRoundToRedis();
  }

  /**
   * Get pending mock bets that haven't been added yet
   */
  getPendingMockBets(): BetData[] {
    return this.pendingMockBets;
  }

  removePendingMockBets(bets: BetData[]): void {
    const betIds = new Set(bets.map(b => b.playerGameId));
    this.pendingMockBets = this.pendingMockBets.filter(b => !betIds.has(b.playerGameId));
  }

  async clearActiveRound(): Promise<void> {
    const redisClient = this.redisService.getClient();
    const maxRetries = 3;
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        await redisClient.del(this.REDIS_KEY_ACTIVE_ROUND);
        await redisClient.del(this.REDIS_KEY_CURRENT_STATE);
        await redisClient.del(this.REDIS_KEY_CURRENT_COEFF);
        this.activeRound = null;
        this.redisLoadCache = { data: null, timestamp: 0, version: 0 };
        return;
      } catch (error) {
        retries++;
        if (retries >= maxRetries) {
          this.logger.error(`[CLEAR_ROUND] Failed after ${maxRetries} attempts: ${(error as Error).message}`);
          await redisClient.expire(this.REDIS_KEY_ACTIVE_ROUND, 300).catch(() => {});
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }
  }

  /**
   * Calculate crash coefficient using weighted probability distribution
   * 
   * Uses industry-standard distribution:
   * - 75% of rounds crash in low range (1.02x - 3.0x)
   * - 20% of rounds crash in medium range (3.0x - 5.0x)
   * - 5% of rounds crash in high range (5.0x - 10.0x+)
   * 
   * Distribution is configurable via database (coefficientDistribution key)
   * Falls back to defaults if not configured
   * 
   * Uses cryptographically secure random number generation for fairness
   */
  private async calculateCrashCoefficient(serverSeed: string): Promise<number> {
    // Load distribution config from database or use defaults
    const distribution = await this.loadDistributionConfig('sugar-daddy');
    
    // Generate cryptographically secure random number [0, 1)
    const randomBytes = crypto.randomBytes(8);
    const randomValue = randomBytes.readUInt32BE(0) / (0xFFFFFFFF + 1);

    // Select range based on cumulative weights
    let cumulativeWeight = 0;
    let selectedRange = distribution.ranges[0]; // Default to first range
    
    for (const range of distribution.ranges) {
      cumulativeWeight += range.weight;
      if (randomValue < cumulativeWeight) {
        selectedRange = range;
        break;
      }
    }

    // Generate coefficient within selected range
    // Use additional random bytes for range selection to ensure independence
    const rangeRandomBytes = crypto.randomBytes(8);
    const rangeRandom = rangeRandomBytes.readUInt32BE(0) / (0xFFFFFFFF + 1);
    
    let coeff: number;
    if (distribution.distributionType === 'power') {
      // Power distribution within range (biased toward lower end)
      const rangeSize = selectedRange.max - selectedRange.min;
      const powerExponent = 0.5; // Adjust for bias (0.5 = moderate bias toward lower)
      const normalizedRandom = Math.pow(rangeRandom, powerExponent);
      coeff = selectedRange.min + rangeSize * normalizedRandom;
    } else {
      // Uniform distribution within range (default)
      const rangeSize = selectedRange.max - selectedRange.min;
      coeff = selectedRange.min + rangeSize * rangeRandom;
    }

    // Ensure coefficient is within bounds
    coeff = Math.max(selectedRange.min, Math.min(selectedRange.max, coeff));

    this.logger.debug(
      `[COEFF_DIST] Calculated crash coefficient: coeff=${coeff.toFixed(GAME_CONSTANTS.COEFFICIENT.DECIMAL_PLACES)} range=${selectedRange.name} (${selectedRange.min}-${selectedRange.max}x)`,
    );

    return parseFloat(coeff.toFixed(GAME_CONSTANTS.COEFFICIENT.DECIMAL_PLACES));
  }

  /**
   * Generate cryptographically secure server seed for provably fair gaming
   */
  private generateServerSeed(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get coefficient history from Redis
   * Returns last N finished rounds (default from constants)
   */
  async getCoefficientsHistory(limit: number = this.COEFFICIENT_HISTORY_LIMIT): Promise<CoefficientHistory[]> {
    try {
      const redisClient = this.redisService.getClient();
      const historyKey = this.REDIS_KEY_COEFFICIENT_HISTORY;

      // For default limit (51), return indices 0-50 (51 items)
      const endIndex = limit === this.COEFFICIENT_HISTORY_LIMIT ? 50 : limit - 1;
      const historyData = await redisClient.lrange(historyKey, 0, endIndex);

      if (!historyData || historyData.length === 0) {
        return [];
      }

      const history: CoefficientHistory[] = historyData
        .map((data) => {
          try {
            return JSON.parse(data) as CoefficientHistory;
          } catch (error) {
            this.logger.warn(`[COEFF_HISTORY] Failed to parse history entry: ${error.message}`);
            return null;
          }
        })
        .filter((entry): entry is CoefficientHistory => entry !== null);

      // Redis rpush adds to end, lrange(0, 50) gets from start to end
      // This gives us: [oldest, ..., newest] with oldest at index 0, newest at index 50
      // This is the correct order - no need to reverse

      // Debug log: Log how many entries retrieved and sample of clientsSeeds
      if (history.length > 0) {
        const sampleEntry = history[0];
        const lastEntry = history[history.length - 1];
        this.logger.debug(
          `[CLIENTSSEEDS_DEBUG] getCoefficientsHistory: Retrieved ${history.length} entries, first entry (oldest) gameId=${sampleEntry.gameId} clientsSeedsCount=${sampleEntry.clientsSeeds?.length || 0}, last entry (newest) gameId=${lastEntry.gameId} clientsSeedsCount=${lastEntry.clientsSeeds?.length || 0}`,
        );
      }

      return history;
    } catch (error) {
      this.logger.error(`[COEFF_HISTORY] Error fetching coefficient history: ${error.message}`);
      return [];
    }
  }

  private async storeFinishedRound(): Promise<void> {
    if (!this.activeRound || !this.activeRound.crashCoeff) {
      return;
    }

    try {
      const preservedState = {
        status: this.activeRound.status,
        clientsSeeds: [...this.activeRound.clientsSeeds],
        bets: new Map(this.activeRound.bets), // Preserve bets data for winner calculation
        crashCoeff: this.activeRound.crashCoeff,
        roundId: this.activeRound.roundId,
      };
      
      await this.loadActiveRoundFromRedis();
      
      if (!this.activeRound) {
        this.logger.error(`[STORE_FINISHED_ROUND] activeRound is null after reload from Redis`);
        return;
      }
      
      this.activeRound.status = preservedState.status;
      this.activeRound.crashCoeff = preservedState.crashCoeff;
      
      if (preservedState.clientsSeeds.length > 0) {
        const existingUserIds = new Set(this.activeRound.clientsSeeds.map(cs => cs.userId));
        for (const seed of preservedState.clientsSeeds) {
          if (!existingUserIds.has(seed.userId)) {
            this.activeRound.clientsSeeds.push(seed);
          }
        }
      }
      
      if (preservedState.bets.size > 0) {
        for (const [playerGameId, bet] of preservedState.bets.entries()) {
          if (!this.activeRound.bets.has(playerGameId)) {
            this.activeRound.bets.set(playerGameId, bet);
          } else {
            this.activeRound.bets.set(playerGameId, bet);
          }
        }
      }

      const topClientsSeeds = this.buildTopClientsSeeds();
      const combinedHash = this.activeRound.combinedHash || this.calculateCombinedHash();
      const decimal = this.activeRound.decimal || this.calculateDecimal(combinedHash);

      if (!this.activeRound.combinedHash) {
        this.activeRound.combinedHash = combinedHash;
        this.activeRound.decimal = decimal;
      }

      const historyEntry: CoefficientHistory = {
        coeff: this.activeRound.crashCoeff,
        gameId: this.activeRound.roundId,
        gameUUID: this.activeRound.gameUUID,
        serverSeed: this.activeRound.serverSeed,
        clientsSeeds: topClientsSeeds,
        combinedHash: combinedHash,
        decimal: decimal,
      };

      const redisClient = this.redisService.getClient();
      const historyKey = this.REDIS_KEY_COEFFICIENT_HISTORY;

      await redisClient.rpush(historyKey, JSON.stringify(historyEntry));
      await redisClient.ltrim(historyKey, -this.COEFFICIENT_HISTORY_LIMIT, -1);
    } catch (error) {
      this.logger.error(`[COEFF_HISTORY] Error: ${(error as Error).message}`);
    }
  }

  buildTopClientsSeeds(): Array<{ userId: string; seed: string; nickname: string; gameAvatar: number | null }> {
    if (!this.activeRound) return [];

    const allWinners: Array<{ bet: BetData; winAmount: number }> = [];
    
    for (const bet of this.activeRound.bets.values()) {
      if (bet.coeffWin && bet.winAmount) {
        const winAmount = parseFloat(bet.winAmount || '0');
        if (winAmount > 0) {
          allWinners.push({ bet, winAmount });
        }
      }
    }
    
    allWinners.sort((a, b) => b.winAmount - a.winAmount);
    const top3Winners = allWinners.slice(0, 3);
    
    const topClientsSeeds: Array<{ userId: string; seed: string; nickname: string; gameAvatar: number | null }> = [];
    const usedUserIds = new Set<string>();
    
    for (const { bet } of top3Winners) {
      const existingSeed = this.activeRound.clientsSeeds.find(cs => cs.userId === bet.userId);
      if (existingSeed) {
        topClientsSeeds.push(existingSeed);
        usedUserIds.add(bet.userId);
      } else {
        topClientsSeeds.push({
          userId: bet.userId,
          seed: crypto.randomBytes(8).toString('hex'),
          nickname: bet.nickname || `user${bet.userId}`,
          gameAvatar: bet.gameAvatar || null,
        });
        usedUserIds.add(bet.userId);
      }
    }
    
    if (topClientsSeeds.length < 3 && this.activeRound.clientsSeeds.length > 0) {
      for (const clientSeed of this.activeRound.clientsSeeds) {
        if (topClientsSeeds.length >= 3) break;
        if (!usedUserIds.has(clientSeed.userId)) {
          topClientsSeeds.push(clientSeed);
          usedUserIds.add(clientSeed.userId);
        }
      }
    }
    
    if (topClientsSeeds.length === 0) {
      return this.getTopClientsSeeds(3);
    }
    
    return topClientsSeeds;
  }

  private calculateCombinedHash(): string {
    if (!this.activeRound) return '';
    const seedString = this.activeRound.serverSeed + this.activeRound.clientsSeeds.map(c => c.seed).join('');
    return crypto.createHash('sha256').update(seedString).digest('hex');
  }

  private calculateDecimal(combinedHash: string): string {
    const hexValue = combinedHash.substring(0, 16);
    return (parseInt(hexValue, 16) / Math.pow(16, 16)).toExponential();
  }

  /**
   * Generate mock bets for display purposes
   * Target total: 15k-20k (90% of time), 20k-25k (10% of time)
   * Individual bet amounts: 10-3,000 INR (multiples of 5)
   * Minimum 15 bets always
   */
  // Mock bet generation methods moved to shared/mock-bets.service.ts

  /**
   * Process mock bet cashout (display only, no wallet/database operations)
   */
  private processMockBetCashout(playerGameId: string, bet: BetData, coeffWin: number): void {
    if (!this.activeRound) {
      return;
    }

    // Update mock bet with cashout info
    bet.coeffWin = coeffWin.toFixed(2);
    const betAmount = parseFloat(bet.betAmount || '0');
    const winAmount = Math.round(betAmount * coeffWin); // Round to full number
    bet.winAmount = winAmount.toString(); // Store as full number string

    // Update in bets map
    this.activeRound.bets.set(playerGameId, bet);

    // Remove from cashout schedule
    this.activeRound.mockBetsCashoutSchedule.delete(playerGameId);

    this.logger.debug(
      `[MOCK_BET_CASHOUT] Processed mock bet cashout: playerGameId=${playerGameId} coeffWin=${coeffWin.toFixed(2)} winAmount=${winAmount}`,
    );
  }

  /**
   * Check if a bet is a mock bet
   */
  private isMockBet(bet: BetData): boolean {
    return bet.userId.startsWith('mock_');
  }

  /**
   * Get top N clientsSeeds (first N available, no sorting)
   * Returns top 3 (or fewer if less available) as they are
   */
  private getTopClientsSeeds(limit: number = 3): Array<{
    userId: string;
    seed: string;
    nickname: string;
    gameAvatar: number | null;
  }> {
    if (!this.activeRound) {
      this.logger.warn(`[GET_TOP_CLIENTS_SEEDS] Active round is null`);
      return [];
    }

    // If clientsSeeds exists and has data, return first N
    if (this.activeRound.clientsSeeds && this.activeRound.clientsSeeds.length > 0) {
      const topSeeds = this.activeRound.clientsSeeds.slice(0, limit);
      this.logger.debug(
        `[GET_TOP_CLIENTS_SEEDS] Returning ${topSeeds.length} clientsSeeds from activeRound (total: ${this.activeRound.clientsSeeds.length})`,
      );
      return topSeeds;
    }

    // Fallback: try to get from bets if clientsSeeds is empty
    if (this.activeRound.bets && this.activeRound.bets.size > 0) {
      const clientsSeedsMap = new Map<string, { userId: string; seed: string; nickname: string; gameAvatar: number | null }>();
      
      for (const bet of this.activeRound.bets.values()) {
        if (!clientsSeedsMap.has(bet.userId) && clientsSeedsMap.size < limit) {
          const userSeed = crypto.randomBytes(8).toString('hex');
          clientsSeedsMap.set(bet.userId, {
            userId: bet.userId,
            seed: userSeed,
            nickname: bet.nickname || `user${bet.userId}`,
            gameAvatar: bet.gameAvatar || null,
          });
        }
      }
      
      const topSeeds = Array.from(clientsSeedsMap.values());
      this.logger.debug(
        `[GET_TOP_CLIENTS_SEEDS] Generated ${topSeeds.length} clientsSeeds from bets (fallback)`,
      );
      return topSeeds;
    }

    this.logger.warn(`[GET_TOP_CLIENTS_SEEDS] No clientsSeeds available and no bets found`);
    return [];
  }

  /**
   * Queue a bet for the next round
   * Supports multiple bets per user (betNumber 0 and 1)
   */
  async queueBetForNextRound(pendingBet: PendingBet): Promise<void> {
    const betIdentifier = `${pendingBet.userId}:${pendingBet.betNumber}`;
    const userPendingBetKey = `${this.REDIS_KEY_PENDING_BETS}:${betIdentifier}`;

    await this.redisService.set(userPendingBetKey, pendingBet, this.PENDING_BET_TTL);

    const pendingBetsKey = `${this.REDIS_KEY_PENDING_BETS}:identifiers`;
    const redisClient = this.redisService.getClient();
    await redisClient.sadd(pendingBetsKey, betIdentifier);
    await redisClient.expire(pendingBetsKey, this.PENDING_BET_TTL);

    const pendingUsersKey = `${this.REDIS_KEY_PENDING_BETS}:users`;
    await redisClient.sadd(pendingUsersKey, pendingBet.userId);
    await redisClient.expire(pendingUsersKey, this.PENDING_BET_TTL);

    this.logger.log(
      `[QUEUE_BET] Queued bet for next round: userId=${pendingBet.userId} betNumber=${pendingBet.betNumber} amount=${pendingBet.betAmount} currency=${pendingBet.currency}`,
    );
  }

  /**
   * Get a specific pending bet for a user by betNumber
   * @param userId - User ID
   * @param betNumber - Bet number (0 or 1), if not provided, returns the first available bet (for backward compatibility)
   */
  async getPendingBet(userId: string, betNumber?: number): Promise<PendingBet | null> {
    if (betNumber !== undefined) {
      const betIdentifier = `${userId}:${betNumber}`;
      const userPendingBetKey = `${this.REDIS_KEY_PENDING_BETS}:${betIdentifier}`;
      return await this.redisService.get<PendingBet>(userPendingBetKey);
    }
    
    const bet0 = await this.getPendingBet(userId, 0);
    if (bet0) return bet0;
    return await this.getPendingBet(userId, 1);
  }

  /**
   * Get all pending bets for a user (both betNumber 0 and 1)
   */
  async getAllPendingBetsForUser(userId: string): Promise<PendingBet[]> {
    const bets: PendingBet[] = [];
    const bet0 = await this.getPendingBet(userId, 0);
    if (bet0) bets.push(bet0);
    const bet1 = await this.getPendingBet(userId, 1);
    if (bet1) bets.push(bet1);
    return bets;
  }

  /**
   * Get all pending bet identifiers (userId:betNumber combinations)
   */
  async getAllPendingBetIdentifiers(): Promise<string[]> {
    const pendingBetsKey = `${this.REDIS_KEY_PENDING_BETS}:identifiers`;
    const redisClient = this.redisService.getClient();
    const identifiers = await redisClient.smembers(pendingBetsKey);
    return identifiers || [];
  }

  async getAllPendingBetUsers(): Promise<string[]> {
    const pendingUsersKey = `${this.REDIS_KEY_PENDING_BETS}:users`;
    const redisClient = this.redisService.getClient();
    const userIds = await redisClient.smembers(pendingUsersKey);
    return userIds || [];
  }

  /**
   * Remove a specific pending bet for a user by betNumber
   * @param userId - User ID
   * @param betNumber - Bet number (0 or 1), if not provided, removes all bets for the user
   */
  async removePendingBet(userId: string, betNumber?: number): Promise<void> {
    if (betNumber !== undefined) {
      const betIdentifier = `${userId}:${betNumber}`;
      const userPendingBetKey = `${this.REDIS_KEY_PENDING_BETS}:${betIdentifier}`;
      await this.redisService.del(userPendingBetKey);

      const pendingBetsKey = `${this.REDIS_KEY_PENDING_BETS}:identifiers`;
      const redisClient = this.redisService.getClient();
      await redisClient.srem(pendingBetsKey, betIdentifier);

      const remainingBets = await this.getAllPendingBetsForUser(userId);
      if (remainingBets.length === 0) {
        const pendingUsersKey = `${this.REDIS_KEY_PENDING_BETS}:users`;
        await redisClient.srem(pendingUsersKey, userId);
      }

      this.logger.debug(`[REMOVE_PENDING_BET] Removed pending bet for userId=${userId} betNumber=${betNumber}`);
    } else {
      const bet0 = await this.getPendingBet(userId, 0);
      const bet1 = await this.getPendingBet(userId, 1);
      if (bet0) await this.removePendingBet(userId, 0);
      if (bet1) await this.removePendingBet(userId, 1);
    }
  }

  async addPendingBetToRound(pendingBet: PendingBet, gameUUID: string, playerGameId: string): Promise<BetData> {
    await this.loadActiveRoundFromRedis();

    const betData: BetData = {
      userId: pendingBet.userId,
      operatorId: pendingBet.operatorId,
      multiplayerGameId: gameUUID,
      nickname: pendingBet.nickname,
      currency: pendingBet.currency,
      betAmount: pendingBet.betAmount,
      betNumber: pendingBet.betNumber,
      gameAvatar: pendingBet.gameAvatar,
      playerGameId,
      coeffAuto: pendingBet.coeffAuto,
      userAvatar: pendingBet.userAvatar,
    };

    if (this.activeRound) {
      this.activeRound.bets.set(playerGameId, betData);

      // CRITICAL: Add client seed for this user if it doesn't exist
      // This ensures fairness data can be generated later
      const existingClientSeed = this.activeRound.clientsSeeds.find(
        (clientSeed) => clientSeed.userId === pendingBet.userId,
      );
      
      if (!existingClientSeed) {
        const userSeed = crypto.randomBytes(8).toString('hex');
        
        this.activeRound.clientsSeeds.push({
          userId: pendingBet.userId,
          seed: userSeed,
          nickname: pendingBet.nickname || `user${pendingBet.userId}`,
          gameAvatar: pendingBet.gameAvatar || null,
        });
        
        this.logger.debug(`[ADD_PENDING_BET] Generated client seed for userId=${pendingBet.userId}`);
      }

      await this.saveActiveRoundToRedis();
    }

    this.logger.log(
      `[PROCESS_PENDING_BET] Added pending bet to round: userId=${pendingBet.userId} playerGameId=${playerGameId} amount=${pendingBet.betAmount}`,
    );

    return betData;
  }

  async saveActiveRoundToRedis(): Promise<void> {
    if (!this.activeRound) {
      return;
    }

    try {
      const redisClient = this.redisService.getClient();

      this.activeRound.version = (this.activeRound.version || 0) + 1;
      this.activeRound.lastSavedAt = Date.now();

      const betsArray = Array.from(this.activeRound.bets.entries());
      const mockBetsCashoutScheduleArray = Array.from(this.activeRound.mockBetsCashoutSchedule.entries());

      const roundData = {
        roundId: this.activeRound.roundId,
        gameUUID: this.activeRound.gameUUID,
        status: this.activeRound.status,
        currentCoeff: this.activeRound.currentCoeff,
        crashCoeff: this.activeRound.crashCoeff,
        startTime: this.activeRound.startTime,
        bets: betsArray,
        mockBetsCashoutSchedule: mockBetsCashoutScheduleArray,
        serverSeed: this.activeRound.serverSeed,
        clientsSeeds: this.activeRound.clientsSeeds,
        combinedHash: this.activeRound.combinedHash,
        decimal: this.activeRound.decimal,
        isRunning: this.activeRound.isRunning,
        version: this.activeRound.version,
        lastSavedAt: this.activeRound.lastSavedAt,
      };

      await redisClient.set(this.REDIS_KEY_ACTIVE_ROUND, JSON.stringify(roundData));

      const saved = await redisClient.get(this.REDIS_KEY_ACTIVE_ROUND);
      if (!saved) {
        throw new Error('Save verification failed');
      }

      const gameState = await this.buildGameStatePayload();
      if (gameState) {
        await redisClient.set(this.REDIS_KEY_CURRENT_STATE, JSON.stringify(gameState));
      }

      this.redisLoadCache = {
        data: this.activeRound,
        timestamp: Date.now(),
        version: this.activeRound.version,
      };
    } catch (error: any) {
      if (this.activeRound) {
        this.activeRound.version = Math.max(0, (this.activeRound.version || 1) - 1);
      }
      this.logger.error(`[REDIS_SAVE] Error: ${error?.message || 'Unknown'}. RoundId: ${this.activeRound?.roundId}`);
    }
  }

  private async loadActiveRoundFromRedis(): Promise<void> {
    try {
      const redisClient = this.redisService.getClient();
      const roundDataStr = await redisClient.get(this.REDIS_KEY_ACTIVE_ROUND);

      if (!roundDataStr) {
        if (this.activeRound) {
          this.logger.warn(`[REDIS_LOAD] No Redis data but in-memory exists. RoundId: ${this.activeRound.roundId}`);
        }
        this.activeRound = null;
        this.redisLoadCache = { data: null, timestamp: 0, version: 0 };
        return;
      }

      const roundData = JSON.parse(roundDataStr);
      
      if (this.activeRound && roundData.version && this.activeRound.version && this.activeRound.version > roundData.version) {
        this.logger.warn(`[REDIS_SYNC] In-memory v${this.activeRound.version} > Redis v${roundData.version}. Syncing...`);
        await this.saveActiveRoundToRedis();
        return;
      }

      const betsMap = new Map<string, BetData>();
      if (roundData.bets && Array.isArray(roundData.bets)) {
        for (const [key, value] of roundData.bets) {
          betsMap.set(key, value as BetData);
        }
      }

      // Handle backward compatibility: merge old mockBets into bets if they exist
      if (roundData.mockBets && Array.isArray(roundData.mockBets)) {
        for (const [key, value] of roundData.mockBets) {
          betsMap.set(key, value as BetData);
        }
      }

      const mockBetsCashoutScheduleMap = new Map<string, { playerGameId: string; cashoutCoeff: number }>();
      if (roundData.mockBetsCashoutSchedule && Array.isArray(roundData.mockBetsCashoutSchedule)) {
        for (const [key, value] of roundData.mockBetsCashoutSchedule) {
          mockBetsCashoutScheduleMap.set(key, value as { playerGameId: string; cashoutCoeff: number });
        }
      }

      // Ensure clientsSeeds is properly deserialized as an array
      let clientsSeeds: Array<{ userId: string; seed: string; nickname: string; gameAvatar: number | null }> = [];
      if (roundData.clientsSeeds) {
        if (Array.isArray(roundData.clientsSeeds)) {
          clientsSeeds = roundData.clientsSeeds;
        } else if (typeof roundData.clientsSeeds === 'object') {
          // Handle case where it might be stored as an object
          clientsSeeds = Object.values(roundData.clientsSeeds);
        }
      }

      this.activeRound = {
        roundId: roundData.roundId,
        gameUUID: roundData.gameUUID,
        status: roundData.status,
        currentCoeff: roundData.currentCoeff,
        crashCoeff: roundData.crashCoeff,
        startTime: roundData.startTime,
        bets: betsMap,
        mockBetsCashoutSchedule: mockBetsCashoutScheduleMap,
        serverSeed: roundData.serverSeed,
        clientsSeeds: clientsSeeds,
        combinedHash: roundData.combinedHash || '',
        decimal: roundData.decimal || '',
        isRunning: roundData.isRunning || false,
        version: roundData.version || 0,
        lastSavedAt: roundData.lastSavedAt || Date.now(),
      };
    } catch (error: any) {
      this.logger.error(`[REDIS_LOAD] Error: ${error?.message || 'Unknown'}`);
      if (!this.activeRound) {
        this.activeRound = null;
        this.redisLoadCache = { data: null, timestamp: 0, version: 0 };
      }
    }
  }

  /**
   * Save current coefficient to Redis for quick access
   */
  private async saveCurrentCoefficientToRedis(): Promise<void> {
    if (!this.activeRound || !this.activeRound.isRunning) {
      return;
    }

    try {
      const redisClient = this.redisService.getClient();
      const coeffPayload: CoefficientChangePayload = {
        coeff: this.activeRound.currentCoeff,
      };
      await redisClient.set(this.REDIS_KEY_CURRENT_COEFF, JSON.stringify(coeffPayload));
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(
        `[REDIS_SAVE] Error saving current coefficient: ${errorMessage}. Coefficient: ${this.activeRound.currentCoeff}`,
      );
      // Don't throw - coefficient updates are frequent and failures shouldn't crash the game
    }
  }

  /**
   * Save previous bets to Redis
   */
  private async savePreviousBetsToRedis(bets: BetData[]): Promise<void> {
    try {
      const redisClient = this.redisService.getClient();
      await redisClient.set(this.REDIS_KEY_PREVIOUS_BETS, JSON.stringify(bets));
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(
        `[REDIS_SAVE] Error saving previous bets: ${errorMessage}. Bet count: ${bets.length}`,
      );
      // Don't throw - previous bets are not critical for game operation
    }
  }

  /**
   * Get previous bets from Redis
   */
  private async getPreviousBetsFromRedis(): Promise<BetData[]> {
    try {
      const redisClient = this.redisService.getClient();
      const betsStr = await redisClient.get(this.REDIS_KEY_PREVIOUS_BETS);
      if (!betsStr) {
        return [];
      }
      return JSON.parse(betsStr) as BetData[];
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(
        `[REDIS_LOAD] Error loading previous bets: ${errorMessage}. Returning empty array.`,
      );
      return [];
    }
  }

  /**
   * Build game state payload (helper for Redis storage and getCurrentGameState)
   * Centralized logic to avoid code duplication
   */
  private async buildGameStatePayload(): Promise<GameStateChangePayload | null> {
    if (!this.activeRound) {
      return null;
    }

    // Get all bets (real and mock) from bets Map
    // Strip "mock_" prefix from userId for UI display (users shouldn't see it's a mock bet)
    const allBets: BetData[] = Array.from(this.activeRound.bets.values())
      .map(bet => {
        const cleanBet = { ...bet };
        if (cleanBet.userId.startsWith('mock_')) {
          cleanBet.userId = cleanBet.userId.replace(/^mock_/, '');
        }
        return cleanBet;
      })
      .sort((a, b) => parseFloat(b.betAmount || '0') - parseFloat(a.betAmount || '0')); // Sort by betAmount descending
    
    // State-based previous bets logic
    let finalBets: BetData[] = [];
    let finalPreviousBets: BetData[] = [];
    let totalBetsAmount = 0;
    let previousBetsTotalAmount = 0;

    if (this.activeRound.status === GameStatus.WAIT_GAME) {
      // WAIT_GAME: Show current bets + previous bets separately
      const previousBets = await this.getPreviousBetsFromRedis();
      finalBets = allBets; // Current round bets
      finalPreviousBets = previousBets; // Previous round bets
      totalBetsAmount = allBets.reduce(
        (sum, bet) => sum + parseFloat(bet.betAmount || '0'),
        0,
      );
      previousBetsTotalAmount = previousBets.reduce(
        (sum, bet) => sum + parseFloat(bet.betAmount || '0'),
        0,
      );
    } else if (this.activeRound.status === GameStatus.FINISH_GAME) {
      // FINISH_GAME: Show the bets that just finished in bets.values
      finalBets = allBets; // These are the bets from the round that just finished
      finalPreviousBets = []; // Empty - previous bets not shown
      totalBetsAmount = allBets.reduce(
        (sum, bet) => sum + parseFloat(bet.betAmount || '0'),
        0,
      );
      previousBetsTotalAmount = 0;
    } else {
      // IN_GAME: Show only current bets
      finalBets = allBets; // Current round bets
      finalPreviousBets = []; // Empty - previous bets not shown
      totalBetsAmount = allBets.reduce(
        (sum, bet) => sum + parseFloat(bet.betAmount || '0'),
        0,
      );
      previousBetsTotalAmount = 0;
    }

    let waitTime: number | null = null;
    if (this.activeRound.status === GameStatus.WAIT_GAME) {
      const elapsed = Date.now() - this.activeRound.startTime;
      const waitDuration = GAME_CONSTANTS.SUGAR_DADDY.WAIT_DURATION_MS;
      waitTime = Math.max(0, waitDuration - elapsed);
    }

    const payload: GameStateChangePayload = {
      status: this.activeRound.status,
      roundId: this.activeRound.roundId,
      waitTime,
      bets: {
        totalBetsAmount,
        values: finalBets,
      },
      previousBets: {
        totalBetsAmount: previousBetsTotalAmount,
        values: finalPreviousBets,
      },
    };

    if (this.activeRound && this.activeRound.status === GameStatus.FINISH_GAME && this.activeRound.crashCoeff) {
      const activeRound = this.activeRound; // Store reference to avoid null check issues
      const crashCoeff = activeRound.crashCoeff!; // Non-null assertion: we know it's not null from the condition
      payload.coeffCrash = crashCoeff;
      
      // Fetch existing history
      const existingHistory = await this.getCoefficientsHistory(this.COEFFICIENT_HISTORY_LIMIT);
      
      // Get top 3 clientsSeeds (same logic as storeFinishedRound)
      let topClientsSeeds = this.getTopClientsSeeds(3);
      
      // Include top 3 mock bet winners (mixed with actual, prioritizing actual)
      const allWinners: Array<{ bet: BetData; winAmount: number }> = [];
      
      // Collect all bet winners (real and mock)
      for (const bet of activeRound.bets.values()) {
        if (bet.coeffWin && bet.winAmount) {
          const winAmount = parseFloat(bet.winAmount || '0');
          allWinners.push({ bet, winAmount });
        }
      }
      
      // Sort by winAmount descending and take top 3
      allWinners.sort((a, b) => b.winAmount - a.winAmount);
      const top3Winners = allWinners.slice(0, 3);
      
      // Convert top 3 winners to clientsSeeds format, prioritizing actual bets
      const top3ClientsSeeds: Array<{
        userId: string;
        seed: string;
        nickname: string;
        gameAvatar: number | null;
      }> = [];
      
      for (const { bet } of top3Winners) {
        // Check if this user already exists in topClientsSeeds (from actual bets)
        const existingSeed = topClientsSeeds.find(cs => cs.userId === bet.userId);
        if (existingSeed) {
          top3ClientsSeeds.push(existingSeed);
        } else {
          // For mock bets or bets not in clientsSeeds, create entry
          const userClientSeed = activeRound.clientsSeeds.find(cs => cs.userId === bet.userId);
          top3ClientsSeeds.push({
            userId: bet.userId,
            seed: userClientSeed?.seed || crypto.randomBytes(8).toString('hex'),
            nickname: bet.nickname || `user${bet.userId}`,
            gameAvatar: bet.gameAvatar || null,
          });
        }
      }
      
      // Use top 3 winners if we have any, otherwise fall back to original topClientsSeeds
      if (top3ClientsSeeds.length > 0) {
        topClientsSeeds = top3ClientsSeeds;
      }
      
      // Debug log: Log clientsSeeds in FINISH_GAME state
      this.logger.debug(
        `[CLIENTSSEEDS_DEBUG] buildGameStatePayload FINISH_GAME: topClientsSeeds count=${topClientsSeeds.length} contents=${JSON.stringify(topClientsSeeds.map(cs => ({ userId: cs.userId, nickname: cs.nickname })))}`,
      );
      
      // Construct current round's coefficient history entry
      const currentRoundEntry: CoefficientHistory = {
        coeff: crashCoeff,
        gameId: activeRound.roundId,
        gameUUID: activeRound.gameUUID,
        serverSeed: activeRound.serverSeed,
        clientsSeeds: topClientsSeeds,
        combinedHash: activeRound.combinedHash,
        decimal: activeRound.decimal,
      };
      
      // Debug log: Log what's being set in currentRoundEntry.clientsSeeds
      this.logger.debug(
        `[CLIENTSSEEDS_DEBUG] buildGameStatePayload FINISH_GAME: currentRoundEntry.clientsSeeds count=${currentRoundEntry.clientsSeeds.length} for gameId=${currentRoundEntry.gameId}`,
      );
      
      // Check if current round is already in history (by gameId)
      const currentRoundInHistory = existingHistory.find(h => h.gameId === activeRound.roundId);
      
      let finalCoefficients: CoefficientHistory[];
      if (!currentRoundInHistory) {
        // Append current round to history (it's the newest, should be at index 50)
        // existingHistory is already oldest to newest, so append makes it oldest at 0, newest at end
        finalCoefficients = [...existingHistory, currentRoundEntry].slice(-this.COEFFICIENT_HISTORY_LIMIT);
      } else {
        // Current round already in history, use as-is
        finalCoefficients = existingHistory;
      }
      
      // Ensure order is correct: oldest at index 0, newest at index 50
      // Verify by checking if the last item has a higher gameId than the first (newer rounds have higher gameIds)
      if (finalCoefficients.length > 1) {
        const firstGameId = finalCoefficients[0]?.gameId || 0;
        const lastGameId = finalCoefficients[finalCoefficients.length - 1]?.gameId || 0;
        if (lastGameId < firstGameId) {
          // Order is reversed, fix it
          this.logger.warn(
            `[COEFF_HISTORY] Coefficient history order is reversed, fixing it. First gameId=${firstGameId}, Last gameId=${lastGameId}`,
          );
          finalCoefficients.reverse();
        }
      }
      
      payload.coefficients = finalCoefficients;
    }

    return payload;
  }

  /**
   * Try to acquire leader lock for game engine
   * Returns true if this pod becomes the leader
   */
  async acquireLeaderLock(podId: string): Promise<boolean> {
    try {
      const redisClient = this.redisService.getClient();
      const lockKey = this.REDIS_KEY_LEADER_LOCK;

      const result = await redisClient.set(
        lockKey,
        podId,
        'EX',
        this.LEADER_LOCK_TTL,
        'NX',
      );

      if (result === 'OK') {
        this.logger.log(`[LEADER_ELECTION] ✅ Pod ${podId} acquired leader lock`);
        return true;
      }

      const currentLeader = await redisClient.get(lockKey);
      if (currentLeader === podId) {
        this.logger.log(`[LEADER_ELECTION] ✅ Pod ${podId} already holds leader lock (renewing)`);
        await redisClient.expire(lockKey, this.LEADER_LOCK_TTL);
        return true;
      }

      this.logger.debug(`[LEADER_ELECTION] ❌ Pod ${podId} failed to acquire lock - current leader: ${currentLeader || 'unknown'}`);
      return false;
    } catch (error) {
      this.logger.error(`[LEADER_ELECTION] Error acquiring lock: ${error.message}`);
      return false;
    }
  }

  /**
   * Renew leader lock (must be called periodically by leader)
   */
  async renewLeaderLock(podId: string): Promise<boolean> {
    try {
      const redisClient = this.redisService.getClient();
      const lockKey = this.REDIS_KEY_LEADER_LOCK;

      const currentLeader = await redisClient.get(lockKey);
      if (currentLeader === podId) {
        await redisClient.expire(lockKey, this.LEADER_LOCK_TTL);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`[LEADER_ELECTION] Error renewing lock: ${error.message}`);
      return false;
    }
  }

  /**
   * Release leader lock
   */
  async releaseLeaderLock(podId: string): Promise<void> {
    try {
      const redisClient = this.redisService.getClient();
      const lockKey = this.REDIS_KEY_LEADER_LOCK;

      const currentLeader = await redisClient.get(lockKey);
      if (currentLeader === podId) {
        await redisClient.del(lockKey);
        this.logger.log(`[LEADER_ELECTION] Pod ${podId} released leader lock`);
      }
    } catch (error) {
      this.logger.error(`[LEADER_ELECTION] Error releasing lock: ${error.message}`);
    }
  }

  /**
   * Check if this pod is the current leader
   */
  async isLeader(podId: string): Promise<boolean> {
    try {
      const redisClient = this.redisService.getClient();
      const currentLeader = await redisClient.get(this.REDIS_KEY_LEADER_LOCK);
      return currentLeader === podId;
    } catch (error) {
      this.logger.error(`[LEADER_ELECTION] Error checking leader: ${error.message}`);
      return false;
    }
  }

  private async safeGetConfig(gameCode: string, key: string): Promise<string> {
    try {
      const raw = await this.gameConfigService.getConfig(gameCode, key);
      return raw || '{}';
    } catch (e: any) {
      this.logger.warn(`[safeGetConfig] Config key ${key} not available for ${gameCode}: ${e.message}`);
      return '{}';
    }
  }

  /**
   * Try to parse JSON string, return undefined on error
   */
  private tryParseJson(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  /**
   * Get game config payload from database with fallback to defaults
   * Used by handler to get betConfig and RTP
   */
  async getGameConfigPayload(gameCode: string): Promise<{
    betConfig: any;
    rtp: number;
  }> {
    try {
      const betConfigRaw = await this.safeGetConfig(gameCode, 'betConfig');
      const rtpRaw = await this.safeGetConfig(gameCode, 'RTP');

      const betConfig = this.tryParseJson(betConfigRaw) || {};
      const rtp = rtpRaw && rtpRaw !== '{}' ? parseFloat(rtpRaw) : null;

      return {
        betConfig: betConfig || DEFAULTS.GAMES.SUGAR_DADDY.BET_CONFIG,
        rtp: rtp || DEFAULTS.GAMES.SUGAR_DADDY.RTP,
      };
    } catch (e: any) {
      this.logger.error(`[getGameConfigPayload] Failed building game config payload for ${gameCode}: ${e.message}`);
      return {
        betConfig: DEFAULTS.GAMES.SUGAR_DADDY.BET_CONFIG,
        rtp: DEFAULTS.GAMES.SUGAR_DADDY.RTP,
      };
    }
  }

  /**
   * Load RTP from database first, then fallback to defaults
   * Call this when game starts or when config might have changed
   */
  async loadRTP(gameCode: string): Promise<number> {
    try {
      // Try to fetch RTP from database first
      const rtpRaw = await this.gameConfigService.getConfig(gameCode, 'RTP');
      
      if (rtpRaw && rtpRaw !== '{}') {
        const rtp = parseFloat(rtpRaw);
        if (!isNaN(rtp) && rtp >= 0 && rtp <= 100) {
          this.rtp = rtp;
          this.logger.log(`[loadRTP] Loaded RTP=${this.rtp}% from database for gameCode=${gameCode}`);
          return this.rtp;
        } else {
          this.logger.warn(`[loadRTP] Invalid RTP value in database: ${rtpRaw}, using default`);
        }
      }
    } catch (error: any) {
      this.logger.warn(`[loadRTP] Failed to load RTP from database: ${error.message}, using default`);
    }
    
    // Fallback to default
    this.rtp = DEFAULTS.GAMES.SUGAR_DADDY.RTP;
    this.logger.log(`[loadRTP] Using default RTP=${this.rtp}% for gameCode=${gameCode}`);
    return this.rtp;
  }

  /**
   * Load coefficient speed from database or use default
   * @param gameCode - Game code
   * @returns Coefficient speed (coefficient increase per second)
   */
  private async loadCoefficientSpeed(gameCode: string): Promise<number> {
    try {
      const speedRaw = await this.gameConfigService.getConfig(gameCode, 'coefficientSpeed');
      
      if (speedRaw && speedRaw !== '{}') {
        const speed = parseFloat(speedRaw);
        if (!isNaN(speed) && speed > 0 && speed <= 10) {
          // Log removed to reduce log size - speed loading is working normally
          return speed;
        } else {
          this.logger.warn(
            `[loadCoefficientSpeed] Invalid speed value in database: ${speedRaw} (must be > 0 and <= 10), using default`,
          );
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `[loadCoefficientSpeed] Failed to load speed from database: ${error.message}, using default`,
      );
    }
    
    // Fallback to default
    return GAME_CONSTANTS.SUGAR_DADDY.COEFF_SPEED_PER_SECOND;
  }

  /**
   * Load coefficient distribution config from database or use defaults
   * @param gameCode - Game code
   * @returns Distribution configuration object
   */
  private async loadDistributionConfig(gameCode: string): Promise<{
    ranges: Array<{ name: string; min: number; max: number; weight: number }>;
    distributionType: 'uniform' | 'power';
  }> {
    try {
      const configRaw = await this.gameConfigService.getConfig(gameCode, 'coefficientDistribution');
      
      if (configRaw && configRaw !== '{}') {
        const config = this.tryParseJson(configRaw);
        
        if (config && config.ranges && Array.isArray(config.ranges)) {
          // Validate ranges
          const totalWeight = config.ranges.reduce((sum: number, r: any) => sum + (r.weight || 0), 0);
          if (Math.abs(totalWeight - 1.0) < 0.01) { // Allow small floating point errors
            this.logger.debug(`[loadDistributionConfig] Loaded distribution from database for ${gameCode}`);
            return {
              ranges: config.ranges,
              distributionType: config.distributionType || 'uniform',
            };
          } else {
            this.logger.warn(
              `[loadDistributionConfig] Distribution weights don't sum to 1.0 (sum=${totalWeight}), using defaults`,
            );
          }
        } else {
          this.logger.warn(`[loadDistributionConfig] Invalid distribution config format, using defaults`);
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `[loadDistributionConfig] Failed to load distribution from database: ${error.message}, using defaults`,
      );
    }
    
    // Fallback to defaults (create mutable copy)
    return {
      ranges: GAME_CONSTANTS.SUGAR_DADDY.DEFAULT_DISTRIBUTION.ranges.map(r => ({
        name: r.name,
        min: r.min,
        max: r.max,
        weight: r.weight,
      })),
      distributionType: GAME_CONSTANTS.SUGAR_DADDY.DEFAULT_DISTRIBUTION.distributionType,
    };
  }
}
