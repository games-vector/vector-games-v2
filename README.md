# Vector Games V2

NestJS backend for the Vector Games platform: multi-game WebSocket gateway with unified routing, wallet, and game handlers.

## Features

- **Single WebSocket gateway** – All games connect at `/io`; routing by `gameMode` / `gameCode`
- **Game dispatcher** – Maps game codes to handlers (Sugar Daddy, Diver, Chicken Road, etc.)
- **Shared services** – JWT, wallet, user, agents, Redis, MySQL
- **REST API** – Auth, games CRUD, online counter, health

See [ARCHITECTURE_AND_ONBOARDING.md](./ARCHITECTURE_AND_ONBOARDING.md) for architecture and how to onboard new games.

---

## Development

### Prerequisites

- Node.js 18+
- npm (or pnpm/yarn)
- MySQL 8 and Redis 7 (or use Docker below)
- **`@games-vector/game-core`** – must be available:
  - From GitHub Packages: set `GITHUB_TOKEN` or `.npmrc` auth for `npm.pkg.github.com`
  - Or install from a local tarball: `npm install ./path/to/game-core.tgz --legacy-peer-deps`

### Quick start

1. **Clone and install**

   ```bash
   git clone <repo-url>
   cd vector-games-v2
   npm install
   ```

   If install fails due to peer dependency conflicts with `@games-vector/game-core`, run:

   ```bash
   npm install --legacy-peer-deps
   ```

2. **Environment**

   ```bash
   cp .env.example .env
   # Edit .env: set DB_*, REDIS_*, JWT_SECRET, etc.
   ```

3. **Database and Redis (optional – Docker)**

   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

   Then in `.env` use:

   - `DB_HOST=localhost` `DB_PORT=3306` `DB_USERNAME=root` `DB_PASSWORD=dev` `DB_DATABASE=vectorgames`
   - `REDIS_HOST=localhost` `REDIS_PORT=6379` `REDIS_PASSWORD=`

4. **Run the app**

   ```bash
   npm run start:dev
   ```

   - API: http://localhost:3000  
   - Swagger: http://localhost:3000/api  
   - Health: http://localhost:3000/health  
   - WebSocket path: `/io` (query: `gameMode`, `operatorId`, `Authorization`)

### Scripts

| Script           | Description                          |
|------------------|--------------------------------------|
| `npm run start`  | Start once                           |
| `npm run start:dev` | Start with watch (recommended for dev) |
| `npm run start:debug` | Start with debug + watch          |
| `npm run build`  | Build to `dist/`                     |
| `npm run lint`   | ESLint with fix                      |
| `npm run format` | Prettier on `src` and `test`         |
| `npm run test`   | Unit tests (Jest)                    |
| `npm run test:e2e` | E2E tests (requires DB + Redis)   |
| `npm run socket:client` | Dev WebSocket client (set `AUTH_TOKEN`, see script) |

### E2E tests

E2E tests need the app’s DB and Redis (e.g. start them via `docker-compose.dev.yml` and ensure `.env` is set). Then:

```bash
npm run test:e2e
```

### WebSocket dev client

```bash
# Get a JWT first (e.g. from POST /api/auth), then:
BASE_URL=http://localhost:3000 GAME_MODE=sugar-daddy OPERATOR_ID=op1 AUTH_TOKEN=<jwt> npm run socket:client
```

---

## Configuration

- **App:** `APP_PORT`, `APP_ENV`, `ENABLE_AUTH`
- **Database:** `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`, `DB_SYNCHRONIZE`
- **Redis:** `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- **JWT:** `JWT_SECRET`, `JWT_EXPIRES_IN`

See `.env.example` and `src/config/*.config.ts` for details.

---

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) and [DEPLOYMENT_STEPS.md](./DEPLOYMENT_STEPS.md).
