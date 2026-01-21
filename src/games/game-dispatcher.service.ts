import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IGameHandler } from './interfaces/game-handler.interface';
import { Server } from 'socket.io';

/**
 * Game Dispatcher Service
 * 
 * Routes WebSocket connections and messages to the appropriate game handler
 * based on the gameCode query parameter.
 * 
 * Architecture:
 * - Single WebSocket gateway receives all connections
 * - Dispatcher routes to game-specific handlers based on gameCode
 * - Each game handler is isolated in its own module
 */
@Injectable()
export class GameDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(GameDispatcherService.name);
  private readonly handlers = new Map<string, IGameHandler>();
  private gatewayServer: Server | null = null;

  /**
   * Set the gateway server instance (called by gateway after initialization)
   */
  setGatewayServer(server: Server): void {
    this.gatewayServer = server;
    this.logger.log('[GAME_DISPATCHER] Gateway server instance stored');
    
    // Notify all already-registered handlers (only once per unique handler instance)
    const initializedHandlers = new Set<IGameHandler>();
    for (const [gameCode, handler] of this.handlers.entries()) {
      // Skip if this handler instance was already initialized
      if (initializedHandlers.has(handler)) {
        continue;
      }
      
      if (handler?.onGatewayInit) {
        try {
          handler.onGatewayInit(server);
          initializedHandlers.add(handler);
          this.logger.log(`[GAME_DISPATCHER] Called onGatewayInit for handler (primary code: ${handler.gameCode}, registered for: ${gameCode})`);
        } catch (error: any) {
          this.logger.error(
            `[GAME_DISPATCHER] Error calling onGatewayInit for ${handler.gameCode}: ${error.message}`,
          );
        }
      }
    }
  }

  /**
   * Register a game handler
   * Called by each game module during initialization
   * Registers the handler for its primary gameCode
   */
  registerHandler(handler: IGameHandler): void {
    this.registerHandlerForGameCode(handler, handler.gameCode);
  }

  /**
   * Register a handler for a specific game code
   * Allows the same handler to be registered for multiple game codes
   * (e.g., chicken-road-two, chicken-road-vegas, etc. can all use the same handler)
   * 
   * @param handler - The game handler instance
   * @param gameCode - The game code to register this handler for
   */
  registerHandlerForGameCode(handler: IGameHandler, gameCode: string): void {
    if (this.handlers.has(gameCode)) {
      this.logger.warn(
        `Game handler for code '${gameCode}' is already registered. Overwriting.`,
      );
    }
    this.handlers.set(gameCode, handler);
    this.logger.log(`Registered game handler for gameCode: ${gameCode} (handler primary code: ${handler.gameCode})`);
    
    // If gateway is already initialized, call onGatewayInit immediately (only once per handler instance)
    // Check if this handler was already initialized by checking if server is set
    if (this.gatewayServer && handler?.onGatewayInit) {
      // Only call onGatewayInit if handler doesn't have server set yet
      // This prevents calling it multiple times when registering for multiple game codes
      const handlerServer = handler.getServer?.();
      if (!handlerServer) {
        try {
          handler.onGatewayInit(this.gatewayServer);
          this.logger.log(`[GAME_DISPATCHER] Called onGatewayInit for handler (primary code: ${handler.gameCode})`);
        } catch (error: any) {
          this.logger.error(
            `[GAME_DISPATCHER] Error calling onGatewayInit for ${handler.gameCode}: ${error.message}`,
          );
        }
      }
    }
  }

  /**
   * Register a handler for multiple game codes
   * Useful when multiple game codes share the same handler logic
   * (e.g., chicken-road-two, chicken-road-vegas, etc.)
   * 
   * @param handler - The game handler instance
   * @param gameCodes - Array of game codes to register this handler for
   */
  registerHandlerForGameCodes(handler: IGameHandler, gameCodes: string[]): void {
    for (const gameCode of gameCodes) {
      this.registerHandlerForGameCode(handler, gameCode);
    }
    this.logger.log(
      `Registered handler (primary: ${handler.gameCode}) for ${gameCodes.length} game code(s): ${gameCodes.join(', ')}`,
    );
  }

  /**
   * Get handler for a specific game code
   */
  getHandler(gameCode: string): IGameHandler | undefined {
    return this.handlers.get(gameCode);
  }

  /**
   * Get all registered game codes
   */
  getRegisteredGameCodes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if a game code has a registered handler
   */
  hasHandler(gameCode: string): boolean {
    return this.handlers.has(gameCode);
  }

  onModuleInit() {
    // Note: Handlers are registered by game modules during their onModuleInit
    // This will be called before handlers are registered, so we log a placeholder
    this.logger.log('Game Dispatcher initialized - waiting for game modules to register handlers');
  }

  /**
   * Get summary of registered handlers
   * Useful for health checks and monitoring
   */
  getSummary(): {
    totalGames: number;
    totalHandlers: number;
    gameCodes: string[];
    handlerMapping: Record<string, string>; // gameCode -> handlerCode
  } {
    const gameCodes = this.getRegisteredGameCodes();
    const handlerMapping: Record<string, string> = {};
    const uniqueHandlers = new Set<string>();

    for (const gameCode of gameCodes) {
      const handler = this.getHandler(gameCode);
      if (handler) {
        handlerMapping[gameCode] = handler.gameCode;
        uniqueHandlers.add(handler.gameCode);
      }
    }

    return {
      totalGames: gameCodes.length,
      totalHandlers: uniqueHandlers.size,
      gameCodes,
      handlerMapping,
    };
  }
}
