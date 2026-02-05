# Wheel Game - Product Requirements Document (PRD)

## Table of Contents

1. [Game Overview](#1-game-overview)
2. [Game Mechanics & Rules](#2-game-mechanics--rules)
3. [UI Components & Layout](#3-ui-components--layout)
4. [User Interactions](#4-user-interactions)
5. [Game Lifecycle & State Machine](#5-game-lifecycle--state-machine)
6. [Authentication Flow](#6-authentication-flow)
7. [Socket Connection & Protocol](#7-socket-connection--protocol)
8. [Socket Events - Complete Reference](#8-socket-events---complete-reference)
9. [Socket Message Flow - User Interaction Mapping](#9-socket-message-flow---user-interaction-mapping)
10. [Wheel Structure & Color Distribution](#10-wheel-structure--color-distribution)
11. [Data Schemas](#11-data-schemas)
12. [Multiplayer & Broadcasting](#12-multiplayer--broadcasting)
13. [Edge Cases & Error Handling](#13-edge-cases--error-handling)

---

## 1. Game Overview

**Game Name:** Wheel
**Game Mode:** `wheel`
**Type:** Multiplayer color-betting wheel game
**Platform:** Web (embedded via iframe/direct URL)
**Real-time Protocol:** Socket.IO over WebSocket

The Wheel game is a multiplayer betting game where players bet on which color segment a spinning wheel will land on. The wheel has 4 color categories, each with a different payout multiplier:

| Color        | Multiplier | UI Color Code | Approximate Probability |
| ------------ | ---------- | ------------- | ----------------------- |
| BLACK (Gray) | x2         | Gray/Dark     | ~48% (25 segments)      |
| RED          | x3         | Red           | ~27% (14 segments)      |
| BLUE         | x5         | Blue          | ~19% (10 segments)      |
| GREEN        | x50        | Green         | ~4% (2 segments)        |

**Key Characteristics:**

- Rounds are server-driven with fixed timing (~15s total per round)
- All players participate in the same round simultaneously
- Multiple bets on the same color are allowed (additive)
- Bets can be placed during WAIT_GAME phase and queued during FINISH_GAME phase
- The game supports multiple currencies with real-time exchange rates
- BANK display shows total bet pool converted to user's currency

---

## 2. Game Mechanics & Rules

### How to Play (Official)

1. Enter the bet amount
2. Choose the color to bet on: gray (BLACK), red, blue, green
3. Click the "Play" button
4. Malfunction voids all pays and plays

### Betting Rules

- **Minimum bet:** Configurable per currency (e.g., $0.01 USD)
- **Maximum bet:** Configurable per currency (e.g., $200.00 USD)
- **Maximum win:** Configurable per currency (e.g., $20,000.00 USD)
- **Bet presets:** Configurable quick-select amounts (e.g., 0.5, 1, 2, 7 for USD)
- **Default bet amount:** Configurable (e.g., 0.08 USD)
- Player can place multiple bets on the SAME color in the same round (each click adds another bet)
- Player can ONLY bet on ONE color per round (selecting a new color changes the selection)
- Bets placed during FINISH_GAME phase are automatically queued for the NEXT round (`isNextRoundBet: true`)

### Payout Calculation

- **Win:** `betAmount * multiplier` (e.g., $1 on RED wins $3 total, net profit $2)
- **Loss:** Player loses their entire bet amount
- No partial payouts

### Round Timing

- **WAIT_GAME:** ~10 seconds (betting window)
- **IN_GAME:** ~2.5 seconds (wheel spinning)
- **FINISH_GAME:** ~5 seconds (result display, win animations)
- **Total round cycle:** ~17.5 seconds

---

## 3. UI Components & Layout

### Header Bar (Top)

- **Game Logo:** "WHEEL" with colored segments icon (top-left)
- **How to play?** button (top-right)
- **Balance display:** Current balance with currency symbol (top-right)
- **Fullscreen toggle** button (top-right)
- **Hamburger menu** (top-right) containing:
  - Player avatar & nickname
  - Change avatar
  - Sound toggle
  - Music toggle
  - Provably fair settings
  - Game rules
  - My bet history
  - "Powered by" branding

### Left Panel - Betting Controls

- **Bet Amount Section:**
  - MIN button (sets to minimum bet)
  - Amount input field (editable text)
  - MAX button (sets to maximum bet)
  - Preset amount buttons (e.g., 0.5, 1, 2, 7) with currency symbol
- **Bet on Color Section:**
  - x2 button (gray/BLACK)
  - x3 button (red/RED) - red border
  - x5 button (blue/BLUE) - blue border
  - x50 button (green/GREEN) - green border
  - Selected color is highlighted with filled background
- **Play Button:** Large green button to place/confirm bet

### Center - Wheel Area

- **Previous Results Strip:** Horizontal strip of colored squares showing recent round results (top)
- **Wheel Graphic:** Semi-circular wheel with colored segments
  - Yellow arrow/pointer at top center
  - Wheel spins during IN_GAME phase
- **Center Display (inside wheel):**
  - "BANK" label
  - Total bet pool amount in player's currency
  - Status text: "Starting in X.XXs" during WAIT_GAME countdown
- **Round ID:** Displayed below the wheel (right-aligned)

### Bottom Panel - Bet Lists

Four columns showing current round's bets grouped by color:

- **Rate x2** (gray header) - BLACK bets
- **Rate x3** (red header) - RED bets
- **Rate x5** (blue header) - BLUE bets
- **Rate x50** (green header) - GREEN bets

Each column shows:

- Player avatar icon (with color indicator)
- Player nickname (truncated if long)
- Bet amount with currency symbol

---

## 4. User Interactions

| #   | Interaction          | UI Element                   | Effect                                           |
| --- | -------------------- | ---------------------------- | ------------------------------------------------ |
| 1   | Click MIN button     | `MIN` button                 | Sets bet amount to minimum (e.g., 0.01)          |
| 2   | Click MAX button     | `MAX` button                 | Sets bet amount to maximum (e.g., 200.00)        |
| 3   | Click preset amount  | `0.5`, `1`, `2`, `7` buttons | Sets bet amount to preset value                  |
| 4   | Type bet amount      | Amount input field           | Manually enter custom bet amount                 |
| 5   | Select color x2      | `x2` button                  | Select BLACK/gray color for bet                  |
| 6   | Select color x3      | `x3` button                  | Select RED color for bet                         |
| 7   | Select color x5      | `x5` button                  | Select BLUE color for bet                        |
| 8   | Select color x50     | `x50` button                 | Select GREEN color for bet                       |
| 9   | Click Play           | `Play` button                | Place bet (or add to existing bet on same color) |
| 10  | Click Play again     | `Play` button                | Place additional bet on same color (stacks)      |
| 11  | Click How to play?   | Top bar button               | Opens rules modal                                |
| 12  | Click hamburger menu | Top-right icon               | Opens sidebar menu                               |
| 13  | Click My bet history | Menu item                    | Shows personal bet history                       |
| 14  | Click Provably fair  | Menu item                    | Opens provably fair verification                 |
| 15  | Click Game rules     | Menu item                    | Opens detailed game rules                        |
| 16  | Toggle Sound         | Menu toggle                  | Enable/disable sound effects                     |
| 17  | Toggle Music         | Menu toggle                  | Enable/disable background music                  |
| 18  | Click Change avatar  | Menu item                    | Opens avatar selection                           |
| 19  | Click Fullscreen     | Top bar icon                 | Toggles fullscreen mode                          |

---

## 5. Game Lifecycle & State Machine

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌─────────────┐    ┌───────────┐    ┌──────────────┐   │
│  │  WAIT_GAME  │───>│  IN_GAME  │───>│ FINISH_GAME  │───┘
│  │  (~10 sec)  │    │ (~2.5 sec)│    │  (~5 sec)    │
│  └─────────────┘    └───────────┘    └──────────────┘
│        │                  │                  │
│   Bets accepted      Wheel spins       Results shown
│   Countdown shown    No new bets*      Win payouts
│   Bet list updates   cellIndex sent    Next round bets
│   BANK accumulates   cellColor sent    queued here
│                                        (isNextRoundBet)
```

### State Transitions (Server-Driven)

**WAIT_GAME → IN_GAME:**

```json
{
	"status": "IN_GAME",
	"nextChangeInMs": 2610,
	"cellIndex": 2,
	"cellColor": "RED",
	"inCellOffset": 0.413
}
```

- `cellIndex`: The wheel position where it will stop (0-52)
- `cellColor`: The winning color
- `inCellOffset`: Precise position within the cell (0-1 float, for animation accuracy)
- `nextChangeInMs`: Time until transition to FINISH_GAME

**IN_GAME → FINISH_GAME:**

```json
{
	"status": "FINISH_GAME",
	"nextChangeInMs": 4997,
	"cellIndex": 2,
	"cellColor": "RED",
	"inCellOffset": 0.413
}
```

- Same cell data repeated for confirmation
- `nextChangeInMs`: Time until transition to WAIT_GAME

**FINISH_GAME → WAIT_GAME:**

```json
{
  "status": "WAIT_GAME",
  "nextChangeInMs": 9938,
  "gameId": 3597026,
  "prevRoundResults": [
    {"cellIndex": 36, "cellColor": "RED"},
    {"cellIndex": 14, "cellColor": "BLUE"},
    {"cellIndex": 26, "cellColor": "BLUE"},
    ...
  ]
}
```

- `gameId`: New round identifier (incrementing integer)
- `nextChangeInMs`: Time until IN_GAME starts
- `prevRoundResults`: Array of recent round results (newest first), used for the results strip at top

---

## 6. Authentication Flow

### Step 1: HTTP Authentication

**Request:**

```
POST https://api.inout.games/api/auth
Content-Type: application/json

{
  "operator": "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52",
  "auth_token": "ea05e675-0d4d-4ae1-b601-5353a906f37f",
  "currency": "USD",
  "game_mode": "wheel"
}
```

**Response (201 Created):**

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

**JWT Token Payload (decoded):**

```json
{
	"userId": "1c8db1d9-5a39-419a-afe9-c35ebdd887bb",
	"nickname": "Apricot Absent Bee",
	"balance": "1000000",
	"currency": "USD",
	"operator": "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52",
	"operatorId": "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52",
	"gameMode": "wheel",
	"meta": null,
	"gameAvatar": null,
	"sessionToken": "yl24el",
	"iat": 1770319563,
	"exp": 1770405963
}
```

### Step 2: WebSocket Connection

After HTTP auth, client establishes WebSocket to `wss://api.inout.games:443/io/` using Socket.IO protocol.
The JWT token is passed during Socket.IO handshake (as auth parameter).

### URL Parameters (Game Launch)

| Parameter             | Description                       | Example        |
| --------------------- | --------------------------------- | -------------- |
| `gameMode`            | Game type identifier              | `wheel`        |
| `operatorId`          | Operator/platform UUID            | `ee2013ed-...` |
| `authToken`           | One-time auth token               | `ea05e675-...` |
| `currency`            | Player's currency code            | `USD`          |
| `lang`                | Language code                     | `en`           |
| `theme`               | UI theme (optional)               | ``             |
| `gameCustomizationId` | Custom config ID (optional)       | ``             |
| `lobbyUrl`            | Redirect URL for lobby (optional) | ``             |

---

## 7. Socket Connection & Protocol

### Transport

- **Protocol:** Socket.IO v4 over Engine.IO
- **WebSocket URL:** `wss://api.inout.games:443/io/`
- **Upgrades:** None (direct WebSocket, no polling fallback)
- **Ping Interval:** 25,000ms
- **Ping Timeout:** 20,000ms
- **Max Payload:** 1,000,000 bytes

### Socket.IO Message Format

Socket.IO uses a numeric prefix system:

- `0{...}` - Engine.IO OPEN (server → client)
- `2` - Engine.IO PING (server → client)
- `3` - Engine.IO PONG (client → server)
- `40` - Socket.IO CONNECT to namespace
- `42["eventName", data]` - Socket.IO EVENT
- `42X["eventName", data]` - Socket.IO EVENT with ack ID `X`
- `43X[data]` - Socket.IO ACK response for ack ID `X`

### Namespace

Default namespace `/` is used (no custom namespace).

---

## 8. Socket Events - Complete Reference

### 8.1 Server → Client Events (IN)

#### `onBalanceChange`

Sent whenever player's balance changes (bet placed, win payout).

```json
[
	"onBalanceChange",
	{
		"currency": "USD",
		"balance": "999999.92"
	}
]
```

#### `betsRanges`

Sent once during initialization. Defines min/max bet per currency.

```json
[
	"betsRanges",
	{
		"USD": ["0.01", "200.00"]
	}
]
```

#### `betsConfig`

Sent once during initialization. Full betting configuration.

```json
[
	"betsConfig",
	{
		"USD": {
			"betPresets": ["0.5", "1", "2", "7"],
			"minBetAmount": "0.01",
			"maxBetAmount": "200.00",
			"maxWinAmount": "20000.00",
			"defaultBetAmount": "0.080000000000000000",
			"decimalPlaces": null
		}
	}
]
```

#### `myData`

Sent once during initialization. Player profile data.

```json
[
	"myData",
	{
		"userId": "1c8db1d9-5a39-419a-afe9-c35ebdd887bb",
		"nickname": "Apricot Absent Bee",
		"gameAvatar": null
	}
]
```

#### `currencies`

Sent once during initialization. Exchange rates for all supported currencies relative to USD.

```json
["currencies", {
  "ADA": 3.807,
  "AED": 3.6725,
  "BTC": 0.0000148,
  "EUR": 0.8755,
  "INR": 87.503,
  "USD": 1,
  ...
}]
```

#### `gameService-game-status-changed`

Core game lifecycle event. Sent at each state transition.

**WAIT_GAME (new round starts):**

```json
[
	"gameService-game-status-changed",
	{
		"status": "WAIT_GAME",
		"nextChangeInMs": 9938,
		"gameId": 3597026,
		"prevRoundResults": [
			{ "cellIndex": 36, "cellColor": "RED" },
			{ "cellIndex": 14, "cellColor": "BLUE" },
			{ "cellIndex": 26, "cellColor": "BLUE" },
			{ "cellIndex": 2, "cellColor": "RED" }
		]
	}
]
```

**IN_GAME (wheel starts spinning):**

```json
[
	"gameService-game-status-changed",
	{
		"status": "IN_GAME",
		"nextChangeInMs": 2610,
		"cellIndex": 2,
		"cellColor": "RED",
		"inCellOffset": 0.413
	}
]
```

**FINISH_GAME (result shown):**

```json
[
	"gameService-game-status-changed",
	{
		"status": "FINISH_GAME",
		"nextChangeInMs": 4997,
		"cellIndex": 2,
		"cellColor": "RED",
		"inCellOffset": 0.413
	}
]
```

#### `gameService-bet-list-updated`

Broadcast frequently during WAIT_GAME. Contains ALL current bets grouped by color.

```json
["gameService-bet-list-updated", {
  "sumInUSD": 253.78,
  "bets": {
    "BLACK": [
      {
        "id": "operatorId::userId",
        "playerGameId": "uuid",
        "placedAt": "2026-02-05T19:29:14.455Z",
        "userId": "user-uuid",
        "operatorId": "operator-uuid",
        "nickname": "PlayerName",
        "gameAvatar": null,
        "betAmount": "20",
        "color": "BLACK",
        "currency": "INR"
      }
    ],
    "RED": [...],
    "BLUE": [...],
    "GREEN": [...]
  }
}]
```

#### `gameService-withdraw-result`

Sent ONLY to winning players after FINISH_GAME.

```json
[
	"gameService-withdraw-result",
	{
		"currency": "USD",
		"winAmount": "3",
		"winCoeff": 3
	}
]
```

**Note:** This event is NOT sent on loss. On loss, only the bet-list-updated for next round comes.

#### `gameService-exception`

Sent when a game action fails (e.g., invalid bet, insufficient balance).

```json
[
	"gameService-exception",
	{
		"message": "error description"
	}
]
```

#### `gameService-my-bets-history`

Response to get-my-bets-history request. Contains player's past bets.

#### `gameService-game-seeds` / `gameService-onGameSeeds`

Provably fair seed information for game verification.

### 8.2 Client → Server Events (OUT)

All client events use the `gameService` event name with an `action` field:

#### `get-game-config`

Sent once after connection. Requests game configuration.

```json
[
	"gameService",
	{
		"action": "get-game-config"
	}
]
```

#### `get-game-state`

Sent once after connection. Requests current game state.

```json
[
	"gameService",
	{
		"action": "get-game-state"
	}
]
```

**Response (ACK):**

```json
{
  "gameId": 3597018,
  "status": "WAIT_GAME",
  "allBets": {
    "sumInUSD": 86.09,
    "bets": {
      "BLACK": [...],
      "RED": [...],
      "BLUE": [...],
      "GREEN": [...]
    }
  }
}
```

#### `make-bet`

Place a bet. Sent each time player clicks "Play".

```json
[
	"gameService",
	{
		"action": "make-bet",
		"payload": {
			"betAmount": "0.08",
			"color": "BLACK",
			"currency": "USD"
		}
	}
]
```

**ACK Response:**

```json
{
	"id": "operatorId::userId",
	"playerGameId": "uuid",
	"placedAt": "2026-02-05T19:29:14.064Z",
	"userId": "user-uuid",
	"operatorId": "operator-uuid",
	"nickname": "Apricot Absent Bee",
	"gameAvatar": null,
	"betAmount": "0.08",
	"color": "BLACK",
	"currency": "USD",
	"isNextRoundBet": false
}
```

### 8.3 Additional Socket Events (from source code analysis)

These events exist in the client code but were not triggered during test sessions:

| Event                       | Direction | Description                            |
| --------------------------- | --------- | -------------------------------------- |
| `initialized`               | IN        | Connection initialization confirmation |
| `chatService-messages`      | IN        | Chat message history                   |
| `chatService-message`       | IN        | Single new chat message                |
| `sendMessageError`          | IN        | Chat send error                        |
| `gameService-new-bet`       | IN        | Broadcast: individual new bet placed   |
| `gameService-bet-increased` | IN        | Broadcast: individual bet increased    |
| `chatService-joinRoom`      | OUT       | Join chat room                         |
| `chatService-sendMessage`   | OUT       | Send chat message                      |
| `changeGameAvatar`          | OUT       | Change player avatar                   |

---

## 9. Socket Message Flow - User Interaction Mapping

### 9.1 Game Load & Initialization

**Trigger:** User opens game URL

```
STEP  DIR    MESSAGE                                     DESCRIPTION
─────────────────────────────────────────────────────────────────────
1     HTTP   POST /api/auth                              Authenticate with operator + auth_token
2     HTTP   Response: JWT token + config flags          Receive JWT + game settings
3     WS     Connect to wss://api.inout.games:443/io/    WebSocket connection established
4     IN     0{"sid":"...","pingInterval":25000,...}      Engine.IO handshake
5     OUT    40                                          Socket.IO namespace connect
6     IN     40{"sid":"..."}                             Namespace connected confirmation
7     IN     42["onBalanceChange",{balance}]             Player's current balance
8     IN     42["betsRanges",{ranges}]                   Min/max bet per currency
9     IN     42["betsConfig",{config}]                   Full bet configuration
10    IN     42["myData",{player}]                       Player profile data
11    IN     42["currencies",{rates}]                    All exchange rates
12    OUT    42X["gameService",{action:"get-game-config"}]  Request game config
13    OUT    42Y["gameService",{action:"get-game-state"}]   Request current state
14    IN     43Y[{gameId,status,allBets}]                Current game state response
15    IN     42["gameService-game-status-changed",{...}] Current game phase
```

### 9.2 Placing a Bet (During WAIT_GAME)

**Trigger:** User selects color + clicks Play

```
STEP  DIR    MESSAGE                                     DESCRIPTION
─────────────────────────────────────────────────────────────────────
1     -      (User selects bet amount - client only)     No socket message
2     -      (User selects color - client only)          No socket message
3     OUT    42X["gameService",{                         Bet placement request
                action:"make-bet",
                payload:{betAmount,color,currency}
              }]
4     IN     42["onBalanceChange",{balance}]             Balance DEDUCTED immediately
5     IN     43X[{id,playerGameId,betAmount,             Bet confirmation (ACK)
                color,currency,isNextRoundBet:false}]
6     IN     42["gameService-bet-list-updated",{...}]    Updated bet list (includes player's bet)
```

### 9.3 Placing Additional Bet (Same Color, Same Round)

**Trigger:** User clicks Play again (same color already selected)

```
STEP  DIR    MESSAGE                                     DESCRIPTION
─────────────────────────────────────────────────────────────────────
1     OUT    42X["gameService",{                         ANOTHER make-bet (same action!)
                action:"make-bet",
                payload:{betAmount,color,currency}        Same color, same amount
              }]
2     IN     42["onBalanceChange",{balance}]             Balance DEDUCTED again
3     IN     43X[{...,isNextRoundBet:false}]             New bet confirmation
4     IN     42["gameService-bet-list-updated",{...}]    Player now has 2 separate bet entries
```

**Key insight:** There is NO separate "increase-bet" action. Each Play click sends a new `make-bet`. Bets stack as separate entries.

### 9.4 Placing Bet During FINISH_GAME Phase

**Trigger:** User clicks Play while previous round result is displayed

```
STEP  DIR    MESSAGE                                     DESCRIPTION
─────────────────────────────────────────────────────────────────────
1     OUT    42X["gameService",{action:"make-bet",...}]  Bet placement request
2     IN     42["onBalanceChange",{balance}]             Balance DEDUCTED immediately
3     IN     43X[{...,isNextRoundBet:true}]              Bet queued for NEXT round
```

**Key insight:** `isNextRoundBet: true` indicates the bet is queued. Balance is still deducted immediately.

### 9.5 Round Execution (Wheel Spin)

**Trigger:** Server-initiated when WAIT_GAME timer expires

```
STEP  DIR    MESSAGE                                     DESCRIPTION
─────────────────────────────────────────────────────────────────────
1     IN     42["gameService-game-status-changed",{      Wheel starts spinning
                status:"IN_GAME",
                nextChangeInMs:2610,                     Time until FINISH_GAME
                cellIndex:2,                             Landing position (0-52)
                cellColor:"RED",                         Winning color
                inCellOffset:0.413                       Position within cell (animation)
              }]
2     -      (Client animates wheel spin for ~2.5s)      Visual animation
3     IN     42["gameService-game-status-changed",{      Round finished
                status:"FINISH_GAME",
                nextChangeInMs:4997,                     Time until next WAIT_GAME
                cellIndex:2,                             Same as IN_GAME
                cellColor:"RED",                         Same as IN_GAME
                inCellOffset:0.413                       Same as IN_GAME
              }]
```

### 9.6 Win Payout

**Trigger:** Server sends after FINISH_GAME if player's bet matches winning color

```
STEP  DIR    MESSAGE                                     DESCRIPTION
─────────────────────────────────────────────────────────────────────
1     IN     42["gameService-withdraw-result",{          Win notification
                currency:"USD",
                winAmount:"3",                           Total payout (bet * multiplier)
                winCoeff:3                               The multiplier applied
              }]
2     IN     42["onBalanceChange",{                      Balance CREDITED
                balance:"1000001.92"                     Includes the full payout
              }]
```

### 9.7 Loss (No Payout)

**Trigger:** Player's bet color does NOT match winning color

```
STEP  DIR    MESSAGE                                     DESCRIPTION
─────────────────────────────────────────────────────────────────────
1     IN     42["onBalanceChange",{                      Balance remains unchanged
                balance:"999999.92"                      (already deducted at bet time)
              }]
```

**Key insight:** On LOSS, there is NO `gameService-withdraw-result`. Only `onBalanceChange` is sent confirming the already-deducted balance. The absence of `withdraw-result` indicates a loss.

### 9.8 New Round Start

**Trigger:** Server-initiated after FINISH_GAME timer expires

```
STEP  DIR    MESSAGE                                     DESCRIPTION
─────────────────────────────────────────────────────────────────────
1     IN     42["gameService-game-status-changed",{      New round begins
                status:"WAIT_GAME",
                nextChangeInMs:9938,                     Countdown to spin (ms)
                gameId:3597026,                          New round ID (incrementing)
                prevRoundResults:[                       History for results strip
                  {cellIndex:36,cellColor:"RED"},
                  {cellIndex:14,cellColor:"BLUE"},
                  ...
                ]
              }]
2     IN     42["gameService-bet-list-updated",{         First bets of new round
                sumInUSD:0.78,                           (from queued next-round bets)
                bets:{BLACK:[],RED:[...],BLUE:[],GREEN:[]}
              }]
3     IN     42["gameService-bet-list-updated",{...}]    Continuous updates as players bet
...   ...    (repeats every ~1-2 seconds during WAIT_GAME)
```

### 9.9 Heartbeat (Ping/Pong)

**Trigger:** Automatic every 25 seconds

```
STEP  DIR    MESSAGE    DESCRIPTION
─────────────────────────────────────────────
1     IN     2          Engine.IO PING from server
2     OUT    3          Engine.IO PONG response
```

---

## 10. Wheel Structure & Color Distribution

The wheel has **53 segments** (indices 0-52) with the following color distribution:

```
Index  Color     Index  Color     Index  Color     Index  Color
─────  ─────     ─────  ─────     ─────  ─────     ─────  ─────
0      GREEN     14     BLUE      28     RED       42     RED*
1      BLUE      15     BLACK     29     BLACK     43     BLACK
2      RED       16     RED*      30     RED       44     BLUE
3      BLACK     17     BLACK     31     BLACK     45     BLACK*
4      BLUE      18     RED*      32     RED*      46     RED
5      BLACK     19     BLACK     33     BLACK     47     BLACK
6      RED       20     BLUE      34     RED       48     RED
7      BLACK     21     BLACK     35     BLACK     49     BLACK
8      BLUE      22     RED       36     RED       50     BLUE
9      BLACK     23     BLACK     37     BLACK     51     BLACK
10     RED       24     RED       38     BLUE      52     RED
11     BLACK*    25     BLACK     39     BLACK
12     RED       26     BLUE      40     RED
13     BLACK     27     BLACK     41     BLACK
```

_Items marked with `_` were not observed in test data but are inferred from the pattern.

### Color Count Summary (approximate from 53 segments):

| Color | Count | Percentage | Multiplier | Expected Return |
| ----- | ----- | ---------- | ---------- | --------------- |
| BLACK | ~25   | ~47.2%     | x2         | 94.4%           |
| RED   | ~14   | ~26.4%     | x3         | 79.2%           |
| BLUE  | ~10   | ~18.9%     | x5         | 94.5%           |
| GREEN | ~2    | ~3.8%      | x50        | 190%\*          |

\*GREEN has a very high multiplier but very low probability. The house edge varies by color.

---

## 11. Data Schemas

### Bet Object Schema

```typescript
interface Bet {
	id: string; // Format: "operatorId::userId"
	playerGameId: string; // UUID - unique per bet placement
	placedAt: string; // ISO 8601 timestamp
	userId: string; // Player's unique ID
	operatorId: string; // Operator's UUID
	nickname: string; // Display name
	gameAvatar: number | null; // Avatar index or null
	betAmount: string; // Decimal string (e.g., "0.08")
	color: "BLACK" | "RED" | "BLUE" | "GREEN";
	currency: string; // ISO currency code
	isNextRoundBet?: boolean; // Only in ACK response
}
```

### Game Status Schema

```typescript
interface GameStatusChanged {
	status: "WAIT_GAME" | "IN_GAME" | "FINISH_GAME";
	nextChangeInMs: number; // Milliseconds until next state change

	// Present in WAIT_GAME:
	gameId?: number; // Incrementing round ID
	prevRoundResults?: Array<{
		cellIndex: number; // Wheel position (0-52)
		cellColor: "BLACK" | "RED" | "BLUE" | "GREEN";
	}>;

	// Present in IN_GAME and FINISH_GAME:
	cellIndex?: number; // Winning position
	cellColor?: string; // Winning color
	inCellOffset?: number; // Position within cell (0-1 float)
}
```

### Bet List Updated Schema

```typescript
interface BetListUpdated {
	sumInUSD: number; // Total bet pool in USD
	bets: {
		BLACK: Bet[];
		RED: Bet[];
		BLUE: Bet[];
		GREEN: Bet[];
	};
}
```

### Withdraw Result Schema

```typescript
interface WithdrawResult {
	currency: string; // Player's currency
	winAmount: string; // Total payout amount (decimal string)
	winCoeff: number; // Multiplier applied (2, 3, 5, or 50)
}
```

### Balance Change Schema

```typescript
interface BalanceChange {
	currency: string; // Player's currency code
	balance: string; // New balance (decimal string)
}
```

### Bets Config Schema

```typescript
interface BetsConfig {
	[currency: string]: {
		betPresets: string[]; // Quick-select amounts
		minBetAmount: string; // Minimum bet
		maxBetAmount: string; // Maximum bet
		maxWinAmount: string; // Maximum possible win
		defaultBetAmount: string; // Default amount shown
		decimalPlaces: number | null;
	};
}
```

### Make Bet Request Schema

```typescript
interface MakeBetRequest {
	action: "make-bet";
	payload: {
		betAmount: string; // Decimal string
		color: "BLACK" | "RED" | "BLUE" | "GREEN";
		currency: string; // ISO currency code
	};
}
```

---

## 12. Multiplayer & Broadcasting

### Real-time Bet Broadcasting

- `gameService-bet-list-updated` is broadcast to ALL connected players frequently during WAIT_GAME
- Contains the COMPLETE bet list for the current round across ALL operators and players
- Bet amounts are shown in their ORIGINAL currency (not converted)
- The `sumInUSD` field provides the total pool value in USD for the BANK display

### Cross-Operator Multiplayer

- Players from DIFFERENT operators share the SAME game rounds
- Each bet's `operatorId` identifies which platform the player is from
- Bet IDs are formatted as `operatorId::userId` to ensure uniqueness across operators

### Player Identity

- Players are identified by `userId` (unique per operator)
- `nickname` is the display name (can be auto-generated like "Apricot Absent Bee" or custom)
- `gameAvatar` is an integer index or null (corresponds to avatar images)

### Bet List Update Frequency

During WAIT_GAME phase, `gameService-bet-list-updated` events are sent approximately every 1-2 seconds, aggregating all new bets since last update.

---

## 13. Edge Cases & Error Handling

### Betting During Different Game Phases

| Phase       | Can Bet? | Behavior                                                |
| ----------- | -------- | ------------------------------------------------------- |
| WAIT_GAME   | Yes      | Bet placed for current round (`isNextRoundBet: false`)  |
| IN_GAME     | No       | Button likely disabled (not tested - wheel is spinning) |
| FINISH_GAME | Yes      | Bet queued for NEXT round (`isNextRoundBet: true`)      |

### Connection Handling

- Engine.IO ping/pong every 25s maintains connection
- Ping timeout of 20s - if no pong, connection is considered dead
- Client should implement reconnection logic

### Error Events

- `gameService-exception` is emitted for server-side errors (insufficient balance, invalid bet amount, etc.)

### Balance Precision

- All monetary values are transmitted as STRINGS (not numbers) to preserve decimal precision
- Example: `"0.080000000000000000"` - up to 18 decimal places
- Client must handle string-to-number conversion carefully

### Multi-Currency Support

- Each bet is placed in the player's configured currency
- The BANK total (`sumInUSD`) is always in USD regardless of player's currency
- Currency exchange rates are provided at initialization via the `currencies` event
- UI converts BANK amount to player's currency using provided rates

### Provably Fair System

- Game supports provably fair verification via `gameService-game-seeds` / `gameService-onGameSeeds`
- Seeds can be requested and verified by players
- Accessible through the "Provably fair settings" menu item

### Static Assets

The game loads these key media assets:

- `WheelTheme.webm` - Background theme audio/video
- `win.webm` - Win celebration audio
- `start.webm` - Round start audio
- `spin.webm` - Wheel spinning audio
- `bet.webm` - Bet placement audio
- `wheel.png` - Wheel graphic image
- `inoutLogo.svg` - Platform logo
- Translation file from `i18n.inout.games` for internationalization

---

## Appendix A: Complete Message Sequence - Single Round with Bet & Win

```
TIME(ms)  DIR   EVENT                           KEY DATA
────────  ────  ──────────────────────────────  ────────────────────────
0         IN    gameService-game-status-changed  status:WAIT_GAME, gameId:3597023, nextChangeInMs:9938
500       IN    gameService-bet-list-updated     sumInUSD:0.78, bets:{...} (other players)
1500      IN    gameService-bet-list-updated     sumInUSD:6.91, bets:{...}
3000      -     (User selects amount "1")        CLIENT-ONLY, no socket msg
3500      -     (User selects color x3/RED)      CLIENT-ONLY, no socket msg
4000      OUT   gameService:make-bet             {betAmount:"1",color:"RED",currency:"USD"}
4050      IN    onBalanceChange                  balance:"999998.92" (deducted)
4100      IN    ACK: bet confirmation            {betAmount:"1",color:"RED",isNextRoundBet:false,...}
4200      IN    gameService-bet-list-updated     (includes player's bet in RED array)
5000      IN    gameService-bet-list-updated     sumInUSD growing...
7000      IN    gameService-bet-list-updated     sumInUSD growing...
9000      IN    gameService-bet-list-updated     final bets
10000     IN    gameService-game-status-changed  status:IN_GAME, cellIndex:36, cellColor:RED, inCellOffset:0.615
12600     IN    gameService-game-status-changed  status:FINISH_GAME, cellIndex:36, cellColor:RED
12650     IN    gameService-withdraw-result      {winAmount:"3",winCoeff:3}  ← WIN!
12700     IN    gameService-bet-list-updated     (bets from next-round queue)
12750     IN    onBalanceChange                  balance:"1000001.92" (credited)
17600     IN    gameService-game-status-changed  status:WAIT_GAME, gameId:3597024, prevRoundResults:[...]
```

## Appendix B: Complete Message Sequence - Single Round with Bet & Loss

```
TIME(ms)  DIR   EVENT                           KEY DATA
────────  ────  ──────────────────────────────  ────────────────────────
0         IN    gameService-game-status-changed  status:WAIT_GAME, gameId:3597020
4000      OUT   gameService:make-bet             {betAmount:"0.08",color:"BLACK",currency:"USD"}
4050      IN    onBalanceChange                  balance:"999999.92" (deducted)
4100      IN    ACK: bet confirmation            {betAmount:"0.08",color:"BLACK",isNextRoundBet:false}
10000     IN    gameService-game-status-changed  status:IN_GAME, cellIndex:2, cellColor:RED
12600     IN    gameService-game-status-changed  status:FINISH_GAME, cellIndex:2, cellColor:RED
12650     IN    onBalanceChange                  balance:"999999.92" (SAME - no win, no withdraw-result!)
17600     IN    gameService-game-status-changed  status:WAIT_GAME, gameId:3597021
```

**Note:** On LOSS, `gameService-withdraw-result` is NEVER sent. Balance stays at post-bet level.

## Appendix C: Socket.IO ACK ID Pattern

Client requests use incrementing ACK IDs to match responses:

```
OUT: 420["gameService",{action:"get-game-config"}]   → ACK ID 0 (response: 430[...])
OUT: 421["gameService",{action:"get-game-state"}]    → ACK ID 1 (response: 431[...])
OUT: 422["gameService",{action:"make-bet",...}]      → ACK ID 2 (response: 432[...])
OUT: 423["gameService",{action:"make-bet",...}]      → ACK ID 3 (response: 433[...])
```

The ACK ID is embedded in the Socket.IO message prefix (e.g., `42X` for request, `43X` for response).
All game actions are sent to the `gameService` event, differentiated by the `action` field.

---

Key Findings:

Game Mechanics:

- Multiplayer color-betting wheel with 4 colors: BLACK(x2), RED(x3), BLUE(x5), GREEN(x50)
- 53 wheel segments, server-driven rounds (~17.5s cycle)
- Bets can stack (multiple Play clicks = multiple bets on same color)
- Bets during FINISH_GAME phase auto-queue for next round (isNextRoundBet: true)

Socket Protocol (Socket.IO over WSS):

- 8 unique IN events captured: onBalanceChange, betsRanges, betsConfig, myData, currencies,
  gameService-game-status-changed, gameService-bet-list-updated, gameService-withdraw-result
- 3 unique OUT actions: get-game-config, get-game-state, make-bet
- All actions go through single gameService event with action field

Critical Backend Insights:

- Balance deducted immediately on bet, credited on win
- gameService-withdraw-result is sent ONLY on win (absence = loss)
- gameService-bet-list-updated broadcasts ALL bets to ALL players (cross-operator)
- Game state machine: WAIT_GAME → IN_GAME → FINISH_GAME → repeat
- IN_GAME message already contains the winning cellIndex and cellColor (client animates accordingly)
