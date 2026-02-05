# Keno Game Backend Specification

## Overview

Keno is a lottery-style casino game where:
- Players select 1-10 numbers from a grid of 40 numbers (1-40)
- The server draws 10 random numbers
- Payouts are based on how many of the player's numbers match the drawn numbers
- Three risk levels affect the payout multipliers: LOW (EASY), MEDIUM, HIGH

---

## Authentication Flow

### Step 1: HTTP Authentication

**Endpoint:** `POST https://api.inout.games/api/auth`

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "operator": "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52",
  "auth_token": "39e28bb7-646e-4741-b2d9-4a75bd440159",
  "currency": "USD",
  "game_mode": "keno"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "result": "JWT_TOKEN_HERE",
  "data": "JWT_TOKEN_HERE",
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
  "userId": "b4744f13-30a0-4033-b0eb-c919e0b3cf46",
  "nickname": "Red Hollow Pike",
  "balance": "999999.99",
  "currency": "USD",
  "operator": "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52",
  "operatorId": "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52",
  "gameMode": "keno",
  "meta": null,
  "gameAvatar": null,
  "sessionToken": "f3lcvg",
  "iat": 1770153005,
  "exp": 1770239405
}
```

---

## WebSocket Connection

### Connection URL
```
wss://api.inout.games:443/io/?gameMode=keno&operatorId={OPERATOR_ID}&Authorization={JWT_TOKEN}&EIO=4&transport=websocket
```

### Protocol
- **Engine.IO Version:** 4
- **Socket.IO Protocol**

### Message Format
Socket.IO uses a specific packet format:

| Prefix | Type | Description |
|--------|------|-------------|
| `0` | OPEN | Initial handshake from server |
| `40` | CONNECT | Connect to namespace |
| `42` | EVENT | Event message |
| `42{id}` | EVENT with ACK | Event expecting acknowledgment |
| `43{id}` | ACK | Acknowledgment response |

---

## WebSocket Message Flow

### 1. Connection Handshake

**Server → Client (OPEN packet):**
```
0{"sid":"HZ5582z1lvoivCrSDJOH","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
```

**Client → Server (CONNECT):**
```
40
```

**Server → Client (CONNECT ACK):**
```
40{"sid":"VyfUDJa5bEWv8l7lDJOI"}
```

### 2. Initial Data from Server

**Balance Update:**
```
42["onBalanceChange",{"currency":"USD","balance":"999999.99"}]
```

**Bet Ranges:**
```
42["betsRanges",{"USD":["0.01","200.00"]}]
```

**Bet Configuration:**
```
42["betsConfig",{
  "USD":{
    "betPresets":["0.5","1","2","7"],
    "minBetAmount":"0.01",
    "maxBetAmount":"200.00",
    "maxWinAmount":"20000.00",
    "defaultBetAmount":"0.060000000000000000",
    "decimalPlaces":null
  }
}]
```

**User Data:**
```
42["myData",{
  "userId":"b4744f13-30a0-4033-b0eb-c919e0b3cf46",
  "nickname":"Red Hollow Pike",
  "gameAvatar":null
}]
```

**Currencies (exchange rates):**
```
42["currencies",{"USD":1,"EUR":0.8755,"BTC":0.000013341189804721441,...}]
```

### 3. Client Requests

**Get Game Config (optional):**
```
420["gameService",{"action":"get-game-config"}]
```

**Get Bet History:**
```
421["gameService-get-my-bets-history",{}]
```

**Response (Bet History):**
```
431[[
  {
    "id": "1448590c-5699-4340-a330-4710dff40336",
    "createdAt": "2026-02-03T21:09:13.684Z",
    "gameId": 0,
    "finishCoeff": 0,
    "fairness": {
      "decimal": "1.2841451166334095e+154",
      "clientSeed": "d1acc8777038c16a",
      "serverSeed": "2991768bc6fb8e31def35511e55ed3ffce2215da",
      "combinedHash": "f52fb4afa34cb12b969efd7102b44404cd4cca2733df9f8c4d7b6f5b2f2a603267fe33132519fbdb814e481cfff944c04259b2b430892c5b790c6ac5fa46a0da",
      "hashedServerSeed": "5ea4e3e92a9ed4191d999fc7038f2fcc99509a608317ccbf68123f3f975b65d36241a53bffe5e96d04e3f6f149305bece1a1dc7c9b5982155201c501e10b9da2"
    },
    "betAmount": 0.06,
    "win": 0.08,
    "withdrawCoeff": 1.33,
    "operatorId": "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52",
    "userId": "b4744f13-30a0-4033-b0eb-c919e0b3cf46",
    "currency": "USD",
    "gameMeta": {
      "risk": "LOW",
      "chosenNumbers": [9, 10, 20, 30, 40],
      "kenoNumbers": [38, 36, 28, 6, 20, 24, 9, 19, 8, 4],
      "coeff": "1.36"
    }
  }
]]
```

---

## Bet Flow (CRITICAL)

### Bet Request (Client → Server)

**Format:** `42{messageId}["gameService", {"action": "bet", "payload": {...}}]`

**Example:**
```
422["gameService",{
  "action": "bet",
  "payload": {
    "currency": "USD",
    "betAmount": "0.06",
    "chosenNumbers": [13, 15, 25],
    "risk": "LOW"
  }
}]
```

**Payload Schema:**
```typescript
interface BetPayload {
  currency: string;      // "USD", "EUR", etc.
  betAmount: string;     // Decimal string, e.g., "0.06"
  chosenNumbers: number[]; // Array of 1-10 numbers (1-40 range)
  risk: "LOW" | "MEDIUM" | "HIGH";
}
```

### Bet Response Flow (Server → Client)

**Step 1: Balance Deduction**
```
42["onBalanceChange",{"currency":"USD","balance":"999999.93"}]
```

**Step 2: Win Credit (if any)**
```
42["onBalanceChange",{"currency":"USD","balance":"1000000.00"}]
```

**Step 3: Bet Result (ACK)**
```
432[{
  "winAmount": "0.07",
  "currency": "USD",
  "risk": "LOW",
  "chosenNumbers": [13, 15, 25],
  "kenoNumbers": [9, 32, 21, 12, 11, 36, 15, 38, 40, 8]
}]
```

**Response Schema:**
```typescript
interface BetResponse {
  winAmount: string;       // Decimal string
  currency: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  chosenNumbers: number[]; // Player's selected numbers
  kenoNumbers: number[];   // 10 drawn numbers (server-generated)
}
```

---

## Game Logic

### Grid Layout
- 40 numbers arranged in 8 columns × 5 rows
- Numbers: 1-40

### Number Selection
- Minimum: 1 number
- Maximum: 10 numbers

### Draw
- Server randomly selects 10 unique numbers from 1-40
- Order of drawn numbers may affect animation but not payout

### Win Calculation
```
winAmount = betAmount × multiplier
```
Where `multiplier` is determined by:
1. Number of player selections
2. Number of hits (matches)
3. Risk level

---

## Payout Tables (Multipliers)

### UI to API Risk Mapping
| UI Label | API Value |
|----------|-----------|
| EASY | `"LOW"` |
| MEDIUM | `"MEDIUM"` |
| HIGH | `"HIGH"` |

### Complete Payout Tables by Selection Count

#### 3 Selections
| Hits | LOW (EASY) | MEDIUM | HIGH |
|------|------------|--------|------|
| 0 | 0 | 0 | 0 |
| 1 | 1.3 | 1.2 | 1 |
| 2 | 2.54 | 2.42 | 2.62 |
| 3 | 5 | 8 | 15 |

#### 5 Selections
| Hits | LOW (EASY) | MEDIUM | HIGH |
|------|------------|--------|------|
| 0 | 0 | 0 | 0 |
| 1 | 0.25 | 0.5 | 0 |
| 2 | 1.36 | 1.4 | 2 |
| 3 | 5 | 3.45 | 3.3 |
| 4 | 10 | 10 | 15 |
| 5 | 15 | 35 | 50 |

#### 10 Selections
| Hits | LOW (EASY) | MEDIUM | HIGH |
|------|------------|--------|------|
| 0 | 0 | 0 | 0 |
| 1 | 0.1 | 0 | 0 |
| 2 | 0.25 | 0.25 | 0 |
| 3 | 1.25 | 1.1 | 0.98 |
| 4 | 2 | 2.45 | 2.7 |
| 5 | 10 | 10 | 10 |
| 6 | 22 | 25 | 50 |
| 7 | 50 | 50 | 100 |
| 8 | 100 | 250 | 500 |
| 9 | 250 | 500 | 1000 |
| 10 | 300* | 1000* | 10000* |

*Note: 10-hit multipliers are estimated based on game patterns. Actual values should be verified.*

### LOW Risk (EASY) - Full Table

| Selections | 0 hits | 1 hit | 2 hits | 3 hits | 4 hits | 5 hits | 6 hits | 7 hits | 8 hits | 9 hits | 10 hits |
|------------|--------|-------|--------|--------|--------|--------|--------|--------|--------|--------|---------|
| 1 | 0 | 2.85 | - | - | - | - | - | - | - | - | - |
| 2 | 0 | 1.35 | 4.1 | - | - | - | - | - | - | - | - |
| 3 | 0 | 1.3 | 2.54 | 5 | - | - | - | - | - | - | - |
| 4 | 0 | 1.1 | 1.72 | 5 | 10 | - | - | - | - | - | - |
| 5 | 0 | 0.25 | 1.36 | 5 | 10 | 15 | - | - | - | - | - |
| 6 | 0 | 0 | 1.5 | 2 | 5 | 13 | 20 | - | - | - | - |
| 7 | 0 | 0 | 0.5 | 2 | 5 | 10 | 20 | 50 | - | - | - |
| 8 | 0 | 0 | 0 | 2 | 4 | 8 | 15 | 50 | 100 | - | - |
| 9 | 0 | 0 | 0 | 1 | 3 | 5 | 10 | 30 | 100 | 200 | - |
| 10 | 0 | 0.1 | 0.25 | 1.25 | 2 | 10 | 22 | 50 | 100 | 250 | 300 |

### Risk Level Differences
- **LOW (EASY)**: Higher payouts for partial matches (1-2 hits), lower for full matches
- **MEDIUM**: Balanced risk/reward
- **HIGH**: Lower payouts for partial matches, much higher for full matches (all numbers hit)

---

## Provably Fair System

Each bet includes fairness data:

```typescript
interface Fairness {
  decimal: string;           // Large decimal number
  clientSeed: string;        // Client-provided seed (hex)
  serverSeed: string;        // Server seed (revealed after bet)
  combinedHash: string;      // SHA-512 hash of combined seeds
  hashedServerSeed: string;  // SHA-512 hash of server seed (shown before bet)
}
```

### Verification Process
1. Before bet: Server provides `hashedServerSeed`
2. Player can set their own `clientSeed`
3. After bet: Server reveals `serverSeed`
4. Player can verify: `SHA-512(serverSeed) === hashedServerSeed`
5. Result derived from combining seeds

---

## Error Handling

### Insufficient Balance
Server will reject bet if balance < betAmount

### Invalid Bet
- Numbers outside 1-40 range
- More than 10 numbers selected
- Less than 1 number selected
- Bet amount below minimum or above maximum

---

## Message ID Management

Socket.IO uses incrementing message IDs for request/response matching:
- Client sends: `420[...]`, `421[...]`, `422[...]`
- Server responds: `430[...]`, `431[...]`, `432[...]`

The client should track message IDs and match responses accordingly.

---

## Heartbeat/Ping

Engine.IO sends ping/pong to maintain connection:
- `pingInterval`: 25000ms (25 seconds)
- `pingTimeout`: 20000ms (20 seconds)

Client must respond to pings to keep connection alive.

---

## Summary of Critical Implementation Points

1. **Authentication**: HTTP POST first, then WebSocket with JWT in URL
2. **Protocol**: Socket.IO over Engine.IO v4
3. **Bet Request**: Event "gameService" with action "bet"
4. **Bet Response**: Three messages - balance deduction, win credit, result
5. **Numbers**: 1-40 grid, select 1-10, server draws 10
6. **Payouts**: Determined by selections count × hits × risk level
7. **All amounts as strings**: betAmount, winAmount, balance are decimal strings
8. **Message IDs**: Track for request/response correlation
