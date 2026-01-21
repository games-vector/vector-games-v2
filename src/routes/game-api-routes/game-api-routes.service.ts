import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtTokenService } from '@vector-games/game-core';
import { UserSessionService } from '../../modules/user-session/user-session.service';
import { GameService } from '../../modules/games/game.service';
import { GameConfigService } from '../../modules/game-config/game-config.service';
import { AuthLoginDto, AuthLoginResponse } from './DTO/auth-login.dto';
import { OnlineCounterResponse } from './DTO/online-counter.dto';
import { CreateGameDto, CreateGameResponse } from './DTO/create-game.dto';

@Injectable()
export class GameApiRoutesService {
  private readonly logger = new Logger(GameApiRoutesService.name);

  constructor(
    private readonly jwtTokenService: JwtTokenService,
    private readonly userSessionService: UserSessionService,
    private readonly gameService: GameService,
    private readonly gameConfigService: GameConfigService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async authenticateGame(dto: AuthLoginDto): Promise<AuthLoginResponse> {
    this.logger.log(
      `[authenticateGame] Request received - operator: ${dto.operator}, currency: ${dto.currency}, game_mode: ${dto.game_mode}`,
    );
    // TODO: Validate operator (agent_id) against database
    // For now, just accepting the value

    // Verify the incoming JWT token and extract userId and agentId
    let decoded: any;
    try {
      decoded = await this.jwtTokenService.verifyToken(dto.auth_token);
      this.logger.log(
        `[authenticateGame] Token verified successfully - decoded: ${JSON.stringify(decoded)}`,
      );
    } catch (error) {
      this.logger.warn(
        `[TOKEN_VERIFICATION_FAILED] operator=${dto.operator} reason=${error.message}`,
      );
      throw new UnauthorizedException('Invalid auth token');
    }

    // Extract userId and agentId from the decoded token
    const userId = decoded.sub || decoded.userId;
    const agentId = decoded.agentId || dto.operator;

    if (!userId) {
      this.logger.warn(
        `[authenticateGame] No userId found in token - operator: ${dto.operator}`,
      );
      throw new UnauthorizedException('Invalid token: missing userId');
    }

    // Generate new JWT token with userId, agentId, and operator_id
    const newToken = await this.jwtTokenService.signGenericToken(
      {
        sub: userId,
        agentId: agentId,
        currency: dto.currency,
        game_mode: dto.game_mode,
        timestamp: Date.now(),
      },
    );

    // Add user to logged-in sessions
    // Note: game_mode from DTO is the gameCode
    await this.userSessionService.addSession(userId, agentId, dto.game_mode);

    this.logger.log(
      `[TOKEN_VERIFIED] user=${userId} agent=${agentId} operator=${dto.operator} currency=${dto.currency} gameMode=${dto.game_mode} tokenGenerated=true`,
    );

    // Return response with dummy data as requested
    return {
      success: true,
      result: newToken,
      data: newToken,
      gameConfig: null,
      bonuses: [],
      isLobbyEnabled: false,
      isPromoCodeEnabled: false,
      isSoundEnabled: false,
      isMusicEnabled: false,
    };
  }

  async getOnlineCounter(token: string): Promise<OnlineCounterResponse> {
    this.logger.log(`[getOnlineCounter] Request received`);

    try {
      const decoded = await this.jwtTokenService.verifyToken(token);
      this.logger.log(
        `[getOnlineCounter] Token verified - operator_id: ${decoded['operator_id'] || 'N/A'}`,
      );
    } catch (error) {
      this.logger.warn(
        `[getOnlineCounter] Token verification failed - error: ${error.message}`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }

    this.logger.log(
      `[getOnlineCounter] SUCCESS - Returning online counter data`,
    );

    const actualLoggedInUsers = await this.userSessionService.getLoggedInUserCount();
    const pumpValue = Math.floor(Math.random() * (15000 - 11000 + 1)) + 11000;
    const total = actualLoggedInUsers + pumpValue;

    this.logger.log(
      `[getOnlineCounter] User count - actual: ${actualLoggedInUsers}, pump: ${pumpValue}, total: ${total}`,
    );

    return {
      "result": {
        "total": total,
        "gameMode": {
          "sugar-daddy": actualLoggedInUsers,
          "chicken-road-two": 0,
        }
      }
    };
  }

  async getActiveGames(): Promise<Array<{ gameCode: string; gameName: string; isActive: boolean }>> {
    this.logger.log(`[getActiveGames] Request received`);
    const games = await this.gameService.getActiveGames();
    return games
      .filter(game => game.isActive)
      .map(game => ({
        gameCode: game.gameCode,
        gameName: game.gameName,
        isActive: game.isActive,
      }));
  }

  /**
   * Normalize gameCode for table names (hyphens to underscores)
   */
  private normalizeGameCode(gameCode: string): string {
    return gameCode.toLowerCase().replace(/-/g, '_');
  }

  /**
   * Create a new game with automatic onboarding:
   * 1. Create game in games table
   * 2. Create config table (optional, can be skipped for now)
   * Note: Hazard initialization is chicken-road specific, so we skip it here
   */
  async createGameWithOnboarding(dto: CreateGameDto): Promise<CreateGameResponse> {
    this.logger.log(`[createGameWithOnboarding] Creating game: ${dto.gameCode}`);

    try {
      // Step 1: Create game in games table
      this.logger.log(`[createGameWithOnboarding] Step 1: Creating game in games table`);
      const game = await this.gameService.createGame({
        gameCode: dto.gameCode,
        gameName: dto.gameName,
        platform: dto.platform,
        gameType: dto.gameType,
        settleType: dto.settleType,
        isActive: true,
      });
      this.logger.log(`[createGameWithOnboarding] Game created: ${game.id}`);

      this.logger.log(`[createGameWithOnboarding] ✅ Game onboarding completed: ${dto.gameCode}`);

      return {
        success: true,
        message: `Game ${dto.gameCode} created successfully`,
        game: {
          id: game.id,
          gameCode: game.gameCode,
          gameName: game.gameName,
          platform: game.platform,
          gameType: game.gameType,
          settleType: game.settleType,
          isActive: game.isActive,
        },
        configTableCreated: false, // Config tables are optional
        configsCopied: 0,
        hazardsInitialized: false, // Hazards are chicken-road specific
      };
    } catch (error) {
      this.logger.error(`[createGameWithOnboarding] Error creating game: ${error.message}`);
      throw error;
    }
  }
}
