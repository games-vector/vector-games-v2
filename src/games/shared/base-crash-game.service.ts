import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { GameStatus, GameStateChangePayload, CoefficientChangePayload, BetData, CoefficientHistory, PendingBet } from './DTO/game-state.dto';
import { RedisService } from '../../modules/redis/redis.service';
import { GameConfigService } from '../../modules/game-config/game-config.service';
import { GAME_CONSTANTS } from '../../common/game-constants';
import { generateMockBets, scheduleMockBetsCashouts, MockBetsConfig, DEFAULT_MOCK_BETS_CONFIG } from './mock-bets.service';

interface ActiveRound {
  roundId: number;
  gameUUID: string;
  status: GameStatus;
  currentCoeff: number;
  crashCoeff: number | null;
  startTime: number;
  bets: Map<string, BetData>;
  mockBetsCashoutSchedule?: Map<string, { playerGameId: string; cashoutCoeff: number }>;
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
export abstract class BaseCrashGameService {
  protected readonly logger: Logger;
  protected readonly gameCode: string;
  protected activeRound: ActiveRound | null = null;
  protected previousRoundBets: BetData[] = [];
  protected roundCounter = 0;
  protected rtp: number | null = null;
  protected pendingMockBets: BetData[] = [];

  protected abstract getGameConstants(): typeof GAME_CONSTANTS.SUGAR_DADDY;

  /**
   * Get mock bets configuration for this game
   * Override in child classes to customize
   */
  protected getMockBetsConfig(): Partial<MockBetsConfig> {
    return {};
  }

  constructor(
    gameCode: string,
    private readonly redisService: RedisService,
    private readonly gameConfigService: GameConfigService,
  ) {
    this.gameCode = gameCode;
    this.logger = new Logger(`${this.constructor.name}[${gameCode}]`);
  }

  protected getRedisKey(key: string): string {
    return `${this.gameCode}:${key}`;
  }

  protected get ROUND_DURATION_MS(): number {
    return this.getGameConstants().ROUND_DURATION_MS;
  }

  protected get COEFF_UPDATE_INTERVAL_MS(): number {
    return this.getGameConstants().COEFF_UPDATE_INTERVAL_MS;
  }

  protected get MIN_COEFF(): number {
    return this.getGameConstants().MIN_COEFF;
  }

  protected get MAX_COEFF(): number {
    return this.getGameConstants().MAX_COEFF;
  }

  protected get COEFF_INCREMENT(): number {
    return this.getGameConstants().COEFF_INCREMENT;
  }

  protected get REDIS_KEY_PENDING_BETS(): string {
    return this.getRedisKey('pending_bets');
  }

  protected get PENDING_BET_TTL(): number {
    return this.getGameConstants().PENDING_BET_TTL;
  }

  protected get REDIS_KEY_COEFFICIENT_HISTORY(): string {
    return this.getRedisKey('coefficient_history');
  }

  protected get REDIS_KEY_CURRENT_STATE(): string {
    return this.getRedisKey('current_state');
  }

  protected get REDIS_KEY_CURRENT_COEFF(): string {
    return this.getRedisKey('current_coeff');
  }

  protected get REDIS_KEY_ACTIVE_ROUND(): string {
    return this.getRedisKey('active_round');
  }

  protected get REDIS_KEY_PREVIOUS_BETS(): string {
    return this.getRedisKey('previous_bets');
  }

  protected get REDIS_KEY_LEADER_LOCK(): string {
    return this.getRedisKey('engine_lock');
  }

  protected get COEFFICIENT_HISTORY_LIMIT(): number {
    return this.getGameConstants().COEFFICIENT_HISTORY_LIMIT;
  }

  protected get LEADER_LOCK_TTL(): number {
    return this.getGameConstants().LEADER_LOCK_TTL;
  }

