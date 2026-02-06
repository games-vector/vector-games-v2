# Mines Game - Product Requirements Document (PRD)

## 1. Game Overview

**Mines** is a single-player, instant-win casino game where players navigate a 5x5 grid (25 cells) trying to reveal stars while avoiding hidden bombs. Players choose how many bombs (mines) to place on the board, place a bet, and then click cells one by one. Each safely revealed cell increases the multiplier. Players can cash out at any time, or continue clicking for higher multipliers at greater risk. Hitting a bomb ends the game with a total loss.

### Core Mechanics
- **Grid**: 5x5 = 25 cells total
- **Cell positions**: 1-indexed (1-25), mapped as `id = row * 5 + column` (0-indexed internally, sent as 1-indexed to server)
- **Grid mapping**: `column = (id) % 5`, `row = Math.floor((id) / 5)` (0-indexed)
- **Bombs**: Player selects 3, 5, 10, 24, or custom (1-24) bombs
- **Stars**: `25 - bombCount` safe cells
- **Outcome**: Determined server-side using provably fair algorithm (server seed + client seed)

---

## 2. Game States & Lifecycle

### 2.1 Game Status (Server-side)
```
enum GameStatus {
  None = "none",       // No active game
  InGame = "in-game",  // Game in progress, player clicking cells
  Lose = "lose",       // Player hit a mine
  Win = "win"          // Player cashed out successfully
}
```

### 2.2 Client-side Game Stages
```
enum GameStage {
  NotStarted = 0,  // status is "none" - ready to play
  InProgress = 1,  // status is "in-game" - clicking cells
  GameOver = 2,    // status is "lose" AND explosion animation playing
  Finished = 3     // status is "win" OR "lose" after animation complete
}
```

### 2.3 Stage Computation Logic
```
if (status === "none") → NotStarted (0)
if (status === "in-game") → InProgress (1)
if (showingExplosion) → GameOver (2)
else → Finished (3)  // covers both "win" and "lose" after animation
```

### 2.4 State Transition Flow
```
NotStarted → [Player clicks Play] → InProgress
InProgress → [Player clicks cell, finds star] → InProgress (updated multiplier)
InProgress → [Player clicks cell, hits mine] → GameOver → Finished
InProgress → [Player clicks Cash Out] → Finished (Win)
Finished → [Player clicks Play again] → InProgress (new round)
```

---

## 3. Authentication & Connection Flow

### 3.1 HTTP Authentication
```
POST /api/auth
Content-Type: application/json

Request Body:
{
  "operator": "<operatorId>",        // UUID, e.g. "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52"
  "auth_token": "<authToken>",       // UUID token from operator
  "currency": "USD",                 // Player's currency
  "game_mode": "platform-mines"      // Game identifier
}

Response:
{
  "data": "<jwt_token>"              // JWT for WebSocket auth
}

Response Headers:
  country-code: <ISO country code>   // Player's detected country
```

### 3.2 WebSocket Connection (Socket.IO v4)
```
Transport: WebSocket (not polling)
URL: wss://<api-host>/
Path: default Socket.IO path

Connection params:
{
  transports: ["websocket"],
  auth: { /* from auth response */ },
  query: {
    gameMode: "platform-mines",
    operatorId: "<operatorId>",
    currency: "USD",
    token: "<jwt_token>"
  }
}
```

### 3.3 Connection Sequence (Events received on connect)
After WebSocket connection is established, the server pushes the following events:

| Order | Event Name | Direction | Description |
|-------|-----------|-----------|-------------|
| 1 | `connect` | Server → Client | Socket.IO connection established |
| 2 | `onBalanceChange` | Server → Client | Player's current balance |
| 3 | `betsConfig` | Server → Client | Bet configuration (min/max/presets) |
| 4 | `betsRanges` | Server → Client | Bet ranges per currency |
| 5 | `myData` | Server → Client | Player profile data |

Then the client requests initial data:

| Order | Event Name | Direction | Description |
|-------|-----------|-----------|-------------|
| 6 | `gameService` {action: "get-game-state"} | Client → Server | Get current game state (for reconnection) |
| 7 | `gameService` {action: "get-game-config"} | Client → Server | Get game configuration |
| 8 | `gameService` {action: "get-rates"} | Client → Server | Get currency exchange rates |
| 9 | `gameService` {action: "get-game-seeds"} | Client → Server | Get provably fair seeds |

---

## 4. Socket Messages - Complete API Reference

All game actions use the Socket.IO `emitWithAck` pattern (request/response with acknowledgement).

### 4.1 Event Names (Constants)

