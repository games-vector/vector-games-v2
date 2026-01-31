import { Logger, Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import { DEFAULTS } from './config/defaults.config';

import { UserModule, AgentsModule, WalletAuditModule, WalletRetryModule, WalletModule } from '@games-vector/game-core';
import { JwtTokenWrapperModule } from './modules/jwt/jwt-token-wrapper.module';

import { User, Agents, Bet, WalletAudit, WalletRetryJob } from '@games-vector/game-core';
import { Game } from './entities/game.entity';

import { HealthController } from './routes/extra/health.controller';
import { BetConfigModule } from './modules/bet-config/bet-config.module';
import { WalletConfigModule } from './modules/wallet-config/wallet-config.module';
import { AppController } from './app.controller';
import { RedisModule } from './modules/redis/redis.module';
import { GameModule } from './modules/games/game.module';
import { GameConfigModule } from './modules/game-config/game-config.module';
import { GameConfigService } from './modules/game-config/game-config.service';
import { GamesModule } from './games/games.module';
import { CommonGameGateway } from './gateway/common-game.gateway';
import { SugarDaddyGameModule } from './games/sugar-daddy-game/sugar-daddy-game.module';
import { DiverGameModule } from './games/diver-game/diver-game.module';
import { ChickenRoadGameModule } from './games/chicken-road-game/chicken-road-game.module';
import { CommonApiFunctionsModule } from './routes/common-api-functions/common-api-functions.module';
import { GameApiRoutesModule } from './routes/game-api-routes/game-api-routes.module';
import { BetCleanupSchedulerModule } from './modules/bet-cleanup/bet-cleanup-scheduler.module';
import { RefundSchedulerModule } from './modules/refund-scheduler/refund-scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      load: [appConfig, databaseConfig, redisConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): TypeOrmModuleOptions => {
        interface DatabaseConfig {
          host: string;
          port: number;
          username: string;
          password: string;
          database: string;
          synchronize: boolean;
        }
        const dbConfig = cfg.get<DatabaseConfig>('database');
        
        if (!dbConfig) {
          Logger.warn('Database config not found in ConfigService, using defaults');
        }
        
        const host = dbConfig?.host || DEFAULTS.DATABASE.DEFAULT_HOST;
        const port = dbConfig?.port || DEFAULTS.DATABASE.DEFAULT_PORT;
        const username = dbConfig?.username || DEFAULTS.DATABASE.DEFAULT_USERNAME;
        const password = dbConfig?.password || DEFAULTS.DATABASE.DEFAULT_PASSWORD;
        const database = dbConfig?.database || DEFAULTS.DATABASE.DEFAULT_DATABASE;
        const synchronize = dbConfig?.synchronize !== undefined 
          ? dbConfig.synchronize 
          : DEFAULTS.DATABASE.DEFAULT_SYNCHRONIZE;
        
        const cfgObj: TypeOrmModuleOptions = {
          type: 'mysql',
          host,
          port,
          username,
          password,
          database,
          synchronize,
          autoLoadEntities: true,
          entities: [User, Agents, Bet, WalletAudit, WalletRetryJob, Game],
          extra: {
            connectionLimit: parseInt(
              process.env.DB_CONNECTION_LIMIT || '30',
              10,
            )
          },
        };
        Logger.log(
          `Database config -> host=${cfgObj.host} port=${cfgObj.port} db=${cfgObj.database} sync=${cfgObj.synchronize} (from ${dbConfig ? 'ConfigService' : 'defaults'})`,
        );
        return cfgObj;
      },
    }),
    TypeOrmModule.forFeature([Game]),
    // Package modules - using forwardRef to ensure TypeORM root is fully initialized
    forwardRef(() => UserModule),
    forwardRef(() => AgentsModule),
    forwardRef(() => BetConfigModule),
    forwardRef(() => WalletConfigModule),
    forwardRef(() => WalletAuditModule),
    forwardRef(() => WalletRetryModule),
    // JWT configuration - loaded from game config table (platform config)
    // Falls back to environment variable, then to defaults
    // To configure: INSERT INTO game_config_platform (`key`, `value`) VALUES ('jwt.expiresIn', '24h');
    JwtTokenWrapperModule.forRootAsync({
      imports: [GameConfigModule],
      inject: [ConfigService, GameConfigService],
      useFactory: async (configService: ConfigService, gameConfigService: GameConfigService) => {
        // Get JWT secret from environment variable (fallback to default)
        const secret = configService.get<string>('JWT_SECRET') || process.env.JWT_SECRET || DEFAULTS.JWT.DEFAULT_SECRET;
        
        // Get JWT expiration from game config table (platform config)
        // Falls back to environment variable, then to default
        let expiresIn: string;
        try {
          const configValue = await gameConfigService.getConfig('platform', 'jwt.expiresIn');
          expiresIn = configValue || process.env.JWT_EXPIRES || process.env.JWT_EXPIRES_IN || DEFAULTS.JWT.DEFAULT_EXPIRES_IN;
          if (configValue) {
            Logger.log(`JWT expiresIn loaded from game config table: ${configValue}`);
          }
        } catch (error) {
          expiresIn = process.env.JWT_EXPIRES || process.env.JWT_EXPIRES_IN || DEFAULTS.JWT.DEFAULT_EXPIRES_IN;
          Logger.debug(`JWT expiresIn using fallback: ${expiresIn} (error: ${(error as Error).message})`);
        }

        // Get JWT generic expiration from game config table (platform config)
        // Falls back to default
        let genericExpiresIn: string;
        try {
          const configValue = await gameConfigService.getConfig('platform', 'jwt.genericExpiresIn');
          genericExpiresIn = configValue || '1h';
          if (configValue) {
            Logger.log(`JWT genericExpiresIn loaded from game config table: ${configValue}`);
          }
        } catch (error) {
          genericExpiresIn = '1h';
          Logger.debug(`JWT genericExpiresIn using fallback: ${genericExpiresIn} (error: ${(error as Error).message})`);
        }

        Logger.log(`JWT Configuration initialized - expiresIn: ${expiresIn}, genericExpiresIn: ${genericExpiresIn}`);

        return {
          secret,
          expiresIn,
          genericExpiresIn,
        };
      },
    }),
    RedisModule,
    GameModule,
    GameConfigModule,
    // Common Schedulers
    BetCleanupSchedulerModule, // Monthly bet cleanup
    RefundSchedulerModule, // Refunds old PLACED bets
    GamesModule, // Provides GameDispatcherService globally - MUST be imported before game modules
    // Common Game Gateway - handles all WebSocket connections
    // Game Modules - register their handlers with dispatcher
    SugarDaddyGameModule, // Depends on GamesModule (GameDispatcherService)
    // DiverGameModule, // Depends on GamesModule (GameDispatcherService)
    ChickenRoadGameModule, // Depends on GamesModule (GameDispatcherService)
    // API Routes
    CommonApiFunctionsModule, // /wallet/* endpoints (createMember, login, doLoginAndLaunchGame, logout)
    GameApiRoutesModule, // /api/* endpoints (auth, games, online-counter)
  ],
  controllers: [HealthController, AppController],
  providers: [
    CommonGameGateway, // Common WebSocket gateway
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  async onModuleInit() {
    this.logger.log('AppModule initialized - TypeORM DataSource should be ready');
  }
}
