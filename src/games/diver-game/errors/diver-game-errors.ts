import { CRASH_GAME_ERROR_CODES, createErrorResponse as baseCreateErrorResponse, createSuccessResponse as baseCreateSuccessResponse, CrashGameErrorCode } from '../../shared/error-helpers';

export const DIVER_ERROR_CODES = {
  ...CRASH_GAME_ERROR_CODES,
} as const;

export type DiverErrorCode = CrashGameErrorCode;

export function createErrorResponse(
  error: string,
  code: DiverErrorCode,
): { success: false; error: string; code: string } {
  return baseCreateErrorResponse(error, code);
}

export function createSuccessResponse<T>(data?: T): { success: true } & T {
  return baseCreateSuccessResponse(data);
}
