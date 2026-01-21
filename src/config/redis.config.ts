import { registerAs } from '@nestjs/config';
import { DEFAULTS } from './defaults.config';

/**
 * Redis configuration interface
 */
export interface RedisConfig {
  /** Redis server host */
  host: string;
  /** Redis server port */
  port: number;
  /** Redis authentication password (if requirepass is enabled) */
  password: string;
}

/**
 * Redis configuration factory.
 * Reads configuration from environment variables with fallback to defaults.
 *
 * @remarks
 * Environment variables:
 * - REDIS_HOST: Redis server host (default: 'localhost')
 * - REDIS_PORT: Redis server port (default: 6379)
 * - REDIS_PASSWORD: Redis password (default: '') - set if requirepass is enabled in redis.conf
 *
 * @returns Redis configuration object
 */
export default registerAs(
  'redis',
  (): RedisConfig => ({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
  }),
);