**Outgoing Events (Client → Server):**
| Constant | Event Name | Usage |
|----------|-----------|-------|
| GAME_SERVICE | `"gameService"` | All game actions (play, step, payout, etc.) |

**Incoming Events (Server → Client - Push):**
| Constant | Event Name | Description |
|----------|-----------|-------------|
| ON_GAME_STATE | `"onGameState"` | Game state push updates |
| ON_BALANCE_CHANGE | `"onBalanceChange"` | Balance change notification |
| ON_BONUS_CHANGE | `"onBonusChange"` | Bonus state changes |
| ON_CRASHED | `"onCrashed"` | Server error/crash notification |
| BETS_CONFIG | `"betsConfig"` | Bet configuration pushed on connect |
| BETS_RANGES | `"betsRanges"` | Bet ranges pushed on connect |
| EXCEPTION | `"exception"` | Error/exception from server |

**Incoming Events (Server → Client - Request-Response via emitWithAck):**
| Constant | Event Name | Description |
|----------|-----------|-------------|
| GET_USER_DATA | `"myData"` | User profile data pushed on connect |

### 4.2 Game Actions (via "gameService" event)

| Action | Constant | Description |
|--------|----------|-------------|
| `"play"` | PLAY | Start a new game (place bet) |
| `"step"` | STEP | Reveal a cell |
| `"payout"` | PAYOUT | Cash out current winnings |
| `"get-game-state"` | GET_GAME_STATE | Get current game state |
| `"get-rates"` | GET_RATES | Get currency exchange rates |
| `"get-game-seeds"` | GET_GAME_SEEDS | Get provably fair seeds |
| `"get-game-config"` | GAME_CONFIG | Get game configuration |
| `"get-game-history"` | GAME_HISTORY | Get player's bet history |

---

## 5. Socket Message Schemas - Detailed

### 5.1 Play (Start Game / Place Bet)

**User Interaction:** Player selects bomb count, bet amount, clicks "Play" button

**Request:**
```json
// Socket.IO emitWithAck
event: "gameService"
data: {
  "action": "play",
  "payload": {
    "gameType": "platform-mines",
    "amount": 1.00,                    // number - bet amount
    "currency": "USD",                 // string - player currency
    "value": {
      "minesCount": 3                  // number - bombs selected (1-24)
    },
    "bonusId": null                    // string|null - bonus ID if active
  }
}
```

**Response (Success - Game Started):**
```json
{
  "status": "in-game",
  "bet": {
    "amount": "1.00",                  // string - bet amount
    "currency": "USD",                 // string - currency
    "decimalPlaces": 2                 // number - decimal precision
  },
  "isFinished": false,
  "isWin": false,
  "coeff": 0,                          // number - current multiplier (0 at start)
  "winAmount": "0",                    // string - potential win amount
  "minesCount": 3,                     // number - bombs on board
  "openedCells": []                    // number[] - no cells opened yet (1-indexed)
}
```

**Side Effects:**
- Balance is deducted immediately by bet amount
- `onBalanceChange` event pushed with new balance

**Response (Error):**
```json
{
  "error": "<error message>"           // string - e.g. "Insufficient balance"
}
```

---

### 5.2 Step (Reveal a Cell)

**User Interaction:** Player clicks an unrevealed cell on the 5x5 grid

**Request:**
```json
event: "gameService"
data: {
  "action": "step",
  "payload": {
    "cellPosition": 13                 // number - 1-indexed cell position (1-25)
  }
}
```

**Cell Position Mapping (1-indexed):**
```
Row 0:  [ 1]  [ 2]  [ 3]  [ 4]  [ 5]
Row 1:  [ 6]  [ 7]  [ 8]  [ 9]  [10]
Row 2:  [11]  [12]  [13]  [14]  [15]
Row 3:  [16]  [17]  [18]  [19]  [20]
Row 4:  [21]  [22]  [23]  [24]  [25]
```

**Response (Safe - Star Found):**
```json
{
  "status": "in-game",
  "bet": {
    "amount": "1.00",
    "currency": "USD",
    "decimalPlaces": 2
  },
  "isFinished": false,
  "isWin": true,                       // true = at least one safe cell opened
  "coeff": 1.07,                       // number - current multiplier
  "winAmount": "1.07",                 // string - current cashout value
  "minesCount": 3,
  "openedCells": [1]                   // number[] - all opened cells so far (1-indexed)
}
```

**Response (Mine Hit - Game Over):**
```json
{
  "status": "lose",
  "bet": {
    "amount": "1.00",
    "currency": "USD",
    "decimalPlaces": 2
  },
  "isFinished": true,
  "isWin": false,
  "coeff": 0,                          // multiplier resets to 0
  "winAmount": "0.00",                 // no winnings
  "minesCount": 24,
  "openedCells": [13],                 // cells that were opened
  "minesCells": [15,23,25,22,6,17,4,5,1,13,3,12,16,19,8,11,2,20,18,14,9,24,10,21]
  // ^^^ ALL mine positions revealed (1-indexed) - only sent when game ends
}
```

