export const CRASH_GAME_ERROR_CODES = {
  INVALID_BET_AMOUNT: 'INVALID_BET_AMOUNT',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  DUPLICATE_BET_NUMBER: 'DUPLICATE_BET_NUMBER',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  BET_NOT_FOUND: 'BET_NOT_FOUND',
  BET_ALREADY_CASHED_OUT: 'BET_ALREADY_CASHED_OUT',
  CANNOT_CANCEL_BET: 'CANNOT_CANCEL_BET',
  INVALID_COEFF_AUTO: 'INVALID_COEFF_AUTO',
  INVALID_BET_NUMBER: 'INVALID_BET_NUMBER',
  INVALID_GAME_STATE: 'INVALID_GAME_STATE',
  BET_REJECTED: 'BET_REJECTED',
  MISSING_USER_INFO: 'MISSING_USER_INFO',
  MISSING_PLAYER_GAME_ID: 'MISSING_PLAYER_GAME_ID',
  MISSING_GAME_CODE: 'MISSING_GAME_CODE',
  BET_HISTORY_ERROR: 'BET_HISTORY_ERROR',
} as const;

export type CrashGameErrorCode = (typeof CRASH_GAME_ERROR_CODES)[keyof typeof CRASH_GAME_ERROR_CODES];

export function createErrorResponse(
  error: string,
  code: CrashGameErrorCode,
): { success: false; error: string; code: string } {
  return {
    success: false,
    error,
    code,
  };
}

export function createSuccessResponse<T>(data?: T): { success: true } & T {
  return {
    success: true,
    ...(data || {}),
  } as { success: true } & T;
}
