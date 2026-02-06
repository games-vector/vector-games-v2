import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { BetService } from '@games-vector/game-core';
import { PlayPayloadDto } from './DTO/play-payload.dto';
import { FairnessService } from '../chicken-road-game/modules/fairness/fairness.service';
import { GameConfigService } from '../../modules/game-config/game-config.service';
import { RedisService } from '../../modules/redis/redis.service';
import { GameService } from '../../modules/games/game.service';
import { WalletService } from '@games-vector/game-core';
import { DEFAULTS } from '../../config/defaults.config';

// ============================================================================
// INTERFACES
// ============================================================================

interface MinesGameSession {
  userId: string;
  agentId: string;
  currency: string;
  minesCount: number;
  minePositions: number[]; // 1-indexed positions of mines (hidden from client)
  openedCells: number[];   // 1-indexed positions of opened safe cells
  status: 'none' | 'in-game' | 'lose' | 'win';
  betAmount: number;
  coeff: number;           // current multiplier
  winAmount: number;       // current potential payout (betAmount * coeff)
  isFinished: boolean;
  isWin: boolean;
  serverSeed?: string;
  userSeed?: string;
  hashedServerSeed?: string;
  nonce?: number;
  platformBetTxId: string;
  roundId: string;
  gameCode: string;
  createdAt: Date;
}

export interface MinesGameResponse {
  status: 'none' | 'in-game' | 'lose' | 'win';
  bet?: {
    amount: string;
    currency: string;
    decimalPlaces: number;
  };
  isFinished: boolean;
  isWin: boolean;
  coeff: number;
  winAmount: string;
  minesCount: number;
  openedCells: number[];
  minesCells?: number[];  // only revealed at game end
}

// ============================================================================
// CONSTANTS
// ============================================================================

const GRID_SIZE = 25;
const DECIMAL_PLACES = 2;
const HOUSE_EDGE = 0.05; // 5% house edge

const ERROR_MESSAGES = {
  ...DEFAULTS.PLATFORM.ERROR_MESSAGES,
  INVALID_MINES_COUNT: 'invalid_mines_count',
  INVALID_CELL_POSITION: 'invalid_cell_position',
  CELL_ALREADY_OPENED: 'cell_already_opened',
  GAME_NOT_IN_PROGRESS: 'game_not_in_progress',
  NO_CELLS_OPENED: 'no_cells_opened',
  INSUFFICIENT_BALANCE: 'insufficient_balance',
};

// ============================================================================
// SERVICE
// ============================================================================

@Injectable()
export class PlatformMinesService {
  private readonly logger = new Logger(PlatformMinesService.name);

  constructor(
    private readonly gameConfigService: GameConfigService,
    private readonly redisService: RedisService,
    private readonly walletService: WalletService,
    private readonly betService: BetService,
    private readonly fairnessService: FairnessService,
    private readonly gameService: GameService,
  ) {}

  // ============================================================================
  // PLAY (Start Game / Place Bet)
  // ============================================================================

