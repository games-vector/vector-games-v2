import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  JwtTokenService,
  UserTokenPayload,
  WalletService,
  UserService,
  AgentsService,
} from '@games-vector/game-core';
import { GameService } from '../modules/games/game.service';
import { GameDispatcherService } from '../games/game-dispatcher.service';
import {
  GameConnectionContext,
  IGameHandler,
} from '../games/interfaces/game-handler.interface';
import { DEFAULTS } from '../config/defaults.config';
import { CriticalHandlersService } from '../games/utils/critical-handlers.service';
import { RedisService } from '../modules/redis/redis.service';

const CONNECTION_ERRORS = {
  MISSING_GAMECODE: 'MISSING_GAMECODE',
  MISSING_OPERATOR_ID: 'MISSING_OPERATOR_ID',
  MISSING_AUTH: 'MISSING_AUTH',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_GAME: 'INVALID_GAME',
  GAME_NOT_ACTIVE: 'GAME_NOT_ACTIVE',
  AGENT_NO_ACCESS: 'AGENT_NO_ACCESS',
  GAME_HANDLER_NOT_FOUND: 'GAME_HANDLER_NOT_FOUND',
} as const;

/**
 * Common WebSocket Gateway
 * 
 * Single entry point for all WebSocket connections.
 * Routes connections and messages to game-specific handlers based on gameCode query parameter.
 * 
 * Connection URL format:
 * wss://api.example.com/io?gameMode=aviatorFly&operatorId=xxx&Authorization=xxx
 * (gameMode is treated as gameCode; gameCode is supported as fallback for backward compatibility)
 */
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  },
  path: '/io',
  namespace: '/',
})
export class CommonGameGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CommonGameGateway.name);

  constructor(
    private readonly jwtTokens: JwtTokenService,
    private readonly walletService: WalletService,
    private readonly userService: UserService,
    private readonly gameService: GameService,
    private readonly agentsService: AgentsService,
    private readonly gameDispatcher: GameDispatcherService,
    private readonly criticalHandlersService: CriticalHandlersService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Extract first value from query parameter (can be string or string[])
   */
  private firstOf(value: string | string[] | undefined): string | undefined {
    if (!value) return undefined;
    if (Array.isArray(value)) return value[0];
    return value;
  }

  /**
   * Emit error and disconnect client
   */
  private emitAndDisconnect(
    client: Socket,
    message: string,
    errorCode: string,
  ): void {
    client.emit('connection-error', {
      error: message,
      code: errorCode,
    });
    client.disconnect(true);
  }

  /**
   * Handle new WebSocket connection
   * Performs authentication and game validation, then routes to game handler
   */
  async handleConnection(client: Socket): Promise<void> {
    const q: any = client.handshake.query;
    
    // gameMode is the primary parameter (treated as gameCode)
    // Support gameCode as fallback for backward compatibility
    const gameCode = this.firstOf(q?.gameMode) || this.firstOf(q?.gameCode);
    const operatorId = this.firstOf(q?.operatorId);
    let rawToken = this.firstOf(q?.Authorization);

    if (!gameCode) {
      this.emitAndDisconnect(
        client,
        'Missing gameMode query parameter',
        CONNECTION_ERRORS.MISSING_GAMECODE,
      );
      return;
    }

    if (!operatorId) {
      this.emitAndDisconnect(
        client,
        'Missing operatorId query parameter',
        CONNECTION_ERRORS.MISSING_OPERATOR_ID,
      );
      return;
    }

    if (!rawToken) {
      this.emitAndDisconnect(
        client,
        'Missing Authorization query parameter',
        CONNECTION_ERRORS.MISSING_AUTH,
      );
      return;
    }

    // Handle token suffix issue (some clients send tokens ending with =4)
    if (rawToken.endsWith('=4') && rawToken.split('.').length === 3) {
      rawToken = rawToken.replace(/=4$/, '');
    }

    // Verify JWT token
    let authPayload: UserTokenPayload | undefined;
    try {
      authPayload = await this.jwtTokens.verifyToken(rawToken);
    } catch (e) {
      this.logger.warn(
        `[WS_CONNECT_FAILED] socketId=${client.id} reason=INVALID_TOKEN error=${(e as any)?.message || e}`,
      );
      this.emitAndDisconnect(
        client,
        'Invalid or expired token',
        CONNECTION_ERRORS.INVALID_TOKEN,
      );
      return;
    }

    const userId = authPayload.sub;
    const agentId = (authPayload as any).agentId || operatorId;

    // Store connection data
    (client.data ||= {}).auth = authPayload;
    (client.data ||= {}).gameCode = gameCode;
    (client.data ||= {}).operatorId = operatorId;
    (client.data ||= {}).userId = userId;
    (client.data ||= {}).agentId = agentId;

    // Validate game exists and is active
    try {
      const game = await this.gameService.getGame(gameCode);
      if (!game) {
        this.logger.warn(
          `[WS_CONNECT_FAILED] socketId=${client.id} reason=GAME_NOT_FOUND gameCode=${gameCode} user=${userId} agent=${agentId}`,
        );
        this.emitAndDisconnect(
          client,
          'Game not found',
          CONNECTION_ERRORS.INVALID_GAME,
        );
        return;
      }
      if (!game.isActive) {
        this.logger.warn(
          `[WS_CONNECT_FAILED] socketId=${client.id} reason=GAME_NOT_ACTIVE gameCode=${gameCode} user=${userId} agent=${agentId}`,
        );
        this.emitAndDisconnect(
          client,
          'Game is not active',
          CONNECTION_ERRORS.GAME_NOT_ACTIVE,
        );
        return;
      }
    } catch (error: any) {
      this.logger.warn(
        `[WS_CONNECT_FAILED] socketId=${client.id} reason=GAME_VALIDATION_ERROR gameCode=${gameCode} user=${userId} agent=${agentId} error=${error.message}`,
      );
      this.emitAndDisconnect(
        client,
        'Game validation failed',
        CONNECTION_ERRORS.INVALID_GAME,
      );
      return;
    }

    // Validate agent has access to this game
    try {
      const hasAccess = await this.agentsService.hasGameAccess(agentId, gameCode);
      if (!hasAccess) {
        this.logger.warn(
          `[WS_CONNECT_FAILED] socketId=${client.id} reason=AGENT_NO_ACCESS gameCode=${gameCode} user=${userId} agent=${agentId}`,
        );
        this.emitAndDisconnect(
          client,
          'Agent does not have access to this game',
          CONNECTION_ERRORS.AGENT_NO_ACCESS,
        );
        return;
      }
    } catch (error: any) {
      this.logger.warn(
        `[WS_CONNECT_FAILED] socketId=${client.id} reason=AGENT_ACCESS_CHECK_ERROR gameCode=${gameCode} user=${userId} agent=${agentId} error=${error.message}`,
      );
      this.emitAndDisconnect(
        client,
        'Agent access validation failed',
        CONNECTION_ERRORS.AGENT_NO_ACCESS,
      );
      return;
    }

    // Get game handler
    const handler = this.gameDispatcher.getHandler(gameCode);
    if (!handler) {
      this.logger.warn(
        `[WS_CONNECT_FAILED] socketId=${client.id} reason=GAME_HANDLER_NOT_FOUND gameCode=${gameCode} user=${userId} agent=${agentId}`,
      );
      this.emitAndDisconnect(
        client,
        `No handler registered for game: ${gameCode}`,
        CONNECTION_ERRORS.GAME_HANDLER_NOT_FOUND,
      );
      return;
    }

    // Join game room
    const gameRoom = `game:${gameCode}`;
    client.join(gameRoom);

    const ipAddress =
      client.handshake.address || client.request.socket.remoteAddress;

    this.logger.log(
      `[WS_CONNECT] socketId=${client.id} user=${userId} agent=${agentId} gameCode=${gameCode} operatorId=${operatorId} joinedRoom=${gameRoom}`,
    );

    // Create connection context
    const context: GameConnectionContext = {
      client,
      userId,
      agentId,
      operatorId,
      gameCode,
      authPayload,
      ipAddress,
    };

    try {
      // Register handlers FIRST to ensure they're ready before any client messages arrive
      // This prevents race conditions where frontend sends "join" before handlers are registered
      handler.registerMessageHandlers(context);
      
      // Then handle connection (async operations)
      await handler.handleConnection(context);
      
      // Register critical handlers AFTER regular handlers to ensure they're not removed
      // Critical handlers must be last so they're called first (prependListener)
      this.registerCriticalHandlers(handler, context);
    } catch (error: any) {
      this.logger.error(
        `[WS_CONNECT_ERROR] socketId=${client.id} gameCode=${gameCode} error=${error.message}`,
        error.stack,
      );
      this.emitAndDisconnect(
        client,
        'Connection handler error',
        CONNECTION_ERRORS.INVALID_GAME,
      );
    }
  }

  private registerCriticalHandlers(
    handler: IGameHandler,
    context: GameConnectionContext,
  ): void {
    try {
      const getGameConfigResponse = (handler as any).getGameConfigResponse?.bind(handler);
      this.criticalHandlersService.registerGetGameConfigHandler(
        context,
        getGameConfigResponse,
      );
      this.logger.log(`[GATEWAY] Critical handlers registered for gameCode=${context.gameCode} socket=${context.client.id}`);
    } catch (error: any) {
      this.logger.error(`[GATEWAY] Failed to register critical handlers: ${error.message}`, error.stack);
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  async handleDisconnect(client: Socket): Promise<void> {
    const gameCode = client.data?.gameCode;
    const userId = client.data?.userId;
    const agentId = client.data?.agentId;

    if (!gameCode) {
      this.logger.warn(
        `[WS_DISCONNECT] socketId=${client.id} - No gameCode found`,
      );
      return;
    }

    const handler = this.gameDispatcher.getHandler(gameCode);
    if (handler) {
      const context: GameConnectionContext = {
        client,
        userId: userId || '',
        agentId: agentId || '',
        operatorId: client.data?.operatorId || '',
        gameCode,
        authPayload: client.data?.auth,
        ipAddress:
          client.handshake.address || client.request.socket.remoteAddress,
      };

      try {
        await handler.handleDisconnection(context);
      } catch (error: any) {
        this.logger.error(
          `[WS_DISCONNECT_ERROR] socketId=${client.id} gameCode=${gameCode} error=${error.message}`,
          error.stack,
        );
      }
    }

    this.logger.log(
      `[WS_DISCONNECT] socketId=${client.id} user=${userId} agent=${agentId} gameCode=${gameCode}`,
    );
  }

  /**
   * Gateway initialization (NestJS hook)
   */
  afterInit(server: Server): void {
    this.logger.log('Common Game Gateway initialized');
    
    // Set up Redis adapter for multi-pod support
    this.setupRedisAdapter(server);
    
    // Store server instance in dispatcher so it can notify handlers registered later
    this.gameDispatcher.setGatewayServer(server);
  }

  private setupRedisAdapter(server: Server): void {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const redisClient = this.redisService.getClient();
      
      // Create pub/sub clients (adapter requires separate clients)
      const pubClient = redisClient.duplicate();
      const subClient = redisClient.duplicate();
      
      server.adapter(createAdapter(pubClient, subClient));
      this.logger.log('✅ Redis adapter configured for Socket.IO - multi-pod support enabled');
    } catch (error) {
      this.logger.error(`Failed to setup Redis adapter: ${(error as Error).message}. Continuing without adapter (single-pod mode).`);
      // Continue without adapter - system will work in single-pod mode
    }
  }

}
