# CoinFlip Frontend – Complete Backend Connection Knowledge

This document is the **single source of truth** for a frontend agent connecting the CoinFlip UI to the backend running on the **local server** (flipcoin/coinflip game). Use it for implementation, debugging, and integration.

---

## 1. Backend Overview

| Item | Value |
|------|--------|
| **Game code** | `coinflip` |
| **Local API base URL** | `http://localhost:3000` |
| **WebSocket path** | `/io` |
| **Full WebSocket URL** | `http://localhost:3000` (Socket.IO connects here; path is `/io`) |
| **Swagger / REST docs** | `http://localhost:3000/api` |

---

## 2. Start the Backend (Prerequisites)

### 2.1 Docker (MySQL + Redis)

Start Docker, then:

```bash
cd /Users/shubhamjangid/Desktop/vector-games-v2
docker compose -f docker-compose.dev.yml up -d
```

- **MySQL**: `localhost:3306`, user `root`, password `dev`, database `vectorgames`
- **Redis**: `localhost:6379`, no password

Wait ~10–15 seconds for MySQL to be ready.

### 2.2 Backend `.env`

Path: `/Users/shubhamjangid/Desktop/vector-games-v2/.env`

Required for local dev:

```env
APP_PORT=3000
APP_ENV=development
NODE_ENV=development
ENABLE_AUTH=true

DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=dev
DB_DATABASE=vectorgames
DB_SYNCHRONIZE=true
DB_CONNECTION_LIMIT=30

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

JWT_SECRET=CHANGE_ME_DEV_SECRET_MIN_32_CHARS
JWT_EXPIRES_IN=1h
```

### 2.3 Run the backend

```bash
cd /Users/shubhamjangid/Desktop/vector-games-v2
npm install
npm run start:dev
```

When ready:

- Log: `Application is running on: 3000 env=development auth=ENABLED dbHost=localhost`
- Swagger: **http://localhost:3000/api**

---

## 3. Frontend Environment

Repo: `coinflip-frontend/` (or your frontend root).

### 3.1 `.env` for local backend

```env
VITE_API_URL=http://localhost:3000
VITE_WS_PATH=/io
VITE_GAME_MODE=coinflip
VITE_OPERATOR_ID=dev-operator
VITE_AUTH_TOKEN=
VITE_DEFAULT_CURRENCY=USD
VITE_DEFAULT_LANGUAGE=en
```

### 3.2 Get a dev JWT (no real login)

Only when `APP_ENV=development`.

**Request:**

```http
GET http://localhost:3000/api/dev-game-token?userId=testuser001&operatorId=dev-operator&currency=USD&game_mode=coinflip
```

**Response:**

```json
{ "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

Use this token as:

- `VITE_AUTH_TOKEN` in `.env`, or
- The `Authorization` query param when connecting the WebSocket (see below).

Optional query params (defaults in parentheses): `userId` (testuser001), `operatorId` (testagent), `currency` (USD), `game_mode` (coinflip).

---

## 4. REST API Endpoints

Base URL: `http://localhost:3000`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dev-game-token` | Dev JWT (query: `userId`, `operatorId`, `currency`, `game_mode`) |
| POST | `/api/auth` | Production auth; body: `{ operator, auth_token, currency, game_mode }`; returns new token in `result` / `data` |
| GET | `/api/online-counter/v1/data` | Online counter (no auth) |
| GET | `/api/games` | List active games |
| POST | `/api/games` | Create game (onboarding) |

**Auth response (POST `/api/auth`):**

```ts
{
  success: boolean;
  result: string;   // new JWT
  data: string;     // same JWT
  gameConfig: any;
  bonuses: any[];
  isLobbyEnabled: boolean;
  isPromoCodeEnabled: boolean;
  isSoundEnabled: boolean;
  isMusicEnabled: boolean;
}
```

---

## 5. WebSocket Connection

### 5.1 URL and path

- **Server URL**: same as API, e.g. `http://localhost:3000`
- **Path**: `/io` (Socket.IO path option)

### 5.2 Required query parameters

