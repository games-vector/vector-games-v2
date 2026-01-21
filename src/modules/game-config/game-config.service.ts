import { Injectable, Logger } from '@nestjs/common';
import { DEFAULTS } from '../../config/defaults.config';

/**
 * Simplified GameConfigService
 * For now, returns default values. Can be extended later to support database-backed configs.
 */
@Injectable()
export class GameConfigService {
  private readonly logger = new Logger(GameConfigService.name);

  /**
   * Get config value for a game
   * @param gameCode - Game code
   * @param key - Config key
   * @returns Config value or null
   */
  async getConfig(gameCode: string, key: string): Promise<string | null> {
    this.logger.debug(`[getConfig] gameCode=${gameCode} key=${key}`);
    
    // Return default frontend host if requested
    if (key === 'frontend.host') {
      return DEFAULTS.FRONTEND.DEFAULT_HOST;
    }
    
    // Return default Redis TTL if requested
    if (key === DEFAULTS.REDIS.CONFIG_KEY) {
      return String(DEFAULTS.REDIS.DEFAULT_TTL);
    }
    
    // Return null for other configs (can be extended later)
    return null;
  }
}