**Key Behaviors:**
- `minesCells` is ONLY included in the response when the game ends (lose or win/payout)
- During `in-game`, server never reveals mine positions
- `openedCells` accumulates all successfully opened cells
- `coeff` increases with each safe cell opened
- `isWin` becomes `true` as soon as the first safe cell is opened
- Balance does NOT change during steps (already deducted at play)

---

### 5.3 Payout (Cash Out)

**User Interaction:** Player clicks "Cash out $X.XX" button during an active game

**Request:**
```json
event: "gameService"
data: {
  "action": "payout"
}
```

**Response (Success - Cashed Out):**
```json
{
  "status": "win",
  "bet": {
    "amount": "1.00",
    "currency": "USD",
    "decimalPlaces": 2
  },
  "isFinished": true,
  "isWin": true,
  "coeff": 1.23,                       // final multiplier
  "winAmount": "1.23",                 // string - actual win amount credited
  "minesCount": 3,
  "openedCells": [1, 25],             // all cells player opened
  "minesCells": [16, 2, 20]           // mine positions revealed after cashout
}
```

**Side Effects:**
- Balance is credited with `winAmount`
- `onBalanceChange` event pushed with new balance
- Game seeds are refetched (for provably fair verification)

---

### 5.4 Get Game State (Reconnection / Init)

**Trigger:** Called on initial connection and reconnection

**Request:**
```json
event: "gameService"
data: {
  "action": "get-game-state"
}
```

**Response (No Active Game):**
```json
{
  "status": "none"
}
```
Client converts this to default state:
```json
{
  "status": "none",
  "isFinished": false,
  "isWin": false,
  "coeff": 0,
  "winAmount": "0"
}
```

**Response (Active Game in Progress):**
```json
{
  "status": "in-game",
  "bet": { "amount": "1.00", "currency": "USD", "decimalPlaces": 2 },
  "isFinished": false,
  "isWin": true,
  "coeff": 1.07,
  "winAmount": "1.07",
  "minesCount": 3,
  "openedCells": [1]
}
```

---

### 5.5 Get Game Config

**Request:**
```json
event: "gameService"
data: {
  "action": "get-game-config"
}
```

**Response:**
```json
{
  "minBetAmount": "0.01",             // string - minimum bet
  "maxBetAmount": "200.00",           // string - maximum bet
  "maxWinAmount": "20000.00",         // string - maximum possible win
  "defaultBetAmount": "0.48",         // string - default bet on first load
  "betPresets": ["0.5", "1", "2", "7"], // string[] - quick bet buttons
  "decimalPlaces": "2",               // string - decimal precision for currency
  "currency": "USD"                   // string - configured currency
}
```

**Note:** The response may also include additional game-specific config merged into this object (e.g., `betConfig` properties are spread into the response).

---

### 5.6 Get Rates (Currency Exchange)

**Request:**
```json
event: "gameService"
data: {
  "action": "get-rates"
}
```

**Response:**
```json
{
  "USD": 1,
  "EUR": 0.8755,
  "BTC": 0.000015591603,
  "ETH": 0.000529073794,
  "INR": 87.503,
  // ... all supported currencies with exchange rates relative to USD
}
```

---

### 5.7 Get Game Seeds (Provably Fair)

**Request:**
```json
event: "gameService"
data: {
  "action": "get-game-seeds"
}
```

**Response:**
```json
{
  "userSeed": "99d41c4767520dee",                              // client seed (random per game)
  "hashedServerSeed": "bbc43e10f4f3528e87917e726af1e0465..."    // SHA256 of server seed
}
```

**Note:** Seeds are refetched after each game ends (win or lose).

---

### 5.8 Get Game History

**Request:**
```json
event: "gameService"
data: {
  "action": "get-game-history"
}
```

**Response:**
```json
[
  {
    "betAmount": 1.00,                 // number - bet amount
    "win": 1.23                        // number - win amount (0 if lost)
    // Additional fields may include: gameId, timestamp, minesCount, coeff, etc.
  }
]
```

Client computes from history array:
- `historyCount`: array length
- `totalWinnings`: sum of all `win` values
- `totalBets`: sum of all `betAmount` values

---

### 5.9 Push Events (Server → Client)

#### onBalanceChange
```json
{
  "currency": "USD",
  "balance": "999995.76"              // string - new balance
}
```

