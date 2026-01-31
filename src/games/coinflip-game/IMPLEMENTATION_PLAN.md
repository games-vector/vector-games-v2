# CoinFlip Game – Implementation Plan (Aligned with ARCHITECTURE_AND_ONBOARDING.md)

This document describes how the CoinFlip game is structured according to **ARCHITECTURE_AND_ONBOARDING.md**: single gateway, dispatcher, `IGameHandler`, `IBaseGameModule`, and shared services.

---

## Architecture alignment

- **Single gateway**: All clients connect at `/io` with `gameMode=coinflip`; `CommonGameGateway` validates JWT and game, then `GameDispatcherService` routes to `CoinFlipGameHandler`.
- **Handler contract**: `CoinFlipGameHandler` implements `IGameHandler` (`handleConnection`, `handleDisconnection`, `registerMessageHandlers`; optional `onGatewayInit`, `getServer`, `getGameConfigResponse`).
- **Module contract**: `CoinFlipGameModule` implements `IBaseGameModule` and uses `initializeGameModule()` in `onModuleInit()` to register the handler and ensure the game row exists in the DB.
- **Common modules**: JWT, User, Agents, Redis, Game, GameConfig, WalletConfig, BetConfig (same pattern as Chicken Road).

---

## File structure (per architecture)

```
src/games/coinflip-game/
├── coinflip-game.module.ts       # NestJS module, IBaseGameModule, initializeGameModule
├── coinflip-game.handler.ts      # IGameHandler: connection, disconnection, message handlers
├── coinflip-game.service.ts      # Business logic: bet, step, cashout, session, fairness
├── DTO/
│   ├── bet-payload.dto.ts
│   ├── step-payload.dto.ts
│   └── game-action.dto.ts
├── interfaces/
│   └── game-session.interface.ts
├── constants/
│   └── coinflip.constants.ts
└── modules/
    └── fairness/
        ├── fairness.module.ts
        └── fairness.service.ts
```

No separate bet service or scheduler; bet/step/cashout logic lives in `coinflip-game.service.ts`.

---

## Module (`coinflip-game.module.ts`)

- **Implements**: `IBaseGameModule`, `OnModuleInit`.
- **Imports**: `JwtTokenModule`, `UserModule`, `AgentsModule`, `RedisModule`, `GameModule`, `GameConfigModule`, `WalletConfigModule`, `BetConfigModule`, `FairnessModule`.
- **Providers**: `CoinFlipGameService`, `CoinFlipGameHandler`.
- **Exports**: `CoinFlipGameService`, `CoinFlipGameHandler`.
- **onModuleInit**: Calls `initializeGameModule(this, config, gameDispatcher, gameService, logger)` then `gameRegistry.refreshRegistry()`.
- **getGameCode**: `DEFAULTS.GAMES.COINFLIP.GAME_CODE` (`'coinflip'`).
- **getAdditionalGameCodes**: `[]`.

---

## Handler (`coinflip-game.handler.ts`)

- **Implements**: `IGameHandler`.
- **gameCode**: `COINFLIP_CONSTANTS.GAME_CODE` (`'coinflip'`).

**Required methods**

- **handleConnection(context)**  
  Sends balance, betsRanges, betConfig, myData, currencies; initializes fairness seeds. Uses `WalletService`, `UserService`, `CoinFlipGameService.getCurrencies()`, `CoinFlipFairnessService.getOrCreateFairness()`. On error, sends fallback payload (default balance/config).

- **handleDisconnection(context)**  
  Logs disconnect (no session cleanup; session is in Redis with TTL).

- **registerMessageHandlers(context)**  
  Registers:
  - `ping` → `pong`.
  - `gameService` (ACK): routes by `data.action`:
    - `get-game-config` / `GET_GAME_CONFIG`: no-op (handled by `CriticalHandlersService` via `getGameConfigResponse`).
    - `get-game-seeds`: `coinFlipGameService.getGameSeeds`.
    - `set-user-seed`: `coinFlipGameService.setUserSeed`.
    - `bet`: `coinFlipGameService.performBetFlow` → ack → emit `onBalanceChange`.
    - `step`: `coinFlipGameService.performStepFlow` → ack → emit `onBalanceChange` if finished.
    - `withdraw`: `coinFlipGameService.performCashOutFlow` → ack → emit `onBalanceChange`.
    - `get-game-state`: `coinFlipGameService.getGameState`.
    - `get-my-bets-history` / `gameService-get-my-bets-history`: `coinFlipGameService.getMyBetsHistory`.
    - Else: ack `unsupported_action`.

