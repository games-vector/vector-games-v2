import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { AgentsModule, JwtTokenModule, UserModule, WalletModule } from '@games-vector/game-core';
import { GameModule } from '../../modules/games/game.module';
import { GameService } from '../../modules/games/game.service';
import { ChickenRoadGameHandler } from './chicken-road-game.handler';
import { ChickenRoadGameService } from './chicken-road-game.service';
import { FairnessModule } from './modules/fairness/fairness.module';
import { GameConfigModule } from '../../modules/game-config/game-config.module';
import { HazardModule } from './modules/hazard/hazard.module';
import { LastWinModule } from './modules/last-win/last-win.module';
import { RedisModule } from '../../modules/redis/redis.module';
import { WalletConfigModule } from '../../modules/wallet-config/wallet-config.module';
import { BetConfigModule } from '../../modules/bet-config/bet-config.module';
import { GameDispatcherService } from '../game-dispatcher.service';
import { GameRegistryService } from '../game-registry.service';
import { DEFAULTS } from '../../config/defaults.config';
import { initializeGameModule, IBaseGameModule } from '../interfaces/base-game-module.interface';

/**
 * Chicken Road Game Module
 * 
 * Handles the Chicken Road game (mines-style crash game)
 * Supports multiple game codes that share the same handler logic
 */
@Module({
  imports: [
    JwtTokenModule,
    GameConfigModule,
    RedisModule,
    AgentsModule,
    BetConfigModule, // Provides BetService from package (initialized with GameService validation)
    FairnessModule,
    HazardModule,
    WalletConfigModule, // Provides WalletService from package
    UserModule,
    LastWinModule,
    GameModule,
  ],
  providers: [ChickenRoadGameHandler, ChickenRoadGameService],
  exports: [ChickenRoadGameHandler, ChickenRoadGameService],
})
export class ChickenRoadGameModule implements OnModuleInit, IBaseGameModule {
  private readonly logger = new Logger(ChickenRoadGameModule.name);

  constructor(
    private readonly gameDispatcher: GameDispatcherService,
    private readonly gameRegistry: GameRegistryService,
    private readonly gameService: GameService,
    private readonly chickenRoadGameHandler: ChickenRoadGameHandler,
  ) {}

  getHandler() {
    return this.chickenRoadGameHandler;
  }

  getGameCode(): string {
    return DEFAULTS.GAMES.CHICKEN_ROAD.GAME_CODE;
  }

  getAdditionalGameCodes(): string[] {
    // Return additional game codes that use the same handler
    // All these game codes will use the same ChickenRoadGameHandler
    return ['chicken-road-vegas'];
  }

  async onModuleInit() {
    // Use standardized initialization helper
    await initializeGameModule(
      this,
      {
        gameCode: this.getGameCode(),
        gameName: DEFAULTS.GAMES.CHICKEN_ROAD.GAME_NAME,
        platform: DEFAULTS.GAMES.CHICKEN_ROAD.PLATFORM,
        gameType: DEFAULTS.GAMES.CHICKEN_ROAD.GAME_TYPE,
        settleType: DEFAULTS.GAMES.CHICKEN_ROAD.GAME_PAYLOADS.SETTLE_TYPE,
        isActive: true,
        additionalGameCodes: this.getAdditionalGameCodes(),
      },
      this.gameDispatcher,
      this.gameService,
      this.logger,
    );

    // Refresh registry after registration
    this.gameRegistry.refreshRegistry();
  }
}