#### betsConfig (pushed on connect)
Same structure as get-game-config response.

#### betsRanges (pushed on connect)
```json
{
  "USD": [0.01, 200],                 // [minBet, maxBet] per currency
  "EUR": [0.01, 180],
  // ...
}
```

#### myData (pushed on connect)
```json
{
  "role": "player",
  "userId": "1c8db1d9-5a39-419a-afe9-c35ebdd887bb",
  "nickname": "Apricot Absent Bee",
  "gameAvatar": null                   // string|null - avatar identifier
}
```

#### onBonusChange
```json
{
  "bonusId": "...",
  "bonusAvailable": 0,
  "status": "ACTIVE",                 // "CREATED"|"ACTIVE"|"COMPLETED"|"EXPIRED"|"CANCELLED"
  "type": "...",
  "winSum": 0
}
```

#### onCrashed (Server Error)
```json
{
  // Error details from server
}
```

#### exception
```json
{
  // Exception details
}
```

---

## 6. Complete User Interaction → Socket Message Map

### 6.1 Flow: Page Load & Initialization

| Step | User Action | Socket Direction | Message | Notes |
|------|------------|-----------------|---------|-------|
| 1 | Page loads | Client → Server | HTTP POST `/api/auth` | Get JWT token |
| 2 | Auth success | Client → Server | Socket.IO connect | WebSocket established |
| 3 | Connected | Server → Client | `onBalanceChange` | Initial balance |
| 4 | Connected | Server → Client | `betsConfig` | Bet configuration |
| 5 | Connected | Server → Client | `betsRanges` | Bet ranges |
| 6 | Connected | Server → Client | `myData` | User profile |
| 7 | Auto | Client → Server | `gameService` {action: "get-game-state"} | Check for active game |
| 8 | Auto | Client → Server | `gameService` {action: "get-game-config"} | Load config |
| 9 | Auto | Client → Server | `gameService` {action: "get-rates"} | Load exchange rates |
| 10 | Auto | Client → Server | `gameService` {action: "get-game-seeds"} | Load provably fair seeds |

### 6.2 Flow: Play a Game (Win Scenario)

| Step | User Action | Socket Direction | Message | State Change |
|------|------------|-----------------|---------|-------------|
| 1 | Select bombs (e.g., 3) | None | Local only | minesCount = 3 |
| 2 | Set bet amount (e.g., $1) | None | Local only | betValue = 1 |
| 3 | Click "Play" | Client → Server | `gameService` {action: "play", payload: {gameType, amount: 1, currency: "USD", value: {minesCount: 3}}} | |
| 4 | | Server → Client | ACK: {status: "in-game", coeff: 0, openedCells: []} | Stage: NotStarted → InProgress |
| 5 | | Server → Client | `onBalanceChange` {balance: "999994.53"} | Balance deducted |
| 6 | Click cell (row 0, col 0) | Client → Server | `gameService` {action: "step", payload: {cellPosition: 1}} | |
| 7 | | Server → Client | ACK: {status: "in-game", isWin: true, coeff: 1.07, winAmount: "1.07", openedCells: [1]} | Star revealed, multiplier updated |
| 8 | Click cell (row 4, col 4) | Client → Server | `gameService` {action: "step", payload: {cellPosition: 25}} | |
| 9 | | Server → Client | ACK: {status: "in-game", isWin: true, coeff: 1.23, winAmount: "1.23", openedCells: [1, 25]} | Second star, higher multiplier |
| 10 | Click "Cash out $1.23" | Client → Server | `gameService` {action: "payout"} | |
| 11 | | Server → Client | ACK: {status: "win", isFinished: true, coeff: 1.23, winAmount: "1.23", minesCells: [16, 2, 20]} | All mines revealed |
| 12 | | Server → Client | `onBalanceChange` {balance: "999995.76"} | Winnings credited |
| 13 | Auto | Client → Server | `gameService` {action: "get-game-seeds"} | New seeds for next game |

### 6.3 Flow: Play a Game (Lose Scenario)

| Step | User Action | Socket Direction | Message | State Change |
|------|------------|-----------------|---------|-------------|
| 1 | Click "Play" | Client → Server | `gameService` {action: "play", payload: {gameType, amount: 1, currency: "USD", value: {minesCount: 5}}} | |
| 2 | | Server → Client | ACK: {status: "in-game", coeff: 0, openedCells: []} | Stage: InProgress |
| 3 | | Server → Client | `onBalanceChange` {balance: "999994.76"} | Bet deducted |
| 4 | Click cell (mine!) | Client → Server | `gameService` {action: "step", payload: {cellPosition: 13}} | |
| 5 | | Server → Client | ACK: {status: "lose", isFinished: true, coeff: 0, winAmount: "0.00", minesCells: [...]} | All mines revealed |
| 6 | | | | Stage: GameOver (explosion animation) → Finished |
| 7 | Auto | Client → Server | `gameService` {action: "get-game-seeds"} | New seeds for next game |

