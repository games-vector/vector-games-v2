import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { JwtTokenModule, UserModule, AgentsModule } from '@games-vector/game-core';
import { RedisModule } from '../../modules/redis/redis.module';
import { GameModule } from '../../modules/games/game.module';
import { GameService } from '../../modules/games/game.service';
import { GameConfigModule } from '../../modules/game-config/game-config.module';
import { WalletConfigModule } from '../../modules/wallet-config/wallet-config.module';
import { BetConfigModule } from '../../modules/bet-config/bet-config.module';
import { CoinFlipGameHandler } from './coinflip-game.handler';
import { CoinFlipGameService } from './coinflip-game.service';
import { CoinFlipFairnessModule } from './modules/fairness/fairness.module';
import { GameDispatcherService } from '../game-dispatcher.service';
import { GameRegistryService } from '../game-registry.service';
import { DEFAULTS } from '../../config/defaults.config';
import { initializeGameModule, IBaseGameModule } from '../interfaces/base-game-module.interface';

/**
 * CoinFlip Game Module
 *
 * Handles the CoinFlip game (QUICK single flip / ROUNDS progressive).
 * Follows ARCHITECTURE_AND_ONBOARDING.md: IBaseGameModule, IGameHandler,
 * common modules (JWT, User, Agents, Redis, Game, GameConfig, WalletConfig, BetConfig),
 * and initializeGameModule for registration.
 */
@Module({
  imports: [
    JwtTokenModule,
    UserModule,
    AgentsModule,
    RedisModule,
    GameModule,
    GameConfigModule,
    WalletConfigModule,
    BetConfigModule,
    CoinFlipFairnessModule,
  ],
  providers: [CoinFlipGameService, CoinFlipGameHandler],
  exports: [CoinFlipGameService, CoinFlipGameHandler],
})
export class CoinFlipGameModule implements OnModuleInit, IBaseGameModule {
  private readonly logger = new Logger(CoinFlipGameModule.name);

  constructor(
    private readonly gameService: GameService,
    private readonly gameDispatcher: GameDispatcherService,
    private readonly gameRegistry: GameRegistryService,
    private readonly coinFlipGameHandler: CoinFlipGameHandler,
  ) {}

  getHandler(): CoinFlipGameHandler {
    return this.coinFlipGameHandler;
  }

  getGameCode(): string {
    return DEFAULTS.GAMES.COINFLIP.GAME_CODE;
  }

  getAdditionalGameCodes(): string[] {
    return [];
  }

  async onModuleInit(): Promise<void> {
    await initializeGameModule(
      this,
      {
        gameCode: this.getGameCode(),
        gameName: DEFAULTS.GAMES.COINFLIP.GAME_NAME,
        platform: DEFAULTS.GAMES.COINFLIP.PLATFORM,
        gameType: DEFAULTS.GAMES.COINFLIP.GAME_TYPE,
        settleType: DEFAULTS.GAMES.COINFLIP.GAME_PAYLOADS.SETTLE_TYPE,
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
