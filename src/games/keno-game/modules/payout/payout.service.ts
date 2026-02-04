import { Injectable, Logger } from '@nestjs/common';
import { Risk } from '../../DTO/bet-payload.dto';

/**
 * Payout table type: payoutTables[risk][selectionCount][hits] = multiplier
 */
type PayoutTable = {
  [key in Risk]: {
    [selectionCount: number]: {
      [hits: number]: number;
    };
  };
};

/**
 * Complete payout tables for Keno game
 * Based on KENO_BACKEND_SPECIFICATION.md
 */
const PAYOUT_TABLES: PayoutTable = {
  [Risk.LOW]: {
    1: { 0: 0, 1: 2.85 },
    2: { 0: 0, 1: 1.35, 2: 4.1 },
    3: { 0: 0, 1: 1.3, 2: 2.54, 3: 5 },
    4: { 0: 0, 1: 1.1, 2: 1.72, 3: 5, 4: 10 },
    5: { 0: 0, 1: 0.25, 2: 1.36, 3: 5, 4: 10, 5: 15 },
    6: { 0: 0, 1: 0, 2: 1.5, 3: 2, 4: 5, 5: 13, 6: 20 },
    7: { 0: 0, 1: 0, 2: 0.5, 3: 2, 4: 5, 5: 10, 6: 20, 7: 50 },
    8: { 0: 0, 1: 0, 2: 0, 3: 2, 4: 4, 5: 8, 6: 15, 7: 50, 8: 100 },
    9: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 3, 5: 5, 6: 10, 7: 30, 8: 100, 9: 200 },
    10: { 0: 0, 1: 0.1, 2: 0.25, 3: 1.25, 4: 2, 5: 10, 6: 22, 7: 50, 8: 100, 9: 250, 10: 300 },
  },
  [Risk.MEDIUM]: {
    1: { 0: 0, 1: 3.8 },
    2: { 0: 0, 1: 1.8, 2: 5 },
    3: { 0: 0, 1: 1.2, 2: 2.42, 3: 8 },
    4: { 0: 0, 1: 0.8, 2: 2, 3: 6, 4: 20 },
    5: { 0: 0, 1: 0.5, 2: 1.4, 3: 3.45, 4: 10, 5: 35 },
    6: { 0: 0, 1: 0.25, 2: 1.4, 3: 2.1, 4: 5, 5: 25, 6: 50 },
    7: { 0: 0, 1: 0, 2: 1, 3: 2.5, 4: 6, 5: 15, 6: 40, 7: 100 },
    8: { 0: 0, 1: 0, 2: 0.5, 3: 2, 4: 5, 5: 12, 6: 30, 7: 100, 8: 250 },
    9: { 0: 0, 1: 0, 2: 0, 3: 1.5, 4: 4, 5: 8, 6: 20, 7: 60, 8: 200, 9: 500 },
    10: { 0: 0, 1: 0, 2: 0.25, 3: 1.1, 4: 2.45, 5: 10, 6: 25, 7: 50, 8: 250, 9: 500, 10: 1000 },
  },
  [Risk.HIGH]: {
    1: { 0: 0, 1: 5.5 },
    2: { 0: 0, 1: 2, 2: 8 },
    3: { 0: 0, 1: 1, 2: 2.62, 3: 15 },
    4: { 0: 0, 1: 0, 2: 2.5, 3: 8, 4: 40 },
    5: { 0: 0, 1: 0, 2: 2, 3: 3.3, 4: 15, 5: 50 },
    6: { 0: 0, 1: 0, 2: 1.1, 3: 2.25, 4: 10, 5: 50, 6: 100 },
    7: { 0: 0, 1: 0, 2: 0.5, 3: 2.5, 4: 8, 5: 25, 6: 80, 7: 200 },
    8: { 0: 0, 1: 0, 2: 0, 3: 2, 4: 6, 5: 18, 6: 50, 7: 200, 8: 500 },
    9: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 4, 5: 10, 6: 35, 7: 100, 8: 400, 9: 1000 },
    10: { 0: 0, 1: 0, 2: 0, 3: 0.98, 4: 2.7, 5: 10, 6: 50, 7: 100, 8: 500, 9: 1000, 10: 10000 },
  },
};

export interface PayoutResult {
  hits: number[];
  hitCount: number;
  multiplier: number;
  winAmount: number;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  /**
   * Calculate hits between chosen numbers and drawn numbers
   * @param chosenNumbers - Player's selected numbers
   * @param drawnNumbers - Server-drawn numbers
   * @returns Array of matching numbers
   */
  calculateHits(chosenNumbers: number[], drawnNumbers: number[]): number[] {
    const drawnSet = new Set(drawnNumbers);
    return chosenNumbers.filter((num) => drawnSet.has(num));
  }

  /**
   * Get multiplier from payout table
   * @param risk - Risk level (LOW, MEDIUM, HIGH)
   * @param selectionCount - Number of selections (1-10)
   * @param hitCount - Number of hits
   * @returns Multiplier value
   */
  getMultiplier(risk: Risk, selectionCount: number, hitCount: number): number {
    const riskTable = PAYOUT_TABLES[risk];
    if (!riskTable) {
      this.logger.warn(`Invalid risk level: ${risk}`);
      return 0;
    }

    const selectionTable = riskTable[selectionCount];
    if (!selectionTable) {
      this.logger.warn(`Invalid selection count: ${selectionCount}`);
      return 0;
    }

    const multiplier = selectionTable[hitCount];
    if (multiplier === undefined) {
      this.logger.warn(
        `No multiplier found for risk=${risk} selections=${selectionCount} hits=${hitCount}`,
      );
      return 0;
    }

    return multiplier;
  }

  /**
   * Calculate complete payout result
   * @param chosenNumbers - Player's selected numbers
   * @param drawnNumbers - Server-drawn numbers
   * @param betAmount - Bet amount
   * @param risk - Risk level
   * @returns Complete payout result
   */
  calculatePayout(
    chosenNumbers: number[],
    drawnNumbers: number[],
    betAmount: number,
    risk: Risk,
  ): PayoutResult {
    const hits = this.calculateHits(chosenNumbers, drawnNumbers);
    const hitCount = hits.length;
    const selectionCount = chosenNumbers.length;
    const multiplier = this.getMultiplier(risk, selectionCount, hitCount);
    const winAmount = betAmount * multiplier;

    this.logger.debug(
      `Payout calculated: risk=${risk} selections=${selectionCount} hits=${hitCount} multiplier=${multiplier} bet=${betAmount} win=${winAmount}`,
    );

    return {
      hits,
      hitCount,
      multiplier,
      winAmount,
    };
  }

  /**
   * Get payout table for a specific risk level and selection count
   * Used for displaying potential payouts to the player
   * @param risk - Risk level
   * @param selectionCount - Number of selections
   * @returns Payout table for the selection count
   */
  getPayoutTable(
    risk: Risk,
    selectionCount: number,
  ): { [hits: number]: number } | null {
    const riskTable = PAYOUT_TABLES[risk];
    if (!riskTable) {
      return null;
    }

    return riskTable[selectionCount] || null;
  }

  /**
   * Get all payout tables (for game config response)
   */
  getAllPayoutTables(): PayoutTable {
    return PAYOUT_TABLES;
  }
}
