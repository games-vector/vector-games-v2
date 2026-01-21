/**
 * Standard error codes used throughout the application.
 * These codes are returned in API responses to indicate various error conditions.
 *
 * @remarks
 * - Success code is '0000'
 * - All error codes are 4-digit strings
 * - Codes follow a categorical grouping pattern
 */
export const ERROR_CODES = {
  /** Generic failure code for unspecified errors */
  FAIL: '9999',
  /** Success status code */
  SUCCESS: '0000',
  /** User ID is invalid or not found */
  INVALID_USER_ID: '1000',
  /** Account already exists in the system */
  ACCOUNT_EXIST: '1001',
  /** Account does not exist in the system */
  ACCOUNT_NOT_EXIST: '1002',
  /** Currency code is not supported or invalid */
  INVALID_CURRENCY: '1004',
  /** Client IP address does not match expected value */
  INVALID_IP_ADDRESS: '1029',
  /** Operation cannot proceed due to internal state */
  UNABLE_TO_PROCEED: '1028',
  /** Agent ID is invalid or unauthorized */
  INVALID_AGENT_ID: '1035',
  /** Request exceeded time limit */
  REQUEST_TIMEOUT: '1040',
  /** HTTP request to external service failed */
  HTTP_STATUS_ERROR: '1041',
  /** Required parameters are missing from request */
  PARAMETER_MISSING: '1056',
  /** Game not found */
  GAME_NOT_FOUND: '1057',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type ErrorCodeKey = keyof typeof ERROR_CODES;
