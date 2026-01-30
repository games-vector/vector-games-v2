import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtTokenModule, UserModule, AgentsModule } from '@games-vector/game-core';
import { RedisModule } from '../../modules/redis/redis.module';
import { GameModule } from '../../modules/games/game.module';
import { GameService } from '../../modules/games/game.service';
import { GameConfigModule } from '../../modules/game-config/game-config.module';
import { DiverGameService } from './diver-game.service';
import { DiverGameHandler } from './diver-game.handler';
import { DiverGameScheduler } from './diver-game.scheduler';
import { DiverGameBetService } from './diver-game-bet.service';
import { GameDispatcherService } from '../game-dispatcher.service';
import { GameRegistryService } from '../game-registry.service';
import { DEFAULTS } from '../../config/defaults.config';
import { initializeGameModule, IBaseGameModule } from '../interfaces/base-game-module.interface';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtTokenModule,
    UserModule,
    AgentsModule,
    RedisModule,
    GameModule,
    GameConfigModule,
  ],
  providers: [
    DiverGameService,
    DiverGameHandler,
    DiverGameScheduler,
    DiverGameBetService,
  ],
  exports: [
    DiverGameService,
    DiverGameHandler,
  ],
})
export class DiverGameModule implements OnModuleInit, IBaseGameModule {
  private readonly logger = new Logger(DiverGameModule.name);

  constructor(
    private readonly gameService: GameService,
    private readonly gameDispatcher: GameDispatcherService,
    private readonly gameRegistry: GameRegistryService,
    private readonly diverGameHandler: DiverGameHandler,
  ) {
    if (!this.gameDispatcher) {
      this.logger.error('[DIVER_MODULE] GameDispatcherService is not available!');
    }
  }

  getHandler() {
    return this.diverGameHandler;
  }

  getGameCode(): string {
    return DEFAULTS.DIVER.GAME_CODE;
  }

  getAdditionalGameCodes(): string[] {
    return [];
  }

  async onModuleInit() {
    await initializeGameModule(
      this,
      {
        gameCode: this.getGameCode(),
        gameName: DEFAULTS.DIVER.GAME_NAME,
        platform: DEFAULTS.DIVER.PLATFORM,
        gameType: DEFAULTS.DIVER.GAME_TYPE,
        settleType: DEFAULTS.DIVER.GAME_PAYLOADS.SETTLE_TYPE,
        isActive: true,
        additionalGameCodes: this.getAdditionalGameCodes(),
      },
      this.gameDispatcher,
      this.gameService,
      this.logger,
    );

    this.gameRegistry.refreshRegistry();
  }
}
