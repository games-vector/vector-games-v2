import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../../modules/redis/redis.service';
import * as crypto from 'crypto';
import { CoinChoice } from '../../DTO/bet-payload.dto';

export interface CoinFlipFairnessData {
  userSeed: string;
  serverSeed: string;
  hashedServerSeed: string;
  nonce: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CoinFlipFairnessProof {
  decimal: string;
  clientSeed: string;
  serverSeed: string;
  combinedHash: string;
  hashedServerSeed: string;
  nonce: number;
}

@Injectable()
export class CoinFlipFairnessService {
  private readonly logger = new Logger(CoinFlipFairnessService.name);
  private readonly FAIRNESS_TTL = 24 * 60 * 60; // 1 day in seconds

  constructor(private readonly redisService: RedisService) {}

  /**
   * Get Redis key for user fairness data
   */
  private getFairnessKey(userId: string, agentId: string): string {
    return `coinflip:fairness:${userId}-${agentId}`;
  }

  /**
   * Generate a random 16-character hex string for user seed
   */
  generateUserSeed(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Generate a random 32-byte hex string for server seed
   */
  generateServerSeed(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash server seed using SHA256
   */
  hashServerSeed(serverSeed: string): string {
    return crypto.createHash('sha256').update(serverSeed).digest('hex');
  }

  /**
   * Generate coin flip result using provably fair algorithm
   *
   * @param serverSeed - Server's secret seed
   * @param userSeed - User's seed
   * @param nonce - Nonce value for this flip
   * @returns 'HEADS' or 'TAILS'
   */
  generateCoinFlipResult(
    serverSeed: string,
    userSeed: string,
    nonce: number,
  ): CoinChoice {
    // Combine seeds with nonce
    const combined = `${serverSeed}:${userSeed}:${nonce}`;

    // Generate SHA256 hash
    const hash = crypto.createHash('sha256').update(combined).digest('hex');

    // Parse first 8 hex characters as decimal
    const decimal = parseInt(hash.substring(0, 8), 16);

    // Return HEADS if even, TAILS if odd
    return decimal % 2 === 0 ? CoinChoice.HEADS : CoinChoice.TAILS;
  }

  /**
   * Get or create fairness data for a user
   */
  async getOrCreateFairness(
    userId: string,
    agentId: string,
  ): Promise<CoinFlipFairnessData> {
    const key = this.getFairnessKey(userId, agentId);
    const existing = await this.redisService.get<CoinFlipFairnessData>(key);

    if (existing) {
      this.logger.debug(
        `Retrieved existing fairness data for user=${userId} agent=${agentId}`,
      );
      return existing;
    }

    // Create new fairness data
    const userSeed = this.generateUserSeed();
    const serverSeed = this.generateServerSeed();
    const hashedServerSeed = this.hashServerSeed(serverSeed);
    const now = new Date();

    const fairnessData: CoinFlipFairnessData = {
      userSeed,
      serverSeed,
      hashedServerSeed,
      nonce: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.redisService.set(key, fairnessData, this.FAIRNESS_TTL);

    this.logger.log(
      `Created new fairness data for user=${userId} agent=${agentId} nonce=${fairnessData.nonce}`,
    );

    return fairnessData;
  }

  /**
   * Get current fairness data (without creating if missing)
   */
  async getFairness(
    userId: string,
    agentId: string,
  ): Promise<CoinFlipFairnessData | null> {
    const key = this.getFairnessKey(userId, agentId);
    return await this.redisService.get<CoinFlipFairnessData>(key);
  }

  /**
   * Update user seed
   * Accepts any non-empty string. If not 16 hex chars, normalizes it to 16 hex via hashing.
   */
  async setUserSeed(
    userId: string,
    agentId: string,
    userSeed: string,
  ): Promise<CoinFlipFairnessData> {
    if (!userSeed || typeof userSeed !== 'string' || userSeed.trim().length === 0) {
      throw new Error('User seed cannot be empty.');
    }

    // Normalize user seed: if not valid 16 hex chars, hash it to produce one
    let normalizedSeed: string;
    if (/^[0-9a-fA-F]{16}$/.test(userSeed)) {
      normalizedSeed = userSeed.toLowerCase();
    } else {
      // Hash the input to produce a valid 16-character hex seed
      const hash = crypto.createHash('sha256').update(userSeed).digest('hex');
      normalizedSeed = hash.substring(0, 16);
      this.logger.debug(
        `Normalized user seed from "${userSeed.substring(0, 20)}..." to ${normalizedSeed}`,
      );
    }

    const key = this.getFairnessKey(userId, agentId);
    const existing = await this.getOrCreateFairness(userId, agentId);

    const updated: CoinFlipFairnessData = {
      ...existing,
      userSeed: normalizedSeed,
      updatedAt: new Date(),
    };

    await this.redisService.set(key, updated, this.FAIRNESS_TTL);

    this.logger.log(
      `Updated user seed for user=${userId} agent=${agentId}`,
    );

    return updated;
  }

  /**
   * Increment nonce after each flip
   */
  async incrementNonce(
    userId: string,
    agentId: string,
  ): Promise<CoinFlipFairnessData> {
    const key = this.getFairnessKey(userId, agentId);
    const existing = await this.getOrCreateFairness(userId, agentId);

    const updated: CoinFlipFairnessData = {
      ...existing,
      nonce: existing.nonce + 1,
      updatedAt: new Date(),
    };

    await this.redisService.set(key, updated, this.FAIRNESS_TTL);

    this.logger.debug(
      `Incremented nonce for user=${userId} agent=${agentId} newNonce=${updated.nonce}`,
    );

    return updated;
  }

  /**
   * Rotate seeds after bet settlement
   * Increments nonce and generates new server seed
   */
  async rotateSeeds(userId: string, agentId: string): Promise<CoinFlipFairnessData> {
    const key = this.getFairnessKey(userId, agentId);
    const existing = await this.getOrCreateFairness(userId, agentId);

    const newServerSeed = this.generateServerSeed();
    const newHashedServerSeed = this.hashServerSeed(newServerSeed);

    const rotated: CoinFlipFairnessData = {
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
   * Calculate combined hash using the same format as generateCoinFlipResult
   * so that provably fair verification matches the actual game result algorithm.
   */
  calculateCombinedHash(serverSeed: string, userSeed: string, nonce: number): string {
    const combined = `${serverSeed}:${userSeed}:${nonce}`;
    return crypto.createHash('sha256').update(combined).digest('hex');
  }

  /**
   * Calculate decimal value from combined hash
   */
  calculateDecimal(combinedHash: string): string {
    // Take first 20 characters as hex, convert to decimal
    const hashPrefix = combinedHash.substring(0, 20);
    const decimalValue = BigInt('0x' + hashPrefix).toString();

    // Format as exponential if too large
    const numValue = parseFloat(decimalValue);
    if (numValue > 1e100) {
      return numValue.toExponential();
    }
    return decimalValue;
  }

  /**
   * Get fairness data for a completed game session
   */
  getFairnessData(session: {
    userSeed?: string;
    serverSeed?: string;
    hashedServerSeed?: string;
    nonce?: number;
  }): CoinFlipFairnessProof | null {
    if (!session.userSeed || !session.serverSeed) {
      return null;
    }

    const nonce = session.nonce ?? 0;
    const combinedHash = this.calculateCombinedHash(session.serverSeed, session.userSeed, nonce);
    const decimal = this.calculateDecimal(combinedHash);

    return {
      decimal,
      clientSeed: session.userSeed,
      serverSeed: session.serverSeed,
      combinedHash,
      hashedServerSeed: session.hashedServerSeed || this.hashServerSeed(session.serverSeed),
      nonce,
    };
  }

  /**
   * Generate complete fairness data for bet history.
   * Uses the same combined string format as generateCoinFlipResult so verification matches.
   */
  generateFairnessDataForBet(
    userSeed: string,
    serverSeed: string,
    nonce: number,
  ): CoinFlipFairnessProof {
    const combinedHash = this.calculateCombinedHash(serverSeed, userSeed, nonce);
    const hashedServerSeed = this.hashServerSeed(serverSeed);
    const decimal = this.calculateDecimal(combinedHash);

    return {
      decimal,
      clientSeed: userSeed,
      serverSeed,
      combinedHash,
      hashedServerSeed,
      nonce,
    };
  }
}
