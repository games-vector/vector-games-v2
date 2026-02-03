# CoinFlip Game - Backend Requirements Document

## Overview
This document defines the complete backend requirements for the CoinFlip game, based on analysis of the existing implementation at `coinflip.inout.games`.

## Game Modes

### 1. QUICK Mode (Instant)
- Single flip, immediate result
- Player selects choice (HEADS/TAILS) with bet in one action
- Fixed multiplier: **1.94x** (house edge ~3%)

### 2. ROUNDS Mode (Multiply)
- Multi-round progressive game (up to 20 rounds)
- Player places bet first, then chooses for each round
- Multiplier doubles each winning round
- Player can cashout at any time after winning a round

---

## Socket.IO Protocol

### Connection
```
URL: wss://api.inout.games:443/io/
Protocol: Socket.IO v4 (Engine.IO)
Transport: WebSocket
Auth: JWT token in query parameter
```

### Message Format (Socket.IO)
| Prefix | Type | Description |
|--------|------|-------------|
| `0{...}` | Engine.IO | Handshake open |
| `40` | Socket.IO | Connect request |
| `40{...}` | Socket.IO | Connect acknowledgment |
| `42["event", data]` | Socket.IO | Event message |
| `42X["event", data]` | Socket.IO | Event with ack ID X |
| `2` | Engine.IO | Ping |
| `3` | Engine.IO | Pong |

---

## WebSocket Events

### Server → Client Events (Push)

#### 1. `onBalanceChange`
Triggered when user balance changes (bet placed, win, cashout).
```typescript
{
  currency: string;    // "USD"
  balance: string;     // "999999.40"
}
```

#### 2. `betsRanges`
Sent on connection - min/max bet amounts per currency.
```typescript
{
  USD: [string, string];  // ["0.01", "200.00"]
}
```

#### 3. `betsConfig`
Sent on connection - bet configuration per currency.
```typescript
{
  USD: {
    betPresets: string[];      // ["0.5", "1", "2", "7"]
    minBetAmount: string;      // "0.01"
    maxBetAmount: string;      // "200.00"
    maxWinAmount: string;      // "20000.00"
    defaultBetAmount: string;  // "0.300000000000000000"
    decimalPlaces: number | null;
  }
}
```

#### 4. `myData`
Sent on connection - user information.
```typescript
{
  userId: string;           // "35d9d6d4-c415-432e-91d2-73b67f72fa42"
  nickname: string;         // "Magenta Puzzled Stork"
  gameAvatar: string | null;
}
```

#### 5. `currencies`
Sent on connection - exchange rates for all currencies.
```typescript
{
  USD: 1,
  EUR: 0.8755,
  BTC: 0.000012,
  // ... all currencies
}
```

---

## Game Service Actions (Request/Response)

### Event Name: `gameService`
All game actions use this event with acknowledgment callbacks.

### Action: `get-game-config`
Get game configuration.
```typescript
// Request
{ action: "get-game-config" }

// Response
{
  error?: { message: string };  // If failed
}
```

### Action: `get-game-state`
Get current game session state (for reconnection).
```typescript
// Request
{ action: "get-game-state", payload: {} }

// Response (if active session)
{
  isFinished: boolean;
  isWin: boolean;
  currency: string;
  betAmount: string;
  coeff: string;
  choices: string[];      // ["HEADS", "HEADS"]
  roundNumber: number;
  playMode: "QUICK" | "ROUNDS";
  quickGamesHistory?: QuickGameResult[];
}

// Response (no active session)
null
```

### Action: `bet`
Place a bet.

#### QUICK Mode (Instant)
```typescript
// Request
{
  action: "bet",
  payload: {
    betAmount: string;        // "0.3"
    currency: string;         // "USD"
    choice: "HEADS" | "TAILS"; // Required for QUICK
    playMode: "QUICK"
  }
}

// Response
{
  isFinished: true;
  isWin: boolean;
  currency: string;
  betAmount: string;
  coeff: string;              // "1.94"
  choices: string[];          // ["HEADS"]
  roundNumber: number;        // 0
  playMode: "QUICK";
  winAmount: string;          // "0.58" or "0"
  quickGamesHistory: QuickGameResult[];
}
```

