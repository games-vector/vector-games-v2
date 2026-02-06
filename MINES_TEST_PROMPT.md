# Mines Game Testing Prompt

Copy-paste everything below into a new Claude Code session to test the mines game backend.

---

## PROMPT START

I have a NestJS backend at `/Users/shubhamjangid/Desktop/keno` with a **platform-mines** game that needs end-to-end testing. Here's the full context:

### Project Setup
- **Backend**: NestJS, runs with `JWT_SECRET="CHANGE_ME_DEV_SECRET_MIN_32_CHARS" node dist/main.js`
- **Database**: MySQL `vectorgames` on localhost, user `root`, no password
- **Redis**: localhost:6379
- **Port**: 3000

### Auth Flow
1. Create a JWT signed with HS256 using secret `CHANGE_ME_DEV_SECRET_MIN_32_CHARS`, payload: `{ sub: "sxxurczuleogz19epayf", agentId: "brlag" }`
2. POST `http://localhost:3000/api/auth` with body: `{ "operator": "brlag", "auth_token": "<jwt>", "currency": "USD", "game_mode": "platform-mines" }`
3. Response `data` field is the game JWT for WebSocket auth

### WebSocket Connection
- URL: `http://localhost:3000` with path `/io`
- Query params: `gameMode=platform-mines`, `operatorId=brlag`, `currency=USD`, `Authorization=<game_jwt>`
- Transport: `websocket` only
- Library: `socket.io-client` (already in node_modules)

### Push Events on Connect (server → client)
- `onBalanceChange` → `{ currency, balance }`
- `betsConfig` → `{ minBetAmount, maxBetAmount, maxWinAmount, defaultBetAmount, betPresets, decimalPlaces, currency }`
- `betsRanges` → `{ INR: [min, max] }`
- `myData` → `{ role, userId, nickname, gameAvatar }`

### Game Actions (all via `emitWithAck("gameService", { action, payload })`)

| Action | Payload | Response |
|--------|---------|----------|
| `play` | `{ gameType: "platform-mines", amount: 1, currency: "USD", value: { minesCount: 3 }, bonusId: null }` | `{ status: "in-game", bet: { amount, currency, decimalPlaces }, isFinished: false, isWin: false, coeff: 0, winAmount: "0", minesCount: 3, openedCells: [] }` |
| `step` | `{ cellPosition: 1 }` (1-25, 1-indexed) | Safe: `{ status: "in-game", isWin: true, coeff: 1.07, winAmount: "1.07", openedCells: [1] }` / Mine: `{ status: "lose", isFinished: true, coeff: 0, winAmount: "0.00", minesCells: [...] }` |
| `payout` | none | `{ status: "win", isFinished: true, isWin: true, coeff, winAmount, minesCells: [...] }` |
| `get-game-state` | none | `{ status: "none" }` or active game state |
| `get-game-config` | none | betConfig object |
| `get-rates` | none | `{ USD: 1, INR: 87.5, ... }` |
| `get-game-seeds` | none | `{ userSeed: "16hexchars", hashedServerSeed: "64hexchars" }` |
| `get-game-history` | none | `[{ betAmount, win }, ...]` |
| `set-user-seed` | `{ userSeed: "16hexchars" }` | `{ success: true, userSeed }` |

### Key Rules from PRD
- **Grid**: 5x5 = 25 cells, positions 1-25 (1-indexed)
- **Mines**: 1-24 bombs, presets: 3, 5, 10, 24
- **minesCells** is ONLY revealed when game ends (lose or payout), never during in-game
- **Balance** deducted on `play`, credited on `payout`. No balance change on `step`
- **Multiplier formula**: `floor((0.95 / probability) * 100) / 100` where `probability = product((safeCells-i)/(25-i))` for each step
- **Expected multipliers (3 mines)**: 1→1.07, 2→1.23, 3→1.41, 4→1.64, 5→1.91, 6→2.25
- **Expected multipliers (5 mines)**: 1→1.18, 2→1.50, 3→1.91, 4→2.48, 5→3.25, 6→4.34
- **Expected multipliers (24 mines)**: 1→23.75
- **Mine generation**: HMAC-SHA256(serverSeed, userSeed:nonce) → Fisher-Yates shuffle → first N positions
- **onBalanceChange** pushed after play and payout

### Game Files
- `src/games/platform-mines-game/platform-mines.handler.ts` - WebSocket handler
- `src/games/platform-mines-game/platform-mines.service.ts` - Game logic
- `src/games/platform-mines-game/platform-mines.module.ts` - NestJS module
- `src/games/platform-mines-game/DTO/` - play-payload, step-payload, game-action DTOs
- DB config table: `game_config_platform_mines` (key/value, has `betConfig` row)

### Existing Test Script
There's `test-mines-game.js` in project root that runs 68 tests across 10 phases. Run with `node test-mines-game.js`. The play/step/payout tests are skipped when the external wallet API (`https://awc.play247.services`) is unreachable — this is normal for local dev.

### What to Test
1. **Build**: `node node_modules/typescript/bin/tsc` (nest CLI is broken, use tsc directly)
2. **Start server**: `kill $(lsof -ti:3000) 2>/dev/null; JWT_SECRET="CHANGE_ME_DEV_SECRET_MIN_32_CHARS" node dist/main.js &`
3. **Run test suite**: `node test-mines-game.js`
4. **Manual testing**: Connect via browser/WebSocket client and play through the full flow
5. **If wallet API is up**: The play→step→payout flow will work. Verify balance changes, multipliers match PRD, mine positions revealed correctly on game end.
6. **If wallet API is down**: All non-wallet tests should still pass (68 tests). The 6 wallet-dependent tests will be skipped.

### Known Issues
- `nest` CLI and `npx tsc` are broken in this project — use `node node_modules/typescript/bin/tsc` instead
- External wallet API at `https://awc.play247.services` is intermittently unreachable — affects ALL games, not just mines
- `getBalance` may work (cached) while `placeBet` fails (requires live connection)

Please start the server, run the test suite, and help me test or fix any issues with the mines game.

## PROMPT END
