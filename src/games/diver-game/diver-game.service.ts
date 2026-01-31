import { Injectable, Logger } from '@nestjs/common';
import { BaseCrashGameService } from '../shared/base-crash-game.service';
import { RedisService } from '../../modules/redis/redis.service';
import { GameConfigService } from '../../modules/game-config/game-config.service';
import { GAME_CONSTANTS } from '../../common/game-constants';
import { DEFAULTS } from '../../config/defaults.config';

@Injectable()
export class DiverGameService extends BaseCrashGameService {
  protected readonly logger = new Logger(DiverGameService.name);

  constructor(
    redisService: RedisService,
    gameConfigService: GameConfigService,
  ) {
    super(DEFAULTS.DIVER.GAME_CODE, redisService, gameConfigService);
    this.logger.log(`[DIVER_GAME_SERVICE] Initialized for gameCode: ${this.gameCode}`);
  }

  protected getGameConstants(): typeof GAME_CONSTANTS.SUGAR_DADDY {
    return GAME_CONSTANTS.DIVER as unknown as typeof GAME_CONSTANTS.SUGAR_DADDY;
  }

  protected getDefaultGameConfig(): { betConfig: any; rtp: number } {
    return {
      betConfig: DEFAULTS.DIVER.BET_CONFIG,
      rtp: DEFAULTS.DIVER.RTP,
    };
  }
}
