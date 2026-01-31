import { DEFAULTS } from '../../../config/defaults.config';

export const COINFLIP_CONSTANTS = {
  GAME_CODE: DEFAULTS.GAMES.COINFLIP.GAME_CODE,
  GAME_NAME: DEFAULTS.GAMES.COINFLIP.GAME_NAME,
  MAX_ROUNDS: DEFAULTS.GAMES.COINFLIP.MAX_ROUNDS,
  BASE_MULTIPLIER: DEFAULTS.GAMES.COINFLIP.BASE_MULTIPLIER,
  CHOICES: ['HEADS', 'TAILS'] as const,
  PLAY_MODES: ['QUICK', 'ROUNDS'] as const,
  DECIMAL_PLACES: DEFAULTS.GAMES.COINFLIP.GAME.DECIMAL_PLACES,
  PLATFORM_NAME: DEFAULTS.GAMES.COINFLIP.GAME.PLATFORM_NAME,
  GAME_TYPE: DEFAULTS.GAMES.COINFLIP.GAME.GAME_TYPE,
} as const;

export const MULTIPLIERS = DEFAULTS.GAMES.COINFLIP.MULTIPLIERS;

export const WS_EVENTS = {
  GAME_SERVICE: 'gameService',
  BALANCE_CHANGE: 'onBalanceChange',
  BET_CONFIG: 'betsConfig',
  MY_DATA: 'myData',
  CURRENCIES: 'currencies',
  BETS_RANGES: 'betsRanges',
  PING: 'ping',
  PONG: 'pong',
} as const;

export const ERROR_RESPONSES = {
  MISSING_ACTION: { error: { message: 'missing_action' } },
  ACTIVE_SESSION_EXISTS: { error: { message: 'active_session_exists' } },
  NO_ACTIVE_SESSION: { error: { message: 'no_active_session' } },
  INVALID_BET_AMOUNT: { error: { message: 'invalid_bet_amount' } },
  INVALID_CHOICE: { error: { message: 'invalid_choice' } },
  INVALID_PLAY_MODE: { error: { message: 'invalid_play_mode' } },
  INVALID_ROUND_NUMBER: { error: { message: 'invalid_round_number' } },
  AGENT_REJECTED: { error: { message: 'agent_rejected' } },
  SETTLEMENT_FAILED: { error: { message: 'settlement_failed' } },
  CASHOUT_FAILED: { error: { message: 'cashout_failed' } },
  MISSING_CONTEXT: { error: { message: 'missing_context' } },
  MISSING_USER_OR_AGENT: { error: { message: 'missing_user_or_agent' } },
  BET_FAILED: { error: { message: 'bet_failed' } },
  STEP_FAILED: { error: { message: 'step_failed' } },
  UNSUPPORTED_ACTION: { error: { message: 'unsupported_action' } },
} as const;

export type CoinChoice = typeof COINFLIP_CONSTANTS.CHOICES[number];
export type PlayMode = typeof COINFLIP_CONSTANTS.PLAY_MODES[number];
