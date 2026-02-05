import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtTokenModule, UserModule, AgentsModule } from '@games-vector/game-core';
import { RedisModule } from '../../modules/redis/redis.module';
import { GameModule } from '../../modules/games/game.module';
import { GameService } from '../../modules/games/game.service';
import { GameConfigModule } from '../../modules/game-config/game-config.module';
import { WheelGameService } from './wheel-game.service';
import { WheelGameHandler } from './wheel-game.handler';
import { WheelGameScheduler } from './wheel-game.scheduler';
import { WheelGameBetService } from './wheel-game-bet.service';
import { WheelRngModule } from './modules/rng/wheel-rng.module';
import { WheelLastWinModule } from './modules/last-win/last-win.module';
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
    WheelRngModule,
    WheelLastWinModule,
  ],
  providers: [
    WheelGameService,
    WheelGameHandler,
    WheelGameScheduler,
    WheelGameBetService,
  ],
  exports: [
    WheelGameService,
    WheelGameHandler,
  ],
})
export class WheelGameModule implements OnModuleInit, IBaseGameModule {
  private readonly logger = new Logger(WheelGameModule.name);

  constructor(
    private readonly gameService: GameService,
    private readonly gameDispatcher: GameDispatcherService,
    private readonly gameRegistry: GameRegistryService,
    private readonly wheelGameHandler: WheelGameHandler,
  ) {
    if (!this.gameDispatcher) {
      this.logger.error('[WHEEL_MODULE] GameDispatcherService is not available!');
    }
  }

  getHandler() {
    return this.wheelGameHandler;
  }

  getGameCode(): string {
    return DEFAULTS.WHEEL.GAME_CODE;
  }

  getAdditionalGameCodes(): string[] {
    return [];
  }

  async onModuleInit() {
    await initializeGameModule(
      this,
      {
        gameCode: this.getGameCode(),
        gameName: DEFAULTS.WHEEL.GAME_NAME,
        platform: DEFAULTS.WHEEL.PLATFORM,
        gameType: DEFAULTS.WHEEL.GAME_TYPE,
        settleType: DEFAULTS.WHEEL.GAME_PAYLOADS.SETTLE_TYPE,
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
