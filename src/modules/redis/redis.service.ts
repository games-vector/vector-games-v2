import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import Redis from 'ioredis';
import { DEFAULTS } from '../../config/defaults.config';
import { GameConfigService } from '../game-config/game-config.service';

const REDIS_CONSTANTS = {
  DEFAULT_TTL: DEFAULTS.REDIS.DEFAULT_TTL,
  CONFIG_KEY: DEFAULTS.REDIS.CONFIG_KEY,
} as const;

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private configuredTTL?: number;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
    @Inject(forwardRef(() => GameConfigService))
    private readonly gameConfigService: GameConfigService,
  ) {}

  getClient(): Redis {
    return this.redisClient;
  }

  async set(key: string, value: any, ttl?: number, gameCode?: string): Promise<void> {
    try {
      const effectiveTTL = ttl ?? REDIS_CONSTANTS.DEFAULT_TTL;
      await this.redisClient.set(
        key,
        JSON.stringify(value),
        'EX',
        effectiveTTL,
      );
      this.logger.debug(`Set key: ${key} (TTL: ${effectiveTTL}s)`);
    } catch (error) {
      this.logger.error(`Failed to set key ${key}`, error);
      throw error;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.logger.error(`Failed to get key ${key}`, error);
      throw error;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redisClient.del(key);
      this.logger.debug(`Deleted key: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete key ${key}`, error);
      throw error;
    }
  }

  async flushAll(): Promise<void> {
    try {
      await this.redisClient.flushall();
      this.logger.warn('All Redis keys flushed');
    } catch (error) {
      this.logger.error('Failed to flush Redis', error);
      throw error;
    }
  }

  async getSessionTTL(gameCode: string = 'chicken-road-two'): Promise<number> {
    try {
      const ttlValue = await this.gameConfigService.getConfig(
        gameCode,
        DEFAULTS.REDIS.CONFIG_KEY,
      );
      const parsed = Number(ttlValue);
      if (isFinite(parsed) && parsed > 0) {
        this.logger.debug(`Using configured session TTL: ${parsed}s`);
        return parsed;
      }
    } catch (error) {
      this.logger.debug('Session TTL not configured, using default');
    }

    return DEFAULTS.REDIS.DEFAULT_TTL;
  }

  /**
   * Acquire a distributed lock using Redis SETNX
   * @param key - Lock key
   * @param ttlSeconds - Lock expiration time in seconds (default: 10)
   * @returns true if lock acquired, false if already locked
   */
  async acquireLock(key: string, ttlSeconds: number = 10): Promise<boolean> {
    try {
      const result = await this.redisClient.set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Failed to acquire lock ${key}`, error);
      return false;
    }
  }

  /**
   * Release a distributed lock
   * @param key - Lock key
   */
  async releaseLock(key: string): Promise<void> {
    try {
      await this.redisClient.del(key);
      this.logger.debug(`Released lock: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to release lock ${key}`, error);
    }
  }

  /**
   * Generate idempotency key for bet placement
   * @param gameCode - Game code
   * @param userId - User ID
   * @param agentId - Agent ID
   * @param roundId - Round ID
   * @param betAmount - Bet amount (as string)
   * @param betNumber - Optional bet number (for Sugar Daddy game)
   * @returns Idempotency key string
   */
  generateIdempotencyKey(
    gameCode: string,
    userId: string,
    agentId: string,
    roundId: string,
    betAmount: string,
    betNumber?: number,
  ): string {
    const baseKey = `idempotency:bet:${gameCode}:${userId}:${agentId}:${roundId}:${betAmount}`;
    return betNumber !== undefined ? `${baseKey}:${betNumber}` : baseKey;
  }

  /**
   * Check if idempotency key exists and return stored data
   * @param key - Idempotency key
   * @returns Object with exists flag and stored data (if exists)
   */
  async checkIdempotencyKey<T>(key: string): Promise<{ exists: boolean; data: T | null }> {
    try {
      const data = await this.get<T>(key);
      if (data) {
        this.logger.debug(`Idempotency key found: ${key}`);
        return { exists: true, data };
      }
      return { exists: false, data: null };
    } catch (error) {
      // Fail open - if Redis check fails, log warning but don't block bet
      this.logger.warn(`Failed to check idempotency key ${key}: ${error.message}. Continuing without idempotency check.`);
      return { exists: false, data: null };
    }
  }

  /**
   * Store idempotency key with data
   * @param key - Idempotency key
   * @param data - Data to store
   * @param ttlSeconds - Time to live in seconds (default: 3600 = 1 hour)
   */
  async setIdempotencyKey<T>(key: string, data: T, ttlSeconds: number = 3600): Promise<void> {
    try {
      await this.set(key, data, ttlSeconds);
      this.logger.debug(`Stored idempotency key: ${key} (TTL: ${ttlSeconds}s)`);
    } catch (error) {
      // Log error but don't throw - idempotency is best effort
      this.logger.error(`Failed to store idempotency key ${key}: ${error.message}`);
    }
  }
}
