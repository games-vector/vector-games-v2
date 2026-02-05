import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtTokenService } from '@games-vector/game-core';
import { UserSessionService } from '../../modules/user-session/user-session.service';
import { GameService } from '../../modules/games/game.service';
import { GameConfigService } from '../../modules/game-config/game-config.service';
import { AuthLoginDto, AuthLoginResponse } from './DTO/auth-login.dto';
import { OnlineCounterResponse } from './DTO/online-counter.dto';
import { CreateGameDto, CreateGameResponse } from './DTO/create-game.dto';
import { DEFAULTS } from '../../config/defaults.config';
import * as fs from 'fs';
import * as path from 'path';

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

  /**
   * Generate a dev token for testing (development only)
   */
  async generateDevToken(
    userId: string,
    operatorId: string,
    currency: string,
    gameMode: string,
  ): Promise<{ token: string }> {
    // Only allow in development
    if (process.env.APP_ENV !== 'development' && process.env.NODE_ENV !== 'development') {
      throw new BadRequestException('Dev tokens are only available in development mode');
    }

    this.logger.log(
      `[generateDevToken] Generating dev token for user=${userId} operator=${operatorId} currency=${currency} gameMode=${gameMode}`,
    );

    // Ensure user exists in database
    try {
      const existingUser = await this.dataSource.query(
        'SELECT * FROM user WHERE id = ? AND agentId = ?',
        [userId, operatorId],
      );

      if (!existingUser || existingUser.length === 0) {
        // Create user
        await this.dataSource.query(
          `INSERT INTO user (id, agentId, username, balance, currency, createdAt, updatedAt)
           VALUES (?, ?, ?, 1000000, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE updatedAt = NOW()`,
          [userId, operatorId, userId, currency],
        );
        this.logger.log(`[generateDevToken] Created user ${userId} for agent ${operatorId}`);
      }
    } catch (error: any) {
      this.logger.warn(`[generateDevToken] Error checking/creating user: ${error.message}`);
    }

    const token = await this.jwtTokenService.signGenericToken({
      sub: userId,
      agentId: operatorId,
      currency: currency,
      game_mode: gameMode,
      timestamp: Date.now(),
    });

    return { token };
  }

  async authenticateGame(dto: AuthLoginDto): Promise<AuthLoginResponse> {
    this.logger.log(
      `[authenticateGame] Request received - operator: ${dto.operator}, currency: ${dto.currency}, game_mode: ${dto.game_mode}`,
    );
    // Operator (agent_id) validation is handled by JWT token verification

    // Verify the incoming JWT token and extract userId and agentId
    let decoded: any;
    try {
      decoded = await this.jwtTokenService.verifyToken(dto.auth_token);
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
      jwt: newToken, // React frontend expects this field
      gameConfig: null,
      bonuses: [],
      isLobbyEnabled: false,
      isPromoCodeEnabled: false,
      isSoundEnabled: false,
      isMusicEnabled: false,
      status: '0000',
    };
  }

  async getOnlineCounter(): Promise<OnlineCounterResponse> {
    this.logger.log(`[getOnlineCounter] Request received (no authentication required)`);

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
   * Load games metadata from JSON file
   */
  private loadGamesMetadata(): { games: Array<{
    gameCode: string;
    thumbnail?: string;
    description?: string;
    demoGif?: string;
    images?: string[];
  }> } {
    try {
      // Try multiple possible locations
      // In production: __dirname will be dist/routes/game-api-routes
      // So ../../data/games-metadata.json = dist/data/games-metadata.json
      const possiblePaths = [
        path.join(__dirname, '../../data/games-metadata.json'), // Production: relative to compiled code (dist/data/)
        path.join(process.cwd(), 'dist/data/games-metadata.json'), // Production: absolute path
        path.join(process.cwd(), 'src/data/games-metadata.json'), // Development
      ];

      let metadataPath: string | null = null;
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          metadataPath = possiblePath;
          break;
        }
      }

      if (!metadataPath) {
        this.logger.warn(`[getDashboardGames] games-metadata.json not found. Tried: ${possiblePaths.join(', ')}`);
        return { games: [] };
      }

      const fileContent = fs.readFileSync(metadataPath, 'utf-8');
      this.logger.log(`[getDashboardGames] Loaded games metadata from ${metadataPath}`);
      return JSON.parse(fileContent);
    } catch (error: any) {
      this.logger.warn(`[getDashboardGames] Could not load games metadata: ${error.message}`);
      return { games: [] };
    }
  }

  async getDashboardGames(): Promise<{ 
    userId: string;
    agentId: string;
    cert: string;
    games: Array<any> 
  }> {
    this.logger.log(`[getDashboardGames] Request received`);
    const games = await this.gameService.getActiveGames();
    
    // Get credentials from platform config table
    let userId = 'ztj130cdajnmodugtbtk';
    let agentId = 'brlag';
    let cert = 'JXfDPlWXw4LxuDtxVz0';
    
    try {
      const credentialsConfig = await this.gameConfigService.getConfig('platform', 'dashboard_credentials');
      if (credentialsConfig) {
        const credentials = JSON.parse(credentialsConfig);
        userId = credentials.userId || userId;
        agentId = credentials.agentId || agentId;
        cert = credentials.cert || cert;
        this.logger.log(`[getDashboardGames] Loaded credentials from platform config`);
      } else {
        this.logger.warn(`[getDashboardGames] dashboard_credentials not found in platform config, using placeholders`);
      }
    } catch (error: any) {
      this.logger.error(`[getDashboardGames] Error loading credentials from platform config: ${error.message}`);
      // Continue with placeholders if config not found or invalid
    }
    
    // Load games metadata from JSON file
    const metadata = this.loadGamesMetadata();
    const metadataMap = new Map<string, {
      gameCode: string;
      thumbnail?: string;
      description?: string;
      demoGif?: string;
      images?: string[];
    }>(
      metadata.games.map((m) => [m.gameCode, m])
    );
    
    const dashboardGames = games
      .filter(game => game.isActive)
      .map(game => {
        // Get game config from defaults
        let gameConfig: any = null;
        
        // Find matching game config
        if (game.gameCode === DEFAULTS.GAMES.SUGAR_DADDY.GAME_CODE) {
          gameConfig = DEFAULTS.GAMES.SUGAR_DADDY;
        } else if (game.gameCode === DEFAULTS.GAMES.CHICKEN_ROAD.GAME_CODE) {
          gameConfig = DEFAULTS.GAMES.CHICKEN_ROAD;
        } else if (game.gameCode === DEFAULTS.GAMES.DIVER.GAME_CODE) {
          gameConfig = DEFAULTS.GAMES.DIVER;
        }

        // Get metadata for this game
        const gameMetadata = metadataMap.get(game.gameCode);

        // Build response object
        const dashboardGame: any = {
          gameCode: game.gameCode,
          gameName: game.gameName,
          displayName: gameConfig?.GAME_NAME || game.gameName,
          platform: game.platform,
          gameType: game.gameType,
          isActive: game.isActive,
          description: gameMetadata?.description || null,
          thumbnail: gameMetadata?.thumbnail || null,
          demoGif: gameMetadata?.demoGif || null,
          images: gameMetadata?.images || [],
          rtp: gameConfig?.RTP || null,
          betConfig: {
            minBetAmount: gameConfig?.BET_CONFIG?.minBetAmount || gameConfig?.betConfig?.minBetAmount || '0.01',
            maxBetAmount: gameConfig?.BET_CONFIG?.maxBetAmount || gameConfig?.betConfig?.maxBetAmount || '200.00',
            currency: gameConfig?.BET_CONFIG?.currency || gameConfig?.betConfig?.currency || 'INR',
          },
          frontendHost: gameConfig?.FRONTEND?.DEFAULT_HOST || null,
        };

        return dashboardGame;
      });

    return { 
      userId,
      agentId,
      cert,
      games: dashboardGames 
    };
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