**Optional methods**

- **onGatewayInit(server)**: Stores `server` for future broadcasting (e.g. last-win); currently only stores.
- **getServer()**: Returns stored server.
- **getGameConfigResponse()**: Returns `{ betConfig, coefficients: {}, lastWin }` from `DEFAULTS.GAMES.COINFLIP` for the critical `get-game-config` handler.

---

## Service (`coinflip-game.service.ts`)

- **Dependencies**: `RedisService`, `WalletService`, `BetService` (game-core), `CoinFlipFairnessService`.
- **Responsibilities**: Session (Redis), bet placement (WalletService.placeBet / refund on failure), QUICK/ROUNDS flow, step, cashout, settlement (WalletService.settleBet, BetService.createPlacement/recordSettlement), fairness (getOrCreateFairness, rotateSeeds, generateFairnessDataForBet), getGameState, getGameSeeds, setUserSeed, getMyBetsHistory, getCurrencies.
- **Session key**: `DEFAULTS.GAMES.COINFLIP.REDIS_KEY` + `userId-agentId-gameCode`.
- **Lock**: Redis lock around bet placement to prevent concurrent bets.

---

## Configuration (`defaults.config.ts`)

Under `GAMES_CONFIG.COINFLIP`: `GAME_CODE`, `GAME_NAME`, `PLATFORM`, `GAME_TYPE`, `REDIS_KEY`, `SESSION_TTL`, `MAX_ROUNDS`, `BASE_MULTIPLIER`, `MULTIPLIERS`, `BET_CONFIG`, `BET_RANGES`, `GAME_PAYLOADS`, `GAME`, `LAST_WIN`, `FAIRNESS`, `ERROR_MESSAGES`.

---

## App module registration

In `src/app.module.ts`:

- Import: `CoinFlipGameModule` from `./games/coinflip-game/coinflip-game.module`.
- Add to `imports` **after** `GamesModule` and other game modules: `CoinFlipGameModule`.

---

## Critical handlers

`CriticalHandlersService.registerGetGameConfigHandler` is called by the gateway with the handler’s `getGameConfigResponse`. For CoinFlip, the handler implements `getGameConfigResponse()`, so the critical handler uses that. `getGameConfigByCode('coinflip')` in the same service is used as fallback when no custom response is provided.

---

## Implementation order (reference)

1. Config in `defaults.config.ts` (GAMES_CONFIG.COINFLIP).
2. Constants: `constants/coinflip.constants.ts`.
3. DTOs: `DTO/bet-payload.dto.ts`, `step-payload.dto.ts`, `game-action.dto.ts`.
4. Interfaces: `interfaces/game-session.interface.ts`.
5. Fairness: `modules/fairness/fairness.service.ts`, `fairness.module.ts`.
6. Service: `coinflip-game.service.ts`.
7. Handler: `coinflip-game.handler.ts`.
8. Module: `coinflip-game.module.ts`.
9. App: add `CoinFlipGameModule` to `app.module.ts`.

---

## Key patterns (from architecture)

- **Gateway**: One entry at `/io`; query params `gameMode=coinflip`, `operatorId`, `Authorization` (JWT).
- **Dispatcher**: `GameDispatcherService.getHandler('coinflip')` returns `CoinFlipGameHandler`.
- **Wallet**: `WalletService` (game-core) via `WalletConfigModule`; `GameService` as `WalletApiAdapter` for game payloads.
- **Bets**: `BetService` (game-core) via `BetConfigModule` for createPlacement / recordSettlement / listUserBetsByTimeRange.
- **Sessions**: Redis (session state, fairness, lock); no per-socket session in handler.
- **Events**: Client sends `gameService` with `action` + optional `payload`; server acks and emits `onBalanceChange` when balance changes.
