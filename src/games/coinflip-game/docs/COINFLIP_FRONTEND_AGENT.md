# CoinFlip Frontend Agent – Backend & Integration Cheat Sheet

This file gives a **frontend agent** everything needed to run the backend and integrate the CoinFlip frontend.

---

## 1. Start the backend (do this first)

### 1.1 Start MySQL + Redis (Docker)

**Start Docker first** (Docker Desktop or `colima start` / your local Docker daemon).

```bash
cd /Users/shubhamjangid/Desktop/vector-games-v2
docker compose -f docker-compose.dev.yml up -d
# or: docker-compose -f docker-compose.dev.yml up -d
```

- **MySQL**: `localhost:3306`, user `root`, password `dev`, database `vectorgames`
- **Redis**: `localhost:6379`, no password

Wait ~10–15 seconds for MySQL to be ready, then continue.

### 1.2 Backend `.env`

Root of repo: `/Users/shubhamjangid/Desktop/vector-games-v2/.env`

**Required for local dev with Docker:**

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

Important: `DB_PASSWORD=dev` when using `docker-compose.dev.yml` (MySQL root password is `dev`).

### 1.3 Run the backend

```bash
cd /Users/shubhamjangid/Desktop/vector-games-v2
npm install
npm run start:dev
```

When ready you’ll see something like:

- `Application is running on: 3000 env=development auth=ENABLED dbHost=localhost`
- Swagger: **http://localhost:3000/api**

---

## 2. Frontend environment

Repo: `coinflip-frontend/`

Copy env and set API + WebSocket + auth:

```bash
cd coinflip-frontend
cp .env.example .env
```

**`.env` for local dev (pointing at backend on 3000):**

```env
VITE_API_URL=http://localhost:3000
VITE_WS_PATH=/io
VITE_GAME_MODE=coinflip
VITE_OPERATOR_ID=dev-operator
VITE_AUTH_TOKEN=
VITE_DEFAULT_CURRENCY=USD
VITE_DEFAULT_LANGUAGE=en
```

**Getting a dev JWT (no real login):**

- Backend must be running with `APP_ENV=development`.
- In browser or curl:

```text
GET http://localhost:3000/api/dev-game-token?userId=testuser001&operatorId=dev-operator&currency=USD&game_mode=coinflip
```

Response: `{ "token": "eyJhbG..." }`. Put this token in `VITE_AUTH_TOKEN` or pass it when connecting the socket (see below).

---

## 3. WebSocket connection

- **Base URL**: same as API (e.g. `http://localhost:3000` for dev).
- **Path**: `/io`
- **Query params** (required by backend):
  - `gameMode` or `gameCode`: `coinflip`
  - `operatorId`: e.g. `dev-operator`
  - `Authorization`: JWT (e.g. from dev-game-token)

**Socket.IO client example:**

```typescript
import { io } from 'socket.io-client';

const apiUrl = import.meta.env.VITE_API_URL;   // http://localhost:3000
const wsPath = import.meta.env.VITE_WS_PATH;   // /io
const token = import.meta.env.VITE_AUTH_TOKEN; // or from dev-game-token response

const socket = io(apiUrl, {
  path: wsPath,
  query: {
    gameMode: 'coinflip',
    operatorId: 'dev-operator',
    Authorization: token,
  },
  transports: ['websocket'],
});
```

---

## 4. Socket events (backend ↔ frontend)

### 4.1 Server → Client (listen on these)

| Event (exact name)     | Payload |
|------------------------|---------|
| `onBalanceChange`      | `{ currency: string, balance: string }` |
| `betsRanges`           | `Record<string, [string, string]>` e.g. `{ USD: ['0.01', '200.00'] }` |
| **`betsConfig`**       | `Record<string, BetConfig>` (key = currency). **Note: `betsConfig` not `betConfig`.** |
| `myData`               | `{ userId: string, nickname: string, gameAvatar: string \| null }` |
| `currencies`           | `Record<string, number>` (e.g. exchange rates) |
| `pong`                 | `{ ts: number }` (reply to `ping`) |

**BetConfig (per currency):**

- `minBetAmount`, `maxBetAmount`, `maxWinAmount`, `defaultBetAmount` (strings)
- `betPresets`: string[]
- `decimalPlaces`: number

### 4.2 Client → Server: game actions

All game actions go through **one** event: **`gameService`**.

Send an object with `action` and optional `payload`. Use the ack callback for the response.

**Emit:**

```typescript
socket.emit('gameService', { action, payload }, (response) => {
  // response = game result or error
});
```

**Actions:**

