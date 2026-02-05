import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { DEFAULTS } from '../../../../config/defaults.config';
import { WheelColor } from '../../DTO/game-state.dto';

@Injectable()
export class WheelRngService {
  private readonly wheelSegments: string[] = DEFAULTS.WHEEL.WHEEL_SEGMENTS;
  private readonly totalSegments: number = DEFAULTS.WHEEL.GAME.TOTAL_SEGMENTS;

  /**
   * Generate a wheel spin result using provably fair system
   * @returns cellIndex (0-52) and inCellOffset (0-1)
   */
  generateSpinResult(serverSeed: string, clientSeed: string, nonce: number): {
    cellIndex: number;
    cellColor: WheelColor;
    inCellOffset: number;
  } {
    const combinedHash = this.calculateCombinedHash(serverSeed, clientSeed, nonce);

    // Use first 8 hex chars for cell index
    const indexHex = combinedHash.substring(0, 8);
    const indexValue = parseInt(indexHex, 16);
    const cellIndex = indexValue % this.totalSegments;

    // Use next 8 hex chars for inCellOffset (0-1 float for animation precision)
    const offsetHex = combinedHash.substring(8, 16);
    const offsetValue = parseInt(offsetHex, 16);
    const inCellOffset = parseFloat((offsetValue / 0xFFFFFFFF).toFixed(3));

    const cellColor = this.wheelSegments[cellIndex] as WheelColor;

    return { cellIndex, cellColor, inCellOffset };
  }

  /**
   * Verify a spin result given the seeds and nonce
   */
  verifySpinResult(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
    expectedCellIndex: number,
  ): boolean {
    const result = this.generateSpinResult(serverSeed, clientSeed, nonce);
    return result.cellIndex === expectedCellIndex;
  }

  /**
   * Get the color for a given cell index
   */
  getColorForIndex(cellIndex: number): WheelColor {
    return this.wheelSegments[cellIndex] as WheelColor;
  }

  generateServerSeed(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  generateClientSeed(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  hashServerSeed(serverSeed: string): string {
    return crypto.createHash('sha256').update(serverSeed).digest('hex');
  }

  calculateCombinedHash(serverSeed: string, clientSeed: string, nonce: number): string {
    const input = `${serverSeed}:${clientSeed}:${nonce}`;
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  calculateDecimal(combinedHash: string): string {
    const hexValue = combinedHash.substring(0, 16);
    const decimalValue = parseInt(hexValue, 16) / Math.pow(16, 16);
    return decimalValue.toString();
  }
}
