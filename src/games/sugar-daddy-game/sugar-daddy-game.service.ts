import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { GameStatus, GameStateChangePayload, CoefficientChangePayload, BetData, CoefficientHistory, PendingBet } from './DTO/game-state.dto';
import { RedisService } from '../../modules/redis/redis.service';
import { DEFAULTS } from '../../config/defaults.config';

import { GameConfigService } from '../../modules/game-config/game-config.service';

interface ActiveRound {
  roundId: number;
  gameUUID: string;
  status: GameStatus;
  currentCoeff: number;
  crashCoeff: number | null;
  startTime: number;
  bets: Map<string, BetData>;
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
}

@Injectable()
export class SugarDaddyGameService {
  private readonly logger = new Logger(SugarDaddyGameService.name);
  private activeRound: ActiveRound | null = null;
  private previousRoundBets: BetData[] = []; // Store bets from last finished round
  private roundCounter = 0;
  private readonly ROUND_DURATION_MS = 10000;
  private readonly COEFF_UPDATE_INTERVAL_MS = 200;
  private readonly MIN_COEFF = 1.00;
  private readonly MAX_COEFF = 1000.00;
  private readonly COEFF_INCREMENT = 0.05;
  // Redis keys - using sugar-daddy prefix for multi-pod compatibility
  private readonly REDIS_KEY_PENDING_BETS = 'sugar-daddy:pending_bets';
  private readonly PENDING_BET_TTL = 300;
  private readonly REDIS_KEY_COEFFICIENT_HISTORY = 'sugar-daddy:coefficient_history';
  private readonly REDIS_KEY_CURRENT_STATE = 'sugar-daddy:current_state';
  private readonly REDIS_KEY_CURRENT_COEFF = 'sugar-daddy:current_coeff';
  private readonly REDIS_KEY_ACTIVE_ROUND = 'sugar-daddy:active_round';
  private readonly REDIS_KEY_PREVIOUS_BETS = 'sugar-daddy:previous_bets';
  private readonly REDIS_KEY_LEADER_LOCK = 'sugar-daddy:engine_lock';
  private readonly COEFFICIENT_HISTORY_LIMIT = 50;
  private readonly LEADER_LOCK_TTL = 30; // 30 seconds - leader must renew every 15 seconds
  private rtp: number | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly gameConfigService: GameConfigService,
  ) { }

  /**
   * Start a new game round (starts in WAIT_GAME state)
   * Stores state in Redis for multi-pod access
   */
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
      serverSeed,
      clientsSeeds: [],
      combinedHash: '',
      decimal: '',
      isRunning: false,
    };

    this.activeRound.crashCoeff = await this.calculateCrashCoefficient(serverSeed);

    // Store in Redis for multi-pod access
    await this.saveActiveRoundToRedis();

    this.logger.log(
      `[SUGAR_DADDY] Started new round: roundId=${roundId} gameUUID=${gameUUID} crashCoeff=${this.activeRound.crashCoeff}`,
    );

    return this.activeRound;
  }

  /**
   * Transition from WAIT_GAME to IN_GAME
   * Updates Redis state for multi-pod access
   */
  async startGame(): Promise<void> {
    // Load from Redis first (in case another pod updated it)
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound || this.activeRound.status !== GameStatus.WAIT_GAME) {
      throw new Error('Cannot start game: not in WAIT_GAME state');
    }

    this.activeRound.status = GameStatus.IN_GAME;
    this.activeRound.isRunning = true;
    this.activeRound.startTime = Date.now();
    this.activeRound.currentCoeff = this.MIN_COEFF;

    // Save to Redis
    await this.saveActiveRoundToRedis();

    this.logger.log(
      `[SUGAR_DADDY] Game started: roundId=${this.activeRound.roundId}`,
    );
  }

  /**
   * Get current game state
   * Reads from Redis for multi-pod compatibility
   */
  async getCurrentGameState(): Promise<GameStateChangePayload | null> {
    // Try to load from Redis first (for multi-pod)
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return null;
    }

    // Use actual bets from the active round instead of mock bets
    // This ensures bet amounts remain constant during IN_GAME state
    const actualBets: BetData[] = Array.from(this.activeRound.bets.values());
    const totalBetsAmount = actualBets.reduce(
      (sum, bet) => sum + parseFloat(bet.betAmount || '0'),
      0,
    );

    // Load previous bets from Redis
    const previousBets = await this.getPreviousBetsFromRedis();
    const previousBetsTotalAmount = previousBets.reduce(
      (sum, bet) => sum + parseFloat(bet.betAmount || '0'),
      0,
    );

    let waitTime: number | null = null;
    if (this.activeRound.status === GameStatus.WAIT_GAME) {
      const elapsed = Date.now() - this.activeRound.startTime;
      const waitDuration = 10000;
      waitTime = Math.max(0, waitDuration - elapsed);
    }

    const payload: GameStateChangePayload = {
      status: this.activeRound.status,
      roundId: this.activeRound.roundId,
      waitTime,
      bets: {
        totalBetsAmount,
        values: actualBets,
      },
      previousBets: {
        totalBetsAmount: previousBetsTotalAmount,
        values: previousBets,
      },
    };

    if (this.activeRound.status === GameStatus.FINISH_GAME && this.activeRound.crashCoeff) {
      payload.coeffCrash = this.activeRound.crashCoeff;
      payload.coefficients = [];
    }

    return payload;
  }

  /**
   * Get current coefficient
   * Reads from Redis for multi-pod compatibility
   */
  async getCurrentCoefficient(): Promise<CoefficientChangePayload | null> {
    // Load from Redis first
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound || !this.activeRound.isRunning) {
      return null;
    }

    return {
      coeff: this.activeRound.currentCoeff,
    };
  }

  /**
   * Update coefficient during game
   * Also handles auto-cashout for bets with coeffAuto
   * Saves to Redis for multi-pod access
   */
  async updateCoefficient(): Promise<boolean> {
    // Load from Redis first (in case another pod updated it)
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound || !this.activeRound.isRunning) {
      return false;
    }

    const elapsed = Date.now() - this.activeRound.startTime;
    const crashCoeff = this.activeRound.crashCoeff || this.MAX_COEFF;

    const newCoeff = Math.min(
      this.MIN_COEFF + (elapsed / this.ROUND_DURATION_MS) * (crashCoeff - this.MIN_COEFF),
      crashCoeff,
    );

    this.activeRound.currentCoeff = parseFloat(newCoeff.toFixed(2));

    // Save to Redis immediately
    await this.saveActiveRoundToRedis();
    await this.saveCurrentCoefficientToRedis();

    // Auto-cashout is now handled in gateway during coefficient broadcast

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
  async getAutoCashoutBets(): Promise<Array<{ playerGameId: string; bet: BetData }>> {
    // Load from Redis first
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return [];
    }

    const currentCoeff = this.activeRound.currentCoeff;
    const autoCashoutBets: Array<{ playerGameId: string; bet: BetData }> = [];

    for (const [playerGameId, bet] of this.activeRound.bets.entries()) {
      // Skip if already cashed out
      if (bet.coeffWin && bet.winAmount) {
        continue;
      }

      // Check if bet has coeffAuto and current coefficient reached it
      if (bet.coeffAuto) {
        const autoCoeff = parseFloat(bet.coeffAuto);
        if (currentCoeff >= autoCoeff) {
          autoCashoutBets.push({ playerGameId, bet });
        }
      }
    }

    return autoCashoutBets;
  }

  /**
   * Mark bet as auto-cashed out (called after settlement)
   * Saves to Redis for multi-pod access
   */
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

      // Save to Redis
      await this.saveActiveRoundToRedis();

      this.logger.log(
        `[AUTO_CASHOUT_MARKED] playerGameId=${playerGameId} coeff=${coeffWin} winAmount=${winAmount}`,
      );
    }
  }

  /**
   * End the current round
   * Saves state to Redis for multi-pod access
   */
  async endRound(): Promise<void> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return;
    }

    this.activeRound.status = GameStatus.FINISH_GAME;
    this.activeRound.isRunning = false;
    this.activeRound.currentCoeff = this.activeRound.crashCoeff || this.MIN_COEFF;

    this.calculateWins();

    // Store finished round bets as previous bets for next round (in Redis)
    const finishedBets = Array.from(this.activeRound.bets.values());
    await this.savePreviousBetsToRedis(finishedBets);

    // Store finished round in coefficient history
    await this.storeFinishedRound();

    // Save final state to Redis
    await this.saveActiveRoundToRedis();

    this.logger.log(
      `[SUGAR_DADDY] Round ended: roundId=${this.activeRound.roundId} crashCoeff=${this.activeRound.crashCoeff} previousBetsCount=${finishedBets.length}`,
    );
  }

  /**
   * Calculate wins for all bets when round ends
   */
  private calculateWins(): void {
    if (!this.activeRound) {
      return;
    }

    const crashCoeff = this.activeRound.crashCoeff || this.MIN_COEFF;

    for (const [playerGameId, bet] of this.activeRound.bets.entries()) {
      if (bet.coeffWin && bet.winAmount) {
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

    // Save to Redis immediately
    await this.saveActiveRoundToRedis();

    this.logger.debug(`[SUGAR_DADDY] Bet added: playerGameId=${bet.playerGameId} amount=${bet.betAmount}`);
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

    // Save to Redis
    await this.saveActiveRoundToRedis();

    this.logger.log(
      `[SUGAR_DADDY] Bet cashed out: playerGameId=${playerGameId} coeff=${winCoeff} winAmount=${winAmount}`,
    );

    return bet;
  }

  async getBet(playerGameId: string): Promise<BetData | null> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      this.logger.debug(`[GET_BET] No active round found for playerGameId=${playerGameId}`);
      return null;
    }
    
    const bet = this.activeRound.bets.get(playerGameId);
    if (!bet) {
      this.logger.debug(
        `[GET_BET] Bet not found in active round: playerGameId=${playerGameId} roundId=${this.activeRound.roundId} status=${this.activeRound.status} totalBets=${this.activeRound.bets.size}`,
      );
    }
    return bet || null;
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

  async getActiveRound(): Promise<ActiveRound | null> {
    await this.loadActiveRoundFromRedis();
    return this.activeRound;
  }

  async clearActiveRound(): Promise<void> {
    // Clear from Redis and memory
    const redisClient = this.redisService.getClient();
    await redisClient.del(this.REDIS_KEY_ACTIVE_ROUND);
    await redisClient.del(this.REDIS_KEY_CURRENT_STATE);
    await redisClient.del(this.REDIS_KEY_CURRENT_COEFF);
    this.activeRound = null;
  }

  /**
   * Calculate crash coefficient based on RTP (Return to Player)
   * 
   * RTP controls the distribution of crash coefficients:
   * - Lower RTP (90%) = more frequent crashes at lower coefficients (higher house edge)
   * - Higher RTP (97%) = less frequent crashes at lower coefficients (lower house edge)
   * 
   * The exponent in the power function controls the distribution curve:
   * - Lower exponent (0.3) = bias toward lower coefficients = lower RTP
   * - Higher exponent (0.65) = bias toward higher coefficients = higher RTP
   * 
   * Formula: exponent = 0.3 + (RTP - 90) * 0.045
   * This maps RTP 90-99% to exponent 0.3-0.705
   */
  private async calculateCrashCoefficient(serverSeed: string): Promise<number> {
    const min = 1.00;
    const max = 10.00;
    const random = Math.random();

    // Use cached RTP or fallback to default
    const rtp = this.rtp || DEFAULTS.GAMES.SUGAR_DADDY.RTP;

    const rtpExponent = 0.3 + (rtp - 90) * 0.045;
    const exponent = Math.max(0.2, Math.min(0.8, rtpExponent));

    const coeff = min + (max - min) * Math.pow(random, exponent);

    this.logger.debug(
      `[RTP] Calculated crash coefficient: coeff=${coeff.toFixed(2)} RTP=${rtp}% exponent=${exponent.toFixed(3)}`,
    );

    return parseFloat(coeff.toFixed(2));
  }

  private generateServerSeed(): string {
    return Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  }

  /**
   * Get coefficient history from Redis
   * Returns last N finished rounds (default 50)
   */
  async getCoefficientsHistory(limit: number = 50): Promise<CoefficientHistory[]> {
    try {
      const redisClient = this.redisService.getClient();
      const historyKey = this.REDIS_KEY_COEFFICIENT_HISTORY;

      // Get last N entries from Redis list
      const historyData = await redisClient.lrange(historyKey, 0, limit - 1);

      if (!historyData || historyData.length === 0) {
        return [];
      }

      // Parse and return coefficient history
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

      return history;
    } catch (error) {
      this.logger.error(`[COEFF_HISTORY] Error fetching coefficient history: ${error.message}`);
      return [];
    }
  }

  /**
   * Store finished round in Redis coefficient history
   */
  private async storeFinishedRound(): Promise<void> {
    if (!this.activeRound || !this.activeRound.crashCoeff) {
      return;
    }

    try {
      // Calculate combined hash and decimal if not already calculated
      let combinedHash = this.activeRound.combinedHash;
      let decimal = this.activeRound.decimal;

      if (!combinedHash || !decimal) {
        // Generate combined hash from server seed and client seeds
        const crypto = require('crypto');
        const seedString = this.activeRound.serverSeed +
          this.activeRound.clientsSeeds.map(c => c.seed).join('');
        combinedHash = crypto.createHash('sha256').update(seedString).digest('hex');

        // Calculate decimal (convert hex to decimal)
        const hexValue = combinedHash.substring(0, 16);
        decimal = (parseInt(hexValue, 16) / Math.pow(16, 16)).toExponential();

        this.activeRound.combinedHash = combinedHash;
        this.activeRound.decimal = decimal;
      }

      const historyEntry: CoefficientHistory = {
        coeff: this.activeRound.crashCoeff,
        gameId: this.activeRound.roundId,
        gameUUID: this.activeRound.gameUUID,
        serverSeed: this.activeRound.serverSeed,
        clientsSeeds: this.activeRound.clientsSeeds,
        combinedHash: combinedHash,
        decimal: decimal,
      };

      const redisClient = this.redisService.getClient();
      const historyKey = this.REDIS_KEY_COEFFICIENT_HISTORY;

      // Add to beginning of list (newest first)
      await redisClient.lpush(historyKey, JSON.stringify(historyEntry));

      // Trim list to keep only last N entries
      await redisClient.ltrim(historyKey, 0, this.COEFFICIENT_HISTORY_LIMIT - 1);

      this.logger.debug(
        `[COEFF_HISTORY] Stored finished round: roundId=${this.activeRound.roundId} coeff=${this.activeRound.crashCoeff}`,
      );
    } catch (error) {
      this.logger.error(
        `[COEFF_HISTORY] Error storing finished round: ${error.message}`,
      );
    }
  }

  /**
   * Queue a bet for the next round
   */
  async queueBetForNextRound(pendingBet: PendingBet): Promise<void> {
    const userPendingBetKey = `${this.REDIS_KEY_PENDING_BETS}:${pendingBet.userId}`;

    await this.redisService.set(userPendingBetKey, pendingBet, this.PENDING_BET_TTL);

    const pendingUsersKey = `${this.REDIS_KEY_PENDING_BETS}:users`;
    const redisClient = this.redisService.getClient();
    await redisClient.sadd(pendingUsersKey, pendingBet.userId);
    await redisClient.expire(pendingUsersKey, this.PENDING_BET_TTL);

    this.logger.log(
      `[QUEUE_BET] Queued bet for next round: userId=${pendingBet.userId} amount=${pendingBet.betAmount} currency=${pendingBet.currency}`,
    );
  }

  async getPendingBet(userId: string): Promise<PendingBet | null> {
    const userPendingBetKey = `${this.REDIS_KEY_PENDING_BETS}:${userId}`;
    return await this.redisService.get<PendingBet>(userPendingBetKey);
  }

  async getAllPendingBetUsers(): Promise<string[]> {
    const pendingUsersKey = `${this.REDIS_KEY_PENDING_BETS}:users`;
    const redisClient = this.redisService.getClient();
    const userIds = await redisClient.smembers(pendingUsersKey);
    return userIds || [];
  }

  async removePendingBet(userId: string): Promise<void> {
    const userPendingBetKey = `${this.REDIS_KEY_PENDING_BETS}:${userId}`;
    const pendingUsersKey = `${this.REDIS_KEY_PENDING_BETS}:users`;

    await this.redisService.del(userPendingBetKey);

    const redisClient = this.redisService.getClient();
    await redisClient.srem(pendingUsersKey, userId);

    this.logger.debug(`[REMOVE_PENDING_BET] Removed pending bet for userId=${userId}`);
  }

  async addPendingBetToRound(pendingBet: PendingBet, gameUUID: string): Promise<BetData> {
    await this.loadActiveRoundFromRedis();

    const playerGameId = uuidv4();
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
      await this.saveActiveRoundToRedis();
    }

    this.logger.log(
      `[PROCESS_PENDING_BET] Added pending bet to round: userId=${pendingBet.userId} playerGameId=${playerGameId} amount=${pendingBet.betAmount}`,
    );

    return betData;
  }

  // ========== Redis State Management Methods ==========

  /**
   * Save active round to Redis for multi-pod access
   */
  private async saveActiveRoundToRedis(): Promise<void> {
    if (!this.activeRound) {
      return;
    }

    try {
      const redisClient = this.redisService.getClient();

      // Convert Map to array for JSON serialization
      const betsArray = Array.from(this.activeRound.bets.entries());

      const roundData = {
        roundId: this.activeRound.roundId,
        gameUUID: this.activeRound.gameUUID,
        status: this.activeRound.status,
        currentCoeff: this.activeRound.currentCoeff,
        crashCoeff: this.activeRound.crashCoeff,
        startTime: this.activeRound.startTime,
        bets: betsArray, // Store as array of [key, value] pairs
        serverSeed: this.activeRound.serverSeed,
        clientsSeeds: this.activeRound.clientsSeeds,
        combinedHash: this.activeRound.combinedHash,
        decimal: this.activeRound.decimal,
        isRunning: this.activeRound.isRunning,
      };

      await redisClient.set(this.REDIS_KEY_ACTIVE_ROUND, JSON.stringify(roundData));

      // Also save current state for quick access
      const gameState = await this.buildGameStatePayload();
      if (gameState) {
        await redisClient.set(this.REDIS_KEY_CURRENT_STATE, JSON.stringify(gameState));
      }
    } catch (error) {
      this.logger.error(`[REDIS_SAVE] Error saving active round: ${error.message}`);
    }
  }

  /**
   * Load active round from Redis
   */
  private async loadActiveRoundFromRedis(): Promise<void> {
    try {
      const redisClient = this.redisService.getClient();
      const roundDataStr = await redisClient.get(this.REDIS_KEY_ACTIVE_ROUND);

      if (!roundDataStr) {
        this.activeRound = null;
        return;
      }

      const roundData = JSON.parse(roundDataStr);

      // Reconstruct Map from array
      const betsMap = new Map<string, BetData>();
      if (roundData.bets && Array.isArray(roundData.bets)) {
        for (const [key, value] of roundData.bets) {
          betsMap.set(key, value as BetData);
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
        serverSeed: roundData.serverSeed,
        clientsSeeds: roundData.clientsSeeds || [],
        combinedHash: roundData.combinedHash || '',
        decimal: roundData.decimal || '',
        isRunning: roundData.isRunning || false,
      };
    } catch (error) {
      this.logger.error(`[REDIS_LOAD] Error loading active round: ${error.message}`);
      this.activeRound = null;
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
    } catch (error) {
      this.logger.error(`[REDIS_SAVE] Error saving current coefficient: ${error.message}`);
    }
  }

  /**
   * Save previous bets to Redis
   */
  private async savePreviousBetsToRedis(bets: BetData[]): Promise<void> {
    try {
      const redisClient = this.redisService.getClient();
      await redisClient.set(this.REDIS_KEY_PREVIOUS_BETS, JSON.stringify(bets));
    } catch (error) {
      this.logger.error(`[REDIS_SAVE] Error saving previous bets: ${error.message}`);
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
    } catch (error) {
      this.logger.error(`[REDIS_LOAD] Error loading previous bets: ${error.message}`);
      return [];
    }
  }

  /**
   * Build game state payload (helper for Redis storage)
   */
  private async buildGameStatePayload(): Promise<GameStateChangePayload | null> {
    if (!this.activeRound) {
      return null;
    }

    const actualBets: BetData[] = Array.from(this.activeRound.bets.values());
    const totalBetsAmount = actualBets.reduce(
      (sum, bet) => sum + parseFloat(bet.betAmount || '0'),
      0,
    );

    const previousBets = await this.getPreviousBetsFromRedis();
    const previousBetsTotalAmount = previousBets.reduce(
      (sum, bet) => sum + parseFloat(bet.betAmount || '0'),
      0,
    );

    let waitTime: number | null = null;
    if (this.activeRound.status === GameStatus.WAIT_GAME) {
      const elapsed = Date.now() - this.activeRound.startTime;
      const waitDuration = 10000;
      waitTime = Math.max(0, waitDuration - elapsed);
    }

    const payload: GameStateChangePayload = {
      status: this.activeRound.status,
      roundId: this.activeRound.roundId,
      waitTime,
      bets: {
        totalBetsAmount,
        values: actualBets,
      },
      previousBets: {
        totalBetsAmount: previousBetsTotalAmount,
        values: previousBets,
      },
    };

    if (this.activeRound.status === GameStatus.FINISH_GAME && this.activeRound.crashCoeff) {
      payload.coeffCrash = this.activeRound.crashCoeff;
      payload.coefficients = [];
    }

    return payload;
  }

  // ========== Leader Election Methods ==========

  /**
   * Try to acquire leader lock for game engine
   * Returns true if this pod becomes the leader
   */
  async acquireLeaderLock(podId: string): Promise<boolean> {
    try {
      const redisClient = this.redisService.getClient();
      const lockKey = this.REDIS_KEY_LEADER_LOCK;

      // Try to set lock with SETNX (set if not exists)
      const result = await redisClient.set(
        lockKey,
        podId,
        'EX',
        this.LEADER_LOCK_TTL,
        'NX', // Only set if key doesn't exist
      );

      if (result === 'OK') {
        this.logger.log(`[LEADER_ELECTION] Pod ${podId} acquired leader lock`);
        return true;
      }

      // Check if we already own the lock
      const currentLeader = await redisClient.get(lockKey);
      if (currentLeader === podId) {
        // Renew the lock
        await redisClient.expire(lockKey, this.LEADER_LOCK_TTL);
        return true;
      }

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

      // Check if we still own the lock
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

      // Only delete if we own the lock
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

  /**
 * Safe config getter - returns empty string on error for graceful fallback
 */
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
   * Load RTP from database and cache it
   * Call this when game starts or when config might have changed
   */
  async loadRTP(gameCode: string): Promise<number> {
    const config = await this.getGameConfigPayload(gameCode);
    this.rtp = config.rtp;
    this.logger.log(`[loadRTP] Loaded RTP=${this.rtp}% for gameCode=${gameCode}`);
    return this.rtp;
  }
}