### 6.4 Flow: Reconnection During Active Game

| Step | Event | Socket Direction | Message | Notes |
|------|-------|-----------------|---------|-------|
| 1 | Disconnect detected | | | Socket.IO reconnection |
| 2 | Reconnect | Client → Server | Socket.IO reconnect | |
| 3 | | Server → Client | `onBalanceChange`, `betsConfig`, etc. | Re-push initial data |
| 4 | Auto | Client → Server | `gameService` {action: "get-game-state"} | |
| 5 | | Server → Client | ACK: {status: "in-game", coeff: 1.07, openedCells: [1], ...} | Restore game state |

---

## 7. Game Configuration

### 7.1 Bet Configuration
| Parameter | Value | Description |
|-----------|-------|-------------|
| minBetAmount | 0.01 | Minimum bet in player currency |
| maxBetAmount | 200.00 | Maximum bet in player currency |
| maxWinAmount | 20,000.00 | Maximum possible win amount |
| defaultBetAmount | 0.48 | Default bet on first load |
| betPresets | [0.5, 1, 2, 7] | Quick bet amount buttons |
| decimalPlaces | 2 | Currency decimal precision |

### 7.2 Bomb Count Options
| Preset | Bombs | Safe Cells | Max Steps to Win All |
|--------|-------|-----------|---------------------|
| 3 | 3 | 22 | 22 |
| 5 | 5 | 20 | 20 |
| 10 | 10 | 15 | 15 |
| 24 | 24 | 1 | 1 |
| Custom | 1-24 | 24-1 | Varies |

Default bomb count: **3**

### 7.3 Multiplier System
Multipliers increase with each safe cell revealed. They are determined server-side based on the number of bombs and cells opened. Observed multiplier tables:

**3 Bombs:**
| Hits | Multiplier |
|------|-----------|
| 1 | x1.07 |
| 2 | x1.23 |
| 3 | x1.41 |
| 4 | x1.64 |
| 5 | x1.91 |
| 6 | x2.25 |

**5 Bombs:**
| Hits | Multiplier |
|------|-----------|
| 1 | x1.18 |
| 2 | x1.50 |
| 3 | x1.91 |
| 4 | x2.48 |
| 5 | x3.25 |
| 6 | x4.34 |

**24 Bombs:**
| Hits | Multiplier |
|------|-----------|
| 1 | x23.75 |

**Note:** Multipliers are computed server-side. The `coeff` field in the step response contains the current multiplier. The `winAmount` = `betAmount * coeff`. The multiplier calculation follows a mathematical formula based on probability: each step multiplier reflects the inverse probability of not hitting a mine, minus house edge.

---

## 8. UI Components & Layout

### 8.1 Header Bar
- **Game Title**: "Mines" (top left)
- **"How to play?" button**: Opens rules modal
- **Balance Display**: Shows current balance with currency icon (e.g., "999 994.76 $")
- **Fullscreen Button**: Expands to fullscreen mode
- **Hamburger Menu** (top right): Opens settings drawer

### 8.2 Left Panel - Betting Controls
- **Bet Amount Section:**
  - `MIN` button: Sets bet to minimum (0.01)
  - Numeric input field: Editable bet amount
  - `MAX` button: Sets bet to maximum (200.00)
  - Preset buttons: `0.5$`, `1$`, `2$`, `7$` (from betConfig.betPresets)

- **Number of Bombs Section:**
  - Preset buttons: `3`, `5`, `10`, `24`
  - Custom button (pencil icon): Opens custom input (1-24)
  - Selected bomb count highlighted in blue

- **Action Button (changes based on state):**
  - **NotStarted/Finished**: Green "Play" button
  - **InProgress (no cells opened)**: Green "Play" button (disabled) → transitions to Cash Out
  - **InProgress (cells opened)**: Green "Cash out $ X.XX" button showing current win amount
  - Disabled during loading (isPlacingBet, isMakingStep, isMakingPayout)

### 8.3 Center - Game Grid (PixiJS Canvas)
- 5x5 grid of cells rendered on HTML5 Canvas via PixiJS
- **Cell States:**
  - **Unrevealed**: Dark rounded square (clickable during InProgress)
  - **Star (safe)**: Gold star icon revealed with animation
  - **Bomb (mine)**: Bomb icon with explosion animation
  - **Stars counter**: Bottom-left of grid, shows remaining safe cells count
  - **Bombs counter**: Bottom-right of grid, shows bomb count

