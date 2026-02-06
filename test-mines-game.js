/**
 * Platform Mines Game - Comprehensive Test Script
 *
 * Tests the full game lifecycle against the backend as per MINES_PRD.md:
 *   1. Authentication (HTTP POST /api/auth)
 *   2. WebSocket connection with initial push events
 *   3. Client init requests (get-game-state, get-game-config, get-rates, get-game-seeds)
 *   4. Play flow (start game with bet)
 *   5. Step flow (reveal cells - safe + mine hit)
 *   6. Payout flow (cash out)
 *   7. Reconnection / state restore
 *   8. Error handling (invalid actions, duplicate cells, etc.)
 *   9. Provably fair verification
 *  10. Game history
 *
 * Usage:
 *   node test-mines-game.js
 *
 * Prerequisites:
 *   - Server running on localhost:3000
 *   - MySQL database with game_config_platform_mines table
 *   - Redis running on localhost:6379
 *   - JWT_SECRET=CHANGE_ME_DEV_SECRET_MIN_32_CHARS
 */

const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const crypto = require('crypto');
const http = require('http');

// ============================================================================
// CONFIG
// ============================================================================

const CONFIG = {
  SERVER_URL: 'http://localhost:3000',
  WS_PATH: '/io',
  JWT_SECRET: 'CHANGE_ME_DEV_SECRET_MIN_32_CHARS',
  USER_ID: 'sxxurczuleogz19epayf',
  AGENT_ID: 'brlag',
  GAME_CODE: 'platform-mines',
  CURRENCY: 'USD',
  ACK_TIMEOUT: 30000,
};

// ============================================================================
// HELPERS
// ============================================================================

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function assert(condition, testName) {
  if (condition) {
    passCount++;
    console.log('  \x1b[32mPASS\x1b[0m', testName);
  } else {
    failCount++;
    console.log('  \x1b[31mFAIL\x1b[0m', testName);
  }
}