#### ROUNDS Mode (Multiply)
```typescript
// Request
{
  action: "bet",
  payload: {
    betAmount: string;        // "0.3"
    currency: string;         // "USD"
    choice: null;             // null for ROUNDS
    playMode: "ROUNDS"
  }
}

// Response
{
  isFinished: false;
  isWin: false;
  currency: string;
  betAmount: string;
  choices: [];                // Empty until first step
  roundNumber: 0;
  playMode: "ROUNDS"
}
```

### Action: `step`
Make a choice in ROUNDS mode.
```typescript
// Request
{
  action: "step",
  payload: {
    choice: "HEADS" | "TAILS";
    roundNumber: number;       // 1, 2, 3, ... (1-indexed)
  }
}

// Response (Win - Continue)
{
  isFinished: false;
  isWin: true;
  currency: string;
  betAmount: string;
  coeff: string;               // "1.94", "3.88", "7.76"...
  choices: string[];           // ["HEADS"]
  roundNumber: number;         // 1
  playMode: "ROUNDS"
}

// Response (Lose)
{
  isFinished: true;
  isWin: false;
  currency: string;
  betAmount: string;
  choices: string[];
  roundNumber: number;
  playMode: "ROUNDS";
  winAmount: "0"
}

// Response (Win Round 20 - Max)
{
  isFinished: true;
  isWin: true;
  currency: string;
  betAmount: string;
  coeff: string;
  choices: string[];
  roundNumber: 20;
  playMode: "ROUNDS";
  winAmount: string;
}
```

### Action: `withdraw` (Cashout)
Cash out current winnings in ROUNDS mode.
```typescript
// Request
{ action: "withdraw" }

// Response
{
  isFinished: true;
  isWin: true;
  currency: string;
  betAmount: string;
  coeff: string;
  choices: string[];
  roundNumber: number;
  playMode: "ROUNDS";
  winAmount: string;          // Calculated: betAmount * coeff
}
```

---

## Game Configuration

### Multiplier Ladder (ROUNDS Mode)
```typescript
const MULTIPLIERS = [
  "1.94",    // Round 1
  "3.88",    // Round 2  (1.94 × 2)
  "7.76",    // Round 3  (3.88 × 2)
  "15.52",   // Round 4
  "31.04",   // Round 5
  "62.08",   // Round 6
  "124.16",  // Round 7
  "248.32",  // Round 8
  "496.64",  // Round 9
  // ... continues up to Round 20
];
```

### Bet Configuration
```typescript
const BET_CONFIG = {
  currency: "USD",
  minBetAmount: "0.01",
  maxBetAmount: "200.00",
  maxWinAmount: "20000.00",
  defaultBetAmount: "0.30",
  betPresets: ["0.5", "1", "2", "7"],
  decimalPlaces: 2
};
```

### Game Constants
```typescript
const GAME_CONSTANTS = {
  GAME_CODE: "coinflip",
  GAME_NAME: "CoinFlip",
  MAX_ROUNDS: 20,
  BASE_MULTIPLIER: 1.94,       // ~3% house edge (1/0.5 - ~3%)
  QUICK_MODE_MULTIPLIER: 1.94,
  CHOICES: ["HEADS", "TAILS"],
  WIN_PROBABILITY: 0.5,        // 50% chance each flip
};
```

---

## Data Types

### TypeScript Interfaces

```typescript
// Play modes
type PlayMode = "QUICK" | "ROUNDS";

// Choices
type CoinChoice = "HEADS" | "TAILS";

// Quick game history entry
interface QuickGameResult {
  isWin: boolean;
  result: CoinChoice;          // The actual result (what coin landed on)
  datetime: string;            // ISO timestamp
}

// Bet payload
interface BetPayload {
  betAmount: string;
  currency: string;
  choice: CoinChoice | null;   // null for ROUNDS mode
  playMode: PlayMode;
}

// Step payload
interface StepPayload {
  choice: CoinChoice;
  roundNumber: number;
}

// Game state response
interface GameStateResponse {
  isFinished: boolean;
  isWin: boolean;
  currency: string;
  betAmount: string;
  coeff?: string;
  choices: CoinChoice[];
  roundNumber: number;
  playMode: PlayMode;
  winAmount?: string;
  quickGamesHistory?: QuickGameResult[];
}

// Game session (Redis)
interface CoinFlipGameSession {
  userId: string;
  agentId: string;
  currency: string;
  playMode: PlayMode;
  betAmount: number;
  currentRound: number;
  choices: CoinChoice[];
  results: CoinChoice[];
  isActive: boolean;
  isWin: boolean;
  currentCoeff: string;
  winAmount: number;
  platformBetTxId: string;
  roundId: string;
  gameCode: string;
  createdAt: Date;
  // Fairness
  serverSeed?: string;
  userSeed?: string;
  hashedServerSeed?: string;
  nonce?: number;
}
```

