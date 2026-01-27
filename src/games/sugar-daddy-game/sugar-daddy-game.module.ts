import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtTokenModule, UserModule, AgentsModule } from '@games-vector/game-core';
import { RedisModule } from '../../modules/redis/redis.module';
import { GameModule } from '../../modules/games/game.module';
import { GameService } from '../../modules/games/game.service';
import { GameConfigModule } from '../../modules/game-config/game-config.module';
import { SugarDaddyGameService } from './sugar-daddy-game.service';
import { SugarDaddyGameHandler } from './sugar-daddy-game.handler';
import { SugarDaddyGameScheduler } from './sugar-daddy-game.scheduler';
import { SugarDaddyGameBetService } from './sugar-daddy-game-bet.service';
import { GameDispatcherService } from '../game-dispatcher.service';
import { GameRegistryService } from '../game-registry.service';
import { DEFAULTS } from '../../config/defaults.config';
import { initializeGameModule, IBaseGameModule } from '../interfaces/base-game-module.interface';

/**
 * Sugar Daddy Game Module
 * 
 * Handles multiplayer crash game logic with WebSocket communication
 * (Renamed from Aviator)
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtTokenModule,
    UserModule, // For UserService
    AgentsModule, // For AgentsService
    RedisModule,
    GameModule, // Import GameModule to access GameService
    GameConfigModule, // Import GameConfigModule to access GameConfigService
    // WalletService and BetService are available globally via WalletConfigModule and BetConfigModule
  ],
  providers: [
    SugarDaddyGameService,
    SugarDaddyGameHandler,
    SugarDaddyGameScheduler,
    SugarDaddyGameBetService,
  ],
  exports: [
    SugarDaddyGameService,
    SugarDaddyGameHandler,
  ],
})
export class SugarDaddyGameModule implements OnModuleInit, IBaseGameModule {
  private readonly logger = new Logger(SugarDaddyGameModule.name);

  constructor(
    private readonly gameService: GameService,
    private readonly gameDispatcher: GameDispatcherService,
    private readonly gameRegistry: GameRegistryService,
    private readonly sugarDaddyGameHandler: SugarDaddyGameHandler,
  ) {
    // GameDispatcherService should be available from GamesModule (@Global)
    if (!this.gameDispatcher) {
      this.logger.error('[SUGAR_DADDY_MODULE] GameDispatcherService is not available!');
    }
  }

  getHandler() {
    return this.sugarDaddyGameHandler;
  }

  getGameCode(): string {
    return DEFAULTS.AVIATOR.GAME_CODE; // Note: AVIATOR config key is used for Sugar Daddy
  }

  getAdditionalGameCodes(): string[] {
    return [];
  }

  async onModuleInit() {
    await initializeGameModule(
      this,
      {
        gameCode: this.getGameCode(),
          gameName: DEFAULTS.AVIATOR.GAME_NAME,
          platform: DEFAULTS.AVIATOR.PLATFORM,
          gameType: DEFAULTS.AVIATOR.GAME_TYPE,
        settleType: DEFAULTS.AVIATOR.GAME_PAYLOADS.SETTLE_TYPE,
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
