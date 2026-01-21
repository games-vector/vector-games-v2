import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config/dist/config.service';
import Redis from 'ioredis';

const logger = new Logger('RedisProvider');

export const RedisProvider: Provider = {
  provide: 'REDIS_CLIENT',
  useFactory: (configService: ConfigService) => {
    interface RedisConfig {
      host: string;
      port: number;
      password: string;
    }
    const redisConfig = configService.get<RedisConfig>('redis');
    
    if (!redisConfig) {
      logger.error('Redis configuration not found!');
      throw new Error('Redis configuration is missing');
    }

    logger.log(`Connecting to Redis at ${redisConfig.host}:${redisConfig.port}`);

    const client = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password || undefined,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn(`Redis connection retry attempt ${times}, waiting ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    // Handle connection events
    client.on('connect', () => {
      logger.log(`Redis client connecting to ${redisConfig.host}:${redisConfig.port}...`);
    });

    client.on('ready', () => {
      logger.log(`Redis client connected and ready at ${redisConfig.host}:${redisConfig.port}`);
    });

    client.on('error', (error) => {
      logger.error(`Redis connection error to ${redisConfig.host}:${redisConfig.port}: ${error.message}`);
    });

    client.on('close', () => {
      logger.warn(`Redis connection closed to ${redisConfig.host}:${redisConfig.port}`);
    });

    client.on('reconnecting', (time) => {
      logger.warn(`Redis reconnecting to ${redisConfig.host}:${redisConfig.port} in ${time}ms`);
    });

    return client;
  },
  inject: [ConfigService],
};