The gateway **requires** these in the handshake query (Socket.IO `query` option):

| Parameter | Description | Example |
|-----------|-------------|---------|
| `gameMode` or `gameCode` | Game identifier | `coinflip` |
| `operatorId` | Operator/agent ID | `dev-operator` |
| `Authorization` | JWT (Bearer not required in query) | token from dev-game-token or auth |

Missing/invalid values result in disconnect with an error event.

### 5.3 Socket.IO client example

```typescript
import { io } from 'socket.io-client';

const apiUrl = import.meta.env.VITE_API_URL;   // http://localhost:3000
const wsPath = import.meta.env.VITE_WS_PATH;   // /io
const token = import.meta.env.VITE_AUTH_TOKEN; // or from dev-game-token
const operatorId = import.meta.env.VITE_OPERATOR_ID;

const socket = io(apiUrl, {
  path: wsPath,
  query: {
    gameMode: 'coinflip',
    operatorId,
    Authorization: token,
  },
  transports: ['websocket'],
});

socket.on('connect', () => { /* ready */ });
socket.on('connect_error', (err) => { /* handle error */ });
```

---

## 6. Socket Events Reference

### 6.1 Server → Client (listen on these)

| Event (exact name) | Payload |
|--------------------|---------|
| `onBalanceChange` | `{ currency: string; balance: string }` |
| `betsRanges` | `Record<string, [string, string]>` e.g. `{ INR: ['0.01', '200.00'] }` |
| `betsConfig` | `Record<string, BetConfig>` (key = currency). **Note: `betsConfig` not `betConfig`.** |
| `myData` | `{ userId: string; nickname: string; gameAvatar: string \| null }` |
| `currencies` | `Record<string, number>` (e.g. exchange rates: INR, USD, EUR) |
| `pong` | `{ ts: number }` (reply to `ping`) |

**BetConfig (per currency):**

```ts
interface BetConfig {
  minBetAmount: string;
  maxBetAmount: string;
  maxWinAmount: string;
  defaultBetAmount: string;
  betPresets: string[];
  decimalPlaces: number;
}
```

These are sent automatically on connection (and balance updates after bets/steps/cashout).

### 6.2 Client → Server: single event for all game actions

All game actions use **one** event: **`gameService`**.

**Emit:**

```typescript
socket.emit('gameService', { action: string, payload?: object }, (response: any) => {
  // response = success payload or { error: { message: string } }
});
```

The third argument is the **ack callback**; the backend always replies via it (success or error).

---

## 7. Game actions (gameService)

### 7.1 Action summary

| action | When | payload |
|--------|------|---------|
| `bet` | Place bet | BetPayload (see below) |
| `step` | ROUNDS only: next round choice | StepPayload |
| `withdraw` | ROUNDS only: cash out | `{}` or omit |
| `get-game-state` | Reconnect / restore state | `{}` |
| `get-game-config` | Get config (optional) | `{}` |
| `get-game-seeds` | Provably fair seeds | `{}` |
| `set-user-seed` | Set client seed | `{ userSeed: string }` |
| `gameService-get-my-bets-history` | Bet history | `{}` |

**Important:**

- **QUICK mode**: send `choice: 'HEADS' | 'TAILS'` in the **bet** payload.
- **ROUNDS mode**: send **bet** with `choice: null`, then use **step** for each round with `choice` and `roundNumber` (1–20). Use **withdraw** to cash out.

### 7.2 Payloads

**BetPayload (action: `bet`):**

```ts
{
  betAmount: string;      // e.g. "0.30"
  currency: string;       // e.g. "USD", "INR"
  choice: 'HEADS' | 'TAILS' | null;  // required for QUICK, null for ROUNDS
  playMode: 'QUICK' | 'ROUNDS';
  countryCode?: string;   // optional
}
```

**StepPayload (action: `step`):**

```ts
{
  choice: 'HEADS' | 'TAILS';
  roundNumber: number;    // 1–20, must match next expected round
}
```

**set-user-seed payload:**

