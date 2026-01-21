import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../../modules/redis/redis.service';
import * as crypto from 'crypto';

export interface FairnessData {
  userSeed: string;
  serverSeed: string;
  hashedServerSeed: string;
  nonce: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class FairnessService {
  private readonly logger = new Logger(FairnessService.name);
  private readonly FAIRNESS_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

  constructor(private readonly redisService: RedisService) {}

  /**
   * Get Redis key for user fairness data
   */
  private getFairnessKey(userId: string, agentId: string): string {
    return `fairness:${userId}-${agentId}`;
  }

  /**
   * Generate a random 16-character hex string for user seed
   */
  private generateUserSeed(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Generate a random 32-byte hex string for server seed
   */
  private generateServerSeed(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash server seed using SHA256
   */
  private hashServerSeed(serverSeed: string): string {
    return crypto.createHash('sha256').update(serverSeed).digest('hex');
  }

  /**
   * Get or create fairness data for a user
   * If data doesn't exist, creates new seeds
   */
  async getOrCreateFairness(
    userId: string,
    agentId: string,
  ): Promise<FairnessData> {
    const key = this.getFairnessKey(userId, agentId);
    const existing = await this.redisService.get<FairnessData>(key);

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
  ): Promise<FairnessData | null> {
    const key = this.getFairnessKey(userId, agentId);
    return await this.redisService.get<FairnessData>(key);
  }

  /**
   * Update user seed
   */
  async setUserSeed(
    userId: string,
    agentId: string,
    userSeed: string,
  ): Promise<FairnessData> {
    // Validate user seed format (16 hex characters)
    if (!/^[0-9a-fA-F]{16}$/.test(userSeed)) {
      throw new Error('Invalid user seed format. Must be 16 hexadecimal characters.');
    }

    const key = this.getFairnessKey(userId, agentId);
    const existing = await this.getOrCreateFairness(userId, agentId);

    const updated: FairnessData = {
      ...existing,
      userSeed: userSeed.toLowerCase(),
      updatedAt: new Date(),
    };

    await this.redisService.set(key, updated, this.FAIRNESS_TTL);

    this.logger.log(
      `Updated user seed for user=${userId} agent=${agentId}`,
    );

    return updated;
  }

  /**
   * Rotate seeds after bet settlement
   * Increments nonce and generates new server seed
   */
  async rotateSeeds(userId: string, agentId: string): Promise<FairnessData> {
    const key = this.getFairnessKey(userId, agentId);
    const existing = await this.getOrCreateFairness(userId, agentId);

    const newServerSeed = this.generateServerSeed();
    const newHashedServerSeed = this.hashServerSeed(newServerSeed);

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
   * Calculate combined hash from user seed and server seed
   */
  calculateCombinedHash(userSeed: string, serverSeed: string): string {
    const combined = `${userSeed}${serverSeed}`;
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
   * Generate complete fairness data for bet history
   */
  generateFairnessDataForBet(
    userSeed: string,
    serverSeed: string,
  ): {
    decimal: string;
    clientSeed: string;
    serverSeed: string;
    combinedHash: string;
    hashedServerSeed: string;
  } {
    const combinedHash = this.calculateCombinedHash(userSeed, serverSeed);
    const hashedServerSeed = this.hashServerSeed(serverSeed);
    const decimal = this.calculateDecimal(combinedHash);

    return {
      decimal,
      clientSeed: userSeed,
      serverSeed,
      combinedHash,
      hashedServerSeed,
    };
  }
}