  async startNewRound(): Promise<ActiveRound> {
    if (this.rtp === null) {
      await this.loadRTP(this.gameCode);
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
    };

    this.activeRound.crashCoeff = await this.calculateCrashCoefficient(serverSeed);

    // Generate mock bets for this round
    const mockBetsConfig = this.getMockBetsConfig();
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

    this.logger.log(
      `Started new round: roundId=${roundId} gameUUID=${gameUUID} crashCoeff=${this.activeRound.crashCoeff}`,
    );

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

    this.logger.log(
      `Game started: roundId=${this.activeRound.roundId}`,
    );
  }

  async getCurrentGameState(): Promise<GameStateChangePayload | null> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      this.logger.debug(`No active round found`);
      return null;
    }

    const payload = await this.buildGameStatePayload();
    
    if (payload) {
      this.logger.debug(
        `Returning state: status=${payload.status} roundId=${payload.roundId} betsCount=${payload.bets.values.length}`,
      );
    }

    return payload;
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
      this.logger.debug(
        `Cannot update: activeRound=${!!this.activeRound} isRunning=${this.activeRound?.isRunning || false}`,
      );
      return false;
    }

    const elapsed = Date.now() - this.activeRound.startTime;
    const elapsedSeconds = elapsed / 1000;
    const crashCoeff = this.activeRound.crashCoeff || this.MAX_COEFF;

    const speed = await this.loadCoefficientSpeed(this.gameCode);

    const newCoeff = Math.min(
      this.MIN_COEFF + (elapsedSeconds * speed),
      crashCoeff,
    );

    this.activeRound.currentCoeff = parseFloat(newCoeff.toFixed(2));

    await this.saveActiveRoundToRedis();
    await this.saveCurrentCoefficientToRedis();

    if (this.activeRound.currentCoeff >= crashCoeff) {
      this.logger.log(
        `Coefficient reached crash point: currentCoeff=${this.activeRound.currentCoeff} crashCoeff=${crashCoeff} roundId=${this.activeRound.roundId} elapsed=${elapsedSeconds.toFixed(2)}s. Calling endRound()`,
      );
      await this.endRound();
      this.logger.log(
        `endRound() completed, returning false to stop coefficient broadcast`,
      );
      return false;
    }

    return true;
  }

  async getAutoCashoutBets(): Promise<Array<{ playerGameId: string; bet: BetData }>> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      return [];
    }

    const currentCoeff = this.activeRound.currentCoeff;
    const autoCashoutBets: Array<{ playerGameId: string; bet: BetData }> = [];

    for (const [playerGameId, bet] of this.activeRound.bets.entries()) {
      if (bet.coeffWin && bet.winAmount) {
        continue;
      }

      if (bet.coeffAuto) {
        const autoCoeff = parseFloat(bet.coeffAuto);
        const roundedCurrentCoeff = Math.round(currentCoeff * GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION) / GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION;
        const roundedAutoCoeff = Math.round(autoCoeff * GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION) / GAME_CONSTANTS.COEFFICIENT.ROUNDING_PRECISION;
        
        if (roundedCurrentCoeff >= roundedAutoCoeff) {
          this.logger.debug(
            `Bet eligible: playerGameId=${playerGameId} betNumber=${bet.betNumber} currentCoeff=${roundedCurrentCoeff} autoCoeff=${roundedAutoCoeff}`,
          );
          autoCashoutBets.push({ playerGameId, bet });
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

      this.logger.log(
        `Marked bet as auto-cashed out: playerGameId=${playerGameId} coeff=${coeffWin} winAmount=${winAmount}`,
      );
    }
  }

  async endRound(): Promise<void> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      this.logger.warn(`No active round to end`);
      return;
    }

    this.logger.log(
      `Starting endRound: roundId=${this.activeRound.roundId} currentStatus=${this.activeRound.status} crashCoeff=${this.activeRound.crashCoeff}`,
    );

    this.activeRound.status = GameStatus.FINISH_GAME;
    this.activeRound.isRunning = false;
    this.activeRound.currentCoeff = this.activeRound.crashCoeff || this.MIN_COEFF;

    this.calculateWins();

    const finishedBets = Array.from(this.activeRound.bets.values());
    await this.savePreviousBetsToRedis(finishedBets);
    await this.storeFinishedRound();
    await this.saveActiveRoundToRedis();

    this.logger.log(
      `Round ended successfully: roundId=${this.activeRound.roundId} status=${this.activeRound.status} crashCoeff=${this.activeRound.crashCoeff} previousBetsCount=${finishedBets.length} betsCount=${this.activeRound.bets.size}`,
    );
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
      
      this.logger.debug(`Generated client seed for userId=${bet.userId}`);
    }

    await this.saveActiveRoundToRedis();

    this.logger.debug(`Bet added: playerGameId=${bet.playerGameId} amount=${bet.betAmount}`);
  }

  /**
   * Add a batch of mock bets to the active round
   */
  async addMockBetsBatch(bets: BetData[]): Promise<void> {
    await this.loadActiveRoundFromRedis();
    if (!this.activeRound) {
      return;
    }

    for (const bet of bets) {
      this.activeRound.bets.set(bet.playerGameId, bet);

      // Add client seed for mock bets (treat them as real bets except wallet/DB)
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

  /**
   * Remove mock bets from pending list
   */
  removePendingMockBets(bets: BetData[]): void {
    const betIds = new Set(bets.map(b => b.playerGameId));
    this.pendingMockBets = this.pendingMockBets.filter(b => !betIds.has(b.playerGameId));
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
      `Bet cashed out: playerGameId=${playerGameId} coeff=${winCoeff} winAmount=${winAmount}`,
    );

    return bet;
  }

  async getBet(playerGameId: string): Promise<BetData | null> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      this.logger.debug(`No active round found for playerGameId=${playerGameId}`);
      return null;
    }
    
    const bet = this.activeRound.bets.get(playerGameId);
    if (!bet) {
      this.logger.debug(
        `Bet not found in active round: playerGameId=${playerGameId} roundId=${this.activeRound.roundId} status=${this.activeRound.status} totalBets=${this.activeRound.bets.size}`,
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

  async getGameSeeds(userId: string): Promise<{ userSeed: string; hashedServerSeed: string } | null> {
    await this.loadActiveRoundFromRedis();

    if (!this.activeRound) {
      this.logger.debug(`No active round found for userId=${userId}`);
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
      
      this.logger.debug(`Generated new client seed for userId=${userId}`);
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

  async clearActiveRound(): Promise<void> {
    const redisClient = this.redisService.getClient();
    await redisClient.del(this.REDIS_KEY_ACTIVE_ROUND);
    await redisClient.del(this.REDIS_KEY_CURRENT_STATE);
    await redisClient.del(this.REDIS_KEY_CURRENT_COEFF);
    this.activeRound = null;
  }

  private async calculateCrashCoefficient(serverSeed: string): Promise<number> {
    const distribution = await this.loadDistributionConfig(this.gameCode);
    
    const randomBytes = crypto.randomBytes(8);
    const randomValue = randomBytes.readUInt32BE(0) / (0xFFFFFFFF + 1);

    let cumulativeWeight = 0;
    let selectedRange = distribution.ranges[0];
    
    for (const range of distribution.ranges) {
      cumulativeWeight += range.weight;
      if (randomValue < cumulativeWeight) {
        selectedRange = range;
        break;
      }
    }

    const rangeRandomBytes = crypto.randomBytes(8);
    const rangeRandom = rangeRandomBytes.readUInt32BE(0) / (0xFFFFFFFF + 1);
    
    let coeff: number;
    if (distribution.distributionType === 'power') {
      const rangeSize = selectedRange.max - selectedRange.min;
      const powerExponent = 0.5;
      const normalizedRandom = Math.pow(rangeRandom, powerExponent);
      coeff = selectedRange.min + rangeSize * normalizedRandom;
    } else {
      const rangeSize = selectedRange.max - selectedRange.min;
      coeff = selectedRange.min + rangeSize * rangeRandom;
    }

    coeff = Math.max(selectedRange.min, Math.min(selectedRange.max, coeff));

    this.logger.debug(
      `Calculated crash coefficient: coeff=${coeff.toFixed(GAME_CONSTANTS.COEFFICIENT.DECIMAL_PLACES)} range=${selectedRange.name} (${selectedRange.min}-${selectedRange.max}x)`,
    );

    return parseFloat(coeff.toFixed(GAME_CONSTANTS.COEFFICIENT.DECIMAL_PLACES));
  }

  private generateServerSeed(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async getCoefficientsHistory(limit: number = this.COEFFICIENT_HISTORY_LIMIT): Promise<CoefficientHistory[]> {
    try {
      const redisClient = this.redisService.getClient();
      const historyKey = this.REDIS_KEY_COEFFICIENT_HISTORY;

      const historyData = await redisClient.lrange(historyKey, 0, limit - 1);

      if (!historyData || historyData.length === 0) {
        return [];
      }

      const history: CoefficientHistory[] = historyData
        .map((data) => {
          try {
            return JSON.parse(data) as CoefficientHistory;
          } catch (error) {
            this.logger.warn(`Failed to parse history entry: ${error.message}`);
            return null;
          }
        })
        .filter((entry): entry is CoefficientHistory => entry !== null);

      return history;
    } catch (error) {
      this.logger.error(`Error fetching coefficient history: ${error.message}`);
      return [];
    }
  }

  private async storeFinishedRound(): Promise<void> {
    if (!this.activeRound || !this.activeRound.crashCoeff) {
      return;
    }

    try {
      const currentStatus = this.activeRound.status;
      this.logger.debug(
        `Saving status before reload: status=${currentStatus} roundId=${this.activeRound.roundId}`,
      );
      
      await this.loadActiveRoundFromRedis();
      
      if (!this.activeRound) {
        this.logger.error(`Active round is null after reload`);
        return;
      }
      
      const reloadedStatus = this.activeRound.status;
      this.activeRound.status = currentStatus;
      this.logger.debug(
        `Restored status after reload: was=${reloadedStatus} restored=${currentStatus} roundId=${this.activeRound.roundId}`,
      );

      const topClientsSeeds = this.getTopClientsSeeds(3);
      
      this.logger.log(
        `Preparing to store: roundId=${this.activeRound.roundId} clientsSeedsCount=${topClientsSeeds.length} activeRoundClientsSeedsCount=${this.activeRound.clientsSeeds?.length || 0}`,
      );

      let combinedHash = this.activeRound.combinedHash;
      let decimal = this.activeRound.decimal;

      if (!combinedHash || !decimal) {
        const seedString = this.activeRound.serverSeed +
          this.activeRound.clientsSeeds.map(c => c.seed).join('');
        combinedHash = crypto.createHash('sha256').update(seedString).digest('hex');

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
        clientsSeeds: topClientsSeeds,
        combinedHash: combinedHash,
        decimal: decimal,
      };

      this.logger.debug(
        `Storing finished round: roundId=${this.activeRound.roundId} coeff=${this.activeRound.crashCoeff} clientsSeedsCount=${historyEntry.clientsSeeds.length}`,
      );

      const redisClient = this.redisService.getClient();
      const historyKey = this.REDIS_KEY_COEFFICIENT_HISTORY;

      await redisClient.lpush(historyKey, JSON.stringify(historyEntry));
      await redisClient.ltrim(historyKey, 0, this.COEFFICIENT_HISTORY_LIMIT - 1);

      this.logger.debug(
        `Stored finished round: roundId=${this.activeRound.roundId} coeff=${this.activeRound.crashCoeff}`,
      );
    } catch (error) {
      this.logger.error(
        `Error storing finished round: ${error.message}`,
      );
    }
  }

  private getTopClientsSeeds(limit: number = 3): Array<{
    userId: string;
    seed: string;
    nickname: string;
    gameAvatar: number | null;
  }> {
    if (!this.activeRound) {
      this.logger.warn(`Active round is null`);
      return [];
    }

    if (this.activeRound.clientsSeeds && this.activeRound.clientsSeeds.length > 0) {
      const topSeeds = this.activeRound.clientsSeeds.slice(0, limit);
      this.logger.debug(
        `Returning ${topSeeds.length} clientsSeeds from activeRound (total: ${this.activeRound.clientsSeeds.length})`,
      );
      return topSeeds;
    }

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
        `Generated ${topSeeds.length} clientsSeeds from bets (fallback)`,
      );
      return topSeeds;
    }

    this.logger.warn(`No clientsSeeds available and no bets found`);
    return [];
  }

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
      `Queued bet for next round: userId=${pendingBet.userId} betNumber=${pendingBet.betNumber} amount=${pendingBet.betAmount} currency=${pendingBet.currency}`,
    );
  }

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

  async getAllPendingBetsForUser(userId: string): Promise<PendingBet[]> {
    const bets: PendingBet[] = [];
    const bet0 = await this.getPendingBet(userId, 0);
    if (bet0) bets.push(bet0);
    const bet1 = await this.getPendingBet(userId, 1);
    if (bet1) bets.push(bet1);
    return bets;
  }

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

      this.logger.debug(`Removed pending bet for userId=${userId} betNumber=${betNumber}`);
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
      await this.saveActiveRoundToRedis();
    }

    this.logger.log(
      `Added pending bet to round: userId=${pendingBet.userId} playerGameId=${playerGameId} amount=${pendingBet.betAmount}`,
    );

    return betData;
  }

  async saveActiveRoundToRedis(): Promise<void> {
    if (!this.activeRound) {
      return;
    }

    try {
      const redisClient = this.redisService.getClient();

      const betsArray = Array.from(this.activeRound.bets.entries());
      const mockBetsCashoutScheduleArray = this.activeRound.mockBetsCashoutSchedule
        ? Array.from(this.activeRound.mockBetsCashoutSchedule.entries())
        : [];

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
      };

      await redisClient.set(this.REDIS_KEY_ACTIVE_ROUND, JSON.stringify(roundData));

      const gameState = await this.buildGameStatePayload();
      if (gameState) {
        await redisClient.set(this.REDIS_KEY_CURRENT_STATE, JSON.stringify(gameState));
      }
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      const errorStack = error?.stack || '';
      this.logger.error(
        `Error saving active round: ${errorMessage}. RoundId: ${this.activeRound?.roundId}`,
        errorStack,
      );
    }
  }

  private async loadActiveRoundFromRedis(): Promise<void> {
    try {
      const redisClient = this.redisService.getClient();
      const roundDataStr = await redisClient.get(this.REDIS_KEY_ACTIVE_ROUND);

      if (!roundDataStr) {
        if (this.activeRound) {
          this.logger.warn(
            `No round data in Redis but in-memory round exists. RoundId: ${this.activeRound.roundId}`,
          );
        }
        this.activeRound = null;
        return;
      }

      const roundData = JSON.parse(roundDataStr);

      const betsMap = new Map<string, BetData>();
      if (roundData.bets && Array.isArray(roundData.bets)) {
        for (const [key, value] of roundData.bets) {
          betsMap.set(key, value as BetData);
        }
      }

      let clientsSeeds: Array<{ userId: string; seed: string; nickname: string; gameAvatar: number | null }> = [];
      if (roundData.clientsSeeds) {
        if (Array.isArray(roundData.clientsSeeds)) {
          clientsSeeds = roundData.clientsSeeds;
        } else if (typeof roundData.clientsSeeds === 'object') {
          clientsSeeds = Object.values(roundData.clientsSeeds);
        }
      }

      const mockBetsCashoutScheduleMap = new Map<string, { playerGameId: string; cashoutCoeff: number }>();
      if (roundData.mockBetsCashoutSchedule && Array.isArray(roundData.mockBetsCashoutSchedule)) {
        for (const [key, value] of roundData.mockBetsCashoutSchedule) {
          mockBetsCashoutScheduleMap.set(key, value as { playerGameId: string; cashoutCoeff: number });
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
        mockBetsCashoutSchedule: mockBetsCashoutScheduleMap.size > 0 ? mockBetsCashoutScheduleMap : new Map(),
        serverSeed: roundData.serverSeed,
        clientsSeeds: clientsSeeds,
        combinedHash: roundData.combinedHash || '',
        decimal: roundData.decimal || '',
        isRunning: roundData.isRunning || false,
      };
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      const errorStack = error?.stack || '';
      this.logger.error(
        `Error loading active round: ${errorMessage}. Keeping existing in-memory state if available.`,
        errorStack,
      );
      if (!this.activeRound) {
        this.activeRound = null;
      }
    }
  }

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
        `Error saving current coefficient: ${errorMessage}. Coefficient: ${this.activeRound.currentCoeff}`,
      );
    }
  }

  private async savePreviousBetsToRedis(bets: BetData[]): Promise<void> {
    try {
      const redisClient = this.redisService.getClient();
      await redisClient.set(this.REDIS_KEY_PREVIOUS_BETS, JSON.stringify(bets));
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(
        `Error saving previous bets: ${errorMessage}. Bet count: ${bets.length}`,
      );
    }
  }

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
        `Error loading previous bets: ${errorMessage}. Returning empty array.`,
      );
      return [];
    }
  }

  private async buildGameStatePayload(): Promise<GameStateChangePayload | null> {
    if (!this.activeRound) {
      return null;
    }

    const actualBets: BetData[] = Array.from(this.activeRound.bets.values())
      .sort((a, b) => parseFloat(b.betAmount || '0') - parseFloat(a.betAmount || '0'));
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
      const waitDuration = this.getGameConstants().WAIT_DURATION_MS;
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
      payload.coefficients = await this.getCoefficientsHistory(this.COEFFICIENT_HISTORY_LIMIT);
    }

    return payload;
  }

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
        this.logger.log(`Pod ${podId} acquired leader lock`);
        return true;
      }

      const currentLeader = await redisClient.get(lockKey);
      if (currentLeader === podId) {
        await redisClient.expire(lockKey, this.LEADER_LOCK_TTL);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Error acquiring lock: ${error.message}`);
      return false;
    }
  }

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
      this.logger.error(`Error renewing lock: ${error.message}`);
      return false;
    }
  }

  async releaseLeaderLock(podId: string): Promise<void> {
    try {
      const redisClient = this.redisService.getClient();
      const lockKey = this.REDIS_KEY_LEADER_LOCK;

      const currentLeader = await redisClient.get(lockKey);
      if (currentLeader === podId) {
        await redisClient.del(lockKey);
        this.logger.log(`Pod ${podId} released leader lock`);
      }
    } catch (error) {
      this.logger.error(`Error releasing lock: ${error.message}`);
    }
  }

  async isLeader(podId: string): Promise<boolean> {
    try {
      const redisClient = this.redisService.getClient();
      const currentLeader = await redisClient.get(this.REDIS_KEY_LEADER_LOCK);
      return currentLeader === podId;
    } catch (error) {
      this.logger.error(`Error checking leader: ${error.message}`);
      return false;
    }
  }

  private async safeGetConfig(gameCode: string, key: string): Promise<string> {
    try {
      const raw = await this.gameConfigService.getConfig(gameCode, key);
      return raw || '{}';
    } catch (e: any) {
      this.logger.warn(`Config key ${key} not available for ${gameCode}: ${e.message}`);
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

  async getGameConfigPayload(gameCode: string): Promise<{
    betConfig: any;
    rtp: number;
  }> {
    try {
      const betConfigRaw = await this.safeGetConfig(gameCode, 'betConfig');
      const rtpRaw = await this.safeGetConfig(gameCode, 'RTP');

      const betConfig = this.tryParseJson(betConfigRaw) || {};
      const rtp = rtpRaw && rtpRaw !== '{}' ? parseFloat(rtpRaw) : null;

      const defaultConfig = this.getDefaultGameConfig();

      return {
        betConfig: betConfig || defaultConfig.betConfig,
        rtp: rtp || defaultConfig.rtp,
      };
    } catch (e: any) {
      this.logger.error(`Failed building game config payload for ${gameCode}: ${e.message}`);
      const defaultConfig = this.getDefaultGameConfig();
      return {
        betConfig: defaultConfig.betConfig,
        rtp: defaultConfig.rtp,
      };
    }
  }

  protected abstract getDefaultGameConfig(): { betConfig: any; rtp: number };

  async loadRTP(gameCode: string): Promise<number> {
    try {
      const rtpRaw = await this.gameConfigService.getConfig(gameCode, 'RTP');
      
      if (rtpRaw && rtpRaw !== '{}') {
        const rtp = parseFloat(rtpRaw);
        if (!isNaN(rtp) && rtp >= 0 && rtp <= 100) {
          this.rtp = rtp;
          this.logger.log(`Loaded RTP=${this.rtp}% from database for gameCode=${gameCode}`);
          return this.rtp;
        } else {
          this.logger.warn(`Invalid RTP value in database: ${rtpRaw}, using default`);
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to load RTP from database: ${error.message}, using default`);
    }
    
    const defaultConfig = this.getDefaultGameConfig();
    this.rtp = defaultConfig.rtp;
    this.logger.log(`Using default RTP=${this.rtp}% for gameCode=${gameCode}`);
    return this.rtp;
  }

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
            `Invalid speed value in database: ${speedRaw} (must be > 0 and <= 10), using default`,
          );
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `Failed to load speed from database: ${error.message}, using default`,
      );
    }
    
    return this.getGameConstants().COEFF_SPEED_PER_SECOND;
  }

  private async loadDistributionConfig(gameCode: string): Promise<{
    ranges: Array<{ name: string; min: number; max: number; weight: number }>;
    distributionType: 'uniform' | 'power';
  }> {
    try {
      const configRaw = await this.gameConfigService.getConfig(gameCode, 'coefficientDistribution');
      
      if (configRaw && configRaw !== '{}') {
        const config = this.tryParseJson(configRaw);
        
        if (config && config.ranges && Array.isArray(config.ranges)) {
          const totalWeight = config.ranges.reduce((sum: number, r: any) => sum + (r.weight || 0), 0);
          if (Math.abs(totalWeight - 1.0) < 0.01) {
            this.logger.debug(`Loaded distribution from database for ${gameCode}`);
            return {
              ranges: config.ranges,
              distributionType: config.distributionType || 'uniform',
            };
          } else {
            this.logger.warn(
              `Distribution weights don't sum to 1.0 (sum=${totalWeight}), using defaults`,
            );
          }
        } else {
          this.logger.warn(`Invalid distribution config format, using defaults`);
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `Failed to load distribution from database: ${error.message}, using defaults`,
      );
    }
    
    return {
      ranges: this.getGameConstants().DEFAULT_DISTRIBUTION.ranges.map(r => ({
        name: r.name,
        min: r.min,
        max: r.max,
        weight: r.weight,
      })),
      distributionType: this.getGameConstants().DEFAULT_DISTRIBUTION.distributionType,
    };
  }
}