```ts
{ userSeed: string }   // backend expects "userSeed", not "clientSeed"
```

---

## 8. Response shapes (ack callback)

### 8.1 Error (any action)

```ts
{ error: { message: string } }
```

**Backend error codes (message):**

- `missing_action` – no `action` in payload
- `missing_context` – missing user/agent/game (e.g. bet)
- `missing_user_or_agent` – used for step, withdraw, get-game-state, get-game-seeds, set-user-seed, get-my-bets-history
- `missing_user_seed` – set-user-seed payload invalid
- `active_session_exists` – bet while session already active
- `no_active_session` – step/withdraw without active ROUNDS session
- `invalid_bet_amount` – validation or range
- `invalid_choice` – not HEADS/TAILS or wrong context
- `invalid_play_mode` – not QUICK/ROUNDS
- `invalid_round_number` – step round not currentRound+1
- `agent_rejected` – wallet/agent rejected bet
- `settlement_failed` – settle failed (server-side)
- `cashout_failed` – cashout failed
- `bet_failed` – bet flow failed
- `step_failed` – step flow failed
- `get_game_seeds_failed` – get-game-seeds failed
- `set_user_seed_failed` – set-user-seed failed
- `get_bet_history_failed` – get-my-bets-history failed
- `unsupported_action` – unknown action

### 8.2 get-game-state

Returns `null` if no active session.

**Success (CoinFlipGameStateResponse):**

```ts
{
  isFinished: boolean;
  isWin: boolean;
  currency: string;
  betAmount: string;
  coeff?: string;           // current multiplier (ROUNDS)
  choices: ('HEADS' | 'TAILS')[];
  roundNumber: number;
  playMode: 'QUICK' | 'ROUNDS';
  winAmount?: string;       // when isFinished
}
```

### 8.3 bet (QUICK)

Same shape as above with `isFinished: true`, single `choices`, `winAmount` set on win.

### 8.4 bet (ROUNDS) / step / withdraw

Same `CoinFlipGameStateResponse`: after **bet** (ROUNDS) you get `isFinished: false`, `roundNumber: 0`; after each **step** or **withdraw** you get updated `roundNumber`, `choices`, `coeff`, `isFinished`, `winAmount` when applicable.

### 8.5 get-game-seeds

```ts
{
  userSeed: string;
  hashedServerSeed: string;
  nonce: string;
}
```

### 8.6 set-user-seed

```ts
{
  success: boolean;
  userSeed: string;
}
```

### 8.7 get-my-bets-history (action: `gameService-get-my-bets-history`)

Returns an array of bet history items:

```ts
Array<{
  id: number;
  createdAt: string;      // ISO date
  gameId: number;
  finishCoeff: number;
  fairness: any;
  betAmount: number;
  win: number;
  withdrawCoeff: number;
  operatorId: string;
  userId: string;
  currency: string;
  gameMeta: {
    coeff: string;
    playMode?: string;
  };
}>
```

### 8.8 get-game-config

Handler does not call the ack for `get-game-config`; config is provided via connection events (`betsConfig`, `betsRanges`, etc.). If you need a dedicated config endpoint, use connection data or a future REST/WS contract.

---

## 9. Backend defaults (coinflip)

Use these for validation and UI defaults when connection data is not yet available.

**Bet limits (INR):**

- min: `0.01`, max: `200.00`, default: `0.30`
- presets: `['0.5', '1', '2', '7']`
- decimalPlaces: `2`

**Multiplier ladder (ROUNDS, rounds 1–20):**

```
1.94, 3.88, 7.76, 15.52, 31.04, 62.08, 124.16, 248.32, 496.64, 993.28,
1986.56, 3973.12, 7946.24, 15892.48, 31784.96, 63569.92, 127139.84,
254279.68, 508559.36, 1017118.72
```

**Currency:**

- Config default: `INR`; frontend often uses `USD`; both work if backend supports them.
- Default wallet balance (e.g. dev): `1000000`.

**QUICK multiplier:** 1.94 (same as round 1).

---

## 10. TypeScript interfaces (frontend)