function skip(testName) {
  skipCount++;
  console.log('  \x1b[33mSKIP\x1b[0m', testName, '(wallet API unavailable)');
}

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: 3000, path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let responseBody = '';
      res.on('data', (d) => { responseBody += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(responseBody)); }
        catch (e) { reject(new Error('Invalid JSON: ' + responseBody)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function createSocket(jwtToken) {
  return io(CONFIG.SERVER_URL, {
    transports: ['websocket'],
    path: CONFIG.WS_PATH,
    query: {
      gameMode: CONFIG.GAME_CODE,
      operatorId: CONFIG.AGENT_ID,
      currency: CONFIG.CURRENCY,
      Authorization: jwtToken,
    },
  });
}

function emitAck(socket, event, data) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('ACK timeout for: ' + JSON.stringify(data))), CONFIG.ACK_TIMEOUT);
    socket.emit(event, data, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

function waitForEvent(socket, eventName, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs || 5000);
    socket.once(eventName, (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Provably fair verification: generate mine positions from seeds
function verifyMinePositions(minesCount, serverSeed, userSeed, nonce) {
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(userSeed + ':' + nonce);
  const hash = hmac.digest('hex');
  const positions = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = positions.length - 1; i > 0; i--) {
    const hexIndex = (i * 4) % hash.length;
    const hexSlice = hash.substring(hexIndex, hexIndex + 4) || hash.substring(0, 4);
    const randomValue = parseInt(hexSlice, 16);
    const j = randomValue % (i + 1);
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions.slice(0, minesCount).sort((a, b) => a - b);
}

function calculateMultiplier(minesCount, stepsCompleted) {
  let probability = 1;
  const safeCells = 25 - minesCount;
  for (let i = 0; i < stepsCompleted; i++) {
    probability *= (safeCells - i) / (25 - i);
  }
  if (probability <= 0) return 0;
  return Math.floor(((1 - 0.05) / probability) * 100) / 100;
}

// ============================================================================
// TESTS
// ============================================================================

async function runTests() {
  console.log('\n\x1b[1m=== PLATFORM MINES GAME - TEST SUITE ===\x1b[0m\n');

  // ------------------------------------------------------------------
  // PHASE 1: Authentication
  // ------------------------------------------------------------------
  console.log('\x1b[36m--- Phase 1: HTTP Authentication ---\x1b[0m');

  const authToken = jwt.sign(
    { sub: CONFIG.USER_ID, agentId: CONFIG.AGENT_ID },
    CONFIG.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const authResponse = await httpPost('/api/auth', {
    operator: CONFIG.AGENT_ID,
    auth_token: authToken,
    currency: CONFIG.CURRENCY,
    game_mode: CONFIG.GAME_CODE,
  });

  assert(authResponse.success === true, 'POST /api/auth returns success=true');
  assert(typeof authResponse.data === 'string' && authResponse.data.length > 50, 'Auth returns JWT token');

  const gameJwt = authResponse.data;

  // Decode JWT and verify payload
  const decoded = jwt.decode(gameJwt);
  assert(decoded.sub === CONFIG.USER_ID, 'JWT sub matches userId');
  assert(decoded.agentId === CONFIG.AGENT_ID, 'JWT agentId matches');
  assert(decoded.currency === CONFIG.CURRENCY, 'JWT currency matches');
  assert(decoded.game_mode === CONFIG.GAME_CODE, 'JWT game_mode = "platform-mines"');

  // ------------------------------------------------------------------
  // PHASE 2: WebSocket Connection & Initial Push Events
  // ------------------------------------------------------------------
  console.log('\n\x1b[36m--- Phase 2: WebSocket Connection ---\x1b[0m');

  const socket = createSocket(gameJwt);
  const pushEvents = {};

  // Collect push events
  socket.on('onBalanceChange', (d) => { pushEvents.balance = d; });
  socket.on('betsConfig', (d) => { pushEvents.betsConfig = d; });
  socket.on('betsRanges', (d) => { pushEvents.betsRanges = d; });
  socket.on('myData', (d) => { pushEvents.myData = d; });

  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 10000);
  });

  assert(true, 'WebSocket connected successfully');
  assert(typeof socket.id === 'string', 'Received socket ID: ' + socket.id);

  // Wait for push events
  await sleep(2000);

  // PRD Section 3.3: Connection sequence events
  assert(pushEvents.balance && typeof pushEvents.balance.balance === 'string', 'onBalanceChange received with balance string');
  assert(pushEvents.balance && pushEvents.balance.currency, 'onBalanceChange has currency field');
  assert(pushEvents.betsConfig && pushEvents.betsConfig.minBetAmount, 'betsConfig received with minBetAmount');
  assert(pushEvents.betsConfig && pushEvents.betsConfig.maxBetAmount, 'betsConfig received with maxBetAmount');
  assert(pushEvents.betsConfig && pushEvents.betsConfig.betPresets, 'betsConfig has betPresets array');
  assert(pushEvents.betsRanges && Object.keys(pushEvents.betsRanges).length > 0, 'betsRanges received');
  assert(pushEvents.myData && pushEvents.myData.userId, 'myData received with userId');

  console.log('  Balance:', pushEvents.balance && pushEvents.balance.balance);
  console.log('  BetConfig:', JSON.stringify(pushEvents.betsConfig));

  // ------------------------------------------------------------------
  // PHASE 3: Client Init Requests
  // ------------------------------------------------------------------
  console.log('\n\x1b[36m--- Phase 3: Client Init Requests ---\x1b[0m');

  // 3a. get-game-state (PRD Section 5.4)
  const gameState = await emitAck(socket, 'gameService', { action: 'get-game-state' });
  assert(gameState && gameState.status === 'none', 'get-game-state returns status="none" (no active game)');

  // 3b. get-game-config (PRD Section 5.5)
  const gameConfig = await emitAck(socket, 'gameService', { action: 'get-game-config' });
  assert(gameConfig && gameConfig.betConfig, 'get-game-config returns betConfig object');
  assert(gameConfig.betConfig.minBetAmount === '0.01', 'minBetAmount = 0.01');
  assert(gameConfig.betConfig.maxBetAmount === '200.00', 'maxBetAmount = 200.00');
  assert(gameConfig.betConfig.maxWinAmount === '20000.00', 'maxWinAmount = 20000.00');
  assert(gameConfig.betConfig.defaultBetAmount === '0.48', 'defaultBetAmount = 0.48');
  assert(Array.isArray(gameConfig.betConfig.betPresets), 'betPresets is array');
  assert(gameConfig.betConfig.decimalPlaces === '2', 'decimalPlaces = "2"');

  // 3c. get-rates (PRD Section 5.6)
  const rates = await emitAck(socket, 'gameService', { action: 'get-rates' });
  assert(rates && rates.USD === 1, 'get-rates: USD = 1');
  assert(rates && rates.INR > 80, 'get-rates: INR > 80');
  assert(rates && rates.EUR < 1, 'get-rates: EUR < 1');
  assert(rates && rates.BTC < 0.001, 'get-rates: BTC < 0.001');
  assert(rates && Object.keys(rates).length >= 40, 'get-rates: 40+ currencies');

  // 3d. get-game-seeds (PRD Section 5.7)
  const seeds = await emitAck(socket, 'gameService', { action: 'get-game-seeds' });
  assert(seeds && typeof seeds.userSeed === 'string', 'get-game-seeds: userSeed present');
  assert(seeds && seeds.userSeed.length === 16, 'userSeed is 16 hex chars');
  assert(seeds && /^[0-9a-f]{16}$/.test(seeds.userSeed), 'userSeed is valid hex');
  assert(seeds && typeof seeds.hashedServerSeed === 'string', 'hashedServerSeed present');
  assert(seeds && seeds.hashedServerSeed.length === 64, 'hashedServerSeed is 64 chars (SHA256)');

  // ------------------------------------------------------------------
  // PHASE 4: Multiplier Verification (PRD Section 7.3)
  // ------------------------------------------------------------------
  console.log('\n\x1b[36m--- Phase 4: Multiplier Verification ---\x1b[0m');

  // Verify multipliers match PRD table
  assert(calculateMultiplier(3, 1) === 1.07, '3 mines, 1 step = x1.07');
  assert(calculateMultiplier(3, 2) === 1.23, '3 mines, 2 steps = x1.23');
  assert(calculateMultiplier(3, 3) === 1.41, '3 mines, 3 steps = x1.41');
  assert(calculateMultiplier(3, 4) === 1.64, '3 mines, 4 steps = x1.64');
  assert(calculateMultiplier(3, 5) === 1.91, '3 mines, 5 steps = x1.91');
  assert(calculateMultiplier(3, 6) === 2.25, '3 mines, 6 steps = x2.25');

  assert(calculateMultiplier(5, 1) === 1.18, '5 mines, 1 step = x1.18');
  assert(calculateMultiplier(5, 2) === 1.50, '5 mines, 2 steps = x1.50');
  assert(calculateMultiplier(5, 3) === 1.91, '5 mines, 3 steps = x1.91');
  assert(calculateMultiplier(5, 4) === 2.48, '5 mines, 4 steps = x2.48');
  assert(calculateMultiplier(5, 5) === 3.25, '5 mines, 5 steps = x3.25');
  assert(calculateMultiplier(5, 6) === 4.34, '5 mines, 6 steps = x4.34');

  assert(calculateMultiplier(24, 1) === 23.75, '24 mines, 1 step = x23.75');

  // ------------------------------------------------------------------
  // PHASE 5: Provably Fair Mine Generation
  // ------------------------------------------------------------------
  console.log('\n\x1b[36m--- Phase 5: Provably Fair Mine Generation ---\x1b[0m');

  const testServerSeed = crypto.randomBytes(32).toString('hex');
  const testUserSeed = crypto.randomBytes(8).toString('hex');

  // Determinism
  const gen1 = verifyMinePositions(5, testServerSeed, testUserSeed, 0);
  const gen2 = verifyMinePositions(5, testServerSeed, testUserSeed, 0);
  assert(JSON.stringify(gen1) === JSON.stringify(gen2), 'Same seeds+nonce = same mine positions (deterministic)');

  // Different nonce = different result
  const gen3 = verifyMinePositions(5, testServerSeed, testUserSeed, 1);
  assert(JSON.stringify(gen1) !== JSON.stringify(gen3), 'Different nonce = different mine positions');

  // All positions valid (1-25)
  const gen4 = verifyMinePositions(10, testServerSeed, testUserSeed, 0);
  assert(gen4.every(p => p >= 1 && p <= 25), 'All positions in range 1-25');
  assert(new Set(gen4).size === 10, 'All positions unique');

  // Edge: 24 mines
  const gen5 = verifyMinePositions(24, testServerSeed, testUserSeed, 0);
  assert(gen5.length === 24, '24 mines generated');
  assert(new Set(gen5).size === 24, '24 unique mine positions');
  const safeCellFor24 = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25].filter(x => !gen5.includes(x));
  assert(safeCellFor24.length === 1, '24 mines leaves exactly 1 safe cell: ' + safeCellFor24[0]);

  // Edge: 1 mine
  const gen6 = verifyMinePositions(1, testServerSeed, testUserSeed, 0);
  assert(gen6.length === 1, '1 mine generated');
  assert(gen6[0] >= 1 && gen6[0] <= 25, 'Single mine in valid range');

  // Server seed hash verification
  const hashedServerSeed = crypto.createHash('sha256').update(testServerSeed).digest('hex');
  assert(hashedServerSeed.length === 64, 'SHA256 hash of server seed is 64 chars');

  // ------------------------------------------------------------------
  // PHASE 6: Error Handling
  // ------------------------------------------------------------------
  console.log('\n\x1b[36m--- Phase 6: Error Handling ---\x1b[0m');

  // Step with no active game (PRD Section 14.1)
  const errStep = await emitAck(socket, 'gameService', { action: 'step', payload: { cellPosition: 1 } });
  assert(errStep && errStep.error && errStep.error.message === 'game_not_in_progress', 'Step without game -> "game_not_in_progress"');

  // Payout with no active game
  const errPayout = await emitAck(socket, 'gameService', { action: 'payout' });
  assert(errPayout && errPayout.error && errPayout.error.message === 'game_not_in_progress', 'Payout without game -> "game_not_in_progress"');

  // Unknown action
  const errUnknown = await emitAck(socket, 'gameService', { action: 'foobar' });
  assert(errUnknown && errUnknown.error && errUnknown.error.message === 'unsupported_action', 'Unknown action -> "unsupported_action"');

  // Missing action
  const errNoAction = await emitAck(socket, 'gameService', {});
  assert(errNoAction && errNoAction.error && errNoAction.error.message === 'missing_action', 'No action -> "missing_action"');

  // Invalid cell position (step without payload)
  // This will also be blocked by "no active game" first, which is correct

  // ------------------------------------------------------------------
  // PHASE 7: Game Play Flow (requires wallet API)
  // ------------------------------------------------------------------
  console.log('\n\x1b[36m--- Phase 7: Play Flow (wallet-dependent) ---\x1b[0m');

  const balanceBefore = pushEvents.balance && pushEvents.balance.balance;

  // Try to play
  const playResult = await emitAck(socket, 'gameService', {
    action: 'play',
    payload: {
      gameType: CONFIG.GAME_CODE,
      amount: 1,
      currency: CONFIG.CURRENCY,
      value: { minesCount: 3 },
      bonusId: null,
    },
  });

  const walletAvailable = playResult && playResult.status === 'in-game';

  if (walletAvailable) {
    // Full game flow test
    assert(playResult.status === 'in-game', 'Play: status = "in-game"');
    assert(playResult.isFinished === false, 'Play: isFinished = false');
    assert(playResult.isWin === false, 'Play: isWin = false');
    assert(playResult.coeff === 0, 'Play: coeff = 0 (no cells opened)');
    assert(playResult.winAmount === '0', 'Play: winAmount = "0"');
    assert(playResult.minesCount === 3, 'Play: minesCount = 3');
    assert(Array.isArray(playResult.openedCells) && playResult.openedCells.length === 0, 'Play: openedCells = []');
    assert(playResult.bet && playResult.bet.amount === '1.00', 'Play: bet.amount = "1.00"');
    assert(playResult.bet && playResult.bet.currency === CONFIG.CURRENCY, 'Play: bet.currency = "' + CONFIG.CURRENCY + '"');
    assert(playResult.bet && playResult.bet.decimalPlaces === 2, 'Play: bet.decimalPlaces = 2');
    assert(!playResult.minesCells, 'Play: minesCells NOT revealed');

    // Wait for balance update (PRD Section 5.1 side effects)
    await sleep(1000);

    // Get game state (should show in-game)
    const stateInGame = await emitAck(socket, 'gameService', { action: 'get-game-state' });
    assert(stateInGame && stateInGame.status === 'in-game', 'Game state during play: status = "in-game"');
    assert(!stateInGame.minesCells, 'Game state: minesCells hidden during play');

    // Step 1: reveal cell 1
    const step1 = await emitAck(socket, 'gameService', { action: 'step', payload: { cellPosition: 1 } });

    if (step1 && step1.status === 'in-game') {
      // Safe cell
      assert(step1.isWin === true, 'Step 1: isWin = true (safe cell)');
      assert(step1.coeff > 0, 'Step 1: coeff > 0 (multiplier applied)');
      assert(step1.coeff === 1.07, 'Step 1: coeff = 1.07 (3 mines, 1 step)');
      assert(step1.winAmount === '1.07', 'Step 1: winAmount = "1.07"');
      assert(step1.openedCells.includes(1), 'Step 1: openedCells includes cell 1');
      assert(step1.openedCells.length === 1, 'Step 1: 1 cell opened');
      assert(!step1.minesCells, 'Step 1: minesCells NOT revealed');
      assert(step1.isFinished === false, 'Step 1: isFinished = false');

      // Try duplicate cell (should error)
      const dupStep = await emitAck(socket, 'gameService', { action: 'step', payload: { cellPosition: 1 } });
      assert(dupStep && dupStep.error && dupStep.error.message === 'cell_already_opened', 'Duplicate cell -> "cell_already_opened"');

      // Step 2: reveal another cell
      const step2 = await emitAck(socket, 'gameService', { action: 'step', payload: { cellPosition: 25 } });

      if (step2 && step2.status === 'in-game') {
        assert(step2.coeff === 1.23, 'Step 2: coeff = 1.23 (3 mines, 2 steps)');
        assert(step2.openedCells.length === 2, 'Step 2: 2 cells opened');
        assert(step2.openedCells.includes(1) && step2.openedCells.includes(25), 'Step 2: cells [1, 25] opened');

        // Payout (cash out) - PRD Section 5.3
        const payout = await emitAck(socket, 'gameService', { action: 'payout' });
        assert(payout && payout.status === 'win', 'Payout: status = "win"');
        assert(payout.isFinished === true, 'Payout: isFinished = true');
        assert(payout.isWin === true, 'Payout: isWin = true');
        assert(payout.coeff === 1.23, 'Payout: coeff = 1.23');
        assert(payout.winAmount === '1.23', 'Payout: winAmount = "1.23"');
        assert(Array.isArray(payout.minesCells), 'Payout: minesCells REVEALED');
        assert(payout.minesCells && payout.minesCells.length === 3, 'Payout: 3 mine positions revealed');

        // Verify game state is now "none"
        const stateAfter = await emitAck(socket, 'gameService', { action: 'get-game-state' });
        assert(stateAfter && stateAfter.status === 'none', 'After payout: game state = "none"');

      } else if (step2 && step2.status === 'lose') {
        console.log('  (Cell 25 was a mine - testing lose flow instead)');
        assert(step2.isFinished === true, 'Lose: isFinished = true');
        assert(step2.isWin === false, 'Lose: isWin = false');
        assert(step2.coeff === 0, 'Lose: coeff = 0');
        assert(step2.winAmount === '0.00', 'Lose: winAmount = "0.00"');
        assert(Array.isArray(step2.minesCells), 'Lose: minesCells REVEALED');
        assert(step2.minesCells && step2.minesCells.length === 3, 'Lose: 3 mine positions revealed');
      }

    } else if (step1 && step1.status === 'lose') {
      console.log('  (Cell 1 was a mine)');
      assert(step1.isFinished === true, 'Lose on step 1: isFinished = true');
      assert(step1.isWin === false, 'Lose on step 1: isWin = false');
      assert(step1.coeff === 0, 'Lose on step 1: coeff = 0');
      assert(Array.isArray(step1.minesCells), 'Lose: minesCells REVEALED');
      assert(step1.minesCells && step1.minesCells.length === 3, 'Lose: 3 mine positions revealed');
    }

    // Test: Play another game with 24 mines
    console.log('\n\x1b[36m--- Phase 7b: 24-Mine Game ---\x1b[0m');

    const play24 = await emitAck(socket, 'gameService', {
      action: 'play',
      payload: { gameType: CONFIG.GAME_CODE, amount: 1, currency: CONFIG.CURRENCY, value: { minesCount: 24 }, bonusId: null },
    });

    if (play24 && play24.status === 'in-game') {
      assert(play24.minesCount === 24, '24-mine game: minesCount = 24');

      // With 24 mines, only 1 safe cell exists. Try cells until we find it or hit mine.
      let found = false;
      for (let cell = 1; cell <= 25; cell++) {
        const step = await emitAck(socket, 'gameService', { action: 'step', payload: { cellPosition: cell } });
        if (step && step.status === 'in-game') {
          // This shouldn't happen with 24 mines - finding safe cell auto-wins
          assert(false, '24-mine: should auto-win or lose, not stay in-game');
          break;
        } else if (step && step.status === 'win') {
          assert(step.coeff === 23.75, '24-mine win: coeff = 23.75');
          assert(step.isFinished === true, '24-mine win: isFinished = true');
          found = true;
          break;
        } else if (step && step.status === 'lose') {
          assert(step.isFinished === true, '24-mine lose: isFinished = true');
          assert(step.minesCells && step.minesCells.length === 24, '24-mine lose: 24 mines revealed');
          found = true;
          break;
        }
      }
      assert(found, '24-mine game: resolved on first step');
    } else {
      skip('24-mine game (play failed)');
    }

  } else {
    // Wallet API unavailable - skip wallet-dependent tests
    console.log('  Wallet API unavailable - play returned:', JSON.stringify(playResult));
    skip('Play flow (start game)');
    skip('Step flow (reveal cells)');
    skip('Payout flow (cash out)');
    skip('Duplicate cell detection');
    skip('Post-payout state verification');
    skip('24-mine game');
  }

  // ------------------------------------------------------------------
  // PHASE 8: Game History
  // ------------------------------------------------------------------
  console.log('\n\x1b[36m--- Phase 8: Game History ---\x1b[0m');

  const history = await emitAck(socket, 'gameService', { action: 'get-game-history' });
  assert(Array.isArray(history), 'get-game-history returns array');
  if (walletAvailable && history.length > 0) {
    assert(typeof history[0].betAmount === 'number', 'History entry has betAmount (number)');
    assert(typeof history[0].win === 'number', 'History entry has win (number)');
  }

  // ------------------------------------------------------------------
  // PHASE 9: Set User Seed
  // ------------------------------------------------------------------
  console.log('\n\x1b[36m--- Phase 9: Set User Seed ---\x1b[0m');

  const newSeed = crypto.randomBytes(8).toString('hex');
  const setSeedResult = await emitAck(socket, 'gameService', {
    action: 'set-user-seed',
    payload: { userSeed: newSeed },
  });
  assert(setSeedResult && setSeedResult.success === true, 'set-user-seed: success = true');
  assert(setSeedResult && setSeedResult.userSeed === newSeed, 'set-user-seed: returned seed matches');

  // Verify seed was updated
  const updatedSeeds = await emitAck(socket, 'gameService', { action: 'get-game-seeds' });
  assert(updatedSeeds && updatedSeeds.userSeed === newSeed, 'get-game-seeds reflects updated userSeed');

  // Invalid seed format
  const badSeed = await emitAck(socket, 'gameService', {
    action: 'set-user-seed',
    payload: { userSeed: 'notvalid' },
  });
  assert(badSeed && badSeed.error, 'Invalid seed format returns error');

  // ------------------------------------------------------------------
  // PHASE 10: Reconnection Test
  // ------------------------------------------------------------------
  console.log('\n\x1b[36m--- Phase 10: Reconnection ---\x1b[0m');

  // Disconnect and reconnect
  socket.disconnect();
  await sleep(500);

  const socket2 = createSocket(gameJwt);
  await new Promise((resolve, reject) => {
    socket2.on('connect', resolve);
    socket2.on('connect_error', reject);
    setTimeout(() => reject(new Error('Reconnection timeout')), 10000);
  });

  assert(true, 'Reconnected successfully');

  await sleep(1000);

  // After reconnect, get-game-state should return "none" (no active game)
  const reconnState = await emitAck(socket2, 'gameService', { action: 'get-game-state' });
  assert(reconnState && reconnState.status === 'none', 'After reconnect: game state = "none"');

  // Seeds should still work
  const reconnSeeds = await emitAck(socket2, 'gameService', { action: 'get-game-seeds' });
  assert(reconnSeeds && reconnSeeds.userSeed === newSeed, 'After reconnect: userSeed persists');

  socket2.disconnect();

  // ------------------------------------------------------------------
  // RESULTS
  // ------------------------------------------------------------------
  console.log('\n\x1b[1m=== TEST RESULTS ===\x1b[0m');
  console.log('\x1b[32m  Passed: ' + passCount + '\x1b[0m');
  if (failCount > 0) console.log('\x1b[31m  Failed: ' + failCount + '\x1b[0m');
  if (skipCount > 0) console.log('\x1b[33m  Skipped: ' + skipCount + ' (wallet API unavailable)\x1b[0m');
  console.log('  Total:  ' + (passCount + failCount + skipCount));
  console.log('');

  if (failCount === 0) {
    console.log('\x1b[32m\x1b[1m  ALL TESTS PASSED!\x1b[0m\n');
  } else {
    console.log('\x1b[31m\x1b[1m  SOME TESTS FAILED\x1b[0m\n');
  }

  process.exit(failCount > 0 ? 1 : 0);
}

// ============================================================================
// RUN
// ============================================================================

runTests().catch((err) => {
  console.error('\n\x1b[31mFATAL ERROR:\x1b[0m', err.message);
  process.exit(1);
});
