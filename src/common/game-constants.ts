/**
 * Game-specific constants extracted from magic numbers
 * These values are used across game services and should be centralized here
 */

export const GAME_CONSTANTS = {
  // Sugar Daddy Game Constants
  SUGAR_DADDY: {
    ROUND_DURATION_MS: 10000, // 10 seconds wait time + game duration
    COEFF_UPDATE_INTERVAL_MS: 200, // Coefficient update frequency
    MIN_COEFF: 1.00,
    MAX_COEFF: 1000.00,
    COEFF_INCREMENT: 0.05,
    PENDING_BET_TTL: 300, // 5 minutes
    COEFFICIENT_HISTORY_LIMIT: 50,
    LEADER_LOCK_TTL: 30, // seconds
    WAIT_DURATION_MS: 10000, // Wait time before game starts
    RTP_EXPONENT_MIN: 0.2,
    RTP_EXPONENT_MAX: 0.8,
    RTP_BASE_EXPONENT: 0.3,
    RTP_MULTIPLIER: 0.045,
    RTP_BASE: 90,
    CRASH_COEFF_MIN: 1.00,
    CRASH_COEFF_MAX: 10.00,
    // Default coefficient distribution (industry standard)
    DEFAULT_DISTRIBUTION: {
      ranges: [
        { name: 'low', min: 1.02, max: 3.0, weight: 0.75 },
        { name: 'medium', min: 3.0, max: 5.0, weight: 0.20 },
        { name: 'high', min: 5.0, max: 10.0, weight: 0.05 },
      ],
      distributionType: 'uniform', // 'uniform' or 'power'
    },
  },

  // Redis Key Prefixes
  REDIS_KEYS: {
    SUGAR_DADDY_PENDING_BETS: 'sugar-daddy:pending_bets',
    SUGAR_DADDY_COEFFICIENT_HISTORY: 'sugar-daddy:coefficient_history',
    SUGAR_DADDY_CURRENT_STATE: 'sugar-daddy:current_state',
    SUGAR_DADDY_CURRENT_COEFF: 'sugar-daddy:current_coeff',
    SUGAR_DADDY_ACTIVE_ROUND: 'sugar-daddy:active_round',
    SUGAR_DADDY_PREVIOUS_BETS: 'sugar-daddy:previous_bets',
    SUGAR_DADDY_LEADER_LOCK: 'sugar-daddy:engine_lock',
  },

  // Coefficient Calculation
  COEFFICIENT: {
    DECIMAL_PLACES: 2,
    ROUNDING_PRECISION: 100, // For rounding: Math.round(value * 100) / 100
  },
} as const;
