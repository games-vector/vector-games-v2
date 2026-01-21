import { Difficulty } from '../../../DTO/bet-payload.dto';

/**
 * Represents the current hazard state for a game and difficulty level
 * Includes current active pattern, next scheduled pattern, and rotation timing
 */
export interface HazardState {
  gameCode: string; // Game identifier
  difficulty: Difficulty;
  current: number[]; // Active hazard column indices
  next: number[]; // Next pattern (becomes current after changeAt)
  changeAt: number; // Epoch timestamp (ms) when rotation occurs
  hazardCount: number; // Number of hazards for this difficulty
  generatedAt: string; // ISO8601 timestamp of generation
}

/**
 * Configuration for hazard rotation behavior
 */
export interface HazardConfig {
  totalColumns: Record<Difficulty, number>; // Per-difficulty column count (matches coefficients array length)
  refreshIntervalMs: number;
  hazardCounts: Record<Difficulty, number>;
}
