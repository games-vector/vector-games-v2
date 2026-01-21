/**
 * Represents an anonymous (unauthenticated) user principal.
 * Used when a request does not have valid authentication credentials.
 *
 * @interface AnonymousPrincipal
 */
export interface AnonymousPrincipal {
  /** Unique identifier for the anonymous session */
  id: string;
  /** Display name for anonymous users */
  username: string;
  /** Flag indicating this is an anonymous principal */
  anonymous: true;
}

/**
 * Standard API response structure with status code and description
 */
export interface ApiResponse<T = any> {
  /** Response status code (e.g., '0000' for success) */
  status: string;
  /** Human-readable description of the response */
  desc?: string;
  /** Optional payload data */
  data?: T;
}

/**
 * Standard error response structure
 */
export interface ErrorResponse {
  error: {
    message: string;
  };
}
