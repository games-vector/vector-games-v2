import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SugarDaddyGameService } from './sugar-daddy-game.service';
import { SugarDaddyGameHandler } from './sugar-daddy-game.handler';
import { SugarDaddyGameBetService } from './sugar-daddy-game-bet.service';
import { GameStatus } from './DTO/game-state.dto';
import { DEFAULTS } from '../../config/defaults.config';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SugarDaddyGameScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SugarDaddyGameScheduler.name);
  private readonly GAME_CODE = DEFAULTS.AVIATOR.GAME_CODE; // Note: AVIATOR config key is used for Sugar Daddy
  private readonly WAIT_TIME_MS = 10000;
  private readonly RESULT_DISPLAY_TIME_MS = 3000;
  private readonly LEADER_RENEW_INTERVAL_MS = 15000; // Renew lock every 15 seconds
  private readonly POD_ID = uuidv4(); // Unique pod identifier
  private waitTimer: NodeJS.Timeout | null = null;
  private nextRoundTimer: NodeJS.Timeout | null = null;
  private leaderRenewTimer: NodeJS.Timeout | null = null;
  private leaderElectionTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isLeader = false;

  constructor(
    private readonly sugarDaddyGameService: SugarDaddyGameService,
    private readonly sugarDaddyGameHandler: SugarDaddyGameHandler,
    private readonly sugarDaddyGameBetService: SugarDaddyGameBetService,
  ) {}

  onModuleInit() {
    this.logger.log(`[SUGAR_DADDY_SCHEDULER] Initialized with podId=${this.POD_ID}`);
    this.sugarDaddyGameHandler.setOnRoundEndCallback(() => {
      this.onRoundEnded();
    });
    
    // Start leader election process
    setTimeout(() => {
      this.startLeaderElection();
    }, 2000);
  }

  onModuleDestroy() {
    this.stopGameLoop();
    this.stopLeaderElection();
    // Release lock on shutdown
    this.sugarDaddyGameService.releaseLeaderLock(this.POD_ID).catch((error) => {
      this.logger.error(`[LEADER_ELECTION] Error releasing lock on shutdown: ${error.message}`);
    });
  }

  /**
   * Start leader election process
   * Tries to acquire lock and become the game engine leader
   */
  private async startLeaderElection(): Promise<void> {
    this.logger.log(`[LEADER_ELECTION] Starting leader election for pod ${this.POD_ID}`);
    
    // Try to acquire lock immediately
    const acquired = await this.sugarDaddyGameService.acquireLeaderLock(this.POD_ID);
    
    if (acquired) {
      this.isLeader = true;
      this.logger.log(`[LEADER_ELECTION] Pod ${this.POD_ID} is now the leader - starting game loop`);
      this.startGameLoop();
      this.startLeaderRenewal();
    } else {
      this.logger.log(`[LEADER_ELECTION] Pod ${this.POD_ID} is not the leader - will retry`);
      // Retry leader election every 5 seconds
      this.leaderElectionTimer = setTimeout(() => {
        this.startLeaderElection();
      }, 5000);
    }
  }

  /**
   * Start periodic leader lock renewal
   */
  private startLeaderRenewal(): void {
    if (this.leaderRenewTimer) {
      clearInterval(this.leaderRenewTimer);
    }

    this.leaderRenewTimer = setInterval(async () => {
      if (this.isLeader) {
        const stillLeader = await this.sugarDaddyGameService.renewLeaderLock(this.POD_ID);
        if (!stillLeader) {
          this.logger.warn(`[LEADER_ELECTION] Pod ${this.POD_ID} lost leadership - stopping game loop`);
          this.isLeader = false;
          this.stopGameLoop();
          // Try to reacquire
          this.startLeaderElection();
        }
      }
    }, this.LEADER_RENEW_INTERVAL_MS);
  }

  /**
   * Stop leader election process
   */
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

  /**
   * Start the game loop (only if leader)
   */
  private startGameLoop(): void {
    if (this.isRunning) {
      this.logger.warn('[SUGAR_DADDY_SCHEDULER] Game loop already running');
      return;
    }

    if (!this.isLeader) {
      this.logger.warn('[SUGAR_DADDY_SCHEDULER] Cannot start game loop - not the leader');
      return;
    }

    this.isRunning = true;
    this.logger.log('[SUGAR_DADDY_SCHEDULER] Starting game loop (event-driven)');

    this.startNewRound();
  }

  /**
   * Stop the game loop
   */
  private stopGameLoop(): void {
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    if (this.nextRoundTimer) {
      clearTimeout(this.nextRoundTimer);
      this.nextRoundTimer = null;
    }
    this.isRunning = false;
    this.sugarDaddyGameHandler.stopCoefficientBroadcast();
    this.logger.log('[SUGAR_DADDY_SCHEDULER] Stopped game loop');
  }

  private onRoundEnded(): void {
    if (!this.isRunning || !this.isLeader) {
      return;
    }

    this.logger.log('[SUGAR_DADDY_SCHEDULER] Round ended naturally, scheduling next round');

    if (this.nextRoundTimer) {
      clearTimeout(this.nextRoundTimer);
    }

    this.nextRoundTimer = setTimeout(() => {
      if (this.isLeader) {
        this.startNewRound();
      }
    }, this.RESULT_DISPLAY_TIME_MS);
  }

  private async startNewRound(): Promise<void> {
    // Double-check we're still the leader
    if (!this.isLeader) {
      this.logger.warn('[SUGAR_DADDY_SCHEDULER] Cannot start new round - not the leader');
      return;
    }

    try {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (activeRound) {
        if (activeRound.status === GameStatus.FINISH_GAME) {
          await this.sugarDaddyGameService.clearActiveRound();
        } else {
          this.logger.warn('[SUGAR_DADDY_SCHEDULER] Previous round still active, forcing end');
          await this.endRound();
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.sugarDaddyGameService.clearActiveRound();
        }
      }

      const round = await this.sugarDaddyGameService.startNewRound();

      this.logger.log(
        `[SUGAR_DADDY_SCHEDULER] Processing pending bets for roundId=${round.roundId}`,
      );
      const pendingBetsResult = await this.sugarDaddyGameBetService.processPendingBets(
        round.roundId,
        round.gameUUID,
      );
      
      if (pendingBetsResult.processed > 0 || pendingBetsResult.failed > 0) {
        this.logger.log(
          `[SUGAR_DADDY_SCHEDULER] Pending bets processed: ${pendingBetsResult.processed} succeeded, ${pendingBetsResult.failed} failed`,
        );
        if (pendingBetsResult.errors.length > 0) {
          this.logger.warn(
            `[SUGAR_DADDY_SCHEDULER] Pending bet errors: ${JSON.stringify(pendingBetsResult.errors)}`,
          );
        }
      }

      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.logger.log(`[SUGAR_DADDY_SCHEDULER] Broadcasting initial WAIT_GAME state: roundId=${gameState.roundId} waitTime=${gameState.waitTime}`);
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      } else {
        this.logger.warn('[SUGAR_DADDY_SCHEDULER] No game state available to broadcast');
      }

      this.logger.log(`[SUGAR_DADDY_SCHEDULER] Starting periodic game state broadcasts (every 3 seconds) for gameCode=${this.GAME_CODE}`);
      this.sugarDaddyGameHandler.startGameStateBroadcast(this.GAME_CODE);

      this.logger.log(
        `[SUGAR_DADDY_SCHEDULER] Started new round: roundId=${round.roundId} gameUUID=${round.gameUUID} crashCoeff=${round.crashCoeff} status=WAIT_GAME`,
      );

      if (this.waitTimer) {
        clearTimeout(this.waitTimer);
      }
      this.waitTimer = setTimeout(async () => {
        if (this.isLeader) {
          await this.transitionToInGame();
        }
      }, this.WAIT_TIME_MS);
    } catch (error) {
      this.logger.error(`[SUGAR_DADDY_SCHEDULER] Error starting new round: ${error.message}`);
    }
  }

  private async endRound(): Promise<void> {
    if (!this.isLeader) {
      return;
    }

    try {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (!activeRound || activeRound.status === GameStatus.FINISH_GAME) {
        return;
      }

      this.sugarDaddyGameHandler.stopCoefficientBroadcast();

      const roundId = activeRound.roundId;
      await this.sugarDaddyGameService.endRound();

      await this.sugarDaddyGameBetService.settleUncashedBets(
        roundId,
        this.GAME_CODE,
      );

      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      }

      this.logger.log(`[SUGAR_DADDY_SCHEDULER] Round ended: roundId=${activeRound.roundId}`);
    } catch (error) {
      this.logger.error(`[SUGAR_DADDY_SCHEDULER] Error ending round: ${error.message}`);
    }
  }

  private async transitionToInGame(): Promise<void> {
    if (!this.isLeader) {
      return;
    }

    try {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (!activeRound || activeRound.status !== GameStatus.WAIT_GAME) {
        return;
      }

      // Keep game state broadcast running - it should continue every 3 seconds during IN_GAME
      // Don't stop it here, let it continue broadcasting state changes

      await this.sugarDaddyGameService.startGame();

      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      }

      // Start coefficient broadcast for IN_GAME state
      // This will send coefficient updates every 200ms during IN_GAME
      this.sugarDaddyGameHandler.startCoefficientBroadcast(this.GAME_CODE);

      this.logger.log(
        `[SUGAR_DADDY_SCHEDULER] Transitioned to IN_GAME: roundId=${activeRound.roundId} - coefficient and state broadcasts active`,
      );
    } catch (error) {
      this.logger.error(`[SUGAR_DADDY_SCHEDULER] Error transitioning to IN_GAME: ${error.message}`);
    }
  }
}