- **Overlay States:**
  - **Game Over (lose)**: "OOPS...." text with "x0" in red, "+ $ 0.00" amount
  - **Win (payout)**: Displays "xN.NN" multiplier in green/gold, "+ $ X.XX" win amount

- **Cell Reveal Animation:**
  - Star reveal: Cell flips/transitions to show gold star
  - Mine hit: Explosion animation on the mine cell, then all mines revealed
  - After game end: All remaining safe cells shown as stars (Finished state)

### 8.4 Bottom - Multiplier Bar
- Horizontal scrollable bar showing multiplier progression
- Format: `N hits` / `xM.MM` for each step
- Current/achieved multiplier highlighted (blue/active color)
- Updates when bomb count changes

### 8.5 Hamburger Menu (Settings Drawer)
- **User Profile**: Avatar icon, truncated nickname, "Change avatar" link
- **Sound**: Toggle on/off
- **Music**: Toggle on/off
- **Provably Fair Settings**: Opens modal
- **Game Rules**: Opens rules display
- **My Bet History**: Opens bet history view
- **Footer**: "Powered by INOUT" branding

### 8.6 Provably Fair Settings Modal
- **Next client (Your) seed**: Display field with copy button
  - "Random on every game" label
  - Shows current client seed (e.g., "99d41c4767520dee")
- **Next server seed SHA256**: Display field with copy button
  - Shows hashed server seed (SHA256 hash)
- **Note**: "You can check fairness of each bet from bets history"

### 8.7 How to Play Modal
Game rules displayed:
1. Choose your risk level (more bombs = higher odds, harder to win)
2. Specify bet amount and start game
3. Open cells - find stars, avoid bombs
4. Stop and collect winnings, or keep going
5. Malfunction voids all pays and plays

---

## 9. Game State Data Model

### 9.1 Full Game State Object (from server responses)
```typescript
interface GameState {
  status: "none" | "in-game" | "lose" | "win";
  bet?: {
    amount: string;          // e.g., "1.00"
    currency: string;        // e.g., "USD"
    decimalPlaces: number;   // e.g., 2
  };
  isFinished: boolean;
  isWin: boolean;
  coeff: number;             // current multiplier (0 when no cells opened or lost)
  winAmount: string;         // current/final win amount (e.g., "1.23")
  minesCount: number;        // number of bombs on board
  openedCells: number[];     // 1-indexed positions of opened safe cells
  minesCells?: number[];     // 1-indexed positions of ALL mines (only revealed at game end)
}
```

### 9.2 Display State (Client-side Computed)
```typescript
interface DisplayState {
  stage: 0 | 1 | 2 | 3;            // GameStage enum
  hasLost: boolean;
  hasWon: boolean;
  minesCells: number[] | undefined;  // from game state
  openedCells: number[] | undefined; // from game state
  showingExplosion: boolean;         // animation state
  explosionCellId: number | null;    // 0-indexed cell that exploded
  maxCells: 25;                      // always 25
}
```

### 9.3 Checkers (Computed Booleans)
```typescript
interface Checkers {
  isInGame: boolean;     // status === "in-game"
  isNone: boolean;       // status === "none"
  hasWon: boolean;       // status === "win"
  hasLost: boolean;      // status === "lose"
  canReset: boolean;     // hasWon || hasLost
  canPlay: boolean;      // !isLoading && !isInGame && isValidBet && balance >= betValue
  canStep: boolean;      // !isLoading && isInGame
  canPayout: boolean;    // !isLoading && isInGame
}
```

---

## 10. Cell Display Logic

### 10.1 Stars Display
```
if stage === GameOver:
  Show stars only for previously opened cells (before mine hit)
if stage === Finished:
  if hasLost: Show ALL non-mine cells as stars (reveal full board)
  if hasWon: Show ALL non-mine cells as stars
if stage === InProgress:
  Show stars only for opened cells
```

### 10.2 Mines Display
```
if stage === GameOver:
  Show ONLY the mine that was just hit (explosionCellId)
if stage === Finished:
  Show ALL mine positions
if stage === InProgress or NotStarted:
  Show no mines (hidden)
```

### 10.3 Cell Index Conversion
- Server uses **1-indexed** positions (1-25)
- Client grid uses **0-indexed** positions (0-24)
- Conversion: `clientIndex = serverPosition - 1`
- Conversion: `serverPosition = clientIndex + 1`

---

## 11. User Data & Profile

### 11.1 User Object
```typescript
interface UserData {
  role: "player";
  userId: string;          // UUID
  nickname: string;        // Auto-generated (e.g., "Apricot Absent Bee")
  gameAvatar: string | null; // Avatar identifier or null
}
```