```ts
// Connection / config
interface BalanceUpdate {
  currency: string;
  balance: string;
}

interface BetConfig {
  minBetAmount: string;
  maxBetAmount: string;
  maxWinAmount: string;
  defaultBetAmount: string;
  betPresets: string[];
  decimalPlaces: number;
}

interface MyData {
  userId: string;
  nickname: string;
  gameAvatar: string | null;
}

// Game state (ack responses)
type CoinChoice = 'HEADS' | 'TAILS';
type PlayMode = 'QUICK' | 'ROUNDS';

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
}

interface GameSeedsResponse {
  userSeed: string;
  hashedServerSeed: string;
  nonce: string;
}

interface SetUserSeedResponse {
  success: boolean;
  userSeed: string;
}

interface ErrorResponse {
  error: { message: string };
}

// GameService ack: GameStateResponse | GameSeedsResponse | SetUserSeedResponse | BetHistoryItem[] | null | ErrorResponse
```

---

## 11. Flow summary

1. **Start backend**: Docker → `.env` → `npm run start:dev`.
2. **Get token**: `GET /api/dev-game-token?game_mode=coinflip&operatorId=dev-operator&...`.
3. **Connect socket**: `io(API_URL, { path: '/io', query: { gameMode: 'coinflip', operatorId, Authorization: token } })`.
4. **On connect**: Listen for `onBalanceChange`, `betsRanges`, `betsConfig`, `myData`, `currencies`.
5. **Reconnect**: Emit `gameService` with `action: 'get-game-state'`, payload `{}`; if ack is not `null`, restore ROUNDS state.
6. **QUICK**: Emit `gameService` with `action: 'bet'`, payload `{ betAmount, currency, choice: 'HEADS'|'TAILS', playMode: 'QUICK' }`; handle ack as game result and update balance from `onBalanceChange` if sent.
7. **ROUNDS**: Emit `bet` with `choice: null`, `playMode: 'ROUNDS'`; then for each round emit `step` with `choice` and `roundNumber`; optionally emit `withdraw` to cash out. Handle ack after each step/withdraw; on `isFinished` or balance event, update UI.
8. **Provably fair**: `get-game-seeds` for seeds; `set-user-seed` with `{ userSeed }` to set client seed.
9. **History**: `gameService-get-my-bets-history` with `{}` for bet history list.

---

## 12. Related docs

- **UI/UX and flows**: `src/games/coinflip-game/FRONTEND_REQUIREMENTS.md`
- **Architecture**: `ARCHITECTURE_AND_ONBOARDING.md`
- **Backend behaviour**: `src/games/coinflip-game/REQUIREMENTS.md`
- **Short checklist**: `COINFLIP_FRONTEND_AGENT.md`

---

## 13. Quick checklist for frontend agent

- [ ] Docker: `docker compose -f docker-compose.dev.yml up -d`
- [ ] Backend `.env`: `DB_PASSWORD=dev`, port 3000, Redis, JWT set
- [ ] Backend running: `npm run start:dev` in repo root
- [ ] Dev token: `GET http://localhost:3000/api/dev-game-token?game_mode=coinflip&operatorId=dev-operator`
- [ ] Frontend `.env`: `VITE_API_URL=http://localhost:3000`, `VITE_WS_PATH=/io`, `VITE_AUTH_TOKEN=<token>`, `VITE_OPERATOR_ID=dev-operator`
- [ ] Socket: connect to `VITE_API_URL`, path `VITE_WS_PATH`, query `gameMode=coinflip`, `operatorId`, `Authorization=token`
- [ ] Listen: `onBalanceChange`, `betsRanges`, `betsConfig`, `myData`, `currencies`
- [ ] Emit: `gameService` with `action` + `payload`; handle ack (success or `error.message`)
- [ ] QUICK: `bet` with `choice`; ROUNDS: `bet` with `choice: null`, then `step`/`withdraw`; set-user-seed uses `userSeed` in payload

Once this is done, the frontend can implement the screens and flows in `FRONTEND_REQUIREMENTS.md`.
