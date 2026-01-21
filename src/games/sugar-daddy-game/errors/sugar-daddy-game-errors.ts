/**
 * Error codes for Sugar Daddy game operations
 */
export const SUGAR_DADDY_ERROR_CODES = {
  /** Bet amount is outside valid range */
  INVALID_BET_AMOUNT: 'INVALID_BET_AMOUNT',
  /** Currency code is not supported or invalid */
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  /** Bet already exists for this betNumber in current round */
  DUPLICATE_BET_NUMBER: 'DUPLICATE_BET_NUMBER',
  /** User doesn't have enough balance */
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  /** Bet with playerGameId not found */
  BET_NOT_FOUND: 'BET_NOT_FOUND',
  /** Bet already cashed out */
  BET_ALREADY_CASHED_OUT: 'BET_ALREADY_CASHED_OUT',
  /** Cannot cancel bet (already cashed out or round ended) */
  CANNOT_CANCEL_BET: 'CANNOT_CANCEL_BET',
  /** Invalid auto cashout coefficient */
  INVALID_COEFF_AUTO: 'INVALID_COEFF_AUTO',
  /** Invalid bet number (must be 0 or 1) */
  INVALID_BET_NUMBER: 'INVALID_BET_NUMBER',
  /** Game not in correct state for operation */
  INVALID_GAME_STATE: 'INVALID_GAME_STATE',
  /** Bet rejected by agent/wallet service */
  BET_REJECTED: 'BET_REJECTED',
} as const;

export type SugarDaddyErrorCode = (typeof SUGAR_DADDY_ERROR_CODES)[keyof typeof SUGAR_DADDY_ERROR_CODES];

/**
 * Creates a standardized error response
 */
export function createErrorResponse(
  error: string,
  code: SugarDaddyErrorCode,
): { success: false; error: string; code: string } {
  return {
    success: false,
    error,
    code,
  };
}

/**
 * Creates a standardized success response
 */
export function createSuccessResponse<T>(data?: T): { success: true } & T {
  return {
    success: true,
    ...(data || {}),
  } as { success: true } & T;
}
