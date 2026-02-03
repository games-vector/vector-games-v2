/**
 * Centralized default configuration values used throughout the application.
 * 
 * Structure:
 * - PLATFORM: Configuration shared across all games (database, Redis, JWT, etc.)
 * - GAMES: Game-specific configurations (Sugar Daddy, Chicken Road, etc.)
 * 
 * Separation Principles:
 * - PLATFORM: Settings that apply to the entire platform and all games
 * - GAMES: Settings unique to each game (bet limits, coefficients, game mechanics, etc.)
 * 
 * All default values should be defined here for better maintainability and consistency.
 */

// ============================================================================
// PLATFORM-SPECIFIC CONFIGURATION
// These settings apply to the entire platform and all games
// ============================================================================

const PLATFORM_CONFIG = {
  // Application Configuration
  APP: {
    PORT: 3000,
    ENV: 'production',
    ENABLE_AUTH: true,
  },

  // Database Configuration
  DATABASE: {
    DEFAULT_HOST: 'localhost',
    DEFAULT_PORT: 3306,
    DEFAULT_USERNAME: 'root',
    DEFAULT_PASSWORD: '',
    DEFAULT_DATABASE: 'vectorgames',
    DEFAULT_SYNCHRONIZE: true,
  },

  // Redis Configuration
  REDIS: {
    DEFAULT_TTL: 3600, // 1 hour in seconds
    CONFIG_KEY: 'redis.TTL',
    SESSION_TTL: 3600, // 1 hour in seconds
    SESSION_TTL_CONFIG_KEY: 'game.session.ttl',
  },

  // JWT Configuration
  JWT: {
    DEFAULT_SECRET: 'CHANGE_ME_DEV_SECRET',
    DEFAULT_EXPIRES_IN: '1h',
  },

  // Logger Configuration
  LOGGER: {
    DEFAULT_LEVEL: 'info',
    DEFAULT_LOG_DIR: 'logs',
    DEFAULT_ENABLE_FILE_LOGGING: true,
  },

  // Currency and Balance (Platform defaults - games can override)
  CURRENCY: {
    DEFAULT: 'INR',
    DEFAULT_BALANCE: '1000000',
  },

  // User Configuration (Platform defaults)
  USER: {
    DEFAULT_LANGUAGE: 'en',
    DEFAULT_ADAPTIVE: 'true',
    DEFAULT_AVATAR: null,
  },

  // Response Configuration
  RESPONSE: {
    DEFAULT_SUCCESS_DESC: 'OK',
  },

  // Common Error Messages (used across all games)
  // Note: Game-specific error messages should be in game config
  ERROR_MESSAGES: {
    ACTIVE_SESSION_EXISTS: 'active_session_exists',
    VALIDATION_FAILED: 'validation_failed',
    INVALID_BET_AMOUNT: 'invalid_bet_amount',
    AGENT_REJECTED: 'agent_rejected',
    NO_ACTIVE_SESSION: 'no_active_session',
    SETTLEMENT_FAILED: 'settlement_failed Please contact support',
  },

  // Common Game Payload Settings (defaults - games can override)
  GAME_PAYLOADS: {
    DEFAULT_SETTLE_TYPE: 'platformTxId',
    DEFAULT_PLATFORM: 'In-out',
  },
} as const;

// ============================================================================
// GAME-SPECIFIC CONFIGURATION
// Each game has its own isolated configuration section
// ============================================================================