  async performPlayFlow(
    userId: string,
    agentId: string,
    gameCode: string,
    incoming: any,
  ): Promise<MinesGameResponse | { error: string; details?: any[] }> {
    // Acquire distributed lock
    const lockKey = `bet-lock:${userId}-${agentId}`;
    const lockAcquired = await this.redisService.acquireLock(lockKey, 30);

    if (!lockAcquired) {
      this.logger.warn(`Concurrent bet attempt blocked: user=${userId}`);
      return { error: ERROR_MESSAGES.ACTIVE_SESSION_EXISTS };
    }

    try {
      // Check for existing active session
      const redisKey = this.getRedisKey(userId, agentId, gameCode);
      const existingSession = await this.redisService.get<MinesGameSession>(redisKey);

      if (existingSession && existingSession.status === 'in-game') {
        this.logger.warn(`User ${userId} has active mines session`);
        return { error: ERROR_MESSAGES.ACTIVE_SESSION_EXISTS };
      }

      // Validate payload
      const dto = plainToInstance(PlayPayloadDto, incoming);
      const errors = await validate(dto, { whitelist: true });
      if (errors.length) {
        return {
          error: ERROR_MESSAGES.VALIDATION_FAILED,
          details: errors.map((e) => Object.values(e.constraints || {})),
        };
      }

      const betAmount = dto.amount;
      if (!isFinite(betAmount) || betAmount <= 0) {
        return { error: ERROR_MESSAGES.INVALID_BET_AMOUNT };
      }

      const minesCount = dto.value.minesCount;
      if (minesCount < 1 || minesCount > 24) {
        return { error: ERROR_MESSAGES.INVALID_MINES_COUNT };
      }

      const currency = dto.currency.toUpperCase();
      const betAmountStr = betAmount.toFixed(DECIMAL_PLACES);
      const roundId = `${userId}${Date.now()}`;
      const platformTxId = uuidv4();

      // Idempotency check
      const idempotencyKey = this.redisService.generateIdempotencyKey(
        gameCode, userId, agentId, roundId, betAmountStr,
      );
      const idempotencyCheck = await this.redisService.checkIdempotencyKey<{
        platformTxId: string;
        response: MinesGameResponse;
      }>(idempotencyKey);

      if (idempotencyCheck.exists && idempotencyCheck.data) {
        this.logger.log(`[IDEMPOTENCY] Duplicate play request: user=${userId} roundId=${roundId}`);
        return idempotencyCheck.data.response;
      }

      this.logger.log(
        `[PLAY] user=${userId} agent=${agentId} amount=${betAmountStr} currency=${currency} mines=${minesCount} roundId=${roundId}`,
      );

      // Place bet via wallet
      const agentResult = await this.walletService.placeBet({
        agentId, userId,
        amount: betAmount,
        roundId, platformTxId,
        currency, gameCode,
      });

      if (agentResult.status !== '0000') {
        this.logger.error(`Agent rejected bet: user=${userId} status=${agentResult.status}`);
        return { error: ERROR_MESSAGES.AGENT_REJECTED };
      }

      const { balance, balanceTs } = agentResult;

      // Create bet record in DB
      try {
        await this.betService.createPlacement({
          externalPlatformTxId: platformTxId,
          userId, roundId,
          gameMetadata: { minesCount },
          betAmount: betAmountStr,
          currency, gameCode,
          isPremium: false,
          betPlacedAt: balanceTs ? new Date(balanceTs) : undefined,
          balanceAfterBet: balance ? String(balance) : undefined,
          createdBy: userId,
          operatorId: agentId,
        });
      } catch (dbError) {
        this.logger.error(`[COMPENSATING_TX] DB write failed: user=${userId} txId=${platformTxId}`, (dbError as Error).stack);
        try {
          await this.walletService.refundBet({
            agentId, userId,
            refundTransactions: [{
              platformTxId,
              refundPlatformTxId: platformTxId,
              betAmount, winAmount: 0, turnover: 0,
              betTime: balanceTs ? new Date(balanceTs).toISOString() : new Date().toISOString(),
              updateTime: new Date().toISOString(),
              roundId, gameCode,
            }],
          });
        } catch (refundError) {
          this.logger.error(`[COMPENSATING_TX] CRITICAL: Refund failed: user=${userId} txId=${platformTxId}`, (refundError as Error).stack);
        }
        return { error: 'Bet placement failed. Your balance has been refunded.' };
      }

      // Get fairness seeds
      const fairnessData = await this.fairnessService.getOrCreateFairness(userId, agentId);

      // Generate mine positions using provably fair algorithm
      const minePositions = this.generateMinePositions(
        minesCount, fairnessData.serverSeed, fairnessData.userSeed, fairnessData.nonce,
      );

      // Create game session
      const session: MinesGameSession = {
        userId, agentId, currency, minesCount,
        minePositions,
        openedCells: [],
        status: 'in-game',
        betAmount, coeff: 0,
        winAmount: 0,
        isFinished: false, isWin: false,
        serverSeed: fairnessData.serverSeed,
        userSeed: fairnessData.userSeed,
        hashedServerSeed: fairnessData.hashedServerSeed,
        nonce: fairnessData.nonce,
        platformBetTxId: platformTxId,
        roundId, gameCode,
        createdAt: new Date(),
      };

      const sessionTTL = await this.redisService.getSessionTTL(gameCode);
      await this.redisService.set(redisKey, session, sessionTTL);

      const resp: MinesGameResponse = {
        status: 'in-game',
        bet: { amount: betAmountStr, currency, decimalPlaces: DECIMAL_PLACES },
        isFinished: false,
        isWin: false,
        coeff: 0,
        winAmount: '0',
        minesCount,
        openedCells: [],
      };

      // Store idempotency
      await this.redisService.setIdempotencyKey(idempotencyKey, {
        platformTxId, response: resp, timestamp: Date.now(),
      });

      return resp;
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  // ============================================================================
  // STEP (Reveal a Cell)
  // ============================================================================

  async performStepFlow(
    userId: string,
    agentId: string,
    gameCode: string,
    cellPosition: number,
  ): Promise<MinesGameResponse | { error: string }> {
    const redisKey = this.getRedisKey(userId, agentId, gameCode);
    const session = await this.redisService.get<MinesGameSession>(redisKey);

    if (!session || session.status !== 'in-game') {
      return { error: ERROR_MESSAGES.GAME_NOT_IN_PROGRESS };
    }

    // Validate cell position
    if (cellPosition < 1 || cellPosition > GRID_SIZE) {
      return { error: ERROR_MESSAGES.INVALID_CELL_POSITION };
    }

    // Check if cell already opened
    if (session.openedCells.includes(cellPosition)) {
      return { error: ERROR_MESSAGES.CELL_ALREADY_OPENED };
    }

    // Check if cell is a mine
    const hitMine = session.minePositions.includes(cellPosition);

    if (hitMine) {
      // LOSE
      session.status = 'lose';
      session.isFinished = true;
      session.isWin = false;
      session.coeff = 0;
      session.winAmount = 0;
      session.openedCells.push(cellPosition);

      this.logger.log(
        `[STEP_LOSE] user=${userId} cell=${cellPosition} mines=${session.minesCount}`,
      );

      // Settle bet with 0 winnings
      await this.settleGame(session, 0);

      // Delete session
      try { await this.redisService.del(redisKey); } catch {}

      return {
        status: 'lose',
        bet: {
          amount: session.betAmount.toFixed(DECIMAL_PLACES),
          currency: session.currency,
          decimalPlaces: DECIMAL_PLACES,
        },
        isFinished: true,
        isWin: false,
        coeff: 0,
        winAmount: '0.00',
        minesCount: session.minesCount,
        openedCells: session.openedCells,
        minesCells: session.minePositions, // reveal mines on loss
      };
    }

    // SAFE - star found
    session.openedCells.push(cellPosition);
    const safeCount = GRID_SIZE - session.minesCount;
    const stepsCompleted = session.openedCells.length;

    // Calculate multiplier
    session.coeff = this.calculateMultiplier(session.minesCount, stepsCompleted);
    session.winAmount = session.betAmount * session.coeff;
    session.isWin = true;

    this.logger.log(
      `[STEP_SAFE] user=${userId} cell=${cellPosition} step=${stepsCompleted} coeff=${session.coeff} winAmount=${session.winAmount.toFixed(DECIMAL_PLACES)}`,
    );

    // Check if all safe cells revealed (auto-win)
    if (stepsCompleted >= safeCount) {
      session.status = 'win';
      session.isFinished = true;

      this.logger.log(`[AUTO_WIN] user=${userId} all safe cells revealed`);

      // Settle bet with full winnings
      await this.settleGame(session, session.winAmount);

      try { await this.redisService.del(redisKey); } catch {}

      return {
        status: 'win',
        bet: {
          amount: session.betAmount.toFixed(DECIMAL_PLACES),
          currency: session.currency,
          decimalPlaces: DECIMAL_PLACES,
        },
        isFinished: true,
        isWin: true,
        coeff: session.coeff,
        winAmount: session.winAmount.toFixed(DECIMAL_PLACES),
        minesCount: session.minesCount,
        openedCells: session.openedCells,
        minesCells: session.minePositions, // reveal mines on auto-win
      };
    }

    // Game continues
    const sessionTTL = await this.redisService.getSessionTTL(gameCode);
    await this.redisService.set(redisKey, session, sessionTTL);

    return {
      status: 'in-game',
      bet: {
        amount: session.betAmount.toFixed(DECIMAL_PLACES),
        currency: session.currency,
        decimalPlaces: DECIMAL_PLACES,
      },
      isFinished: false,
      isWin: true,
      coeff: session.coeff,
      winAmount: session.winAmount.toFixed(DECIMAL_PLACES),
      minesCount: session.minesCount,
      openedCells: session.openedCells,
      // minesCells NOT sent during active game
    };
  }

  // ============================================================================
  // PAYOUT (Cash Out)
  // ============================================================================

  async performPayoutFlow(
    userId: string,
    agentId: string,
    gameCode: string,
  ): Promise<MinesGameResponse | { error: string }> {
    const redisKey = this.getRedisKey(userId, agentId, gameCode);
    const session = await this.redisService.get<MinesGameSession>(redisKey);

    if (!session || session.status !== 'in-game') {
      return { error: ERROR_MESSAGES.GAME_NOT_IN_PROGRESS };
    }

    // Must have opened at least one cell
    if (session.openedCells.length === 0) {
      return { error: ERROR_MESSAGES.NO_CELLS_OPENED };
    }

    session.status = 'win';
    session.isFinished = true;
    session.isWin = true;

    this.logger.log(
      `[PAYOUT] user=${userId} coeff=${session.coeff} winAmount=${session.winAmount.toFixed(DECIMAL_PLACES)} cells=${session.openedCells.length}`,
    );

    // Settle bet
    await this.settleGame(session, session.winAmount);

    // Delete session
    try { await this.redisService.del(redisKey); } catch {}

    return {
      status: 'win',
      bet: {
        amount: session.betAmount.toFixed(DECIMAL_PLACES),
        currency: session.currency,
        decimalPlaces: DECIMAL_PLACES,
      },
      isFinished: true,
      isWin: true,
      coeff: session.coeff,
      winAmount: session.winAmount.toFixed(DECIMAL_PLACES),
      minesCount: session.minesCount,
      openedCells: session.openedCells,
      minesCells: session.minePositions, // reveal mines on payout
    };
  }

  // ============================================================================
  // GET GAME STATE (Reconnection / Init)
  // ============================================================================

  async performGetGameStateFlow(
    userId: string,
    agentId: string,
    gameCode: string,
  ): Promise<MinesGameResponse> {
    const redisKey = this.getRedisKey(userId, agentId, gameCode);
    const session = await this.redisService.get<MinesGameSession>(redisKey);

    if (!session || session.status !== 'in-game') {
      return { status: 'none', isFinished: false, isWin: false, coeff: 0, winAmount: '0', minesCount: 0, openedCells: [] };
    }

    return {
      status: 'in-game',
      bet: {
        amount: session.betAmount.toFixed(DECIMAL_PLACES),
        currency: session.currency,
        decimalPlaces: DECIMAL_PLACES,
      },
      isFinished: false,
      isWin: session.openedCells.length > 0,
      coeff: session.coeff,
      winAmount: session.winAmount.toFixed(DECIMAL_PLACES),
      minesCount: session.minesCount,
      openedCells: session.openedCells,
      // minesCells NOT sent for active game
    };
  }

  // ============================================================================
  // GET RATES
  // ============================================================================

  async getRates(): Promise<Record<string, number>> {
    return {
      USD: 1, EUR: 0.8755, BTC: 0.000012050399374548936,
      ETH: 0.00036986204295658424, INR: 87.503, BRL: 5.6015,
      GBP: 0.7571, JPY: 150.81, CAD: 1.3858, AUD: 1.5559,
      TRY: 40.6684, RUB: 79.8753, PLN: 3.7442, CZK: 21.5136,
      SEK: 9.7896, NOK: 10.3276, DKK: 6.5351, CHF: 0.814,
      HUF: 350.19, RON: 4.4403, BGN: 1.712, ZAR: 18.2178,
      KRW: 1392.51, SGD: 1.2979, HKD: 7.8498, MXN: 18.869,
      IDR: 16443.4, PHP: 58.27, THB: 32.752, VND: 26199,
      KZT: 540.82, UZS: 12605, PKR: 283.25, BDT: 122.25,
      NGN: 1532.39, KES: 129.2, GHS: 10.5, TZS: 2570,
      ZMW: 23.1485, UAH: 41.6966, AED: 3.6725, USDT: 1,
      USDC: 0.9993, BNB: 0.001229924674, LTC: 0.01219800670691517,
      DOGE: 7.249083135964963, TRX: 3.621891742307764,
      XRP: 0.5234373962121788, TON: 0.6662012207757025,
      ADA: 2.493846558309699,
    };
  }

  // ============================================================================
  // GET GAME SEEDS
  // ============================================================================

  async getGameSeeds(userId: string, agentId: string): Promise<{ userSeed: string; hashedServerSeed: string }> {
    const fairness = await this.fairnessService.getOrCreateFairness(userId, agentId);
    return {
      userSeed: fairness.userSeed,
      hashedServerSeed: fairness.hashedServerSeed,
    };
  }

  // ============================================================================
  // SET USER SEED
  // ============================================================================

  async setUserSeed(userId: string, agentId: string, userSeed: string): Promise<{ success: boolean; userSeed: string }> {
    const result = await this.fairnessService.setUserSeed(userId, agentId, userSeed);
    return { success: true, userSeed: result.userSeed };
  }

  // ============================================================================
  // GET GAME CONFIG
  // ============================================================================

  async getGameConfigPayload(gameCode: string): Promise<Record<string, any>> {
    try {
      const betConfigRaw = await this.safeGetConfig(gameCode, 'betConfig');
      const betConfig = this.tryParseJson(betConfigRaw) || {};
      return betConfig;
    } catch (e) {
      this.logger.error(`Failed building game config payload: ${e}`);
      return {};
    }
  }

  // ============================================================================
  // GET BET HISTORY
  // ============================================================================

  async getMyBetsHistory(userId: string, agentId: string, gameCode?: string): Promise<any[]> {
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const bets = await this.betService.listUserBetsByTimeRange(userId, lastWeek, new Date(), gameCode, 30);

    return bets.map((bet) => {
      const betAmount = parseFloat(bet.betAmount || '0');
      const winAmount = parseFloat(bet.winAmount || '0');
      return { betAmount, win: winAmount };
    });
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Calculate multiplier for mines game based on number of bombs and steps completed.
   * Formula: multiplier = (1 - houseEdge) * (C(25, stepsCompleted) / C(25 - minesCount, stepsCompleted))
   * This reflects the inverse probability of selecting `stepsCompleted` safe cells from a grid.
   */
  private calculateMultiplier(minesCount: number, stepsCompleted: number): number {
    const totalCells = GRID_SIZE;
    const safeCells = totalCells - minesCount;

    // Product of probabilities for each step
    let probability = 1;
    for (let i = 0; i < stepsCompleted; i++) {
      probability *= (safeCells - i) / (totalCells - i);
    }

    if (probability <= 0) return 0;

    const rawMultiplier = (1 - HOUSE_EDGE) / probability;
    // Round down to 2 decimal places
    return Math.floor(rawMultiplier * 100) / 100;
  }

  /**
   * Generate mine positions using provably fair algorithm.
   * Uses HMAC-SHA256(serverSeed, userSeed:nonce) to deterministically generate positions.
   */
  private generateMinePositions(
    minesCount: number,
    serverSeed: string,
    userSeed: string,
    nonce: number,
  ): number[] {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${userSeed}:${nonce}`);
    const hash = hmac.digest('hex');

    // Fisher-Yates shuffle using hash bytes as entropy
    const positions = Array.from({ length: GRID_SIZE }, (_, i) => i + 1); // 1-25

    for (let i = positions.length - 1; i > 0; i--) {
      // Use 4 hex chars (2 bytes) per swap for sufficient randomness
      const hexIndex = (i * 4) % hash.length;
      const hexSlice = hash.substring(hexIndex, hexIndex + 4) || hash.substring(0, 4);
      const randomValue = parseInt(hexSlice, 16);
      const j = randomValue % (i + 1);
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    // Take first minesCount positions as mine locations
    return positions.slice(0, minesCount).sort((a, b) => a - b);
  }

  /**
   * Settle a completed game via wallet service.
   */
  private async settleGame(session: MinesGameSession, winAmount: number): Promise<void> {
    try {
      const settleResult = await this.walletService.settleBet({
        agentId: session.agentId,
        platformTxId: session.platformBetTxId,
        userId: session.userId,
        winAmount,
        roundId: session.roundId,
        betAmount: session.betAmount,
        gameCode: session.gameCode,
        gameSession: session,
      });

      this.logger.log(
        `Settlement success: user=${session.userId} balance=${settleResult.balance} winAmount=${winAmount}`,
      );

      // Record settlement in bet DB
      const withdrawCoeff = session.betAmount > 0 && winAmount > 0
        ? (winAmount / session.betAmount).toFixed(3)
        : '0';

      const fairnessData = session.userSeed && session.serverSeed
        ? this.fairnessService.generateFairnessDataForBet(session.userSeed, session.serverSeed)
        : undefined;

      await this.betService.recordSettlement({
        externalPlatformTxId: session.platformBetTxId,
        winAmount: winAmount.toFixed(DECIMAL_PLACES),
        settledAt: new Date(),
        balanceAfterSettlement: settleResult.balance ? String(settleResult.balance) : undefined,
        updatedBy: session.userId,
        finalCoeff: session.coeff.toString(),
        withdrawCoeff,
        fairnessData,
      });

      // Rotate seeds
      try {
        await this.fairnessService.rotateSeeds(session.userId, session.agentId);
      } catch (e) {
        this.logger.warn(`Failed to rotate seeds: user=${session.userId} error=${(e as Error).message}`);
      }
    } catch (error: any) {
      this.logger.error(`Settlement failed: user=${session.userId} txId=${session.platformBetTxId}`, error);
      throw new Error(ERROR_MESSAGES.SETTLEMENT_FAILED);
    }
  }

  private getRedisKey(userId: string, agentId: string, gameCode: string): string {
    return `gameSession:${userId}-${agentId}-${gameCode}`;
  }

  private async safeGetConfig(gameCode: string, key: string): Promise<string> {
    try {
      const raw = await this.gameConfigService.getConfig(gameCode, key);
      return typeof raw === 'string' ? raw : JSON.stringify(raw);
    } catch (e) {
      this.logger.warn(`Config key ${key} not available: ${e}`);
      return '{}';
    }
  }

  private tryParseJson(value: string): any {
    try { return JSON.parse(value); } catch { return undefined; }
  }
}
