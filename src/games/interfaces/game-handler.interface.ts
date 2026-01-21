import { Socket } from 'socket.io';
import { UserTokenPayload } from '@games-vector/game-core';

/**
 * Connection context passed to game handlers
 * Contains all information needed to handle a WebSocket connection
 */
export interface GameConnectionContext {
  client: Socket;
  userId: string;
  agentId: string;
  operatorId: string;
  gameCode: string;
  authPayload: UserTokenPayload;
  ipAddress?: string;
}

/**
 * Interface that all game handlers must implement
 * Each game module provides a handler that implements this interface
 * 
 * This interface ensures:
 * - Consistent handler structure across all games
 * - Easy addition of new games
 * - Scalable architecture for 50+ games
 */
export interface IGameHandler {
  /**
   * Unique game code that this handler manages
   * Used for routing connections to the correct handler
   * This is the primary game code; handler may support additional codes
   */
  readonly gameCode: string;

  /**
   * Handle a new WebSocket connection
   * Called after authentication and game validation by CommonGameGateway
   * 
   * Responsibilities:
   * - Send initial game data (balance, config, user data, etc.)
   * - Initialize game-specific state if needed
   * - Join game-specific rooms for broadcasting
   * 
   * @param context - Connection context with client, user info, and game code
   */
  handleConnection(context: GameConnectionContext): Promise<void> | void;

  /**
   * Handle a WebSocket disconnection
   * Called when client disconnects
   * 
   * Responsibilities:
   * - Cleanup game-specific resources
   * - Save game state if needed
   * - Leave game-specific rooms
   * 
   * @param context - Connection context
   */
  handleDisconnection(context: GameConnectionContext): Promise<void> | void;

  /**
   * Register message handlers on the socket
   * Called after connection is established
   * 
   * Responsibilities:
   * - Set up socket.on() listeners for game-specific events
   * - Handle game actions (bet, cashout, step, etc.)
   * - Implement ACK handlers for request-response patterns
   * 
   * Common patterns:
   * - ACK handlers: client.on('gameService', (data, ack) => { ... })
   * - Event handlers: client.on('customEvent', (data) => { ... })
   * 
   * @param context - Connection context
   */
  registerMessageHandlers(context: GameConnectionContext): void;

  /**
   * Optional: Handle gateway initialization
   * Called when the WebSocket gateway is initialized
   * 
   * Use this to:
   * - Store server instance for broadcasting
   * - Initialize game-specific services (schedulers, broadcasters)
   * - Set up periodic tasks
   * 
   * Note: This is called once per handler instance, even if handler
   * is registered for multiple game codes
   * 
   * @param server - Socket.IO server instance for broadcasting
   */
  onGatewayInit?(server: any): void;

  /**
   * Get the server instance (for broadcasting)
   * Should be set by the handler during onGatewayInit
   * 
   * Used by GameDispatcherService to check if handler is initialized
   * 
   * @returns Socket.IO server instance or null if not initialized
   */
  getServer?(): any;
}