### 11.2 Avatar Change
```
Action: changeAvatar(avatarId)
Effect: Updates user.gameAvatar via user.setData({...user.data, gameAvatar: avatarId.toString()})
```

---

## 12. Bonus System

### 12.1 Bonus States
```typescript
enum BonusStatus {
  CREATED = "CREATED",
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED"
}
```

### 12.2 Bonus Object
```typescript
interface BonusData {
  bonusId: string | null;
  bonusAvailable: number;
  status: BonusStatus;
  type: string;
  winSum: number;
  isBonusAvailable: boolean;  // computed: bonusAvailable > 0 && status === ACTIVE
  isActive: boolean;          // computed: status === ACTIVE
}
```

### 12.3 Bonus in Play
When a bonus is available (`isBonusAvailable === true`), the `bonusId` is included in the play request payload.

---

## 13. Provably Fair System

### 13.1 Seeds
- **Client Seed (userSeed)**: Random hex string generated per game, visible to player before game
- **Server Seed**: Hidden during game, only SHA256 hash shown before game
- **Combined**: Round result determined from combination of server seed and client seed (+ first 3 bets of round)

### 13.2 Verification Flow
1. Before game: Player sees `userSeed` and `hashedServerSeed` (SHA256)
2. Game plays out (mine positions determined server-side)
3. After game: Full server seed revealed (via bet history), player can verify SHA256 hash matches
4. Seeds refresh after every game completion (`gameSeed.fetch()` called after play/payout/lose)

---

## 14. Error Handling

### 14.1 Game Server Errors
All game service responses can return errors:
```json
{
  "error": "Error message string"
}
```

Client throws `GameServerError` with the message. Error conditions include:
- `"Cannot play: conditions not met"` - Client-side validation (insufficient balance, game in progress)
- `"Cannot step: game not in progress"` - Trying to click cell when no active game
- `"Cannot payout: game not in progress"` - Trying to cash out when no active game
- Server-side errors: insufficient balance, invalid cell position, etc.

### 14.2 Connection Errors
- `onCrashed` event: Server crash notification
- `exception` event: Server exception
- `connect_error`: Socket.IO connection error
- `disconnect`: Socket disconnected (auto-reconnect enabled)

### 14.3 Reconnection Behavior
- Socket.IO handles reconnection automatically
- On reconnect: status transitions from "ready" → "initialized" → "ready"
- Client refetches game state via `get-game-state` to restore any active game
- Active game can be resumed (step/payout) after reconnection

---

## 15. Sound & Music

- **Sound**: Toggle for game sound effects (cell reveal, explosion, win/lose)
- **Music**: Toggle for background music
- Sound system uses Howler.js audio library with audio pool (pool size: 20)
- Settings persist in local storage

---

## 16. Supported Currencies

TON, ADA, INR, BTC, USD, EUR, ETC, UAH, RUB, LTC, DEMO, ETH, BRL, BCH, BNB, DASH, DOGE, TRX, USDT, USDC, XMR, ZEC, XRP, KZT, VND, UZS, IDR, AZN, KGS, PKR, BDT, CLP, PEN, COP, MXN, ARS, BOB, CRC, SVC, GTQ, NIO, PAB, PYG, UYU, CAD, CZK, ZAR, BGN, DKK, RON, AUD, NZD, CHF, NOK, HUF, TRY, PLN, GBP, NGN, JPY, SEK, ZMW, TZS, GHS, XOF, SGD, KRW, KES, AED, and many more (100+ currencies supported).

---

## 17. Backend Implementation Notes

### 17.1 Key Architecture Decisions for Backend
1. **Single-player game**: No multiplayer/shared state. Each player has independent game sessions.
2. **Stateful sessions**: Active game state must persist across reconnections.
3. **Server-side outcome**: Mine positions are determined at game start (or lazily on each step), using provably fair algorithm.
4. **Balance management**: Bet deducted on `play`, winnings credited on `payout`. No balance change on `step`.
5. **All multipliers server-computed**: Client displays `coeff` from server response; does NOT compute multipliers locally.
6. **1-indexed cell positions**: All cell positions in the protocol are 1-indexed (1-25).
7. **minesCells only revealed at game end**: During `in-game`, the server never sends mine positions to prevent cheating.

### 17.2 Required Server-Side Validations
- **play**: Verify sufficient balance, no active game in progress, valid minesCount (1-24), valid bet amount within configured ranges
- **step**: Verify game is in-game status, cell position is valid (1-25), cell hasn't been opened already
- **payout**: Verify game is in-game status, at least one cell has been opened (coeff > 0)
- **Concurrent requests**: Prevent race conditions on step/payout (only one active action at a time per game session)

