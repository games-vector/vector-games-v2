/**
 * Correlation ID utility for request tracing
 * Helps track requests across services and logs
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a correlation ID for request tracing
 * @returns A unique correlation ID string
 */
export function generateCorrelationId(): string {
  return uuidv4();
}

/**
 * Get correlation ID from request headers or generate a new one
 * @param headers - Request headers object
 * @returns Correlation ID string
 */
export function getCorrelationId(headers: Record<string, string | string[] | undefined>): string {
  const correlationIdHeader = headers['x-correlation-id'] || headers['X-Correlation-ID'];
  
  if (correlationIdHeader) {
    if (Array.isArray(correlationIdHeader)) {
      return correlationIdHeader[0];
    }
    return correlationIdHeader;
  }
  
  return generateCorrelationId();
}

/**
 * Format log message with correlation ID
 * @param correlationId - Correlation ID
 * @param message - Log message
 * @returns Formatted message with correlation ID
 */
export function formatLogWithCorrelationId(correlationId: string, message: string): string {
  return `[${correlationId}] ${message}`;
}
