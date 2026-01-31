# Vector Games V2 - Quick Reference Guide

## Architecture Summary

```
Client → CommonGameGateway → GameDispatcherService → Game Handler
```

**Single Gateway Pattern**: One WebSocket gateway (`/io`) handles all games  
**Handler-Based Routing**: Each game has its own handler implementing `IGameHandler`  
**Dispatcher Pattern**: Routes connections based on `gameCode` query parameter

---

## Key Components

### Gateway Layer
- **`CommonGameGateway`**: Single WebSocket entry point
  - Validates authentication
  - Validates game access
  - Routes to handler via dispatcher

### Dispatcher Layer
- **`GameDispatcherService`**: Routes connections to handlers
  - Maintains `Map<gameCode, IGameHandler>`
  - Registers handlers during module init

### Game Layer
- **Handler**: Implements `IGameHandler` interface
- **Service**: Game-specific business logic
- **Module**: NestJS module implementing `IBaseGameModule`

---

## Onboarding a New Game (Quick Steps)

### 1. Create Handler
```typescript
@Injectable()
export class MyGameHandler implements IGameHandler {
  readonly gameCode = 'my-game';
  
  handleConnection(context: GameConnectionContext): Promise<void> { }
  handleDisconnection(context: GameConnectionContext): Promise<void> { }
  registerMessageHandlers(context: GameConnectionContext): void { }
}
```

### 2. Create Module
```typescript
@Module({ ... })
export class MyGameModule implements IBaseGameModule {
  getHandler() { return this.myGameHandler; }
  getGameCode() { return 'my-game'; }
  getAdditionalGameCodes() { return []; }
  
  async onModuleInit() {
    await initializeGameModule(this, config, dispatcher, gameService, logger);
  }
}
```

### 3. Add to AppModule
```typescript
@Module({
  imports: [
    GamesModule,  // MUST be first
    MyGameModule, // Add your module
  ],
})
```

---

## Common vs Game-Specific

### Common (Shared)
- ✅ `CommonGameGateway` - Single gateway
- ✅ `GameDispatcherService` - Routing
- ✅ `WalletService` - Wallet operations
- ✅ `BetService` - Bet management
- ✅ `GameService` - Game CRUD
- ✅ `JwtTokenService` - Authentication
- ✅ `AgentsService` - Access control

### Game-Specific (Per Game)
- ✅ Handler - Connection & message handling
- ✅ Service - Business logic
- ✅ Bet Service - Bet handling (optional)
- ✅ Scheduler - Periodic tasks (optional)
- ✅ DTOs - Data structures

---

## Connection Flow

1. Client connects: `wss://api.example.com/io?gameMode=xxx&operatorId=xxx&Authorization=xxx`
2. Gateway validates token & game
3. Gateway gets handler from dispatcher
4. Gateway calls `handler.registerMessageHandlers(context)`
5. Gateway calls `handler.handleConnection(context)`

---

## Message Handling Patterns

### ACK Handler (Request-Response)
```typescript
client.on('gameService', async (data, ack) => {
  if (typeof ack !== 'function') return;
  const result = await this.process(data);
  ack(result);
});
```

### Event Handler (Fire-and-Forget)
```typescript
client.on('customEvent', (data) => {
  this.handle(data);
});
```

---

## Broadcasting

```typescript
// Store server in handler
onGatewayInit(server: Server): void {
  this.server = server;
}

// Broadcast to game room
this.server?.to(`game:${this.gameCode}`).emit('event', data);
```

---

## File Structure

```
src/games/my-game/
├── my-game.module.ts      # NestJS module
├── my-game.handler.ts      # IGameHandler implementation
├── my-game.service.ts      # Business logic
├── my-game-bet.service.ts # Bet handling (optional)
├── my-game.scheduler.ts    # Scheduled tasks (optional)
└── DTO/                    # Data Transfer Objects
```

---

## Required Interface Methods

```typescript
interface IGameHandler {
  readonly gameCode: string;
  handleConnection(context: GameConnectionContext): Promise<void> | void;
  handleDisconnection(context: GameConnectionContext): Promise<void> | void;
  registerMessageHandlers(context: GameConnectionContext): void;
  onGatewayInit?(server: Server): void;  // Optional
  getServer?(): Server | null;            // Optional
  getGameConfigResponse?(): any;          // Optional
}
```

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| Game not found | Game exists in DB, `isActive = true` |
| Handler not found | Module imported in `AppModule`, `GamesModule` imported first |
| Connection fails | JWT valid, agent has access, query params correct |
| Messages not received | Handlers registered, event names match |

---

## Key Files

- `src/gateway/common-game.gateway.ts` - Gateway
- `src/games/game-dispatcher.service.ts` - Dispatcher
- `src/games/interfaces/game-handler.interface.ts` - Handler interface
- `src/games/interfaces/base-game-module.interface.ts` - Module interface
- `src/app.module.ts` - Add your module here

---

## Example Games

- `sugar-daddy-game/` - Crash game
- `chicken-road-game/` - Mines-style game
- `diver-game/` - Another crash game
