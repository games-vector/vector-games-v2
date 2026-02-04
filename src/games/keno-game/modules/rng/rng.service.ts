import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Random Number Generator Service for Keno
 * Uses provably fair system to generate 10 unique random numbers from 1-40
 */
@Injectable()
export class RngService {
  private readonly logger = new Logger(RngService.name);

  /**
   * Generate 10 unique random numbers from 1-40 using provably fair seeds
   *
   * @param serverSeed - Server seed (hex string)
   * @param clientSeed - Client/user seed (hex string)
   * @param nonce - Bet nonce (increments each bet)
   * @returns Array of 10 unique numbers from 1-40
   */
  generateKenoNumbers(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
  ): number[] {
    const numbers: number[] = [];
    let cursor = 0;

    // Keep generating until we have 10 unique numbers
    while (numbers.length < 10) {
      // Create combined seed with cursor to generate different values
      const combinedSeed = `${serverSeed}:${clientSeed}:${nonce}:${cursor}`;
      const hash = crypto.createHash('sha256').update(combinedSeed).digest('hex');

      // Extract numbers from hash (4 hex chars = 16 bits per number attempt)
      for (let i = 0; i < hash.length - 3 && numbers.length < 10; i += 4) {
        const hexChunk = hash.substring(i, i + 4);
        const value = parseInt(hexChunk, 16);

        // Map to 1-40 range
        const number = (value % 40) + 1;

        // Only add if unique
        if (!numbers.includes(number)) {
          numbers.push(number);
        }
      }

      cursor++;

      // Safety check to prevent infinite loops
      if (cursor > 100) {
        this.logger.error('RNG safety limit reached, forcing completion');
        break;
      }
    }

    this.logger.debug(
      `Generated Keno numbers: [${numbers.join(', ')}] with nonce=${nonce}`,
    );

    return numbers;
  }

  /**
   * Generate a random server seed
   * @returns 64-character hex string
   */
  generateServerSeed(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generate a random client seed
   * @returns 16-character hex string
   */
  generateClientSeed(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Hash a server seed using SHA-256
   * @param serverSeed - Server seed to hash
   * @returns Hashed server seed
   */
  hashServerSeed(serverSeed: string): string {
    return crypto.createHash('sha256').update(serverSeed).digest('hex');
  }

  /**
   * Calculate combined hash from user seed and server seed
   * @param clientSeed - Client/user seed
   * @param serverSeed - Server seed
   * @returns Combined SHA-512 hash
   */
  calculateCombinedHash(clientSeed: string, serverSeed: string): string {
    const combined = `${clientSeed}${serverSeed}`;
    return crypto.createHash('sha512').update(combined).digest('hex');
  }

  /**
   * Calculate decimal value from combined hash for display
   * @param combinedHash - Combined hash string
   * @returns Decimal string representation
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
   * Verify that given numbers could have been generated from the seeds
   * @param serverSeed - Server seed
   * @param clientSeed - Client seed
   * @param nonce - Nonce used
   * @param numbers - Numbers to verify
   * @returns true if numbers match regenerated numbers
   */
  verifyNumbers(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
    numbers: number[],
  ): boolean {
    const regenerated = this.generateKenoNumbers(serverSeed, clientSeed, nonce);

    if (regenerated.length !== numbers.length) {
      return false;
    }

    // Numbers should match exactly in order
    return regenerated.every((num, index) => num === numbers[index]);
  }
}
