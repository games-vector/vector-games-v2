# Keno Game - Backend PRD (Product Requirements Document)

**Version:** 1.0
**Date:** February 4, 2026
**Purpose:** Enable a backend developer to build a 100% functionally-accurate NestJS backend for the Keno game without seeing the game UI.

---

## Table of Contents

1. [Game Overview](#1-game-overview)
2. [Detailed Game Rules & Flow](#2-detailed-game-rules--flow)
3. [State Machine Diagram](#3-state-machine-diagram)
4. [Socket Event Catalog](#4-socket-event-catalog)
5. [Message Schemas (JSON)](#5-message-schemas-json)
6. [Backend Business Logic Breakdown](#6-backend-business-logic-breakdown)
7. [NestJS Architecture Proposal](#7-nestjs-architecture-proposal)
8. [Edge Cases & Failure Scenarios](#8-edge-cases--failure-scenarios)
9. [Assumptions](#9-assumptions)

---

## 1. Game Overview

### 1.1 What is Keno?

Keno is a lottery-style casino game where players select numbers from a grid, place a bet, and the system randomly draws numbers. Players win based on how many of their selected numbers match the drawn numbers.

### 1.2 Core Game Parameters

| Parameter | Value |
|-----------|-------|
| Grid Size | 40 numbers (1-40) |
| Min Selection | 1 number |
| Max Selection | 10 numbers |
| Numbers Drawn | 10 numbers per round |
| Difficulty Modes | EASY, MEDIUM, HIGH |
| Currency | Configurable (USD observed) |
| Min Bet | 0.06 (observed) |
| Max Bet | Configurable (not observed) |

### 1.3 Game Objective

The player's objective is to correctly predict which numbers will be drawn by the system. Winnings are determined by:
- Number of selections made
- Number of "hits" (matches between selection and drawn numbers)
- Difficulty mode selected

### 1.4 Technology Stack (Observed)

- **Frontend:** React with PixiJS (canvas-based rendering)
- **Backend API:** REST API (base URL: `https://api.inout.games`)
- **Authentication:** JWT-based tokens
- **Real-time:** WebSocket/Socket.IO (assumed based on game type)

---

## 2. Detailed Game Rules & Flow

### 2.1 Pre-Game Setup

1. **Authentication:** Player authenticates via operator token
2. **Session Creation:** Server creates a session with:
   - Unique session token
   - User ID
   - Initial balance
   - Currency
3. **Initial State:** Game loads in IDLE state with:
   - Empty number selection
   - Default bet amount (0.06)
   - Default difficulty (EASY)

### 2.2 Number Selection Rules

| Rule | Description |
|------|-------------|
| Selection Method | Click/tap on number cells (1-40) |
| Toggle Behavior | Clicking selected number deselects it |
| Min Selection | At least 1 number required to bet |
| Max Selection | Maximum 10 numbers can be selected |
| Random Selection | "Shuffle" button randomly selects numbers |
| Clear Selection | "Clear" button removes all selections |

### 2.3 Bet Amount Rules

| Rule | Description |
|------|-------------|
| MIN Button | Sets bet to minimum allowed (0.06 observed) |
| MAX Button | Sets bet to maximum allowed or remaining balance |
| Manual Input | Players can type custom amount |
| Validation | Bet must be >= min AND <= balance |

### 2.4 Difficulty Mode Rules

| Mode | Description |
|------|-------------|
| EASY | Lower risk, lower rewards - more frequent small wins |
| MEDIUM | Balanced risk/reward |
| HIGH | Higher risk, higher rewards - rare big wins |

**Key Insight:** Higher difficulty means:
- Lower multipliers for fewer hits
- Higher multipliers for more hits (especially max hits)
- 1-hit may pay x0 on HIGH mode

### 2.5 Game Round Flow

```
1. IDLE STATE
   ├── Player selects 1-10 numbers
   ├── Player sets bet amount
   ├── Player selects difficulty
   └── Player clicks BET button

2. BET VALIDATION
   ├── Validate number selection count (1-10)
   ├── Validate bet amount (>= min, <= balance)
   └── Deduct bet from balance (IMMEDIATE)

3. NUMBER DRAW
   ├── Server generates 10 random numbers (1-40, no duplicates)
   ├── Draw animation plays (visual only, numbers already determined)
   └── Each drawn number is revealed sequentially

4. HIT CALCULATION
   ├── Compare player selections to drawn numbers
   ├── Count total hits
   └── Calculate payout multiplier from payout table

5. PAYOUT
   ├── Calculate win = bet * multiplier
   ├── Add win to balance
   └── Display result

6. ROUND COMPLETE
   ├── Player can view results
   ├── Previous selections remain (can reuse)
   └── Return to IDLE STATE
```

### 2.6 Payout Tables

#### EASY Mode - 6 Numbers Selected (Observed)

| Hits | Multiplier |
|------|------------|
| 0 | x0 |
| 1 | x0.2 |
| 2 | x1.36 |
| 3 | x2.51 |
| 4 | x5 |
| 5 | x15 |
| 6 | x25 |

#### MEDIUM Mode - 6 Numbers Selected (Observed)

| Hits | Multiplier |
|------|------------|
| 0 | x0 |
| 1 | x0.25 |
| 2 | x1.4 |
| 3 | x2.1 |
| 4 | x5 |
| 5 | x25 |
| 6 | x50 |

#### HIGH Mode - 6 Numbers Selected (Observed)

| Hits | Multiplier |
|------|------------|
| 0 | x0 |
| 1 | x0 |
| 2 | x1.1 |
| 3 | x2.25 |
| 4 | x10 |
| 5 | x50 |
| 6 | x100 |

#### EASY Mode - Other Selections (Partial Observations)

**3 Numbers:**
| Hits | Multiplier |
|------|------------|
| 0 | x0 |
| 1 | x1.3 |
| 2 | x2.54 |
| 3 | x5 |

**5 Numbers:**
| Hits | Multiplier |
|------|------------|
| 0 | x0 |
| 1 | x0.25 |
| 2 | x1.36 |
| 3 | x5 |
| 4 | x10 |
| 5 | x15 |

### 2.7 Provably Fair System

The game includes a "Provably Fair" feature (observed in menu), which typically involves:
- Server seed (hidden until round ends)
- Client seed (user can set/view)
- Nonce (increments each round)
- Hash verification

**Note:** Detailed provably fair implementation was not reverse-engineered.

---

## 3. State Machine Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         KENO GAME STATES                        │
└─────────────────────────────────────────────────────────────────┘

                    ┌──────────────────┐
                    │   INITIALIZING   │
                    │                  │
                    │  - Auth request  │
                    │  - Load config   │
                    │  - Get balance   │
                    └────────┬─────────┘
                             │
                             │ auth_success
                             ▼
                    ┌──────────────────┐
           ┌───────│      IDLE        │◄─────────────────┐
           │       │                  │                  │
           │       │  - Select nums   │                  │
           │       │  - Set bet       │                  │
           │       │  - Set mode      │                  │
           │       └────────┬─────────┘                  │
           │                │                            │
           │                │ click_bet (valid)          │
           │                ▼                            │
           │       ┌──────────────────┐                  │
           │       │   VALIDATING     │                  │
           │       │                  │                  │
           │       │  - Check balance │                  │
           │       │  - Check selection│                 │
           │       │  - Deduct bet    │                  │
           │       └────────┬─────────┘                  │
           │                │                            │
           │                │ validation_success         │
           │                ▼                            │
           │       ┌──────────────────┐                  │
           │       │    DRAWING       │                  │
           │       │                  │                  │
           │       │  - Generate nums │                  │
           │       │  - Animate draw  │                  │
           │       │  - Reveal hits   │                  │
           │       └────────┬─────────┘                  │
           │                │                            │
           │                │ draw_complete              │
           │                ▼                            │
           │       ┌──────────────────┐                  │
           │       │   CALCULATING    │                  │
           │       │                  │                  │
           │       │  - Count hits    │                  │
           │       │  - Get multiplier│                  │
           │       │  - Calc payout   │                  │
           │       └────────┬─────────┘                  │
           │                │                            │
           │                │ payout_calculated          │
           │                ▼                            │
           │       ┌──────────────────┐                  │
           │       │    COMPLETE      │──────────────────┘
           │       │                  │   auto_return (after delay)
           │       │  - Show result   │
           │       │  - Update balance│
           │       └──────────────────┘
           │
           │ validation_failed
           ▼
    ┌──────────────────┐
    │      ERROR       │
    │                  │
    │  - Show message  │
    │  - Return to IDLE│
    └──────────────────┘
```

### State Descriptions

| State | Description | Valid Actions |
|-------|-------------|---------------|
| INITIALIZING | Game loading, authenticating | None (wait) |
| IDLE | Ready for player input | Select numbers, set bet, set mode, click BET |
| VALIDATING | Processing bet request | None (wait) |
| DRAWING | Numbers being drawn | None (wait/watch) |
| CALCULATING | Determining results | None (wait) |
| COMPLETE | Round finished, showing results | Wait for auto-return or click to continue |
| ERROR | Validation/server error | Acknowledge error |

---

## 4. Socket Event Catalog

**Note:** WebSocket traffic could not be directly captured during analysis. The game may use REST API for bet operations or have WebSocket events that weren't visible. The following is an **inferred specification** based on common patterns.

### 4.1 Client → Server Events

| Event Name | Description | When Sent |
|------------|-------------|-----------|
| `connect` | Establish connection | On game load |
| `authenticate` | Send auth token | After connect |
| `bet:place` | Submit bet request | When BET clicked |
| `ping` | Heartbeat | Every 30s (typical) |
| `disconnect` | Close connection | On game close |

### 4.2 Server → Client Events

| Event Name | Description | When Sent |
|------------|-------------|-----------|
| `authenticated` | Auth success | After auth validation |
| `balance:update` | New balance | After any balance change |
| `bet:accepted` | Bet validated | After bet validation |
| `bet:rejected` | Bet failed | On validation error |
| `draw:start` | Draw beginning | After bet accepted |
| `draw:number` | Single number drawn | 10 times during draw |
| `draw:complete` | All numbers drawn | After final number |
| `round:result` | Final results | After calculation |
| `error` | Error occurred | On any error |

---

## 5. Message Schemas (JSON)

### 5.1 Authentication API (Observed)

#### Request: POST /api/auth
```json
{
  "operator": "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52",
  "auth_token": "39e28bb7-646e-4741-b2d9-4a75bd440159",
  "currency": "USD",
  "game_mode": "keno"
}
```

#### Response: Success
```json
{
  "success": true,
  "result": "<JWT_TOKEN>",
  "data": "<JWT_TOKEN>",
  "gameConfig": null,
  "bonuses": [],
  "isLobbyEnabled": false,
  "isPromoCodeEnabled": false,
  "isSoundEnabled": false,
  "isMusicEnabled": false
}
```

### 5.2 JWT Token Payload (Decoded)

```json
{
  "userId": "b4744f13-30a0-4033-b0eb-c919e0b3cf46",
  "nickname": "Red Hollow Pike",
  "balance": "1000000.02",
  "currency": "USD",
  "operator": "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52",
  "gameMode": "keno",
  "sessionToken": "f3lcvg",
  "iat": 1738640000,
  "exp": 1738726400
}
```

### 5.3 Bet Request (Inferred)

```json
{
  "selections": [7, 14, 21, 22, 32, 35],
  "betAmount": 0.06,
  "difficulty": "EASY",
  "sessionToken": "f3lcvg",
  "clientSeed": "abc123"
}
```

### 5.4 Bet Response (Inferred)

```json
{
  "success": true,
  "betId": "bet-uuid-12345",
  "drawnNumbers": [3, 8, 14, 17, 21, 25, 31, 35, 38, 40],
  "hits": [14, 21, 35],
  "hitCount": 3,
  "multiplier": 2.51,
  "payout": 0.15,
  "newBalance": 999999.97,
  "serverSeed": "revealed-after-bet",
  "nonce": 42
}
```

### 5.5 Balance Update Schema

```json
{
  "balance": "999999.97",
  "currency": "USD",
  "timestamp": "2026-02-04T10:30:00Z"
}
```

### 5.6 Error Response Schema

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Your balance is insufficient for this bet"
  }
}
```

### 5.7 Payout Table Configuration Schema

```json
{
  "difficulty": "EASY",
  "selections": 6,
  "payouts": {
    "0": 0,
    "1": 0.2,
    "2": 1.36,
    "3": 2.51,
    "4": 5,
    "5": 15,
    "6": 25
  }
}
```

---

## 6. Backend Business Logic Breakdown

### 6.1 Authentication Service

```typescript
// Responsibilities:
// 1. Validate operator credentials
// 2. Validate auth token with external provider
// 3. Create/retrieve user session
// 4. Generate JWT token
// 5. Return initial balance and config

interface AuthService {
  authenticate(request: AuthRequest): Promise<AuthResponse>;
  validateJWT(token: string): Promise<UserSession>;
  refreshSession(sessionToken: string): Promise<UserSession>;
}
```

### 6.2 Bet Validation Service

```typescript
// Validation Rules:
// 1. Session must be valid and not expired
// 2. Selections must be 1-10 unique numbers in range 1-40
// 3. Bet amount >= minimum (0.06)
// 4. Bet amount <= user balance
// 5. Difficulty must be EASY, MEDIUM, or HIGH
// 6. No concurrent bets from same session

interface BetValidationService {
  validateBet(request: BetRequest, session: UserSession): ValidationResult;
  checkConcurrentBet(sessionId: string): boolean;
  lockSession(sessionId: string): void;
  unlockSession(sessionId: string): void;
}
```

### 6.3 Random Number Generator Service

```typescript
// Requirements:
// 1. Cryptographically secure random generation
// 2. Generate exactly 10 unique numbers from 1-40
// 3. Support provably fair verification
// 4. Pre-generate server seed before bet

interface RNGService {
  generateServerSeed(): string;
  generateDrawnNumbers(serverSeed: string, clientSeed: string, nonce: number): number[];
  verifyResult(serverSeed: string, clientSeed: string, nonce: number, numbers: number[]): boolean;
}
```

### 6.4 Payout Calculation Service

```typescript
// Logic:
// 1. Count hits (intersection of selections and drawn)
// 2. Look up multiplier from payout table
// 3. Calculate payout = bet * multiplier
// 4. Handle edge cases (0 hits, max hits)

interface PayoutService {
  getPayoutTable(difficulty: Difficulty, selectionCount: number): PayoutTable;
  calculateHits(selections: number[], drawn: number[]): number[];
  calculatePayout(betAmount: number, hitCount: number, table: PayoutTable): number;
}
```

### 6.5 Balance Service

```typescript
// Operations:
// 1. Deduct bet (atomic, with lock)
// 2. Credit payout (atomic)
// 3. Sync with external wallet if needed
// 4. Maintain transaction log

interface BalanceService {
  deductBet(userId: string, amount: number): Promise<Transaction>;
  creditPayout(userId: string, amount: number): Promise<Transaction>;
  getBalance(userId: string): Promise<number>;
  rollback(transactionId: string): Promise<void>;
}
```

### 6.6 Game History Service

```typescript
// Stores:
// 1. All bet details
// 2. Results and payouts
// 3. Provably fair data
// 4. Timestamps

interface GameHistoryService {
  recordBet(bet: BetRecord): Promise<void>;
  getBetHistory(userId: string, limit: number, offset: number): Promise<BetRecord[]>;
  getBetById(betId: string): Promise<BetRecord>;
}
```

### 6.7 Complete Bet Flow (Pseudo-code)

```typescript
async function processBet(request: BetRequest): Promise<BetResponse> {
  // 1. Validate session
  const session = await authService.validateJWT(request.token);
  if (!session) throw new UnauthorizedError();

  // 2. Acquire lock to prevent concurrent bets
  const locked = await betValidationService.lockSession(session.id);
  if (!locked) throw new ConcurrentBetError();

  try {
    // 3. Validate bet parameters
    const validation = betValidationService.validateBet(request, session);
    if (!validation.valid) throw new ValidationError(validation.errors);

    // 4. Deduct bet from balance (atomic)
    const debitTx = await balanceService.deductBet(session.userId, request.betAmount);

    // 5. Generate drawn numbers
    const serverSeed = rngService.generateServerSeed();
    const drawnNumbers = rngService.generateDrawnNumbers(
      serverSeed,
      request.clientSeed,
      session.nonce
    );

    // 6. Calculate results
    const hits = payoutService.calculateHits(request.selections, drawnNumbers);
    const payoutTable = payoutService.getPayoutTable(request.difficulty, request.selections.length);
    const payout = payoutService.calculatePayout(request.betAmount, hits.length, payoutTable);

    // 7. Credit payout (if any)
    if (payout > 0) {
      await balanceService.creditPayout(session.userId, payout);
    }

    // 8. Record bet history
    await gameHistoryService.recordBet({
      betId: generateBetId(),
      userId: session.userId,
      selections: request.selections,
      drawnNumbers,
      hits,
      betAmount: request.betAmount,
      payout,
      difficulty: request.difficulty,
      serverSeed,
      clientSeed: request.clientSeed,
      nonce: session.nonce,
      timestamp: new Date()
    });

    // 9. Increment nonce for next bet
    session.nonce++;

    // 10. Return result
    return {
      success: true,
      drawnNumbers,
      hits,
      hitCount: hits.length,
      multiplier: payoutTable[hits.length],
      payout,
      newBalance: await balanceService.getBalance(session.userId),
      serverSeed // Reveal after bet
    };

  } finally {
    // Always release lock
    await betValidationService.unlockSession(session.id);
  }
}
```

---

## 7. NestJS Architecture Proposal

### 7.1 Module Structure

```
src/
├── app.module.ts
├── main.ts
│
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── auth.guard.ts
│   ├── jwt.strategy.ts
│   └── dto/
│       ├── auth-request.dto.ts
│       └── auth-response.dto.ts
│
├── game/
│   ├── game.module.ts
│   ├── game.controller.ts
│   ├── game.service.ts
│   ├── game.gateway.ts (WebSocket)
│   ├── dto/
│   │   ├── bet-request.dto.ts
│   │   ├── bet-response.dto.ts
│   │   └── game-result.dto.ts
│   └── interfaces/
│       └── game-state.interface.ts
│
├── payout/
│   ├── payout.module.ts
│   ├── payout.service.ts
│   └── payout-tables/
│       ├── easy.payout.ts
│       ├── medium.payout.ts
│       └── high.payout.ts
│
├── rng/
│   ├── rng.module.ts
│   ├── rng.service.ts
│   └── provably-fair.service.ts
│
├── balance/
│   ├── balance.module.ts
│   ├── balance.service.ts
│   └── dto/
│       └── balance-update.dto.ts
│
├── history/
│   ├── history.module.ts
│   ├── history.service.ts
│   ├── history.controller.ts
│   └── entities/
│       └── bet-record.entity.ts
│
├── session/
│   ├── session.module.ts
│   └── session.service.ts
│
└── common/
    ├── filters/
    │   └── http-exception.filter.ts
    ├── interceptors/
    │   └── logging.interceptor.ts
    ├── decorators/
    │   └── user.decorator.ts
    └── constants/
        └── game.constants.ts
```

### 7.2 Module Dependencies

```
┌──────────────────────────────────────────────────────────────────┐
│                          AppModule                               │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ AuthModule  │  │ GameModule  │  │HistoryModule│              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         │                │                │                      │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐              │
│  │SessionModule│  │PayoutModule │  │   Database  │              │
│  └─────────────┘  └─────────────┘  │  (TypeORM)  │              │
│                                    └─────────────┘              │
│  ┌─────────────┐  ┌─────────────┐                               │
│  │BalanceModule│  │  RNGModule  │                               │
│  └─────────────┘  └─────────────┘                               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 7.3 Key DTOs

```typescript
// auth-request.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class AuthRequestDto {
  @IsString()
  @IsNotEmpty()
  operator: string;

  @IsString()
  @IsNotEmpty()
  auth_token: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  game_mode: string;
}

// bet-request.dto.ts
import { IsArray, IsNumber, IsEnum, Min, Max, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export enum Difficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH'
}

export class BetRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsNumber({}, { each: true })
  @Min(1, { each: true })
  @Max(40, { each: true })
  selections: number[];

  @IsNumber()
  @Min(0.06)
  betAmount: number;

  @IsEnum(Difficulty)
  difficulty: Difficulty;

  @IsString()
  clientSeed?: string;
}
```

### 7.4 WebSocket Gateway

```typescript
// game.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    // Validate auth token from handshake
    // Associate socket with session
  }

  handleDisconnect(client: Socket) {
    // Cleanup session if needed
  }

  @SubscribeMessage('bet:place')
  async handleBet(client: Socket, payload: BetRequestDto) {
    // Process bet
    // Emit draw events
    // Emit result
  }

  // Emit methods for sending to specific client
  emitBalanceUpdate(clientId: string, balance: number) {
    this.server.to(clientId).emit('balance:update', { balance });
  }

  emitDrawNumber(clientId: string, number: number, index: number) {
    this.server.to(clientId).emit('draw:number', { number, index });
  }
}
```

### 7.5 State Storage Strategy

| Data Type | Storage | Reason |
|-----------|---------|--------|
| Sessions | Redis | Fast access, TTL support, distributed |
| Payout Tables | In-memory (constants) | Static data, frequently accessed |
| Game History | PostgreSQL | Persistence, queryable |
| Balances | External API + Redis Cache | Source of truth with caching |
| Active Bets | Redis | Prevent concurrent bets |

### 7.6 Scaling Considerations

```
┌─────────────────────────────────────────────────────────────────┐
│                     SCALING ARCHITECTURE                        │
└─────────────────────────────────────────────────────────────────┘

                         ┌─────────────┐
                         │ Load Balancer│
                         │   (nginx)   │
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
       ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
       │  NestJS #1  │   │  NestJS #2  │   │  NestJS #3  │
       │  (Worker)   │   │  (Worker)   │   │  (Worker)   │
       └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
              │                 │                 │
              └─────────────────┼─────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
             ┌──────▼──────┐         ┌──────▼──────┐
             │    Redis    │         │ PostgreSQL  │
             │  (Cluster)  │         │  (Primary)  │
             └─────────────┘         └─────────────┘
```

**Key Points:**
- Use Redis Pub/Sub for WebSocket scaling across instances
- Sticky sessions NOT required if using Redis for session state
- Stateless workers for horizontal scaling
- Database connection pooling essential

---

## 8. Edge Cases & Failure Scenarios

### 8.1 Concurrent Bet Prevention

**Scenario:** User rapidly clicks BET multiple times.

**Solution:**
```typescript
// Use Redis lock with TTL
async function acquireBetLock(sessionId: string): Promise<boolean> {
  const lockKey = `bet_lock:${sessionId}`;
  const result = await redis.set(lockKey, '1', 'NX', 'EX', 30);
  return result === 'OK';
}
```

### 8.2 Insufficient Balance During Bet

**Scenario:** Balance changes between validation and deduction.

**Solution:**
```typescript
// Atomic balance deduction with conditional check
async function deductBet(userId: string, amount: number): Promise<boolean> {
  const result = await db.query(`
    UPDATE balances
    SET amount = amount - $1
    WHERE user_id = $2 AND amount >= $1
    RETURNING amount
  `, [amount, userId]);
  return result.rowCount > 0;
}
```

### 8.3 Connection Lost During Draw

**Scenario:** WebSocket disconnects mid-game.

**Solution:**
- Store bet state in Redis with TTL
- On reconnect, check for pending bet
- Resume draw animation from last known state
- Always complete bet on server regardless of connection

```typescript
interface PendingBet {
  betId: string;
  drawnNumbers: number[];
  revealedCount: number;
  result: BetResult;
}
```

### 8.4 Server Restart During Active Bet

**Scenario:** Server crashes after bet deduction but before result.

**Solution:**
- Use transaction log/event sourcing
- On startup, replay incomplete transactions
- Implement idempotency keys for bet operations

### 8.5 Invalid Number Selection Attempts

**Scenario:** User sends [0, 41, -1, 50] as selections.

**Solution:**
```typescript
// Strict validation
function validateSelections(selections: number[]): ValidationResult {
  const errors = [];

  // Check array bounds
  if (selections.length < 1 || selections.length > 10) {
    errors.push('Must select 1-10 numbers');
  }

  // Check each number
  for (const num of selections) {
    if (!Number.isInteger(num) || num < 1 || num > 40) {
      errors.push(`Invalid number: ${num}`);
    }
  }

  // Check for duplicates
  if (new Set(selections).size !== selections.length) {
    errors.push('Duplicate numbers not allowed');
  }

  return { valid: errors.length === 0, errors };
}
```

### 8.6 Floating Point Precision Issues

**Scenario:** 0.1 + 0.2 = 0.30000000000000004

**Solution:**
```typescript
// Use integer math (cents) internally
const betAmountCents = Math.round(betAmount * 100);
const payoutCents = Math.round(betAmountCents * multiplier);
const payoutDollars = payoutCents / 100;

// Or use decimal.js library for precise calculations
import Decimal from 'decimal.js';
const payout = new Decimal(betAmount).times(multiplier).toDecimalPlaces(2);
```

### 8.7 Rate Limiting

**Scenario:** Bot making 1000 bets per second.

**Solution:**
```typescript
// Use sliding window rate limiter
const RATE_LIMIT = {
  windowMs: 60000, // 1 minute
  maxRequests: 60, // 60 bets per minute max
};

@UseGuards(RateLimitGuard)
@Post('bet')
async placeBet() { ... }
```

### 8.8 Session Expiry During Game

**Scenario:** JWT expires while user is selecting numbers.

**Solution:**
- Frontend should track token expiry
- Implement token refresh before expiry
- Backend returns 401 with clear error code
- Frontend handles gracefully with re-auth

---

## 9. Assumptions

The following items could not be directly observed and are documented as assumptions:

### 9.1 Network Protocol Assumptions

| Assumption | Confidence | Notes |
|------------|------------|-------|
| Game uses WebSocket for real-time updates | Medium | Standard for real-time games, but REST-only is possible |
| Bet API endpoint is POST /api/bet or similar | Medium | Based on REST conventions |
| Balance updates are pushed via WebSocket | Medium | Alternative: polling or response-only |

### 9.2 Business Logic Assumptions

| Assumption | Confidence | Notes |
|------------|------------|-------|
| Complete payout tables exist for all selection counts (1-10) | High | UI shows payout table dynamically |
| Provably fair uses SHA-256 hashing | Medium | Industry standard |
| Server seed is revealed after each bet | Medium | Standard provably fair implementation |
| Nonce increments by 1 each bet | Medium | Common pattern |

### 9.3 Technical Assumptions

| Assumption | Confidence | Notes |
|------------|------------|-------|
| Session tokens have TTL of ~24 hours | Low | Based on typical implementations |
| Maximum bet amount exists | High | Standard for gambling games |
| Auto-bet/turbo features may exist | Low | Not observed but common |

### 9.4 Complete Payout Tables (Assumption)

Full payout tables for all combinations were not captured. The following structure is assumed:

```typescript
const PAYOUT_TABLES: Record<Difficulty, Record<number, number[]>> = {
  EASY: {
    1: [0, 3.8],
    2: [0, 1.8, 5],
    3: [0, 1.3, 2.54, 5],
    4: [0, 0.5, 2, 5, 10],
    5: [0, 0.25, 1.36, 5, 10, 15],
    6: [0, 0.2, 1.36, 2.51, 5, 15, 25],
    7: [/* ... */],
    8: [/* ... */],
    9: [/* ... */],
    10: [/* ... */],
  },
  MEDIUM: { /* ... */ },
  HIGH: { /* ... */ }
};
```

**Recommendation:** Obtain complete payout tables from game operator or extract from game configuration API.

---

## Appendix A: API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth | Authenticate and get JWT |
| GET | /api/balance | Get current balance |
| POST | /api/bet | Place a bet |
| GET | /api/history | Get bet history |
| GET | /api/config | Get game configuration |
| GET | /api/payout-tables | Get payout tables |

## Appendix B: Error Codes

| Code | Message | HTTP Status |
|------|---------|-------------|
| INVALID_AUTH | Invalid authentication credentials | 401 |
| SESSION_EXPIRED | Session has expired | 401 |
| INSUFFICIENT_BALANCE | Balance insufficient for bet | 400 |
| INVALID_SELECTION | Invalid number selection | 400 |
| INVALID_BET_AMOUNT | Bet amount out of range | 400 |
| CONCURRENT_BET | Another bet in progress | 409 |
| RATE_LIMITED | Too many requests | 429 |
| SERVER_ERROR | Internal server error | 500 |

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| Hit | A number in player's selection that matches a drawn number |
| Multiplier | The factor by which bet is multiplied to calculate payout |
| Difficulty | Risk level affecting payout multipliers |
| Provably Fair | System allowing players to verify randomness |
| Server Seed | Random value generated by server before bet |
| Client Seed | Value provided by player for randomness |
| Nonce | Counter incrementing with each bet for uniqueness |

---

**Document End**

*This PRD was generated through reverse-engineering of the production Keno game. Some implementation details are inferred based on observed behavior and industry standards. Items marked as assumptions should be verified with the game operator.*
