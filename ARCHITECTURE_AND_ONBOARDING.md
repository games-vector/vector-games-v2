# Vector Games V2 - Architecture & Game Onboarding Guide

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [System Components](#system-components)
3. [Common vs Game-Specific Components](#common-vs-game-specific-components)
4. [Gateway Architecture](#gateway-architecture)
5. [How to Onboard a New Game](#how-to-onboard-a-new-game)
6. [Step-by-Step Onboarding Checklist](#step-by-step-onboarding-checklist)

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Applications                       │
│         (WebSocket: wss://api.example.com/io)                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              CommonGameGateway (Single Entry Point)          │
│  - Handles ALL WebSocket connections                        │
│  - Validates authentication & game access                    │
│  - Routes to appropriate game handler                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              GameDispatcherService                           │
│  - Maintains Map<gameCode, IGameHandler>                     │
│  - Routes connections to correct handler                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Sugar Daddy │ │ Chicken Road│ │ Diver Game  │
│   Handler   │ │   Handler   │ │   Handler   │
└─────────────┘ └─────────────┘ └─────────────┘
```

### Key Design Principles

1. **Single Gateway Pattern**: One WebSocket gateway handles all games
2. **Handler-Based Routing**: Each game has its own handler implementing `IGameHandler`
3. **Dispatcher Pattern**: Central dispatcher routes connections based on `gameCode`
4. **Modular Architecture**: Each game is a self-contained module
5. **Shared Infrastructure**: Common services (wallet, user, agents) are shared

---

## System Components

### 1. Gateway Layer

#### `CommonGameGateway` (`src/gateway/common-game.gateway.ts`)
- **Purpose**: Single entry point for all WebSocket connections
- **Responsibilities**:
  - Accepts WebSocket connections at `/io` path
  - Validates query parameters: `gameMode`/`gameCode`, `operatorId`, `Authorization`
  - Verifies JWT token
  - Validates game exists and is active
  - Checks agent has access to game
  - Routes connection to appropriate handler via `GameDispatcherService`
  - Registers critical handlers (e.g., `get-game-config`)

**Connection URL Format:**
```
wss://api.example.com/io?gameMode=sugar-daddy&operatorId=xxx&Authorization=xxx
```

**Connection Flow:**
1. Client connects with `gameMode`, `operatorId`, and `Authorization` query params
2. Gateway validates token and extracts `userId`, `agentId`
3. Gateway validates game exists in database and is active
4. Gateway checks agent has access to game
5. Gateway gets handler from `GameDispatcherService`
6. Gateway calls `handler.registerMessageHandlers(context)`
7. Gateway calls `handler.handleConnection(context)`
8. Gateway registers critical handlers

### 2. Dispatcher Layer

#### `GameDispatcherService` (`src/games/game-dispatcher.service.ts`)
- **Purpose**: Routes WebSocket connections to game-specific handlers
- **Responsibilities**:
  - Maintains registry of `Map<gameCode, IGameHandler>`
  - Registers handlers during module initialization
  - Provides handler lookup by `gameCode`
  - Supports multiple game codes per handler (e.g., `chicken-road-two`, `chicken-road-vegas`)
  - Calls `onGatewayInit` on handlers when gateway is ready

**Key Methods:**
- `registerHandler(handler)`: Register handler for its primary `gameCode`
- `registerHandlerForGameCode(handler, gameCode)`: Register handler for specific game code
- `registerHandlerForGameCodes(handler, gameCodes[])`: Register handler for multiple codes
- `getHandler(gameCode)`: Get handler for a game code

#### `GameRegistryService` (`src/games/game-registry.service.ts`)
- **Purpose**: Provides centralized game information and statistics
- **Responsibilities**:
  - Tracks all registered games
  - Monitors game handler status
  - Provides game metadata
  - Supports health checks

### 3. Game Module Layer

Each game follows a consistent structure:

```
game-name/
├── game-name.module.ts          # NestJS module
├── game-name.handler.ts          # Implements IGameHandler
├── game-name.service.ts          # Business logic
├── game-name-bet.service.ts      # Bet handling logic (optional)
├── game-name.scheduler.ts         # Scheduled tasks (optional)
├── DTO/                          # Data Transfer Objects
│   ├── game-state.dto.ts
│   ├── bet-payload.dto.ts
│   └── ...
└── modules/                      # Game-specific sub-modules (optional)
    └── ...
```

### 4. Handler Interface

#### `IGameHandler` (`src/games/interfaces/game-handler.interface.ts`)

All game handlers must implement this interface:

```typescript
interface IGameHandler {
  readonly gameCode: string;  // Primary game code
  
  // Required methods
  handleConnection(context: GameConnectionContext): Promise<void> | void;
  handleDisconnection(context: GameConnectionContext): Promise<void> | void;
  registerMessageHandlers(context: GameConnectionContext): void;
  
  // Optional methods
  onGatewayInit?(server: Server): void;  // Called when gateway initializes
  getServer?(): Server | null;             // Get server instance for broadcasting
  getGameConfigResponse?(): any;           // Custom game config response
}
```

**Connection Context:**
```typescript
interface GameConnectionContext {
  client: Socket;              // Socket.IO client
  userId: string;              // User ID from JWT
  agentId: string;             // Agent ID
  operatorId: string;          // Operator ID from query
  gameCode: string;            // Game code
  authPayload: UserTokenPayload; // Decoded JWT payload
  ipAddress?: string;          // Client IP
}
```

### 5. Base Game Module Interface

#### `IBaseGameModule` (`src/games/interfaces/base-game-module.interface.ts`)

All game modules must implement this interface:

```typescript
interface IBaseGameModule {
  getHandler(): IGameHandler;
  getGameCode(): string;
  getAdditionalGameCodes(): string[];
  onModuleInit(): Promise<void> | void;
}
```

**Initialization Helper:**
- `initializeGameModule()`: Standardized helper that:
  - Registers handler with dispatcher
  - Registers additional game codes if any
  - Ensures game exists in database (creates if missing)

---

## Common vs Game-Specific Components

### Common Components (Shared Across All Games)

#### 1. Gateway & Routing
- `CommonGameGateway`: Single WebSocket gateway
- `GameDispatcherService`: Routes connections to handlers
- `GameRegistryService`: Tracks registered games

#### 2. Authentication & Authorization
- `JwtTokenService`: JWT token verification and generation
- `UserService`: User management
- `AgentsService`: Agent access validation
- `UserSessionService`: Session management

#### 3. Wallet & Betting
- `WalletService`: Wallet operations (deposit, withdraw, balance)
- `BetService`: Bet creation and management (from `@games-vector/game-core`)
- `WalletAuditService`: Wallet transaction auditing

#### 4. Database & Configuration
- `GameService`: Game CRUD operations
- `GameConfigService`: Game configuration management
- `RedisService`: Redis operations

#### 5. API Routes
- `GameApiRoutesController`: REST API endpoints (`/api/*`)
  - `POST /api/auth`: Authenticate user
  - `GET /api/games`: Get active games
  - `POST /api/games`: Create new game
  - `GET /api/online-counter/v1/data`: Get online user count

#### 6. Utilities
- `CriticalHandlersService`: Registers critical handlers (e.g., `get-game-config`)
- `initializeGameModule()`: Standardized module initialization

### Game-Specific Components (Per Game)

#### 1. Handler
- Implements `IGameHandler`
- Handles game-specific connection logic
- Registers game-specific message handlers

#### 2. Service
- Game-specific business logic
- Game state management
- Game-specific calculations

#### 3. Bet Service (Optional)
- Game-specific bet handling
- Bet validation
- Bet settlement logic

#### 4. Scheduler (Optional)
- Periodic game rounds
- Game state updates
- Broadcasting game events

#### 5. DTOs
- Game-specific data structures
- Request/response types

#### 6. Sub-modules (Optional)
- Game-specific features (e.g., `FairnessModule`, `HazardModule`)

---

## Gateway Architecture

### Connection Flow Diagram

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ WebSocket: wss://api.example.com/io?gameMode=xxx&operatorId=xxx&Authorization=xxx
       ▼
┌─────────────────────────────────────┐
│      CommonGameGateway              │
│  ┌───────────────────────────────┐  │
│  │ 1. Extract query params       │  │
│  │    - gameMode/gameCode        │  │
│  │    - operatorId               │  │
│  │    - Authorization            │  │
│  └───────────┬───────────────────┘  │
│              │                      │
│  ┌───────────▼───────────────────┐  │
│  │ 2. Validate JWT token         │  │
│  │    - Extract userId, agentId  │  │
│  └───────────┬───────────────────┘  │
│              │                      │
│  ┌───────────▼───────────────────┐  │
│  │ 3. Validate game              │  │
│  │    - Game exists?             │  │
│  │    - Game is active?           │  │
│  └───────────┬───────────────────┘  │
│              │                      │
│  ┌───────────▼───────────────────┐  │
│  │ 4. Check agent access         │  │
│  │    - Agent has access?        │  │
│  └───────────┬───────────────────┘  │
│              │                      │
│  ┌───────────▼───────────────────┐  │
│  │ 5. Get handler from dispatcher│  │
│  │    - gameDispatcher.getHandler│  │
│  └───────────┬───────────────────┘  │
│              │                      │
│  ┌───────────▼───────────────────┐  │
│  │ 6. Join game room             │  │
│  │    - client.join(`game:${code}`)│
│  └───────────┬───────────────────┘  │
│              │                      │
│  ┌───────────▼───────────────────┐  │
│  │ 7. Register critical handlers │  │
│  │    - get-game-config          │  │
│  └───────────┬───────────────────┘  │
│              │                      │
│  ┌───────────▼───────────────────┐  │
│  │ 8. Register message handlers  │  │
│  │    - handler.registerMessage  │  │
│  │      Handlers(context)        │  │
│  └───────────┬───────────────────┘  │
│              │                      │
│  ┌───────────▼───────────────────┐  │
│  │ 9. Handle connection          │  │
│  │    - handler.handleConnection │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Message Handling

The gateway uses a **handler-based routing pattern**:

1. **Connection**: Gateway validates and routes to handler
2. **Message Registration**: Handler registers its message listeners
3. **Message Processing**: Handler processes game-specific messages
4. **Broadcasting**: Handler can broadcast to game rooms using server instance

**Example Message Handler Pattern:**
```typescript
registerMessageHandlers(context: GameConnectionContext): void {
  const { client } = context;
  
  // ACK handler (request-response pattern)
  client.on('gameService', async (data, ack) => {
    if (data.action === 'place-bet') {
      const result = await this.handleBet(data);
      ack(result);
    }
  });
  
  // Event handler (fire-and-forget)
  client.on('customEvent', (data) => {
    this.handleCustomEvent(data);
  });
}
```

---

## How to Onboard a New Game

### Prerequisites

1. Game code (e.g., `my-new-game`)
2. Game name (e.g., `My New Game`)
3. Game type (e.g., `CRASH`, `SLOT`, etc.)
4. Platform name (e.g., `In-out`)
5. Settlement type (e.g., `platformTxId`)

### Step-by-Step Process

#### Step 1: Create Game Directory Structure

Create a new directory under `src/games/`:

```
src/games/my-new-game/
├── my-new-game.module.ts
├── my-new-game.handler.ts
├── my-new-game.service.ts
├── my-new-game-bet.service.ts (optional)
├── my-new-game.scheduler.ts (optional)
└── DTO/
    ├── game-state.dto.ts
    └── bet-payload.dto.ts
```

#### Step 2: Create Game Handler

Create `my-new-game.handler.ts` implementing `IGameHandler`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { IGameHandler, GameConnectionContext } from '../interfaces/game-handler.interface';
import { MyNewGameService } from './my-new-game.service';
import { DEFAULTS } from '../../config/defaults.config';

@Injectable()
export class MyNewGameHandler implements IGameHandler {
  readonly gameCode = 'my-new-game';  // Your game code
  
  private readonly logger = new Logger(MyNewGameHandler.name);
  private server: Server | null = null;

  constructor(
    private readonly myNewGameService: MyNewGameService,
    // Inject other services as needed
  ) {}

  // Optional: Called when gateway initializes
  onGatewayInit(server: Server): void {
    this.server = server;
    this.logger.log('[MY_NEW_GAME_HANDLER] Gateway initialized');
  }

  // Optional: Get server instance
  getServer(): Server | null {
    return this.server;
  }

  // Optional: Custom game config response
  getGameConfigResponse(): any {
    return {
      betConfig: {
        minBetAmount: '0.01',
        maxBetAmount: '100.00',
        // ... other config
      },
      coefficients: {},
      lastWin: {
        username: 'Player',
        winAmount: '0',
        currency: 'INR',
      },
    };
  }

  // Required: Handle connection
  async handleConnection(context: GameConnectionContext): Promise<void> {
    const { client, userId, agentId, gameCode } = context;
    
    // Send initial game data
    client.emit('gameService-onConnectGame', {
      // Your initial game data
    });
    
    // Send balance
    const balance = await this.getBalance(userId, agentId);
    client.emit('onBalanceChange', { balance });
  }

  // Required: Handle disconnection
  async handleDisconnection(context: GameConnectionContext): Promise<void> {
    const { userId, gameCode } = context;
    this.logger.log(`User ${userId} disconnected from ${gameCode}`);
    // Cleanup if needed
  }

  // Required: Register message handlers
  registerMessageHandlers(context: GameConnectionContext): void {
    const { client, userId, agentId } = context;
    
    // Example: ACK handler for gameService
    client.on('gameService', async (data, ack) => {
      if (typeof ack !== 'function') return;
      
      try {
        switch (data.action) {
          case 'place-bet':
            const betResult = await this.handleBet(data, userId, agentId);
            ack(betResult);
            break;
          case 'cashout':
            const cashoutResult = await this.handleCashout(data, userId, agentId);
            ack(cashoutResult);
            break;
          default:
            ack({ error: { message: 'unknown_action' } });
        }
      } catch (error) {
        ack({ error: { message: error.message } });
      }
    });
    
    // Example: Event handler
    client.on('customEvent', (data) => {
      this.handleCustomEvent(data, userId);
    });
  }

  // Helper methods
  private async handleBet(data: any, userId: string, agentId: string) {
    // Your bet logic
  }

  private async handleCashout(data: any, userId: string, agentId: string) {
    // Your cashout logic
  }

  private async getBalance(userId: string, agentId: string): Promise<string> {
    // Get balance from wallet service
  }
}
```

#### Step 3: Create Game Service

Create `my-new-game.service.ts` for business logic:

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MyNewGameService {
  private readonly logger = new Logger(MyNewGameService.name);

  // Your game-specific business logic
}
```

#### Step 4: Create Game Module

Create `my-new-game.module.ts`:

```typescript
import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { JwtTokenModule, UserModule, AgentsModule } from '@games-vector/game-core';
import { RedisModule } from '../../modules/redis/redis.module';
import { GameModule } from '../../modules/games/game.module';
import { GameService } from '../../modules/games/game.service';
import { GameConfigModule } from '../../modules/game-config/game-config.module';
import { MyNewGameHandler } from './my-new-game.handler';
import { MyNewGameService } from './my-new-game.service';
import { GameDispatcherService } from '../game-dispatcher.service';
import { GameRegistryService } from '../game-registry.service';
import { initializeGameModule, IBaseGameModule } from '../interfaces/base-game-module.interface';

@Module({
  imports: [
    JwtTokenModule,
    UserModule,
    AgentsModule,
    RedisModule,
    GameModule,
    GameConfigModule,
    // Add other modules as needed
  ],
  providers: [
    MyNewGameService,
    MyNewGameHandler,
    // Add other providers as needed
  ],
  exports: [
    MyNewGameService,
    MyNewGameHandler,
  ],
})
export class MyNewGameModule implements OnModuleInit, IBaseGameModule {
  private readonly logger = new Logger(MyNewGameModule.name);

  constructor(
    private readonly gameService: GameService,
    private readonly gameDispatcher: GameDispatcherService,
    private readonly gameRegistry: GameRegistryService,
    private readonly myNewGameHandler: MyNewGameHandler,
  ) {}

  getHandler() {
    return this.myNewGameHandler;
  }

  getGameCode(): string {
    return 'my-new-game';  // Your game code
  }

  getAdditionalGameCodes(): string[] {
    // Return additional game codes if handler supports multiple codes
    // Example: return ['my-new-game-vegas'];
    return [];
  }

  async onModuleInit() {
    await initializeGameModule(
      this,
      {
        gameCode: this.getGameCode(),
        gameName: 'My New Game',  // Your game name
        platform: 'In-out',       // Your platform
        gameType: 'CRASH',        // Your game type
        settleType: 'platformTxId', // Your settlement type
        isActive: true,
        additionalGameCodes: this.getAdditionalGameCodes(),
      },
      this.gameDispatcher,
      this.gameService,
      this.logger,
    );

    this.gameRegistry.refreshRegistry();
  }
}
```

#### Step 5: Add Game to App Module

Add your game module to `src/app.module.ts`:

```typescript
import { MyNewGameModule } from './games/my-new-game/my-new-game.module';

@Module({
  imports: [
    // ... existing imports
    GamesModule,  // MUST be before game modules
    SugarDaddyGameModule,
    DiverGameModule,
    ChickenRoadGameModule,
    MyNewGameModule,  // Add your module here
    // ... other imports
  ],
  // ...
})
```

#### Step 6: Add Game to Defaults Config (Optional)

If you want to use centralized defaults, add to `src/config/defaults.config.ts`:

```typescript
export const DEFAULTS = {
  // ... existing config
  GAMES: {
    // ... existing games
    MY_NEW_GAME: {
      GAME_CODE: 'my-new-game',
      GAME_NAME: 'My New Game',
      PLATFORM: 'In-out',
      GAME_TYPE: 'CRASH',
      BET_CONFIG: {
        minBetAmount: '0.01',
        maxBetAmount: '100.00',
        // ... other config
      },
    },
  },
};
```

Then update your module to use defaults:

```typescript
getGameCode(): string {
  return DEFAULTS.GAMES.MY_NEW_GAME.GAME_CODE;
}
```

#### Step 7: Test Your Game

1. **Start the application**
2. **Verify game is registered**: Check logs for registration message
3. **Test WebSocket connection**: Connect with your game code
4. **Test message handlers**: Send test messages

---

## Step-by-Step Onboarding Checklist

### Pre-Development
- [ ] Define game code (e.g., `my-new-game`)
- [ ] Define game name, type, platform, settlement type
- [ ] Understand game requirements and business logic

### Development
- [ ] Create game directory structure
- [ ] Create `IGameHandler` implementation
- [ ] Create game service for business logic
- [ ] Create game module implementing `IBaseGameModule`
- [ ] Add game module to `AppModule`
- [ ] (Optional) Add game to `DEFAULTS` config
- [ ] (Optional) Create bet service if needed
- [ ] (Optional) Create scheduler if needed
- [ ] (Optional) Create DTOs for game-specific data

### Testing
- [ ] Verify game is registered in logs
- [ ] Test WebSocket connection
- [ ] Test message handlers
- [ ] Test game-specific features
- [ ] Verify database entry is created

### Deployment
- [ ] Ensure game is active in database
- [ ] Verify agent has access to game
- [ ] Test in production environment

---

## Key Files Reference

### Core Files
- `src/gateway/common-game.gateway.ts` - Single WebSocket gateway
- `src/games/game-dispatcher.service.ts` - Routes connections to handlers
- `src/games/game-registry.service.ts` - Tracks registered games
- `src/games/games.module.ts` - Global games module
- `src/games/interfaces/game-handler.interface.ts` - Handler interface
- `src/games/interfaces/base-game-module.interface.ts` - Module interface

### Example Games
- `src/games/sugar-daddy-game/` - Crash game example
- `src/games/chicken-road-game/` - Mines-style game example
- `src/games/diver-game/` - Another crash game example

### API Routes
- `src/routes/game-api-routes/` - REST API endpoints

### Services
- `src/modules/games/game.service.ts` - Game CRUD operations
- `src/modules/game-config/game-config.service.ts` - Configuration management

---

## Common Patterns

### 1. Broadcasting to Game Room

```typescript
// In handler
onGatewayInit(server: Server): void {
  this.server = server;
}

// Broadcast to all players in game
this.server?.to(`game:${this.gameCode}`).emit('event', data);
```

### 2. ACK Handler Pattern

```typescript
client.on('gameService', async (data, ack) => {
  if (typeof ack !== 'function') return;
  
  try {
    const result = await this.processAction(data);
    ack({ success: true, data: result });
  } catch (error) {
    ack({ error: { message: error.message } });
  }
});
```

### 3. Event Handler Pattern

```typescript
client.on('customEvent', (data) => {
  this.handleEvent(data);
});
```

### 4. Using Wallet Service

```typescript
// Inject WalletService
constructor(
  private readonly walletService: WalletService,
) {}

// Get balance
const balance = await this.walletService.getBalance(userId, agentId, currency);

// Place bet (withdraw)
const tx = await this.walletService.withdraw(userId, agentId, amount, currency, {
  gameCode: this.gameCode,
  // ... other metadata
});

// Settle bet (deposit)
await this.walletService.deposit(userId, agentId, winAmount, currency, {
  gameCode: this.gameCode,
  platformTxId: tx.id,
  // ... other metadata
});
```

### 5. Using Bet Service

```typescript
// Inject BetService (from @games-vector/game-core)
constructor(
  private readonly betService: BetService,
) {}

// Create bet
const bet = await this.betService.createBet({
  userId,
  agentId,
  gameCode: this.gameCode,
  amount: betAmount,
  currency,
  // ... other fields
});
```

---

## Troubleshooting

### Game Not Found Error
- **Check**: Game exists in database (`games` table)
- **Check**: Game is active (`isActive = true`)
- **Check**: Handler is registered (check logs)

### Handler Not Found Error
- **Check**: Game module is imported in `AppModule`
- **Check**: `GamesModule` is imported before game modules
- **Check**: Handler is registered in `onModuleInit`

### Connection Fails
- **Check**: JWT token is valid
- **Check**: Agent has access to game
- **Check**: Query parameters are correct (`gameMode`, `operatorId`, `Authorization`)

### Messages Not Received
- **Check**: Message handlers are registered in `registerMessageHandlers`
- **Check**: Event names match between client and server
- **Check**: ACK function is provided for ACK handlers

---

## Summary

The Vector Games V2 architecture follows a **handler-based routing pattern** with:

1. **Single Gateway**: One WebSocket gateway handles all games
2. **Dispatcher Pattern**: Routes connections to game-specific handlers
3. **Modular Design**: Each game is a self-contained module
4. **Shared Infrastructure**: Common services are shared across games
5. **Standardized Interface**: All games implement `IGameHandler`

To onboard a new game:
1. Create handler implementing `IGameHandler`
2. Create module implementing `IBaseGameModule`
3. Add module to `AppModule`
4. Use `initializeGameModule()` helper for registration

The architecture is designed to scale to 50+ games while maintaining clean separation of concerns.