| action             | When           | payload |
|--------------------|----------------|---------|
| `bet`              | Place bet      | `{ betAmount: string, currency: string, choice: 'HEADS' \| 'TAILS' \| null, playMode: 'QUICK' \| 'ROUNDS' }` |
| `step`             | ROUNDS only    | `{ choice: 'HEADS' \| 'TAILS', roundNumber: number }` |
| `withdraw`         | Cashout ROUNDS | `{}` or omit payload |
| `get-game-state`   | Reconnect      | `{}` |
| `get-game-config`  | Get config     | `{}` |
| `get-game-seeds`   | Provably fair  | `{}` |
| `set-user-seed`    | Set client seed| `{ userSeed: string }` (16-char hex; backend expects `userSeed`) |

**Important:**

- For **QUICK** mode: `choice` must be `'HEADS'` or `'TAILS'` when placing bet.
- For **ROUNDS** mode: place bet with `choice: null`, then use `step` each round with `choice` and `roundNumber`.

---

## 5. Response shapes

### 5.1 Success (ack callback)

```typescript
interface GameStateResponse {
  isFinished: boolean;
  isWin: boolean;
  currency: string;
  betAmount: string;
  coeff?: string;
  choices: string[];        // 'HEADS' | 'TAILS'
  roundNumber: number;
  playMode: 'QUICK' | 'ROUNDS';
  winAmount?: string;
  quickGamesHistory?: { isWin: boolean; result: string; datetime: string }[];
}
```

### 5.2 Error (ack callback)

```typescript
{ error: { message: string } }
```

**Backend error codes (message):**  
`missing_action`, `active_session_exists`, `no_active_session`, `invalid_bet_amount`, `invalid_choice`, `invalid_play_mode`, `invalid_round_number`, `agent_rejected`, `settlement_failed`, `cashout_failed`, `bet_failed`, `step_failed`, `unsupported_action`.

---

## 6. Defaults (backend)

- **Bet limits**: min `0.01`, max `200.00`, default `0.30`, presets `['0.5','1','2','7']`.
- **Currency**: config default `INR`; frontend often uses `USD`; both work if backend supports them.
- **Balance**: default wallet balance (e.g. 1000000) when using dev/session.
- **Multipliers**: round 1 = 1.94, round 2 = 3.88, … round 20 = 1017118.72 (see `FRONTEND_REQUIREMENTS.md` for full ladder).

---

## 7. REST API (useful for frontend)

- **Swagger**: http://localhost:3000/api  
- **Dev token**: `GET /api/dev-game-token?userId=...&operatorId=...&currency=USD&game_mode=coinflip`  
- **Auth (real)**: `POST /api/auth` with body `{ operator, currency, game_mode, auth_token }`  
- **Health**: check root or health route if present.

---

## 8. Docs to use while building the UI

- **Full UI/UX and flows**: `src/games/coinflip-game/FRONTEND_REQUIREMENTS.md`
- **Architecture / onboarding**: `ARCHITECTURE_AND_ONBOARDING.md`
- **Backend requirements**: `src/games/coinflip-game/REQUIREMENTS.md`

---

## 9. Socket mock client (backend verification)

A script acts as a frontend socket client to verify messaging matches this doc:

1. Start backend: `npm run start:dev`
2. Run: `npm run socket:coinflip`

Optional env: `API_URL`, `WS_PATH`, `OPERATOR_ID`, `USER_ID`, `AUTH_TOKEN` (if unset, fetches dev token from backend).

Location: `src/games/coinflip-game/scripts/socket-mock-client.ts`. It checks:

- Server→client: `onBalanceChange`, `betsRanges`, `betsConfig`, `myData`, `currencies`, `pong` payload shapes
- Client→server: `gameService` with `get-game-config`, `get-game-seeds`, `set-user-seed`, `get-game-state`, `get-game-session`, `bet` (QUICK), `get-my-bets-history`, `ping`; and error responses for `missing_action`, `unsupported_action`

---

## 10. Quick checklist for frontend agent

1. Start Docker: `docker compose -f docker-compose.dev.yml up -d`
2. Set backend `.env` with `DB_PASSWORD=dev` (and other vars above).
3. Start backend: `npm run start:dev` in repo root.
4. Get dev token: `GET http://localhost:3000/api/dev-game-token?game_mode=coinflip&operatorId=dev-operator`
5. Set `coinflip-frontend/.env`: `VITE_API_URL=http://localhost:3000`, `VITE_WS_PATH=/io`, `VITE_AUTH_TOKEN=<token>` (or pass token at runtime).
6. Connect socket to `VITE_API_URL` with path `VITE_WS_PATH`, query `gameMode=coinflip`, `operatorId`, `Authorization=token`.
7. Listen for `onBalanceChange`, `betsRanges`, **`betsConfig`**, `myData`, `currencies`.
8. Emit `gameService` with `action` + `payload`; handle ack response and errors.
9. (Optional) Run `npm run socket:coinflip` with backend up to verify socket contract.

Once this is done, the frontend can implement the screens and flows described in `FRONTEND_REQUIREMENTS.md`.
