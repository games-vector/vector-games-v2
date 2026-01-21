import { Injectable, Logger } from '@nestjs/common';
import { HazardState } from './interfaces/hazard-state.interface';

/**
 * Pure hazard generation and validation logic
 * No side effects - only generates patterns and performs checks
 */
@Injectable()
export class HazardGeneratorService {
  private readonly logger = new Logger(HazardGeneratorService.name);

  /**
   * Generate a random unique pattern of hazard column indices
   * @param hazardCount Number of hazards to generate
   * @param totalColumns Total available columns (0-indexed)
   * @returns Sorted array of unique column indices
   */
  generateRandomPattern(hazardCount: number, totalColumns: number): number[] {
    const count = Math.min(hazardCount, totalColumns);
    const hazards = new Set<number>();

    while (hazards.size < count) {
      const columnIndex = Math.floor(Math.random() * totalColumns);
      hazards.add(columnIndex);
    }

    return Array.from(hazards).sort((a, b) => a - b);
  }

  /**
   * Check if a specific column is a hazard for the given state
   * Respects the changeAt timing to determine active pattern
   * @param columnIndex Column index to check (0-based)
   * @param state Current hazard state
   * @returns True if column is currently a hazard
   */
  isColumnHazard(columnIndex: number, state: HazardState): boolean {
    if (!state || !state.current) {
      return false;
    }

    const activePattern = this.getActivePattern(state);
    return activePattern.includes(columnIndex);
  }

  /**
   * Get the active hazard pattern for a state
   * Uses 'current' if changeAt hasn't passed, otherwise uses 'next'
   * @param state Current hazard state
   * @returns Array of active hazard column indices
   */
  getActivePattern(state: HazardState | undefined): number[] {
    if (!state) {
      return [];
    }

    const now = Date.now();
    return now < state.changeAt ? state.current : state.next;
  }

  /**
   * Calculate time remaining until next hazard rotation
   * @param state Current hazard state
   * @returns Milliseconds until rotation (0 if already passed)
   */
  getTimeUntilChange(state: HazardState | undefined): number {
    if (!state || !state.changeAt) {
      return 0;
    }

    const now = Date.now();
    const timeUntil = state.changeAt - now;
    return Math.max(0, timeUntil);
  }

  /**
   * Validate that a hazard state is well-formed
   * @param state State to validate
   * @returns True if valid
   */
  validateState(state: HazardState): boolean {
    if (!state) return false;
    if (!Array.isArray(state.current) || !Array.isArray(state.next))
      return false;
    if (typeof state.changeAt !== 'number' || state.changeAt <= 0) return false;
    if (typeof state.hazardCount !== 'number' || state.hazardCount <= 0)
      return false;
    return true;
  }

  /**
   * Check if two patterns are identical (for testing/debugging)
   */
  patternsEqual(pattern1: number[], pattern2: number[]): boolean {
    if (pattern1.length !== pattern2.length) return false;
    const sorted1 = [...pattern1].sort((a, b) => a - b);
    const sorted2 = [...pattern2].sort((a, b) => a - b);
    return sorted1.every((val, idx) => val === sorted2[idx]);
  }
}
