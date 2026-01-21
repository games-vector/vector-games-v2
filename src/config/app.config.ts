import { registerAs } from '@nestjs/config';
import { DEFAULTS } from './defaults.config';

/**
 * Application configuration interface
 */
export interface AppConfig {
  /** Port number on which the application listens */
  port: number;
  /** Environment name (development, production, etc.) */
  env: string;
  /** Whether authentication guards are enabled */
  enableAuth: boolean;
}

/**
 * Application configuration factory.
 * Reads configuration from environment variables with fallback to defaults.
 *
 * @remarks
 * Environment variables:
 * - APP_PORT: Application port number (default: 3000)
 * - APP_ENV: Environment name (default: 'production')
 * - ENABLE_AUTH: Authentication toggle, set to 'false' to disable (default: true)
 *
 * @returns Application configuration object
 */
export default registerAs(
  'app',
  (): AppConfig => ({
    port: parseInt(process.env.APP_PORT || String(DEFAULTS.APP.PORT), 10),
    env: process.env.APP_ENV || DEFAULTS.APP.ENV,
    enableAuth:
      process.env.ENABLE_AUTH === undefined
        ? DEFAULTS.APP.ENABLE_AUTH
        : process.env.ENABLE_AUTH !== 'false',
  }),
);
