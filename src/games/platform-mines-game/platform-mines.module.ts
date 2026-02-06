import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { AgentsModule, JwtTokenModule, UserModule } from '@games-vector/game-core';
import { GameModule } from '../../modules/games/game.module';
import { GameService } from '../../modules/games/game.service';
import { PlatformMinesHandler } from './platform-mines.handler';
import { PlatformMinesService } from './platform-mines.service';
import { FairnessModule } from '../chicken-road-game/modules/fairness/fairness.module';
import { GameConfigModule } from '../../modules/game-config/game-config.module';
import { RedisModule } from '../../modules/redis/redis.module';
import { WalletConfigModule } from '../../modules/wallet-config/wallet-config.module';
import { BetConfigModule } from '../../modules/bet-config/bet-config.module';
import { GameDispatcherService } from '../game-dispatcher.service';
import { GameRegistryService } from '../game-registry.service';
import { initializeGameModule, IBaseGameModule } from '../interfaces/base-game-module.interface';

const GAME_CODE = 'platform-mines';
const GAME_NAME = 'Platform Mines';

@Module({
  imports: [
    JwtTokenModule,
    GameConfigModule,
    RedisModule,
    AgentsModule,
    BetConfigModule,
    FairnessModule,
    WalletConfigModule,
    UserModule,
    GameModule,
  ],
  providers: [PlatformMinesHandler, PlatformMinesService],
  exports: [PlatformMinesHandler, PlatformMinesService],
})
export class PlatformMinesModule implements OnModuleInit, IBaseGameModule {
  private readonly logger = new Logger(PlatformMinesModule.name);

  constructor(
    private readonly gameDispatcher: GameDispatcherService,
    private readonly gameRegistry: GameRegistryService,
    private readonly gameService: GameService,
    private readonly platformMinesHandler: PlatformMinesHandler,
  ) {}

  getHandler() {
    return this.platformMinesHandler;
  }

  getGameCode(): string {
    return GAME_CODE;
  }

  getAdditionalGameCodes(): string[] {
    return [];
  }

  async onModuleInit() {
    await initializeGameModule(
      this,
      {
        gameCode: GAME_CODE,
        gameName: GAME_NAME,
        platform: 'In-out',
        gameType: 'INSTANT',
        settleType: 'platformTxId',
        isActive: true,
        additionalGameCodes: [],
      },
      this.gameDispatcher,
      this.gameService,
      this.logger,
    );

    this.gameRegistry.refreshRegistry();
  }
}