const GAMES_CONFIG = {
  // Sugar Daddy Game
  SUGAR_DADDY: {
    // Game Identity
    GAME_CODE: 'sugar-daddy',
    GAME_NAME: 'Sugar Daddy',
    PLATFORM: 'In-out',
    GAME_TYPE: 'CRASH',
    
    // RTP (Return to Player) Configuration (game-specific)
    RTP: 92, // 97% RTP means house keeps 3%
    
    // Bet Configuration (game-specific)
    BET_CONFIG: {
      minBetAmount: '0.01',
      maxBetAmount: '200.00',
      maxWinAmount: '20000.00',
      defaultBetAmount: '1.00',
      betPresets: ['0.5', '1', '2', '7', '10', '20'],
      decimalPlaces: '2',
      currency: 'INR',
    },
    
    // Bet Ranges per Currency (game-specific)
    BET_RANGES: {
      INR: ['0.01', '200.00'],
    },
    
    // Default Currency (game-specific, overrides platform default)
    DEFAULT_CURRENCY: 'INR',

    // Game Payloads Configuration (for WalletService integration)
    GAME_PAYLOADS: {
      GAME_TYPE: 'CRASH',
      PLATFORM: 'In-out',
      SETTLE_TYPE: 'platformTxId',
    },

    // Frontend/Host Configuration (game-specific)
    FRONTEND: {
      DEFAULT_HOST: 'gscr.sugardaddy.live',
    },

    // Game-specific Error Messages (if any)
    ERROR_MESSAGES: {
      // Add Sugar Daddy specific errors here if needed
    },
  },

  // Diver Game
  DIVER: {
    GAME_CODE: 'diver',
    GAME_NAME: 'Diver',
    PLATFORM: 'In-out',
    GAME_TYPE: 'CRASH',
    
    RTP: 92,
    
    BET_CONFIG: {
      minBetAmount: '0.01',
      maxBetAmount: '200.00',
      maxWinAmount: '20000.00',
      defaultBetAmount: '1.00',
      betPresets: ['0.5', '1', '2', '7', '10', '20'],
      decimalPlaces: '2',
      currency: 'INR',
    },
    
    BET_RANGES: {
      INR: ['0.01', '200.00'],
    },
    
    DEFAULT_CURRENCY: 'INR',

    GAME_PAYLOADS: {
      GAME_TYPE: 'CRASH',
      PLATFORM: 'In-out',
      SETTLE_TYPE: 'platformTxId',
    },

    FRONTEND: {
      DEFAULT_HOST: 'gscr.diver.live',
    },

    ERROR_MESSAGES: {},
  },

  // CoinFlip Game
  COINFLIP: {
    // Game Identity
    GAME_CODE: 'coinflip',
    GAME_NAME: 'CoinFlip',
    PLATFORM: 'In-out',
    GAME_TYPE: 'CRASH',

    // Redis Configuration
    REDIS_KEY: 'coinflip:session:',
    SESSION_TTL: 3600, // 1 hour in seconds

    // Game Constants
    MAX_ROUNDS: 20,
    BASE_MULTIPLIER: 1.94,

    // Multipliers for each round (1-20)
    MULTIPLIERS: [
      '1.94', '3.88', '7.76', '15.52', '31.04',
      '62.08', '124.16', '248.32', '496.64', '993.28',
      '1986.56', '3973.12', '7946.24', '15892.48', '31784.96',
      '63569.92', '127139.84', '254279.68', '508559.36', '1017118.72'
    ],

    // Bet Configuration
    BET_CONFIG: {
      minBetAmount: '0.01',
      maxBetAmount: '200.00',
      maxWinAmount: '20000.00',
      defaultBetAmount: '0.30',
      betPresets: ['0.5', '1', '2', '7'],
      decimalPlaces: 2,
      currency: 'INR',
    },

    // Bet Ranges per Currency
    BET_RANGES: {
      INR: ['0.01', '200.00'],
    },

    // Game Payloads Configuration (for WalletService integration)
    GAME_PAYLOADS: {
      GAME_TYPE: 'CRASH',
      PLATFORM: 'In-out',
      SETTLE_TYPE: 'platformTxId',
    },

    // Game Runtime Configuration
    GAME: {
      DECIMAL_PLACES: 2,
      PLATFORM_NAME: 'In-out',
      GAME_TYPE: 'CRASH',
      SETTLEMENT_AMOUNT_ZERO: 0.0,
      BET_HISTORY_LIMIT: 30,
      BET_HISTORY_DAYS: 7,
      DEFAULT_COEFF: '1',
      DEFAULT_MULTIPLIER: 1,
    },

    // Last Win Configuration
    LAST_WIN: {
      DEFAULT_USERNAME: 'Lucky Player',
      DEFAULT_WIN_AMOUNT: '100.00',
      DEFAULT_CURRENCY: 'INR',
      FALLBACK_USERNAME: 'UNKNOWN',
      FALLBACK_WIN_AMOUNT: '0',
      FALLBACK_CURRENCY: 'INR',
    },

    // Fairness Configuration
    FAIRNESS: {
      CLIENT_SEED_LENGTH: 16,
    },

    // Error Messages
    ERROR_MESSAGES: {
      INVALID_CHOICE: 'invalid_choice',
      INVALID_PLAY_MODE: 'invalid_play_mode',
      INVALID_ROUND_NUMBER: 'invalid_round_number',
      CASHOUT_FAILED: 'cashout_failed',
    },
  },

  // Chicken Road Game
  CHICKEN_ROAD: {
    // Game Identity
    GAME_CODE: 'chicken-road-two',
    GAME_NAME: 'chicken-road-2',
    PLATFORM: 'In-out',
    GAME_TYPE: 'CRASH',
    
    // Bet Configuration (game-specific)
    betConfig: {
      minBetAmount: '0.01',
      maxBetAmount: '150.00',
      maxWinAmount: '10000.00',
      defaultBetAmount: '0.600000000000000000',
      betPresets: ['0.5', '1', '2', '7'],
      decimalPlaces: '2',
      currency: 'INR',
    },

    // Coefficients per Difficulty Level (game-specific)
    coefficients: {
      EASY: [
        '1.01', '1.03', '1.06', '1.10', '1.15', '1.19', '1.24', '1.30',
        '1.35', '1.42', '1.48', '1.56', '1.65', '1.75', '1.85', '1.98',
        '2.12', '2.28', '2.47', '2.70', '2.96', '3.28', '3.70', '4.11',
        '4.64', '5.39', '6.50', '8.36', '12.08', '23.24',
      ],
      MEDIUM: [
        '1.08', '1.21', '1.37', '1.56', '1.78', '2.05', '2.37', '2.77',
        '3.24', '3.85', '4.62', '5.61', '6.91', '8.64', '10.99', '14.29',
        '18.96', '26.07', '37.24', '53.82', '82.36', '137.59', '265.35', '638.82',
        '2457.00',
      ],
      HARD: [
        '1.18', '1.46', '1.83', '2.31', '2.95', '3.82', '5.02', '6.66',
        '9.04', '12.52', '17.74', '25.80', '38.71', '60.21', '97.34', '166.87',
        '305.94', '595.86', '1283.03', '3267.64', '10898.54', '62162.09',
      ],
      DAREDEVIL: [
        '1.44', '2.21', '3.45', '5.53', '9.09', '15.30', '26.78', '48.70',
        '92.54', '185.08', '391.25', '894.28', '2235.72', '6096.15', '18960.33', '72432.75',
        '379632.82', '3608855.25',
      ],
    },

    // Hazard Configuration (mines game mechanics - Chicken Road specific)
    hazardConfig: {
      // totalColumns per difficulty - MUST match coefficients array length for each difficulty
      totalColumns: {
        EASY: 30,    // Must equal coefficients.EASY.length
        MEDIUM: 25,  // Must equal coefficients.MEDIUM.length
        HARD: 22,    // Must equal coefficients.HARD.length
        DAREDEVIL: 18, // Must equal coefficients.DAREDEVIL.length
      },
      hazardRefreshMs: 5000,
      hazards: {
        EASY: 3,
        MEDIUM: 4,
        HARD: 5,
        DAREDEVIL: 7,
      },
    },

    // Game Runtime Configuration (constants not stored in DB - game-specific)
    GAME: {
      LEADER_LEASE_TTL: 5, // seconds
      DECIMAL_PLACES: 3, // Internal precision (betConfig.decimalPlaces is for display)
      INITIAL_STEP: -1,
      PLATFORM_NAME: 'In-out',
      GAME_TYPE: 'CRASH',
      SETTLEMENT_AMOUNT_ZERO: 0.0,
      BET_HISTORY_LIMIT: 30,
      BET_HISTORY_DAYS: 7,
      DEFAULT_COEFF: '1',
      DEFAULT_MULTIPLIER: 1,
      HAZARD_REFRESH_MIN_MS: 2000,
      HAZARD_REFRESH_MAX_MS: 30000,
      HAZARD_TTL_MULTIPLIER: 1.5,
      HAZARD_HISTORY_LIMIT: 20,
    },

    // Bet Defaults (game-specific)
    BET: {
      DEFAULT_LIMIT: 50,
      DEFAULT_STATUS: 'placed',
      DEFAULT_PLATFORM: 'SPADE',
      DEFAULT_GAME_TYPE: 'LIVE',
      DEFAULT_BET_RANGES: {
        INR: ['0.01', '150.00'],
      },
    },

    // Last Win Configuration (game-specific)
    LAST_WIN: {
      DEFAULT_USERNAME: 'Salmon Delighted Loon',
      DEFAULT_WIN_AMOUNT: '306.00',
      DEFAULT_CURRENCY: 'USD',
      FALLBACK_USERNAME: 'UNKNOWN',
      FALLBACK_WIN_AMOUNT: '0',
      FALLBACK_CURRENCY: 'INR',
    },

    // Fairness/Seeds Configuration (provably fair - game-specific)
    FAIRNESS: {
      LEGACY_CLIENT_SEED: 'e0b4c48b46701588',
      CLIENT_SEED_LENGTH: 16,
    },

    // Game Payloads Configuration (for wallet API)
    GAME_PAYLOADS: {
      GAME_TYPE: 'CRASH',
      PLATFORM: 'In-out',
      SETTLE_TYPE: 'platformTxId',
    },

    // Frontend/Host Configuration (game-specific)
    FRONTEND: {
      DEFAULT_HOST: 'gscr.chicken-road-twoinout.live',
    },

    // Game-specific Error Messages
    ERROR_MESSAGES: {
      INVALID_DIFFICULTY_CONFIG: 'invalid_difficulty_config',
      INVALID_STEP_SEQUENCE: 'invalid_step_sequence',
    },
  },
} as const;

