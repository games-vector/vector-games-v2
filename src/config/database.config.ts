import { registerAs } from '@nestjs/config';
import { DEFAULTS } from './defaults.config';

/**
 * Database configuration interface
 */
export interface DatabaseConfig {
  /** Database server host */
  host: string;
  /** Database server port */
  port: number;
  /** Database authentication username */
  username: string;
  /** Database authentication password */
  password: string;
  /** Database name to connect to */
  database: string;
  /** Whether to auto-synchronize entity schemas (dangerous in production) */
  synchronize: boolean;
}

/**
 * Database configuration factory.
 * Reads configuration from environment variables with fallback to defaults.
 *
 * @remarks
 * Environment variables:
 * - DB_HOST: Database host (default: 'localhost')
 * - DB_PORT: Database port (default: 3306)
 * - DB_USERNAME: Database username (default: 'root')
 * - DB_PASSWORD: Database password (default: '') **IMPORTANT: Set this in production**
 * - DB_DATABASE or DB_NAME: Database name (default: 'vectorgames')
 * - DB_SYNCHRONIZE: Auto-sync schema, 'true'/'false' (default: true) **DISABLE in production**
 *
 * @returns Database configuration object
 */
export default registerAs(
  'database',
  (): DatabaseConfig => ({
    host: process.env.DB_HOST || DEFAULTS.DATABASE.DEFAULT_HOST,
    port: parseInt(process.env.DB_PORT || String(DEFAULTS.DATABASE.DEFAULT_PORT), 10),
    username: process.env.DB_USERNAME || DEFAULTS.DATABASE.DEFAULT_USERNAME,
    password: process.env.DB_PASSWORD || DEFAULTS.DATABASE.DEFAULT_PASSWORD,
    database: process.env.DB_DATABASE || process.env.DB_NAME || DEFAULTS.DATABASE.DEFAULT_DATABASE,
    synchronize:
      process.env.DB_SYNCHRONIZE === undefined
        ? DEFAULTS.DATABASE.DEFAULT_SYNCHRONIZE
        : process.env.DB_SYNCHRONIZE === 'true',
  }),
);
