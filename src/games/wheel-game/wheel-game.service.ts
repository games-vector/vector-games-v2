import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { RedisService } from '../../modules/redis/redis.service';
import { GameConfigService } from '../../modules/game-config/game-config.service';
import { WheelRngService } from './modules/rng/wheel-rng.service';
import { DEFAULTS } from '../../config/defaults.config';
import {
  GameStatus,
  WheelColor,
  WheelBetData,
  WheelBetListPayload,
  WheelRound,
  WheelPendingBet,
  PrevRoundResult,
  GameStatusChangedPayload,
} from './DTO/game-state.dto';

const REDIS_KEYS = {
  ACTIVE_ROUND: 'wheel:active_round',
  PREV_ROUND_RESULTS: 'wheel:prev_round_results',
  ROUND_COUNTER: 'wheel:round_counter',
  LEADER_LOCK: 'wheel:leader_lock',
  PENDING_BETS: 'wheel:pending_bets',
  PENDING_BET_PREFIX: 'wheel:pending_bet:',
  CLIENT_SEED_PREFIX: 'wheel:client_seed:',
  BET_MAPPING_PREFIX: 'wheel:bet:',
};

@Injectable()
export class WheelGameService {
  private readonly logger = new Logger(WheelGameService.name);
  private readonly gameCode = DEFAULTS.WHEEL.GAME_CODE;
  private readonly multipliers = DEFAULTS.WHEEL.MULTIPLIERS;

