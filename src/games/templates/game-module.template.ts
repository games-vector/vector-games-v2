/**
 * GAME MODULE TEMPLATE
 * 
 * Copy this template to create a new game module.
 * Replace all instances of:
 * - YOUR_GAME with your game name (PascalCase)
 * - your-game with your game name (kebab-case)
 * - YOUR_GAME_CODE with your game code
 */

import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { GameModule } from '../../modules/games/game.module';
import { GameService } from '../../modules/games/game.service';
import { YourGameHandler } from './your-game.handler';
import { YourGameService } from './your-game.service';
import { GameDispatcherService } from '../game-dispatcher.service';
import { GameRegistryService } from '../game-registry.service';
import { DEFAULTS } from '../../config/defaults.config';
import { initializeGameModule, IBaseGameModule } from '../interfaces/base-game-module.interface';

/**
 * Your Game Module
 * 
 * Description: [Describe your game here]
 */
@Module({
  imports: [
    // Required modules
    GameModule,
    // Add other dependencies as needed:
    // - RedisModule (for caching)
    // - GameConfigModule (for game config)
    // - WalletConfigModule (for WalletService)
    // - BetConfigModule (for BetService)
    // - UserModule (for UserService)
    // - AgentsModule (for AgentsService)
    // - etc.
  ],
  providers: [
    YourGameHandler,
    YourGameService,
    // Add other game-specific services
  ],
  exports: [
    YourGameHandler,
    YourGameService,
  ],
})
export class YourGameModule implements OnModuleInit, IBaseGameModule {
  private readonly logger = new Logger(YourGameModule.name);

  constructor(
    private readonly gameService: GameService,
    private readonly gameDispatcher: GameDispatcherService,
    private readonly gameRegistry: GameRegistryService,
    private readonly yourGameHandler: YourGameHandler,
  ) {}

  getHandler() {
    return this.yourGameHandler;
  }

  getGameCode(): string {
    return DEFAULTS.GAMES.YOUR_GAME.GAME_CODE;
  }

  getAdditionalGameCodes(): string[] {
    // Return additional game codes that use the same handler
    // Example: ['your-game-pro', 'your-game-classic']
    // Return empty array if handler only supports primary game code
    return [];
  }

  async onModuleInit() {
    // Use standardized initialization helper
    await initializeGameModule(
      this,
      {
        gameCode: this.getGameCode(),
        gameName: DEFAULTS.GAMES.YOUR_GAME.GAME_NAME,
        platform: DEFAULTS.GAMES.YOUR_GAME.PLATFORM,
        gameType: DEFAULTS.GAMES.YOUR_GAME.GAME_TYPE,
        settleType: DEFAULTS.GAMES.YOUR_GAME.GAME_PAYLOADS.SETTLE_TYPE,
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
