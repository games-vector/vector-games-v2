import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DEFAULTS } from '../../config/defaults.config';

/**
 * GameConfigService - Generic service for fetching game configs from database
 * Works for all games by querying game_config_{normalizedGameCode} tables
 */
@Injectable()
export class GameConfigService {
  private readonly logger = new Logger(GameConfigService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Normalize gameCode for table names
   * Example: 'sugar-daddy' → 'sugar_daddy'
   * Example: 'chicken-road-two' → 'chicken_road_two'
   */
  private normalizeGameCode(gameCode: string): string {
    return gameCode.toLowerCase().replace(/-/g, '_');
  }

  /**
   * Get config from specific game's config table
   * Returns null if table doesn't exist or key not found (for graceful fallback)
   */
  private async getConfigFromTable(gameCode: string, key: string): Promise<{ key: string; value: string } | null> {
    const normalizedGameCode = this.normalizeGameCode(gameCode);
    const tableName = `game_config_${normalizedGameCode}`;

    try {
      const result = await this.dataSource.query(
        `SELECT * FROM \`${tableName}\` WHERE \`key\` = ? LIMIT 1`,
        [key]
      );

      if (!result || result.length === 0) {
        this.logger.debug(`Config key "${key}" not found in table ${tableName} for game ${gameCode}`);
        return null;
      }

      return {
        key: result[0].key,
        value: result[0].value,
      };
    } catch (error: any) {
      // Check if it's a table doesn't exist error
      if (error.code === 'ER_NO_SUCH_TABLE' || error.message?.includes("doesn't exist")) {
        this.logger.warn(
          `Config table ${tableName} does not exist for game ${gameCode}. Will use defaults.`,
        );
        return null; // Return null instead of throwing for graceful fallback
      }
      this.logger.error(`Error getting config from table ${tableName}: ${error.message || error}`);
      return null; // Return null on error for graceful fallback
    }
  }

  /**
   * Get config value for a game
   * @param gameCode - Game code (e.g., 'sugar-daddy', 'chicken-road-two')
   * @param key - Config key (e.g., 'betConfig', 'RTP', 'coefficients', 'frontend.host')
   * @returns Config value as string, or null if not found (allows graceful fallback to defaults)
   */
  async getConfig(gameCode: string, key: string): Promise<string | null> {
    this.logger.debug(`[getConfig] gameCode=${gameCode} key=${key}`);
    
    // Try fetching from game-specific config table first
    const config = await this.getConfigFromTable(gameCode, key);
    if (config) {
      return config.value;
    }
    
    // Return null if not found (allows graceful fallback to defaults in calling code)
    this.logger.debug(`[getConfig] Config not found for game: ${gameCode}, key: ${key} - will use defaults`);
    return null;
  }
}