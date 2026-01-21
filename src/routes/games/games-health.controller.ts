import { Controller, Get } from '@nestjs/common';
import { GameRegistryService } from '../../games/game-registry.service';
import { GameDispatcherService } from '../../games/game-dispatcher.service';

/**
 * Games Health Controller
 * 
 * Provides health check and monitoring endpoints for game handlers
 * Useful for monitoring, debugging, and administrative purposes
 */
@Controller('games/health')
export class GamesHealthController {
  constructor(
    private readonly gameRegistry: GameRegistryService,
    private readonly gameDispatcher: GameDispatcherService,
  ) {}

  /**
   * Get health status of all games
   * GET /games/health
   */
  @Get()
  getHealthStatus() {
    const statistics = this.gameRegistry.getStatistics();
    const allGames = this.gameRegistry.getAllGameCodes();
    
    const gamesStatus = allGames.map((gameCode) => {
      const metadata = this.gameRegistry.getGameMetadata(gameCode);
      const handler = this.gameRegistry.getHandlerForGame(gameCode);
      
      return {
        gameCode,
        handlerCode: metadata?.handlerCode,
        handlerType: metadata?.handlerType,
        isRegistered: !!handler,
        hasServer: handler?.getServer ? !!handler.getServer() : false,
        registeredAt: metadata?.registeredAt,
      };
    });

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      statistics,
      games: gamesStatus,
    };
  }

  /**
   * Get registry statistics
   * GET /games/health/stats
   */
  @Get('stats')
  getStatistics() {
    return {
      timestamp: new Date().toISOString(),
      ...this.gameRegistry.getStatistics(),
    };
  }

  /**
   * Get all registered game codes
   * GET /games/health/codes
   */
  @Get('codes')
  getGameCodes() {
    return {
      timestamp: new Date().toISOString(),
      gameCodes: this.gameRegistry.getAllGameCodes(),
      handlers: this.gameRegistry.getAllHandlerCodes(),
    };
  }

  /**
   * Get detailed information about a specific game
   * GET /games/health/:gameCode
   */
  @Get(':gameCode')
  getGameDetails(gameCode: string) {
    const metadata = this.gameRegistry.getGameMetadata(gameCode);
    const handler = this.gameRegistry.getHandlerForGame(gameCode);
    const handlerGames = metadata
      ? this.gameRegistry.getGamesForHandler(metadata.handlerCode)
      : [];

    if (!metadata) {
      return {
        error: 'Game not found',
        gameCode,
      };
    }

    return {
      gameCode,
      metadata,
      handler: {
        code: metadata.handlerCode,
        type: metadata.handlerType,
        isAvailable: !!handler,
        hasServer: handler?.getServer ? !!handler.getServer() : false,
        gamesHandled: handlerGames,
      },
    };
  }
}
