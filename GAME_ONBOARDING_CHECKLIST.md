# Game Onboarding Checklist

## Prerequisites
- Game code (e.g., `my-new-game`)
- Game name, type, platform, settlement type

---

## Step 1: Create Game Directory Structure
**Location**: `src/games/{game-code}/`

**Significance**: Organizes game files in a dedicated directory.

**Success Indicator**: Directory exists with at minimum:
- `{game-code}.module.ts`
- `{game-code}.handler.ts`
- `{game-code}.service.ts`

---

## Step 2: Create Game Handler
**File**: `{game-code}.handler.ts`

**Significance**: Implements `IGameHandler` - handles WebSocket connections and messages for the game.

**Success Indicator**: 
- Class implements `IGameHandler` interface
- Has `readonly gameCode` property
- Implements required methods: `handleConnection()`, `handleDisconnection()`, `registerMessageHandlers()`
- No TypeScript compilation errors

---

## Step 3: Create Game Service
**File**: `{game-code}.service.ts`

**Significance**: Contains game-specific business logic (game state, calculations, etc.).

**Success Indicator**: 
- Service class is injectable (`@Injectable()`)
- No TypeScript compilation errors
- Can be injected into handler

---

## Step 4: Create Game Module
**File**: `{game-code}.module.ts`

**Significance**: NestJS module that wires everything together and registers the handler.

**Success Indicator**:
- Module implements `IBaseGameModule` and `OnModuleInit`
- Implements required methods: `getHandler()`, `getGameCode()`, `getAdditionalGameCodes()`
- Calls `initializeGameModule()` in `onModuleInit()`
- No TypeScript compilation errors

---

## Step 5: Add Module to AppModule
**File**: `src/app.module.ts`

**Significance**: Registers the game module so NestJS loads it on startup.

**Success Indicator**:
- Module imported in `AppModule` imports array
- Import placed after `GamesModule` (required order)
- Application starts without errors

---

## Step 6: Verify Module Initialization
**Check**: Application startup logs

**Significance**: Confirms game is registered and database entry exists.

**Success Indicator**: Logs show:
```
[{GAME_CODE}_MODULE] Registered handler for primary gameCode: {game-code}
[{GAME_CODE}_MODULE] Game '{game-code}' already exists in database
```
OR
```
[{GAME_CODE}_MODULE] Game '{game-code}' not found, creating...
[{GAME_CODE}_MODULE] ✅ Successfully created game '{game-code}' in database
```

---

## Step 7: Verify Database Entry
**Check**: Query `games` table

**Significance**: Confirms game record exists in database.

**Success Indicator**:
```sql
SELECT * FROM games WHERE gameCode = '{game-code}';
```
Returns one row with:
- `gameCode` matches your game code
- `isActive = true` (or your intended value)
- Other fields populated correctly

---

## Step 8: Verify Config Table (Optional)
**Check**: Query database

**Significance**: Config table stores game-specific settings (bet limits, RTP, etc.). Optional - system works without it using defaults.

**Success Indicator**:
```sql
SHOW TABLES LIKE 'game_config_{normalized_game_code}';
```
Returns table name if created, or system logs show graceful fallback if missing.

---

## Step 9: Test WebSocket Connection
**Test**: Connect via WebSocket client

**Significance**: Verifies game is accessible and handler responds to connections.

**Success Indicator**:
- Connection URL: `wss://{host}/io?gameMode={game-code}&operatorId={operator}&Authorization={token}`
- Connection succeeds (no errors)
- Handler's `handleConnection()` is called
- Initial game data received (if implemented)

---

## Step 10: Test Message Handlers
**Test**: Send WebSocket messages

**Significance**: Verifies game-specific message handlers work correctly.

**Success Indicator**:
- Messages registered in `registerMessageHandlers()` are received
- Handlers process messages and return appropriate responses
- No errors in application logs

---

## Common Issues

**Handler not found**: Module not imported in `AppModule` or import order wrong (must be after `GamesModule`)

**Game not found**: Database entry missing - check Step 6 logs

**Connection fails**: JWT token invalid, game not active, or agent doesn't have access

**Messages not received**: Handlers not registered in `registerMessageHandlers()` method
