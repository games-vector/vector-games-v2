import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IGameHandler } from './interfaces/game-handler.interface';
import { GameDispatcherService } from './game-dispatcher.service';

/**
 * Game Registry Service
 * 
 * Provides centralized game information and statistics
 * Useful for monitoring, health checks, and administrative purposes
 * 
 * Features:
 * - Track all registered games
 * - Monitor game handler status
 * - Provide game metadata
 * - Support for health checks
 */
export interface GameMetadata {
  gameCode: string;
  handlerCode: string; // Primary game code of the handler
  isActive: boolean;
  registeredAt: Date;
  handlerType: string; // Class name of the handler
}

@Injectable()
export class GameRegistryService implements OnModuleInit {
  private readonly logger = new Logger(GameRegistryService.name);
  private readonly gameMetadata = new Map<string, GameMetadata>();
  private readonly handlerToGames = new Map<string, string[]>(); // handlerCode -> gameCodes[]

  constructor(private readonly gameDispatcher: GameDispatcherService) {}

  onModuleInit() {
    // Build registry from dispatcher
    this.refreshRegistry();
    this.logger.log(
      `Game Registry initialized with ${this.gameMetadata.size} game(s) across ${this.handlerToGames.size} handler(s)`,
    );
  }

  /**
   * Refresh registry from dispatcher
   * Call this after handlers are registered
   */
  refreshRegistry(): void {
    const gameCodes = this.gameDispatcher.getRegisteredGameCodes();
    
    this.gameMetadata.clear();
    this.handlerToGames.clear();

    for (const gameCode of gameCodes) {
      const handler = this.gameDispatcher.getHandler(gameCode);
      if (handler) {
        const handlerCode = handler.gameCode;
        const metadata: GameMetadata = {
          gameCode,
          handlerCode,
          isActive: true, // TODO: Check from database
          registeredAt: new Date(),
          handlerType: handler.constructor.name,
        };

        this.gameMetadata.set(gameCode, metadata);

        // Track handler to games mapping
        if (!this.handlerToGames.has(handlerCode)) {
          this.handlerToGames.set(handlerCode, []);
        }
        this.handlerToGames.get(handlerCode)!.push(gameCode);
      }
    }

    this.logger.debug(
      `Registry refreshed: ${this.gameMetadata.size} games, ${this.handlerToGames.size} handlers`,
    );
  }

  /**
   * Get metadata for a specific game
   */
  getGameMetadata(gameCode: string): GameMetadata | undefined {
    return this.gameMetadata.get(gameCode);
  }

  /**
   * Get all registered game codes
   */
  getAllGameCodes(): string[] {
    return Array.from(this.gameMetadata.keys());
  }

  /**
   * Get all games handled by a specific handler
   */
  getGamesForHandler(handlerCode: string): string[] {
    return this.handlerToGames.get(handlerCode) || [];
  }

  /**
   * Get all handler codes
   */
  getAllHandlerCodes(): string[] {
    return Array.from(this.handlerToGames.keys());
  }

  /**
   * Get registry statistics
   */
  getStatistics(): {
    totalGames: number;
    totalHandlers: number;
    gamesPerHandler: Record<string, number>;
    handlerTypes: Record<string, number>;
  } {
    const gamesPerHandler: Record<string, number> = {};
    const handlerTypes: Record<string, number> = {};

    for (const [handlerCode, gameCodes] of this.handlerToGames.entries()) {
      gamesPerHandler[handlerCode] = gameCodes.length;
    }

    for (const metadata of this.gameMetadata.values()) {
      handlerTypes[metadata.handlerType] = (handlerTypes[metadata.handlerType] || 0) + 1;
    }

    return {
      totalGames: this.gameMetadata.size,
      totalHandlers: this.handlerToGames.size,
      gamesPerHandler,
      handlerTypes,
    };
  }

  /**
   * Check if a game is registered
   */
  isGameRegistered(gameCode: string): boolean {
    return this.gameMetadata.has(gameCode);
  }

  /**
   * Get handler for a game
   */
  getHandlerForGame(gameCode: string): IGameHandler | undefined {
    return this.gameDispatcher.getHandler(gameCode);
  }
}