---

## Game Flow Diagrams

### QUICK Mode Flow
```
1. Client → Server: bet (with choice)
2. Server: Deduct balance
3. Server: Generate result (provably fair)
4. Server: Calculate win/loss
5. Server: Settle bet
6. Server → Client: onBalanceChange (deduction)
7. Server → Client: onBalanceChange (if win)
8. Server → Client: Game result (ack)
```

### ROUNDS Mode Flow
```
1. Client → Server: bet (choice=null, playMode=ROUNDS)
2. Server: Deduct balance
3. Server: Create session
4. Server → Client: onBalanceChange (deduction)
5. Server → Client: Game state (isFinished=false)

[For each round until win round 20, loss, or cashout]
6. Client → Server: step (choice, roundNumber)
7. Server: Generate result
8. If WIN:
   - Server: Update session (coeff, choices)
   - Server → Client: Game state (isFinished=false, isWin=true)
9. If LOSE:
   - Server: Settle bet (winAmount=0)
   - Server → Client: Game state (isFinished=true, isWin=false)
   - Server → Client: onBalanceChange (no change)

[If player cashes out]
10. Client → Server: withdraw
11. Server: Calculate winAmount (betAmount × coeff)
12. Server: Settle bet
13. Server → Client: onBalanceChange (win)
14. Server → Client: Game state (isFinished=true, isWin=true, winAmount)
```

---

## Random Number Generation (Provably Fair)

### Algorithm
```typescript
function generateCoinFlipResult(
  serverSeed: string,
  userSeed: string,
  nonce: number
): CoinChoice {
  const combined = `${serverSeed}:${userSeed}:${nonce}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');

  // Use first 8 chars of hash as hex number
  const decimal = parseInt(hash.substring(0, 8), 16);

  // 50/50 split
  return decimal % 2 === 0 ? "HEADS" : "TAILS";
}
```

### Fairness Data Structure
```typescript
interface FairnessData {
  decimal: string;
  clientSeed: string;
  serverSeed: string;
  combinedHash: string;
  hashedServerSeed: string;
}
```

---

## API Endpoints (REST)

### Authentication
```
POST /api/auth
Body: { authToken, operatorId, gameMode, currency, lang }
Response: { JWT token }
```

### Online Counter
```
GET /api/online-counter/v1/data
Response: { count: number }
```

---

## Error Handling

### Error Response Format
```typescript
{
  error: {
    message: string;
  }
}
```

### Error Messages
```typescript
const ERROR_MESSAGES = {
  MISSING_ACTION: "missing_action",
  ACTIVE_SESSION_EXISTS: "active_session_exists",
  NO_ACTIVE_SESSION: "no_active_session",
  INVALID_BET_AMOUNT: "invalid_bet_amount",
  INVALID_CHOICE: "invalid_choice",
  INVALID_PLAY_MODE: "invalid_play_mode",
  INVALID_ROUND_NUMBER: "invalid_round_number",
  AGENT_REJECTED: "agent_rejected",
  SETTLEMENT_FAILED: "settlement_failed",
  CASHOUT_FAILED: "cashout_failed",
  METHOD_NOT_IMPLEMENTED: "method not implemented",
};
```

---

## File Structure

```
src/games/coinflip-game/
├── coinflip-game.module.ts
├── coinflip-game.handler.ts
├── coinflip-game.service.ts
├── DTO/
│   ├── bet-payload.dto.ts
│   ├── step-payload.dto.ts
│   └── game-state.dto.ts
├── interfaces/
│   └── game-session.interface.ts
├── modules/
│   └── fairness/
│       ├── fairness.module.ts
│       └── fairness.service.ts
└── constants/
    └── coinflip.constants.ts
