import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { WheelGameService } from './wheel-game.service';
import { WheelGameHandler } from './wheel-game.handler';
import { WheelGameBetService } from './wheel-game-bet.service';
import { GameStatus, WheelBetData, WheelColor } from './DTO/game-state.dto';
import { DEFAULTS } from '../../config/defaults.config';
import { WalletService } from '@games-vector/game-core';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WheelGameScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WheelGameScheduler.name);
  private readonly GAME_CODE = DEFAULTS.WHEEL.GAME_CODE;
  private readonly WAIT_TIME_MS = DEFAULTS.WHEEL.GAME.WAIT_TIME_MS;
  private readonly SPIN_TIME_MS = DEFAULTS.WHEEL.GAME.SPIN_TIME_MS;
  private readonly RESULT_DISPLAY_TIME_MS = DEFAULTS.WHEEL.GAME.RESULT_DISPLAY_TIME_MS;
  private readonly LEADER_RENEW_INTERVAL_MS = DEFAULTS.WHEEL.GAME.LEADER_RENEW_INTERVAL_MS;
  private readonly POD_ID = uuidv4();

  private waitTimer: NodeJS.Timeout | null = null;
  private spinTimer: NodeJS.Timeout | null = null;
  private finishTimer: NodeJS.Timeout | null = null;
  private leaderRenewTimer: NodeJS.Timeout | null = null;
  private leaderElectionTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isLeader = false;

  constructor(
    private readonly wheelGameService: WheelGameService,
    private readonly wheelGameHandler: WheelGameHandler,
    private readonly wheelGameBetService: WheelGameBetService,
    private readonly walletService: WalletService,
  ) {}

  onModuleInit() {
    try {
      setTimeout(() => {
        this.startLeaderElection().catch((error) => {
          this.logger.error(`[WHEEL_LEADER_ELECTION] Error: ${(error as Error).message}`);
        });
      }, 2000);
    } catch (error) {
      this.logger.error(`[WHEEL_SCHEDULER] Init error: ${(error as Error).message}`);
    }
  }

  onModuleDestroy() {
    this.stopGameLoop();
    this.stopLeaderElection();
    this.wheelGameService.releaseLeaderLock(this.POD_ID).catch((error) => {
      this.logger.error(`[WHEEL_LEADER] Error releasing lock: ${(error as Error).message}`);
    });
  }

  // =============================================
  // LEADER ELECTION
  // =============================================

  private async startLeaderElection(): Promise<void> {
    try {
      const acquired = await this.wheelGameService.acquireLeaderLock(this.POD_ID);

      if (acquired) {
        this.isLeader = true;
        this.startGameLoop();
        this.startLeaderRenewal();
      } else {
        this.leaderElectionTimer = setTimeout(() => {
          this.startLeaderElection().catch((error) => {
            this.logger.error(`[WHEEL_LEADER] Retry error: ${(error as Error).message}`);
          });
        }, 5000);
      }
    } catch (error) {
      this.leaderElectionTimer = setTimeout(() => {
        this.startLeaderElection().catch((err) => {
          this.logger.error(`[WHEEL_LEADER] Error retry: ${(err as Error).message}`);
        });
      }, 5000);
    }
  }

  private startLeaderRenewal(): void {
    if (this.leaderRenewTimer) {
      clearInterval(this.leaderRenewTimer);
    }

    this.leaderRenewTimer = setInterval(async () => {
      if (this.isLeader) {
        const stillLeader = await this.wheelGameService.renewLeaderLock(this.POD_ID);
        if (!stillLeader) {
          this.isLeader = false;
          this.stopGameLoop();
          this.startLeaderElection();
        }
      }
    }, this.LEADER_RENEW_INTERVAL_MS);
  }

  private stopLeaderElection(): void {
    if (this.leaderElectionTimer) {
      clearTimeout(this.leaderElectionTimer);
      this.leaderElectionTimer = null;
    }
    if (this.leaderRenewTimer) {
      clearInterval(this.leaderRenewTimer);
      this.leaderRenewTimer = null;
    }
  }

  // =============================================
  // GAME LOOP
  // =============================================

  private startGameLoop(): void {
    if (this.isRunning || !this.isLeader) return;
    this.isRunning = true;
    this.logger.log('[WHEEL_SCHEDULER] Game loop started');
    this.startNewRound();
  }

  private stopGameLoop(): void {
    this.clearAllTimers();
    this.isRunning = false;
    this.wheelGameHandler.stopBetListBroadcast();
    this.logger.log('[WHEEL_SCHEDULER] Game loop stopped');
  }

  private clearAllTimers(): void {
    if (this.waitTimer) { clearTimeout(this.waitTimer); this.waitTimer = null; }
    if (this.spinTimer) { clearTimeout(this.spinTimer); this.spinTimer = null; }
    if (this.finishTimer) { clearTimeout(this.finishTimer); this.finishTimer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.leaderElectionTimer) { clearTimeout(this.leaderElectionTimer); this.leaderElectionTimer = null; }
    if (this.leaderRenewTimer) { clearInterval(this.leaderRenewTimer); this.leaderRenewTimer = null; }
  }

  // =============================================
  // ROUND LIFECYCLE
  // =============================================

  private async startNewRound(): Promise<void> {
    if (!this.isLeader) return;

    try {
      // Clear any existing active round
      const existingRound = this.wheelGameService.getActiveRound();
      if (existingRound) {
        if (existingRound.status === GameStatus.FINISH_GAME) {
          await this.wheelGameService.clearActiveRound();
        } else {
          // Force end the round
          await this.wheelGameService.clearActiveRound();
        }
      }

      // Start a new round
      const round = await this.wheelGameService.startNewRound();

      // Process any pending bets from the previous round
      const pendingBetsResult = await this.wheelGameBetService.processPendingBets(
        round.roundId,
        round.gameUUID,
      );

      if (pendingBetsResult.errors.length > 0) {
        this.logger.warn(`[WHEEL_SCHEDULER] Pending bet errors: ${pendingBetsResult.errors.length}`);
      }

      // Broadcast WAIT_GAME status
      const prevRoundResults = await this.wheelGameService.getPrevRoundResults();
      const waitPayload = this.wheelGameService.getWaitGamePayload(prevRoundResults);
      this.wheelGameHandler.broadcastGameStatusChanged(this.GAME_CODE, waitPayload);

      // Broadcast initial bet list (may include pending bets from previous round)
      await this.wheelGameHandler.broadcastBetListUpdate(this.GAME_CODE);

      // Start periodic bet list broadcasts during WAIT_GAME
      this.wheelGameHandler.startBetListBroadcast(this.GAME_CODE);

      // Set timer for transition to IN_GAME
      if (this.waitTimer) clearTimeout(this.waitTimer);
      this.waitTimer = setTimeout(async () => {
        if (this.isLeader) {
          await this.transitionToInGame();
        }
      }, this.WAIT_TIME_MS);

      this.logger.log(
        `[WHEEL_SCHEDULER] New round ${round.roundId} started, waiting ${this.WAIT_TIME_MS}ms`,
      );
    } catch (error) {
      this.logger.error(`[WHEEL_SCHEDULER] Error starting round: ${(error as Error).message}`);
      if (this.isLeader && this.isRunning) {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (this.isLeader && this.isRunning) {
            this.startNewRound();
          }
        }, 5000);
      }
    }
  }

  private async transitionToInGame(): Promise<void> {
    if (!this.isLeader) return;

    try {
      const activeRound = this.wheelGameService.getActiveRound();
      if (!activeRound || activeRound.status !== GameStatus.WAIT_GAME) return;

      // Stop bet list broadcasts (no more bets accepted)
      this.wheelGameHandler.stopBetListBroadcast();

      // Transition to IN_GAME
      await this.wheelGameService.transitionToInGame();

      // Broadcast IN_GAME with the result (client animates wheel spin)
      const inGamePayload = this.wheelGameService.getInGamePayload();
      this.wheelGameHandler.broadcastGameStatusChanged(this.GAME_CODE, inGamePayload);

      this.logger.log(
        `[WHEEL_SCHEDULER] IN_GAME: roundId=${activeRound.roundId} cellIndex=${activeRound.cellIndex} cellColor=${activeRound.cellColor}`,
      );

      // Set timer for transition to FINISH_GAME
      if (this.spinTimer) clearTimeout(this.spinTimer);
      this.spinTimer = setTimeout(async () => {
        if (this.isLeader) {
          await this.transitionToFinishGame();
        }
      }, this.SPIN_TIME_MS);
    } catch (error) {
      this.logger.error(`[WHEEL_SCHEDULER] Error transitioning to IN_GAME: ${(error as Error).message}`);
    }
  }

  private async transitionToFinishGame(): Promise<void> {
    if (!this.isLeader) return;

    try {
      const activeRound = this.wheelGameService.getActiveRound();
      if (!activeRound || activeRound.status !== GameStatus.IN_GAME) return;

      // Transition to FINISH_GAME
      await this.wheelGameService.transitionToFinishGame();

      // Broadcast FINISH_GAME
      const finishPayload = this.wheelGameService.getFinishGamePayload();
      this.wheelGameHandler.broadcastGameStatusChanged(this.GAME_CODE, finishPayload);

      // Settle all bets (wins and losses)
      await this.wheelGameBetService.settleRound(this.GAME_CODE);

      // Send withdraw-result to winning players and balance updates
      await this.processWinPayouts(activeRound.roundId);

      // Send balance updates to losing players
      await this.processLossBalanceUpdates(activeRound.roundId);

      // Broadcast updated bet list (for next round queued bets)
      await this.wheelGameHandler.broadcastBetListUpdate(this.GAME_CODE);

      this.logger.log(
        `[WHEEL_SCHEDULER] FINISH_GAME: roundId=${activeRound.roundId}`,
      );

      // Set timer for next round
      if (this.finishTimer) clearTimeout(this.finishTimer);
      this.finishTimer = setTimeout(async () => {
        if (this.isLeader) {
          await this.startNewRound();
        }
      }, this.RESULT_DISPLAY_TIME_MS);
    } catch (error) {
      this.logger.error(`[WHEEL_SCHEDULER] Error transitioning to FINISH_GAME: ${(error as Error).message}`);
      // Still try to start next round after delay
      if (this.finishTimer) clearTimeout(this.finishTimer);
      this.finishTimer = setTimeout(async () => {
        if (this.isLeader && this.isRunning) {
          await this.startNewRound();
        }
      }, this.RESULT_DISPLAY_TIME_MS);
    }
  }

  // =============================================
  // WIN/LOSS PROCESSING
  // =============================================

  private async processWinPayouts(roundId: number): Promise<void> {
    const activeRound = this.wheelGameService.getActiveRound();
    if (!activeRound) return;

    const winningColor = activeRound.cellColor;
    const multiplier = this.wheelGameService.getMultiplierForColor(winningColor);

    for (const [playerGameId, bet] of activeRound.bets.entries()) {
      if (bet.color !== winningColor) continue;

      const betAmount = parseFloat(bet.betAmount);
      const winAmount = (betAmount * multiplier).toFixed(2);

      try {
        // Get updated balance for this user
        const walletBalance = await this.walletService.getBalance(bet.operatorId, bet.userId);
        const balance = walletBalance.balance ? String(walletBalance.balance) : undefined;

        // Send withdraw-result to winning player
        this.wheelGameHandler.broadcastWithdrawResult(bet.userId, this.GAME_CODE, {
          currency: bet.currency,
          winAmount: String(winAmount),
          winCoeff: multiplier,
        });

        // Send balance update
        if (balance) {
          this.wheelGameHandler.emitBalanceChange(
            bet.userId, this.GAME_CODE, bet.currency, balance,
          );
        }

        this.logger.log(
          `[WHEEL_WIN] userId=${bet.userId} color=${bet.color} betAmount=${betAmount} winAmount=${winAmount} multiplier=${multiplier}`,
        );
      } catch (error: any) {
        this.logger.error(
          `[WHEEL_WIN] Error processing payout for userId=${bet.userId}: ${error.message}`,
        );
      }
    }
  }

  private async processLossBalanceUpdates(roundId: number): Promise<void> {
    const activeRound = this.wheelGameService.getActiveRound();
    if (!activeRound) return;

    const winningColor = activeRound.cellColor;

    // Collect unique losing users
    const losingUsers = new Map<string, { agentId: string; currency: string }>();
    for (const [, bet] of activeRound.bets.entries()) {
      if (bet.color === winningColor) continue;
      if (!losingUsers.has(bet.userId)) {
        losingUsers.set(bet.userId, { agentId: bet.operatorId, currency: bet.currency });
      }
    }

    // Send balance confirmation to losing players (balance unchanged from bet deduction)
    for (const [userId, { agentId, currency }] of losingUsers.entries()) {
      try {
        const walletBalance = await this.walletService.getBalance(agentId, userId);
        const balance = walletBalance.balance ? String(walletBalance.balance) : undefined;

        if (balance) {
          this.wheelGameHandler.emitBalanceChange(userId, this.GAME_CODE, currency, balance);
        }
      } catch (error: any) {
        this.logger.error(
          `[WHEEL_LOSS] Error sending balance update for userId=${userId}: ${error.message}`,
        );
      }
    }
  }
}
