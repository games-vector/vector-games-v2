import { Injectable } from '@nestjs/common';
import { JwtTokenService, WalletService, UserService, AgentsService } from '@games-vector/game-core';
import { DiverGameService } from './diver-game.service';
import { DiverGameBetService } from './diver-game-bet.service';
import { GameService } from '../../modules/games/game.service';
import { BaseCrashGameHandler } from '../shared/base-crash-game.handler';
import { DEFAULTS } from '../../config/defaults.config';

@Injectable()
export class DiverGameHandler extends BaseCrashGameHandler {
  readonly gameCode = DEFAULTS.DIVER.GAME_CODE;

  private readonly diverGameBetService: DiverGameBetService;

  constructor(
    jwtTokens: JwtTokenService,
    diverGameService: DiverGameService,
    diverGameBetService: DiverGameBetService,
    walletService: WalletService,
    userService: UserService,
    gameServiceCore: GameService,
    agentsService: AgentsService,
  ) {
    super(
      jwtTokens,
      diverGameService,
      walletService,
      userService,
      gameServiceCore,
      agentsService,
      DEFAULTS.DIVER.GAME_CODE,
    );
    this.diverGameBetService = diverGameBetService;
    this.logger.log(`[DIVER_GAME_HANDLER] Initialized for gameCode: ${this.gameCode}`);
  }

  protected getBetService() {
    return this.diverGameBetService;
  }

  protected getDefaultBetConfig() {
    return DEFAULTS.DIVER.BET_CONFIG;
  }

  protected getDefaultCurrency(): string {
    return DEFAULTS.DIVER.DEFAULT_CURRENCY;
  }

  protected getChatRoomPrefix(): string {
    return 'diver';
  }
}
