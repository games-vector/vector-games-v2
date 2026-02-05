export const WHEEL_ERROR_CODES = {
  INVALID_BET_AMOUNT: 'INVALID_BET_AMOUNT',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  INVALID_COLOR: 'INVALID_COLOR',
  BET_REJECTED: 'BET_REJECTED',
  BET_NOT_FOUND: 'BET_NOT_FOUND',
  INVALID_GAME_STATE: 'INVALID_GAME_STATE',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
} as const;

export function createErrorResponse(
  message: string,
  code: string,
): { success: false; error: string; code: string } {
  return { success: false, error: message, code };
}

export function createSuccessResponse<T extends Record<string, any>>(
  data: T,
): T & { success: true } {
  return { success: true, ...data };
}
