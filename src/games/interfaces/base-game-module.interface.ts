import { OnModuleInit } from '@nestjs/common';
import { IGameHandler } from './game-handler.interface';
import { GameDispatcherService } from '../game-dispatcher.service';
import { GameService } from '../../modules/games/game.service';

/**
 * Base interface for all game modules
 * Ensures consistent initialization pattern across all games
 * 
 * All game modules should implement this interface to:
 * - Register handlers with the dispatcher
 * - Ensure game exists in database
 * - Follow consistent error handling
 */
export interface IBaseGameModule extends OnModuleInit {
  /**
   * Get the game handler instance
   */
  getHandler(): IGameHandler;

  /**
   * Get the primary game code for this module
   */
  getGameCode(): string;

  /**
   * Get additional game codes this handler supports (if any)
   * Returns empty array if handler only supports primary game code
   */
  getAdditionalGameCodes(): string[];

  /**
   * Initialize the game module
   * Called automatically by NestJS on module initialization
   */
  onModuleInit(): Promise<void> | void;
}

/**
 * Configuration for game module initialization
 */
export interface GameModuleConfig {
  /**
   * Primary game code
   */
  gameCode: string;

  /**
   * Game name
   */
  gameName: string;

  /**
   * Platform name
   */
  platform: string;

  /**
   * Game type (e.g., 'CRASH', 'SLOT', etc.)
   */
  gameType: string;

  /**
   * Settlement type (e.g., 'platformTxId')
   */
  settleType: string;

  /**
   * Whether game should be active by default
   */
  isActive?: boolean;

  /**
   * Additional game codes that use the same handler
   */
  additionalGameCodes?: string[];
}

/**
 * Helper function to initialize a game module
 * Provides consistent initialization logic for all game modules
 */
export async function initializeGameModule(
  module: IBaseGameModule,
  config: GameModuleConfig,
  gameDispatcher: GameDispatcherService,
  gameService: GameService,
  logger: any,
): Promise<void> {
  const handler = module.getHandler();
  const primaryCode = module.getGameCode();
  const additionalCodes = module.getAdditionalGameCodes();

  // Register primary game code
  gameDispatcher.registerHandler(handler);
  logger.log(`[${primaryCode.toUpperCase()}_MODULE] Registered handler for primary gameCode: ${primaryCode}`);

  // Register additional game codes if any
  if (additionalCodes && additionalCodes.length > 0) {
    gameDispatcher.registerHandlerForGameCodes(handler, additionalCodes);
    logger.log(
      `[${primaryCode.toUpperCase()}_MODULE] Registered handler for ${additionalCodes.length} additional game code(s): ${additionalCodes.join(', ')}`,
    );
  }

  // Ensure game exists in database
  const allGameCodes = [primaryCode, ...(additionalCodes || [])];
  
  for (const gameCode of allGameCodes) {
    try {
      await gameService.getGame(gameCode);
      logger.log(`[${primaryCode.toUpperCase()}_MODULE] Game '${gameCode}' already exists in database`);
    } catch (error) {
      // Game doesn't exist, create it
      logger.log(`[${primaryCode.toUpperCase()}_MODULE] Game '${gameCode}' not found, creating...`);
      try {
        await gameService.createGame({
          gameCode,
          gameName: config.gameName,
          platform: config.platform,
          gameType: config.gameType,
          settleType: config.settleType,
          isActive: config.isActive !== undefined ? config.isActive : true,
        });
        logger.log(`[${primaryCode.toUpperCase()}_MODULE] ✅ Successfully created game '${gameCode}' in database`);
      } catch (createError: any) {
        logger.error(
          `[${primaryCode.toUpperCase()}_MODULE] Failed to create game '${gameCode}': ${createError.message}`,
        );
        // Don't throw - allow module to continue even if game creation fails
        // The game can be created manually via API
      }
    }
  }
}
