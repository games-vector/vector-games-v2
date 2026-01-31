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
  private readonly GAME_CODE = DEFAULTS.SUGAR_DADDY.GAME_CODE;
  private readonly WAIT_TIME_MS = 10000;
  private readonly RESULT_DISPLAY_TIME_MS = 3000;
  private readonly LEADER_RENEW_INTERVAL_MS = 15000;
  private readonly POD_ID = uuidv4();
  private waitTimer: NodeJS.Timeout | null = null;
  private nextRoundTimer: NodeJS.Timeout | null = null;
  private leaderRenewTimer: NodeJS.Timeout | null = null;
  private leaderElectionTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private mockBetsAdditionTimer: NodeJS.Timeout | null = null;
  private mockBetsToAdd: Array<{ playerGameId: string; bet: any }> = [];
  private isRunning = false;
  private isLeader = false;

  constructor(
    private readonly sugarDaddyGameService: SugarDaddyGameService,
    private readonly sugarDaddyGameHandler: SugarDaddyGameHandler,
    private readonly sugarDaddyGameBetService: SugarDaddyGameBetService,
  ) {}

  onModuleInit() {
    try {
      this.logger.log(`[SUGAR_DADDY_SCHEDULER] ✅ Initializing with podId=${this.POD_ID}`);
      this.sugarDaddyGameHandler.setOnRoundEndCallback(() => {
        this.onRoundEnded();
      });
      
      setTimeout(() => {
        this.logger.log(`[SUGAR_DADDY_SCHEDULER] Starting leader election in 2 seconds...`);
        this.startLeaderElection().catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`[SUGAR_DADDY_SCHEDULER] ❌ Error in startLeaderElection: ${errorMessage}`);
        });
      }, 2000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[SUGAR_DADDY_SCHEDULER] ❌ Error in onModuleInit: ${errorMessage}${errorStack ? `\nStack: ${errorStack}` : ''}`,
      );
    }
  }

  onModuleDestroy() {
    this.stopGameLoop();
    this.stopLeaderElection();
    if (this.mockBetsAdditionTimer) {
      clearInterval(this.mockBetsAdditionTimer);
      this.mockBetsAdditionTimer = null;
    }
    this.sugarDaddyGameService.releaseLeaderLock(this.POD_ID).catch((error) => {
      this.logger.error(`[LEADER_ELECTION] Error releasing lock on shutdown: ${error.message}`);
    });
  }

  /**
   * Start leader election process
   * Tries to acquire lock and become the game engine leader
   */
  private async startLeaderElection(): Promise<void> {
    try {
      this.logger.log(`[LEADER_ELECTION] Attempting to acquire leader lock for pod ${this.POD_ID}`);
      const acquired = await this.sugarDaddyGameService.acquireLeaderLock(this.POD_ID);
      
      if (acquired) {
        this.isLeader = true;
        this.logger.log(`[LEADER_ELECTION] ✅ Pod ${this.POD_ID} is now the leader - starting game loop`);
        this.startGameLoop();
        this.startLeaderRenewal();
      } else {
        this.logger.warn(`[LEADER_ELECTION] ❌ Pod ${this.POD_ID} failed to acquire leader lock - another pod may be leader. Retrying in 5 seconds...`);
        this.leaderElectionTimer = setTimeout(() => {
          this.startLeaderElection().catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[LEADER_ELECTION] ❌ Error in retry: ${errorMessage}`);
          });
        }, 5000);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[LEADER_ELECTION] ❌ Error during leader election: ${errorMessage}${errorStack ? `\nStack: ${errorStack}` : ''}`,
      );
      // Retry after 5 seconds even on error
      this.leaderElectionTimer = setTimeout(() => {
        this.startLeaderElection().catch((err) => {
          this.logger.error(`[LEADER_ELECTION] ❌ Error in error retry: ${err instanceof Error ? err.message : String(err)}`);
        });
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
      this.logger.warn(`[SUGAR_DADDY_SCHEDULER] Game loop already running, skipping start`);
      return;
    }

    if (!this.isLeader) {
      this.logger.warn(`[SUGAR_DADDY_SCHEDULER] Cannot start game loop - not the leader (podId=${this.POD_ID})`);
      return;
    }

    this.logger.log(`[SUGAR_DADDY_SCHEDULER] ✅ Starting game loop (podId=${this.POD_ID})`);
    this.isRunning = true;
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
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.isRunning = false;
    this.sugarDaddyGameHandler.stopCoefficientBroadcast();
  }

  private onRoundEnded(): void {
    if (!this.isRunning || !this.isLeader) {
      return;
    }

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
    if (!this.isLeader) {
      this.logger.warn(`[SUGAR_DADDY_SCHEDULER] Cannot start new round - not the leader (podId=${this.POD_ID})`);
      return;
    }

    this.logger.log(`[SUGAR_DADDY_SCHEDULER] Starting new round (podId=${this.POD_ID}, isLeader=${this.isLeader})`);
    try {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (activeRound) {
        this.logger.log(`[SUGAR_DADDY_SCHEDULER] Found existing active round: roundId=${activeRound.roundId} status=${activeRound.status}`);
        if (activeRound.status === GameStatus.FINISH_GAME) {
          this.logger.log(`[SUGAR_DADDY_SCHEDULER] Clearing finished round`);
          await this.sugarDaddyGameService.clearActiveRound();
        } else {
          this.logger.warn('[SUGAR_DADDY_SCHEDULER] Previous round still active, forcing end');
          await this.endRound();
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.sugarDaddyGameService.clearActiveRound();
        }
      } else {
        this.logger.log(`[SUGAR_DADDY_SCHEDULER] No existing active round found, creating new one`);
      }

      this.logger.log(`[SUGAR_DADDY_SCHEDULER] Calling startNewRound()...`);
      const round = await this.sugarDaddyGameService.startNewRound();
      this.logger.log(`[SUGAR_DADDY_SCHEDULER] ✅ New round created: roundId=${round.roundId} gameUUID=${round.gameUUID} crashCoeff=${round.crashCoeff}`);

      this.logger.log(`[SUGAR_DADDY_SCHEDULER] Processing pending bets...`);
      const pendingBetsResult = await this.sugarDaddyGameBetService.processPendingBets(
        round.roundId,
        round.gameUUID,
      );
      
      if (pendingBetsResult.errors.length > 0) {
        this.logger.warn(
          `[SUGAR_DADDY_SCHEDULER] Pending bet errors: ${JSON.stringify(pendingBetsResult.errors)}`,
        );
      } else {
        this.logger.log(`[SUGAR_DADDY_SCHEDULER] ✅ Pending bets processed: ${pendingBetsResult.processed} processed, ${pendingBetsResult.errors.length} errors`);
      }

      // Log removed to reduce log size - getting game state is working normally
      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        // Log removed to reduce log size - game state retrieved successfully
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      } else {
        this.logger.error(`[SUGAR_DADDY_SCHEDULER] ❌ Failed to get game state after creating round!`);
      }

      // Start gradual mock bet addition during WAIT_GAME
      this.startGradualMockBetsAddition();

      this.logger.log(`[SUGAR_DADDY_SCHEDULER] Starting game state broadcast...`);
      this.sugarDaddyGameHandler.startGameStateBroadcast(this.GAME_CODE);

      if (this.waitTimer) {
        clearTimeout(this.waitTimer);
      }
      // Log removed to reduce log size - wait timer is working normally
      this.waitTimer = setTimeout(async () => {
        if (this.isLeader) {
          // Log removed to reduce log size - transition is working normally
          await this.transitionToInGame();
        } else {
          this.logger.warn(`[SUGAR_DADDY_SCHEDULER] Wait timer expired but not leader anymore, skipping transition`);
        }
      }, this.WAIT_TIME_MS);
      
      this.logger.log(`[SUGAR_DADDY_SCHEDULER] ✅ New round setup complete`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[SUGAR_DADDY_SCHEDULER] ❌ Error starting new round: ${errorMessage}${errorStack ? `\nStack: ${errorStack}` : ''}`,
      );
      // Retry after 5 seconds if there's an error (only if still leader and running)
      if (this.isLeader && this.isRunning) {
        // Clear any existing retry timer
        if (this.retryTimer) {
          clearTimeout(this.retryTimer);
        }
        this.logger.log(`[SUGAR_DADDY_SCHEDULER] Retrying in 5 seconds...`);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (this.isLeader && this.isRunning) {
            this.startNewRound();
          }
        }, 5000);
      } else {
        this.logger.warn(`[SUGAR_DADDY_SCHEDULER] Not retrying - isLeader=${this.isLeader} isRunning=${this.isRunning}`);
      }
    }
  }

  private async endRound(): Promise<void> {
    if (!this.isLeader) {
      this.logger.debug(`[SCHEDULER_END_ROUND] Not the leader, skipping endRound`);
      return;
    }

    try {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (!activeRound) {
        this.logger.warn(`[SCHEDULER_END_ROUND] No active round found`);
        return;
      }

      if (activeRound.status === GameStatus.FINISH_GAME) {
        this.logger.log(`[SCHEDULER_END_ROUND] Round already in FINISH_GAME state, skipping`);
        return;
      }

      this.logger.log(
        `[SCHEDULER_END_ROUND] Ending round: roundId=${activeRound.roundId} currentStatus=${activeRound.status}`,
      );

      this.sugarDaddyGameHandler.stopCoefficientBroadcast();

      const roundId = activeRound.roundId;
      await this.sugarDaddyGameService.endRound();

      await this.sugarDaddyGameBetService.settleUncashedBets(
        roundId,
        this.GAME_CODE,
      );

      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.logger.log(
          `[SCHEDULER_END_ROUND] Broadcasting FINISH_GAME state: roundId=${gameState.roundId} status=${gameState.status} crashCoeff=${gameState.coeffCrash || 'N/A'} betsCount=${gameState.bets.values.length}`,
        );
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
        this.logger.log(
          `[SCHEDULER_END_ROUND] ✅ FINISH_GAME state broadcasted successfully`,
        );
      } else {
        this.logger.error(`[SCHEDULER_END_ROUND] ❌ Failed to get game state after endRound`);
      }
    } catch (error) {
      this.logger.error(`[SCHEDULER_END_ROUND] Error ending round: ${error.message}`, error.stack);
    }
  }

  /**
   * Gradually add mock bets during WAIT_GAME phase
   * Adds 3-5 batches of 2-8 bets each, with 1.5-2.5 second intervals
   */
  private startGradualMockBetsAddition(): void {
    // Clear any existing timer
    if (this.mockBetsAdditionTimer) {
      clearInterval(this.mockBetsAdditionTimer);
      this.mockBetsAdditionTimer = null;
    }

    const pendingMockBets = this.sugarDaddyGameService.getPendingMockBets();
    if (pendingMockBets.length === 0) {
      this.logger.debug(`[MOCK_BETS] No pending mock bets to add gradually`);
      return;
    }

    // Determine number of batches (3-5)
    const numBatches = Math.floor(Math.random() * 3) + 3; // 3-5 batches
    const betsPerBatch = Math.ceil(pendingMockBets.length / numBatches);
    
    let batchIndex = 0;
    let addedCount = 0;

    const addBatch = async () => {
      if (!this.isLeader) {
        this.logger.debug(`[MOCK_BETS] Not leader, stopping gradual addition`);
        if (this.mockBetsAdditionTimer) {
          clearInterval(this.mockBetsAdditionTimer);
          this.mockBetsAdditionTimer = null;
        }
        return;
      }

      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (!activeRound || activeRound.status !== GameStatus.WAIT_GAME) {
        this.logger.debug(`[MOCK_BETS] Round not in WAIT_GAME, stopping gradual addition`);
        if (this.mockBetsAdditionTimer) {
          clearInterval(this.mockBetsAdditionTimer);
          this.mockBetsAdditionTimer = null;
        }
        return;
      }

      const remainingBets = this.sugarDaddyGameService.getPendingMockBets();
      if (remainingBets.length === 0) {
        this.logger.debug(`[MOCK_BETS] All mock bets added, stopping gradual addition`);
        if (this.mockBetsAdditionTimer) {
          clearInterval(this.mockBetsAdditionTimer);
          this.mockBetsAdditionTimer = null;
        }
        return;
      }

      // Determine batch size (2-8 bets, or remaining if less)
      const batchSize = Math.min(
        Math.floor(Math.random() * 7) + 2, // 2-8 bets
        remainingBets.length
      );

      const batch = remainingBets.slice(0, batchSize);
      await this.sugarDaddyGameService.addMockBetsBatch(batch);
      this.sugarDaddyGameService.removePendingMockBets(batch);
      addedCount += batch.length;

      // Broadcast updated game state
      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      }

      batchIndex++;
      this.logger.debug(
        // Log removed to reduce log size - mock bets are being added normally
      );

      // Stop if we've added all bets or reached max batches
      if (remainingBets.length <= batchSize || batchIndex >= numBatches) {
        if (this.mockBetsAdditionTimer) {
          clearInterval(this.mockBetsAdditionTimer);
          this.mockBetsAdditionTimer = null;
        }
        // Add any remaining bets
        const finalRemaining = this.sugarDaddyGameService.getPendingMockBets();
        if (finalRemaining.length > 0) {
          await this.sugarDaddyGameService.addMockBetsBatch(finalRemaining);
          this.sugarDaddyGameService.removePendingMockBets(finalRemaining);
          const finalGameState = await this.sugarDaddyGameService.getCurrentGameState();
          if (finalGameState) {
            this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, finalGameState);
          }
        }
      }
    };

    // Start adding batches with random intervals (1.5-2.5 seconds)
    const addFirstBatch = () => {
      addBatch().catch((error) => {
        this.logger.error(`[MOCK_BETS] Error adding mock bets batch: ${error.message}`);
      });
    };

    // Add first batch immediately
    setTimeout(addFirstBatch, 500); // Small delay to let round settle

    // Schedule subsequent batches
    this.mockBetsAdditionTimer = setInterval(() => {
      addBatch().catch((error) => {
        this.logger.error(`[MOCK_BETS] Error adding mock bets batch: ${error.message}`);
      });
    }, 1500 + Math.random() * 1000); // 1.5-2.5 seconds
  }

  private async transitionToInGame(): Promise<void> {
    if (!this.isLeader) {
      this.logger.warn(`[SUGAR_DADDY_SCHEDULER] Cannot transition to IN_GAME - not the leader`);
      return;
    }

    try {
      // Log removed to reduce log size - transition is working normally
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (!activeRound) {
        this.logger.error(`[SUGAR_DADDY_SCHEDULER] ❌ No active round found when transitioning to IN_GAME`);
        return;
      }
      
      if (activeRound.status !== GameStatus.WAIT_GAME) {
        this.logger.warn(`[SUGAR_DADDY_SCHEDULER] Round is not in WAIT_GAME status (current: ${activeRound.status}), skipping transition`);
        return;
      }

      this.logger.log(`[SUGAR_DADDY_SCHEDULER] Starting game (roundId=${activeRound.roundId})...`);
      await this.sugarDaddyGameService.startGame();
      this.logger.log(`[SUGAR_DADDY_SCHEDULER] ✅ Game started successfully`);

      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      } else {
        this.logger.error(`[SUGAR_DADDY_SCHEDULER] ❌ Failed to get game state after starting game`);
      }

      this.logger.log(`[SUGAR_DADDY_SCHEDULER] Starting coefficient broadcast...`);
      this.sugarDaddyGameHandler.startCoefficientBroadcast(this.GAME_CODE);
      this.logger.log(`[SUGAR_DADDY_SCHEDULER] ✅ Transition to IN_GAME complete`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[SUGAR_DADDY_SCHEDULER] ❌ Error transitioning to IN_GAME: ${errorMessage}${errorStack ? `\nStack: ${errorStack}` : ''}`,
      );
    }
  }
}
