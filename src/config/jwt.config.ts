import { registerAs } from '@nestjs/config';
import { DEFAULTS } from './defaults.config';

/**
 * JWT configuration interface
 */
export interface JwtConfig {
  /** Secret key for signing JWT tokens */
  secret: string;
  /** Token expiration duration (e.g., '1h', '7d', '30m') */
  expiresIn: string;
}

/**
 * JWT configuration factory.
 * Reads configuration from environment variables with fallback to defaults.
 *
 * @remarks
 * Environment variables:
 * - JWT_SECRET: Secret key for signing tokens **CRITICAL: Set a strong secret in production**
 * - JWT_EXPIRES or JWT_EXPIRES_IN: Token expiration time (default: '1h')
 *
 * Supported expiration formats: '1h', '7d', '30m', '1y', etc.
 *
 * @returns JWT configuration object
 */
export default registerAs(
  'jwt',
  (): JwtConfig => ({
    secret: process.env.JWT_SECRET || DEFAULTS.JWT.DEFAULT_SECRET,
    expiresIn: process.env.JWT_EXPIRES || process.env.JWT_EXPIRES_IN || DEFAULTS.JWT.DEFAULT_EXPIRES_IN,
  }),
);
