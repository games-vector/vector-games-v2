import { Module, OnModuleInit, Logger } from '@nestjs/common';
import {
  AgentsModule,
  JwtTokenModule,
  UserModule,
} from '@games-vector/game-core';
import { GameModule } from '../../modules/games/game.module';
import { GameService } from '../../modules/games/game.service';
import { KenoGameHandler } from './keno-game.handler';
import { KenoGameService } from './keno-game.service';
import { RngModule } from './modules/rng/rng.module';
import { PayoutModule } from './modules/payout/payout.module';
import { KenoLastWinModule } from './modules/last-win/last-win.module';
import { GameConfigModule } from '../../modules/game-config/game-config.module';
import { RedisModule } from '../../modules/redis/redis.module';
import { WalletConfigModule } from '../../modules/wallet-config/wallet-config.module';
import { BetConfigModule } from '../../modules/bet-config/bet-config.module';
import { GameDispatcherService } from '../game-dispatcher.service';
import { GameRegistryService } from '../game-registry.service';
import {
  initializeGameModule,
  IBaseGameModule,
} from '../interfaces/base-game-module.interface';

const GAME_CODE = 'keno';
const GAME_NAME = 'Keno';
const PLATFORM = 'In-out';
const GAME_TYPE = 'KENO';
const SETTLE_TYPE = 'platformTxId';

/**
 * Keno Game Module
 *
 * Handles the Keno lottery-style game where players:
 * - Select 1-10 numbers from a grid of 40
 * - Server draws 10 random numbers
 * - Payouts based on hits and risk level (LOW, MEDIUM, HIGH)
 */
@Module({
  imports: [
    JwtTokenModule,
    GameConfigModule,
    RedisModule,
    AgentsModule,
    BetConfigModule,
    WalletConfigModule,
    UserModule,
    GameModule,
    RngModule,
    PayoutModule,
    KenoLastWinModule,
  ],
  providers: [KenoGameHandler, KenoGameService],
  exports: [KenoGameHandler, KenoGameService],
})
export class KenoGameModule implements OnModuleInit, IBaseGameModule {
  private readonly logger = new Logger(KenoGameModule.name);

  constructor(
    private readonly gameDispatcher: GameDispatcherService,
    private readonly gameRegistry: GameRegistryService,
    private readonly gameService: GameService,
    private readonly kenoGameHandler: KenoGameHandler,
  ) {}

  getHandler() {
    return this.kenoGameHandler;
  }

  getGameCode(): string {
    return GAME_CODE;
  }

  getAdditionalGameCodes(): string[] {
    // Return additional game codes if handler supports multiple codes
    // For now, Keno only supports one game code
    return [];
  }

  async onModuleInit() {
    // Use standardized initialization helper
    await initializeGameModule(
      this,
      {
        gameCode: this.getGameCode(),
        gameName: GAME_NAME,
        platform: PLATFORM,
        gameType: GAME_TYPE,
        settleType: SETTLE_TYPE,
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