```

---

## Socket Message Sequence Examples

### Example 1: QUICK Mode Win
```
→ 420["gameService",{"action":"bet","payload":{"betAmount":"0.3","currency":"USD","choice":"HEADS","playMode":"QUICK"}}]
← 42["onBalanceChange",{"currency":"USD","balance":"999999.40"}]
← 42["onBalanceChange",{"currency":"USD","balance":"999999.98"}]
← 430[{"isFinished":true,"isWin":true,"currency":"USD","betAmount":"0.3","coeff":"1.94","choices":["HEADS"],"roundNumber":0,"playMode":"QUICK","winAmount":"0.58"}]
```

### Example 2: ROUNDS Mode - Multiple Rounds + Cashout
```
# Start game
→ 421["gameService",{"action":"bet","payload":{"betAmount":"0.3","currency":"USD","choice":null,"playMode":"ROUNDS"}}]
← 42["onBalanceChange",{"currency":"USD","balance":"999999.08"}]
← 431[{"isFinished":false,"isWin":false,"currency":"USD","betAmount":"0.3","choices":[],"roundNumber":0,"playMode":"ROUNDS"}]

# Round 1 - Win
→ 422["gameService",{"action":"step","payload":{"choice":"HEADS","roundNumber":1}}]
← 432[{"isFinished":false,"isWin":true,"currency":"USD","betAmount":"0.3","coeff":"1.94","choices":["HEADS"],"roundNumber":1,"playMode":"ROUNDS"}]

# Round 2 - Win
→ 423["gameService",{"action":"step","payload":{"choice":"HEADS","roundNumber":2}}]
← 433[{"isFinished":false,"isWin":true,"currency":"USD","betAmount":"0.3","coeff":"3.88","choices":["HEADS","HEADS"],"roundNumber":2,"playMode":"ROUNDS"}]

# Cashout
→ 424["gameService",{"action":"withdraw"}]
← 434[{"isFinished":true,"isWin":true,"currency":"USD","betAmount":"0.3","coeff":"3.88","choices":["HEADS","HEADS"],"roundNumber":2,"playMode":"ROUNDS","winAmount":"1.16"}]
← 42["onBalanceChange",{"currency":"USD","balance":"1000000.24"}]
```

### Example 3: ROUNDS Mode - Loss
```
→ 425["gameService",{"action":"bet","payload":{"betAmount":"0.3","currency":"USD","choice":null,"playMode":"ROUNDS"}}]
← 42["onBalanceChange",{"currency":"USD","balance":"999999.38"}]
← 435[{"isFinished":false,"isWin":false,"currency":"USD","betAmount":"0.3","choices":[],"roundNumber":0,"playMode":"ROUNDS"}]

→ 426["gameService",{"action":"step","payload":{"choice":"HEADS","roundNumber":1}}]
← 436[{"isFinished":true,"isWin":false,"currency":"USD","betAmount":"0.3","choices":["HEADS"],"roundNumber":1,"playMode":"ROUNDS","winAmount":"0"}]
← 42["onBalanceChange",{"currency":"USD","balance":"999999.38"}]
```

---

## Implementation Notes

1. **Session Management**: Use Redis to store active game sessions with TTL
2. **Concurrency**: Use distributed locks to prevent double-betting
3. **Idempotency**: Track bet transactions to prevent duplicate processing
4. **Balance Updates**: Always emit `onBalanceChange` after any balance modification
5. **Acknowledgment IDs**: Socket.IO ack IDs are auto-incrementing per client session
6. **Quick Games History**: Store last N quick game results for the user (shown in UI)
7. **Fairness Seeds**: Generate and rotate seeds per bet for provably fair verification

---

## Local Testing Setup

### Operator Configuration

| Operator | Wallet API | Use Case |
|----------|------------|----------|
| `brlag` | Real remote API | **Recommended for testing** - no additional setup needed |
| `dev-operator` | `localhost:3001` | Requires mock wallet server running |

### Quick Start (Recommended)

1. Start the backend: `npm run start:dev`
2. Open test UI: `coinflip-clone-httrack/simple-test.html`
3. The test UI uses `brlag` operator by default (real wallet API)

### Test Files

All test HTML files in `coinflip-clone-httrack/` are configured to use `brlag` operator:
- `simple-test.html` - Simple UI for QUICK mode testing
- `index.html` - Full React frontend
- `test-direct-connection.html` - WebSocket connection testing
- `test-coinflip.html` - Basic coinflip testing

### Using dev-operator (Optional)

If you need to use `dev-operator` (isolated local testing):
1. Start mock wallet: `node mock-wallet-server.js`
2. Add `?operatorId=dev-operator` to the test URL

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `bet_failed` with ECONNREFUSED | Mock wallet not running | Use `brlag` operator or start `mock-wallet-server.js` |
| Balance not updating | WebSocket disconnect | Refresh page, check backend logs |
| Auth failed | Invalid token | Check backend is running on port 3000 |