  // In-memory active round (also backed by Redis for persistence)
  private activeRound: WheelRound | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly gameConfigService: GameConfigService,
    private readonly wheelRngService: WheelRngService,
  ) {}

  // =============================================
  // ROUND MANAGEMENT
  // =============================================

  async startNewRound(): Promise<WheelRound> {
    const roundId = await this.getNextRoundId();
    const gameUUID = uuidv4();
    const serverSeed = this.wheelRngService.generateServerSeed();
    const hashedServerSeed = this.wheelRngService.hashServerSeed(serverSeed);

    // Use a global client seed for the round (individual user seeds in multiplayer are complex)
    const clientSeed = this.wheelRngService.generateClientSeed();
    const nonce = roundId;

    // Generate the spin result
    const spinResult = this.wheelRngService.generateSpinResult(serverSeed, clientSeed, nonce);

    this.activeRound = {
      roundId,
      gameUUID,
      status: GameStatus.WAIT_GAME,
      bets: new Map(),
      cellIndex: spinResult.cellIndex,
      cellColor: spinResult.cellColor,
      inCellOffset: spinResult.inCellOffset,
      serverSeed,
      hashedServerSeed,
      createdAt: Date.now(),
    };

    await this.saveActiveRoundToRedis();

    this.logger.log(
      `[WHEEL] New round started: roundId=${roundId} gameUUID=${gameUUID} cellIndex=${spinResult.cellIndex} cellColor=${spinResult.cellColor}`,
    );

    return this.activeRound;
  }

  async transitionToInGame(): Promise<void> {
    if (!this.activeRound || this.activeRound.status !== GameStatus.WAIT_GAME) {
      this.logger.warn('[WHEEL] Cannot transition to IN_GAME: invalid state');
      return;
    }

    this.activeRound.status = GameStatus.IN_GAME;
    await this.saveActiveRoundToRedis();

    this.logger.log(
      `[WHEEL] Transitioned to IN_GAME: roundId=${this.activeRound.roundId}`,
    );
  }

  async transitionToFinishGame(): Promise<void> {
    if (!this.activeRound || this.activeRound.status !== GameStatus.IN_GAME) {
      this.logger.warn('[WHEEL] Cannot transition to FINISH_GAME: invalid state');
      return;
    }

    this.activeRound.status = GameStatus.FINISH_GAME;
    await this.saveActiveRoundToRedis();

    // Store this result in prev round results
    await this.addPrevRoundResult({
      cellIndex: this.activeRound.cellIndex,
      cellColor: this.activeRound.cellColor,
    });

    this.logger.log(
      `[WHEEL] Transitioned to FINISH_GAME: roundId=${this.activeRound.roundId} cellColor=${this.activeRound.cellColor}`,
    );
  }

  async clearActiveRound(): Promise<void> {
    this.activeRound = null;
    await this.redisService.del(REDIS_KEYS.ACTIVE_ROUND);
  }

  // =============================================
  // BET MANAGEMENT
  // =============================================

  async addBet(bet: WheelBetData): Promise<void> {
    if (!this.activeRound) {
      throw new Error('No active round');
    }
    this.activeRound.bets.set(bet.playerGameId, bet);
    await this.saveActiveRoundToRedis();
  }

  async getUserBets(userId: string): Promise<WheelBetData[]> {
    if (!this.activeRound) return [];
    return Array.from(this.activeRound.bets.values()).filter(
      (bet) => bet.userId === userId,
    );
  }

  async getAllBets(): Promise<WheelBetData[]> {
    if (!this.activeRound) return [];
    return Array.from(this.activeRound.bets.values());
  }

  // =============================================
  // PENDING BETS (for next round)
  // =============================================

  async queueBetForNextRound(pendingBet: WheelPendingBet): Promise<void> {
    const key = `${REDIS_KEYS.PENDING_BET_PREFIX}${pendingBet.userId}:${pendingBet.playerGameId}`;
    await this.redisService.set(key, JSON.stringify(pendingBet), 300); // 5 min TTL

    // Also add to the set of pending bet identifiers
    const identifiers = await this.getAllPendingBetIdentifiers();
    identifiers.push(`${pendingBet.userId}:${pendingBet.playerGameId}`);
    await this.redisService.set(REDIS_KEYS.PENDING_BETS, JSON.stringify(identifiers), 600);
  }

  async getAllPendingBetIdentifiers(): Promise<string[]> {
    const data = await this.redisService.get<string>(REDIS_KEYS.PENDING_BETS);
    if (!data) return [];
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async getPendingBet(userId: string, playerGameId: string): Promise<WheelPendingBet | null> {
    const key = `${REDIS_KEYS.PENDING_BET_PREFIX}${userId}:${playerGameId}`;
    const data = await this.redisService.get<string>(key);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async getAllPendingBetsForUser(userId: string): Promise<WheelPendingBet[]> {
    const identifiers = await this.getAllPendingBetIdentifiers();
    const userBets: WheelPendingBet[] = [];

    for (const identifier of identifiers) {
      if (identifier.startsWith(`${userId}:`)) {
        const pgId = identifier.split(':').slice(1).join(':');
        const bet = await this.getPendingBet(userId, pgId);
        if (bet) userBets.push(bet);
      }
    }

    return userBets;
  }

  async removePendingBet(userId: string, playerGameId: string): Promise<void> {
    const key = `${REDIS_KEYS.PENDING_BET_PREFIX}${userId}:${playerGameId}`;
    await this.redisService.del(key);

    // Remove from identifiers set
    const identifiers = await this.getAllPendingBetIdentifiers();
    const filtered = identifiers.filter((id) => id !== `${userId}:${playerGameId}`);
    await this.redisService.set(REDIS_KEYS.PENDING_BETS, JSON.stringify(filtered), 600);
  }

  async clearAllPendingBets(): Promise<void> {
    const identifiers = await this.getAllPendingBetIdentifiers();
    for (const identifier of identifiers) {
      const [userId, ...rest] = identifier.split(':');
      const playerGameId = rest.join(':');
      const key = `${REDIS_KEYS.PENDING_BET_PREFIX}${userId}:${playerGameId}`;
      await this.redisService.del(key);
    }
    await this.redisService.del(REDIS_KEYS.PENDING_BETS);
  }

  // =============================================
  // BET LIST PAYLOAD (for broadcasting)
  // =============================================

  async getBetListPayload(): Promise<WheelBetListPayload> {
    const bets: WheelBetListPayload = {
      sumInUSD: 0,
      bets: {
        BLACK: [],
        RED: [],
        BLUE: [],
        GREEN: [],
      },
    };

    if (!this.activeRound) return bets;

    for (const bet of this.activeRound.bets.values()) {
      const betAmount = parseFloat(bet.betAmount) || 0;
      // Approximate USD conversion (simplified - in production, use exchange rates)
      bets.sumInUSD += betAmount;
      bets.bets[bet.color].push(bet);
    }

    // Round sumInUSD to 2 decimal places
    bets.sumInUSD = parseFloat(bets.sumInUSD.toFixed(2));

    return bets;
  }

  // =============================================
  // WIN/LOSS PROCESSING
  // =============================================

  getWinningColor(): WheelColor | null {
    if (!this.activeRound) return null;
    return this.activeRound.cellColor;
  }

  getMultiplierForColor(color: WheelColor): number {
    return this.multipliers[color] || 0;
  }

  getWinningBets(): WheelBetData[] {
    if (!this.activeRound) return [];
    const winningColor = this.activeRound.cellColor;
    return Array.from(this.activeRound.bets.values()).filter(
      (bet) => bet.color === winningColor,
    );
  }

  getLosingBets(): WheelBetData[] {
    if (!this.activeRound) return [];
    const winningColor = this.activeRound.cellColor;
    return Array.from(this.activeRound.bets.values()).filter(
      (bet) => bet.color !== winningColor,
    );
  }

  // =============================================
  // GAME STATE
  // =============================================

  getActiveRound(): WheelRound | null {
    return this.activeRound;
  }

  async getGameStateResponse(): Promise<{
    gameId: number;
    status: GameStatus;
    allBets: WheelBetListPayload;
  } | null> {
    if (!this.activeRound) return null;

    const allBets = await this.getBetListPayload();

    return {
      gameId: this.activeRound.roundId,
      status: this.activeRound.status,
      allBets,
    };
  }

  getWaitGamePayload(prevRoundResults?: PrevRoundResult[]): GameStatusChangedPayload {
    return {
      status: GameStatus.WAIT_GAME,
      nextChangeInMs: DEFAULTS.WHEEL.GAME.WAIT_TIME_MS,
      gameId: this.activeRound?.roundId,
      prevRoundResults: prevRoundResults || [],
    };
  }

  getInGamePayload(): GameStatusChangedPayload {
    if (!this.activeRound) {
      throw new Error('No active round for IN_GAME payload');
    }
    return {
      status: GameStatus.IN_GAME,
      nextChangeInMs: DEFAULTS.WHEEL.GAME.SPIN_TIME_MS,
      cellIndex: this.activeRound.cellIndex,
      cellColor: this.activeRound.cellColor,
      inCellOffset: this.activeRound.inCellOffset,
    };
  }

  getFinishGamePayload(): GameStatusChangedPayload {
    if (!this.activeRound) {
      throw new Error('No active round for FINISH_GAME payload');
    }
    return {
      status: GameStatus.FINISH_GAME,
      nextChangeInMs: DEFAULTS.WHEEL.GAME.RESULT_DISPLAY_TIME_MS,
      cellIndex: this.activeRound.cellIndex,
      cellColor: this.activeRound.cellColor,
      inCellOffset: this.activeRound.inCellOffset,
    };
  }

  // =============================================
  // PREV ROUND RESULTS
  // =============================================

  async getPrevRoundResults(): Promise<PrevRoundResult[]> {
    const data = await this.redisService.get<string>(REDIS_KEYS.PREV_ROUND_RESULTS);
    if (!data) return [];
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async addPrevRoundResult(result: PrevRoundResult): Promise<void> {
    const results = await this.getPrevRoundResults();
    results.unshift(result); // Newest first
    // Keep only the latest N results
    const trimmed = results.slice(0, DEFAULTS.WHEEL.GAME.PREV_ROUND_RESULTS_LIMIT);
    await this.redisService.set(
      REDIS_KEYS.PREV_ROUND_RESULTS,
      JSON.stringify(trimmed),
      86400, // 24 hours
    );
  }

  // =============================================
  // GAME CONFIG
  // =============================================

  async getGameConfigPayload(gameCode: string): Promise<{
    betConfig: any;
  }> {
    try {
      const betConfigFromDb = await this.gameConfigService.getConfig(gameCode, 'betConfig');
      if (betConfigFromDb) {
        return { betConfig: JSON.parse(betConfigFromDb) };
      }
    } catch (error) {
      this.logger.debug(`[WHEEL] Using default bet config: ${(error as Error).message}`);
    }

    return {
      betConfig: {
        minBetAmount: DEFAULTS.WHEEL.BET_CONFIG.minBetAmount,
        maxBetAmount: DEFAULTS.WHEEL.BET_CONFIG.maxBetAmount,
        maxWinAmount: DEFAULTS.WHEEL.BET_CONFIG.maxWinAmount,
        defaultBetAmount: DEFAULTS.WHEEL.BET_CONFIG.defaultBetAmount,
        betPresets: DEFAULTS.WHEEL.BET_CONFIG.betPresets,
        decimalPlaces: DEFAULTS.WHEEL.BET_CONFIG.decimalPlaces,
        currency: DEFAULTS.WHEEL.BET_CONFIG.currency,
      },
    };
  }

  // =============================================
  // LEADER ELECTION
  // =============================================

  async acquireLeaderLock(podId: string): Promise<boolean> {
    const key = REDIS_KEYS.LEADER_LOCK;
    const ttl = DEFAULTS.WHEEL.GAME.LEADER_LEASE_TTL;

    try {
      const existing = await this.redisService.get<string>(key);
      if (existing && existing !== podId) {
        return false;
      }

      await this.redisService.set(key, podId, ttl);
      this.logger.log(`[WHEEL_LEADER] Acquired leader lock: podId=${podId}`);
      return true;
    } catch (error) {
      this.logger.error(`[WHEEL_LEADER] Error acquiring lock: ${(error as Error).message}`);
      return false;
    }
  }

  async renewLeaderLock(podId: string): Promise<boolean> {
    const key = REDIS_KEYS.LEADER_LOCK;
    const ttl = DEFAULTS.WHEEL.GAME.LEADER_LEASE_TTL;

    try {
      const existing = await this.redisService.get<string>(key);
      if (existing !== podId) {
        return false;
      }

      await this.redisService.set(key, podId, ttl);
      return true;
    } catch (error) {
      this.logger.error(`[WHEEL_LEADER] Error renewing lock: ${(error as Error).message}`);
      return false;
    }
  }

  async releaseLeaderLock(podId: string): Promise<void> {
    const key = REDIS_KEYS.LEADER_LOCK;
    try {
      const existing = await this.redisService.get<string>(key);
      if (existing === podId) {
        await this.redisService.del(key);
        this.logger.log(`[WHEEL_LEADER] Released leader lock: podId=${podId}`);
      }
    } catch (error) {
      this.logger.error(`[WHEEL_LEADER] Error releasing lock: ${(error as Error).message}`);
    }
  }

  // =============================================
  // REDIS PERSISTENCE
  // =============================================

  async saveActiveRoundToRedis(): Promise<void> {
    if (!this.activeRound) return;

    const serializable = {
      ...this.activeRound,
      bets: Array.from(this.activeRound.bets.entries()),
    };

    await this.redisService.set(
      REDIS_KEYS.ACTIVE_ROUND,
      JSON.stringify(serializable),
      300, // 5 minute TTL
    );
  }

  async loadActiveRoundFromRedis(): Promise<WheelRound | null> {
    const data = await this.redisService.get<string>(REDIS_KEYS.ACTIVE_ROUND);
    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      const round: WheelRound = {
        ...parsed,
        bets: new Map(parsed.bets),
      };
      this.activeRound = round;
      return round;
    } catch {
      return null;
    }
  }

  // =============================================
  // ROUND ID COUNTER
  // =============================================

  private async getNextRoundId(): Promise<number> {
    const key = REDIS_KEYS.ROUND_COUNTER;
    const current = await this.redisService.get<string>(key);
    const nextId = current ? parseInt(current, 10) + 1 : 3600000; // Start from 3600000 like production
    await this.redisService.set(key, String(nextId), 86400 * 30); // 30 day TTL
    return nextId;
  }
}