### 17.3 Win Amount Calculation
```
winAmount = betAmount * coeff
```
Where `coeff` is the multiplier corresponding to the number of safely opened cells given the bomb count. The multiplier reflects adjusted probabilities minus house edge.

### 17.4 Game Session Storage
Active game sessions need to store:
- `roundId` / game identifier
- `userId`, `agentId`
- `bet` (amount, currency, decimalPlaces)
- `minesCount`
- `minePositions[]` (predetermined, hidden from client)
- `openedCells[]`
- `status` (none/in-game/lose/win)
- `coeff` (current multiplier)
- `winAmount` (current potential payout)
- `serverSeed`, `clientSeed` (for provably fair)
- `createdAt`, `updatedAt`

---

## 18. Wire Protocol (Raw WebSocket Frames)

The game uses Socket.IO v4 over Engine.IO v4 with WebSocket transport. Raw frame format:

### 18.1 Engine.IO Frame Types
| Frame | Type | Description |
|-------|------|-------------|
| `0` | open | Connection opened, server sends handshake |
| `2` | ping | Server ping |
| `3` | pong | Client pong response |
| `4` | message | Socket.IO message |

### 18.2 Socket.IO Packet Types (prefixed after `4`)
| Packet | Type | Example |
|--------|------|---------|
| `40` | CONNECT | Socket.IO namespace connect |
| `42` | EVENT | Event with data |
| `42N` | EVENT with ACK | Event with ACK ID N (e.g., `420`, `421`) |
| `43N` | ACK | Acknowledgement for ID N |

### 18.3 Example Raw Frame Sequence

**Client sends play request:**
```
420["gameService",{"action":"play","payload":{"gameType":"platform-mines","amount":1,"currency":"USD","value":{"minesCount":3}}}]
```
(Frame: Socket.IO EVENT with ACK ID 0)

**Server responds:**
```
430[{"status":"in-game","bet":{"amount":"1.00","currency":"USD","decimalPlaces":2},"isFinished":false,"isWin":false,"coeff":0,"winAmount":"0","minesCount":3,"openedCells":[]}]
```
(Frame: Socket.IO ACK for ID 0)

**Server pushes balance update:**
```
42["onBalanceChange",{"currency":"USD","balance":"999994.53"}]
```

**Client sends step:**
```
421["gameService",{"action":"step","payload":{"cellPosition":1}}]
```

**Server responds:**
```
431[{"status":"in-game","bet":{"amount":"1.00","currency":"USD","decimalPlaces":2},"isFinished":false,"isWin":true,"coeff":1.07,"winAmount":"1.07","minesCount":3,"openedCells":[1]}]
```

**Client sends payout:**
```
422["gameService",{"action":"payout"}]
```

**Server responds:**
```
432[{"status":"win","bet":{"amount":"1.00","currency":"USD","decimalPlaces":2},"isFinished":true,"isWin":true,"coeff":1.23,"winAmount":"1.23","minesCount":3,"openedCells":[1,25],"minesCells":[16,2,20]}]
```

**Server pushes balance:**
```
42["onBalanceChange",{"currency":"USD","balance":"999995.76"}]
```

---

## 19. Verified Game Flow Data (Actual Server Responses)

### 19.1 Win Flow (3 bombs, $1 bet)
```
PRE:  balance=999995.53, status="lose" (from previous game)
PLAY: balance=999994.53, status="in-game", coeff=0, openedCells=[]
STEP(cell 1):  status="in-game", isWin=true, coeff=1.07, winAmount="1.07", openedCells=[1]
STEP(cell 25): status="in-game", isWin=true, coeff=1.23, winAmount="1.23", openedCells=[1,25]
PAYOUT: status="win", isFinished=true, coeff=1.23, winAmount="1.23", openedCells=[1,25], minesCells=[16,2,20]
POST: balance=999995.76 (gained $0.23 net)
```

### 19.2 Lose Flow (24 bombs, $1 bet)
```
PRE:  balance=999995.76
PLAY: balance=999994.76, status="in-game", coeff=0, openedCells=[]
STEP(cell 13): status="lose", isFinished=true, coeff=0, winAmount="0.00", openedCells=[13],
               minesCells=[15,23,25,22,6,17,4,5,1,13,3,12,16,19,8,11,2,20,18,14,9,24,10,21]
POST: balance=999994.76 (lost $1.00)
```

---

## 20. Game Mode Identifier

- **gameMode**: `"platform-mines"` (used in auth, Socket.IO query, and play payload as `gameType`)
- **Game code**: `"platform-mines"`
- This is the identifier used throughout the system to identify this game variant.