// ============================================================================
// MAIN DEFAULTS OBJECT
// Combines platform and game configs with backward compatibility aliases
// ============================================================================

export const DEFAULTS = {
  // ============================================================================
  // PLATFORM CONFIGURATION (Shared across all games)
  // ============================================================================
  PLATFORM: PLATFORM_CONFIG,
  
  // ============================================================================
  // GAME-SPECIFIC CONFIGURATIONS
  // ============================================================================
  GAMES: GAMES_CONFIG,

  // ============================================================================
  // BACKWARD COMPATIBILITY ALIASES (for existing code)
  // These allow existing code to continue working while we migrate to new structure
  // ============================================================================
  
  // Platform-level aliases (for easier access)
  APP: PLATFORM_CONFIG.APP,
  DATABASE: PLATFORM_CONFIG.DATABASE,
  REDIS: PLATFORM_CONFIG.REDIS,
  JWT: PLATFORM_CONFIG.JWT,
  LOGGER: PLATFORM_CONFIG.LOGGER,
  CURRENCY: PLATFORM_CONFIG.CURRENCY,
  USER: PLATFORM_CONFIG.USER,
  RESPONSE: PLATFORM_CONFIG.RESPONSE,
  ERROR_MESSAGES: PLATFORM_CONFIG.ERROR_MESSAGES,

  // Game-specific aliases (for backward compatibility)
  SUGAR_DADDY: GAMES_CONFIG.SUGAR_DADDY,
  DIVER: GAMES_CONFIG.DIVER,
  COINFLIP: GAMES_CONFIG.COINFLIP,
  CHICKEN_ROAD: GAMES_CONFIG.CHICKEN_ROAD,

  // Legacy aliases (for Chicken Road - will be deprecated)
  // These are kept for backward compatibility with existing code
  FRONTEND: GAMES_CONFIG.CHICKEN_ROAD.FRONTEND,
  hazardConfig: GAMES_CONFIG.CHICKEN_ROAD.hazardConfig,
  GAME: GAMES_CONFIG.CHICKEN_ROAD.GAME,
  betConfig: GAMES_CONFIG.CHICKEN_ROAD.betConfig,
  coefficients: GAMES_CONFIG.CHICKEN_ROAD.coefficients,
} as const;

// ============================================================================
// TYPE EXPORTS (for TypeScript type safety)
// ============================================================================

export type PlatformConfig = typeof PLATFORM_CONFIG;
export type GamesConfig = typeof GAMES_CONFIG;
export type SugarDaddyConfig = typeof GAMES_CONFIG.SUGAR_DADDY;
export type DiverConfig = typeof GAMES_CONFIG.DIVER;
export type CoinFlipConfig = typeof GAMES_CONFIG.COINFLIP;
export type ChickenRoadConfig = typeof GAMES_CONFIG.CHICKEN_ROAD;
