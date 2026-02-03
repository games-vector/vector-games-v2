import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DiverGameService } from './diver-game.service';
import { DiverGameHandler } from './diver-game.handler';
import { DiverGameBetService } from './diver-game-bet.service';
import { GameStatus } from '../shared/DTO/game-state.dto';
import { DEFAULTS } from '../../config/defaults.config';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DiverGameScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiverGameScheduler.name);
  private readonly GAME_CODE = DEFAULTS.DIVER.GAME_CODE;
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
  private isRunning = false;
  private isLeader = false;

  constructor(
    private readonly diverGameService: DiverGameService,
    private readonly diverGameHandler: DiverGameHandler,
    private readonly diverGameBetService: DiverGameBetService,
  ) {}

  onModuleInit() {
    try {
      this.logger.log(`[DIVER_SCHEDULER] ✅ Initializing with podId=${this.POD_ID}`);
      this.diverGameHandler.setOnRoundEndCallback(() => {
        this.onRoundEnded();
      });
      
      setTimeout(() => {
        this.logger.log(`[DIVER_SCHEDULER] Starting leader election in 2 seconds...`);
        this.startLeaderElection().catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`[DIVER_SCHEDULER] ❌ Error in startLeaderElection: ${errorMessage}`);
        });
      }, 2000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[DIVER_SCHEDULER] ❌ Error in onModuleInit: ${errorMessage}${errorStack ? `\nStack: ${errorStack}` : ''}`,
      );
    }
  }

  onModuleDestroy() {
    this.stopGameLoop();
    this.stopLeaderElection();
    this.diverGameService.releaseLeaderLock(this.POD_ID).catch((error) => {
      this.logger.error(`[LEADER_ELECTION] Error releasing lock on shutdown: ${error.message}`);
    });
  }

  private async startLeaderElection(): Promise<void> {
    try {
      this.logger.log(`[DIVER_LEADER_ELECTION] Attempting to acquire leader lock for pod ${this.POD_ID}`);
      const acquired = await this.diverGameService.acquireLeaderLock(this.POD_ID);
      
      if (acquired) {
        this.isLeader = true;
        this.logger.log(`[DIVER_LEADER_ELECTION] ✅ Pod ${this.POD_ID} is now the leader - starting game loop`);
        this.startGameLoop();
        this.startLeaderRenewal();
      } else {
        this.logger.warn(`[DIVER_LEADER_ELECTION] ❌ Pod ${this.POD_ID} failed to acquire leader lock - another pod may be leader. Retrying in 5 seconds...`);
        this.leaderElectionTimer = setTimeout(() => {
          this.startLeaderElection().catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[DIVER_LEADER_ELECTION] ❌ Error in retry: ${errorMessage}`);
          });
        }, 5000);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[DIVER_LEADER_ELECTION] ❌ Error during leader election: ${errorMessage}${errorStack ? `\nStack: ${errorStack}` : ''}`,
      );
      // Retry after 5 seconds even on error
      this.leaderElectionTimer = setTimeout(() => {
        this.startLeaderElection().catch((err) => {
          this.logger.error(`[DIVER_LEADER_ELECTION] ❌ Error in error retry: ${err instanceof Error ? err.message : String(err)}`);
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
        const stillLeader = await this.diverGameService.renewLeaderLock(this.POD_ID);
        if (!stillLeader) {
          this.logger.warn(`[LEADER_ELECTION] Pod ${this.POD_ID} lost leadership - stopping game loop`);
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

  private startGameLoop(): void {
    if (this.isRunning) {
      this.logger.warn(`[DIVER_SCHEDULER] Game loop already running, skipping start`);
      return;
    }

    if (!this.isLeader) {
      this.logger.warn(`[DIVER_SCHEDULER] Cannot start game loop - not the leader (podId=${this.POD_ID})`);
      return;
    }

    this.logger.log(`[DIVER_SCHEDULER] ✅ Starting game loop (podId=${this.POD_ID})`);
    this.isRunning = true;
    this.startNewRound();
  }

  private startGradualMockBetsAddition(): void {
    if (this.mockBetsAdditionTimer) {
      clearInterval(this.mockBetsAdditionTimer);
      this.mockBetsAdditionTimer = null;
    }

    const pendingMockBets = this.diverGameService.getPendingMockBets();
    if (pendingMockBets.length === 0) {
      return;
    }

    const numBatches = Math.floor(Math.random() * 3) + 3;
    let batchIndex = 0;

    const addBatch = async () => {
      if (!this.isLeader) {
        if (this.mockBetsAdditionTimer) {
          clearInterval(this.mockBetsAdditionTimer);
          this.mockBetsAdditionTimer = null;
        }
        return;
      }

      const activeRound = await this.diverGameService.getActiveRound();
      if (!activeRound || activeRound.status !== GameStatus.WAIT_GAME) {
        if (this.mockBetsAdditionTimer) {
          clearInterval(this.mockBetsAdditionTimer);
          this.mockBetsAdditionTimer = null;
        }
        return;
      }

      const remainingBets = this.diverGameService.getPendingMockBets();
      if (remainingBets.length === 0) {
        if (this.mockBetsAdditionTimer) {
          clearInterval(this.mockBetsAdditionTimer);
          this.mockBetsAdditionTimer = null;
        }
        return;
      }

      const batchSize = Math.min(Math.floor(Math.random() * 7) + 2, remainingBets.length);
      const batch = remainingBets.slice(0, batchSize);
      
      await this.diverGameService.addMockBetsBatch(batch);
      this.diverGameService.removePendingMockBets(batch);

      const gameState = await this.diverGameService.getCurrentGameState();
      if (gameState) {
        this.diverGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      }

      batchIndex++;

      if (remainingBets.length <= batchSize || batchIndex >= numBatches) {
        if (this.mockBetsAdditionTimer) {
          clearInterval(this.mockBetsAdditionTimer);
          this.mockBetsAdditionTimer = null;
        }
        
        const finalRemaining = this.diverGameService.getPendingMockBets();
        if (finalRemaining.length > 0) {
          await this.diverGameService.addMockBetsBatch(finalRemaining);
          this.diverGameService.removePendingMockBets(finalRemaining);
          
          const finalGameState = await this.diverGameService.getCurrentGameState();
          if (finalGameState) {
            this.diverGameHandler.broadcastGameStateChange(this.GAME_CODE, finalGameState);
          }
        }
      }
    };

    const interval = Math.floor(Math.random() * 2000) + 1000;
    this.mockBetsAdditionTimer = setInterval(addBatch, interval);
    addBatch();
  }

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
    if (this.mockBetsAdditionTimer) {
      clearInterval(this.mockBetsAdditionTimer);
      this.mockBetsAdditionTimer = null;
    }
    this.isRunning = false;
    this.diverGameHandler.stopCoefficientBroadcast();
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
      this.logger.warn(`[DIVER_SCHEDULER] Cannot start new round - not the leader (podId=${this.POD_ID})`);
      return;
    }

    this.logger.log(`[DIVER_SCHEDULER] Starting new round (podId=${this.POD_ID}, isLeader=${this.isLeader})`);
    try {
      const activeRound = await this.diverGameService.getActiveRound();
      if (activeRound) {
        this.logger.log(`[DIVER_SCHEDULER] Found existing active round: roundId=${activeRound.roundId} status=${activeRound.status}`);
        if (activeRound.status === GameStatus.FINISH_GAME) {
          this.logger.log(`[DIVER_SCHEDULER] Clearing finished round`);
          await this.diverGameService.clearActiveRound();
        } else {
          this.logger.warn('[DIVER_SCHEDULER] Previous round still active, forcing end');
          await this.endRound();
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.diverGameService.clearActiveRound();
        }
      } else {
        this.logger.log(`[DIVER_SCHEDULER] No existing active round found, creating new one`);
      }

      this.logger.log(`[DIVER_SCHEDULER] Calling startNewRound()...`);
      const round = await this.diverGameService.startNewRound();
      this.logger.log(`[DIVER_SCHEDULER] ✅ New round created: roundId=${round.roundId} gameUUID=${round.gameUUID} crashCoeff=${round.crashCoeff}`);

      this.logger.log(`[DIVER_SCHEDULER] Processing pending bets...`);
      const pendingBetsResult = await this.diverGameBetService.processPendingBets(
        round.roundId,
        round.gameUUID,
      );
      
      if (pendingBetsResult.errors.length > 0) {
        this.logger.warn(
          `[DIVER_SCHEDULER] Pending bet errors: ${JSON.stringify(pendingBetsResult.errors)}`,
        );
      } else {
        this.logger.log(`[DIVER_SCHEDULER] ✅ Pending bets processed: ${pendingBetsResult.processed} processed, ${pendingBetsResult.errors.length} errors`);
      }

      this.logger.log(`[DIVER_SCHEDULER] Getting current game state...`);
      const gameState = await this.diverGameService.getCurrentGameState();
      if (gameState) {
        this.logger.log(`[DIVER_SCHEDULER] ✅ Game state retrieved: status=${gameState.status} roundId=${gameState.roundId} betsCount=${gameState.bets.values.length}`);
        this.diverGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      } else {
        this.logger.error(`[DIVER_SCHEDULER] ❌ Failed to get game state after creating round!`);
      }

      this.logger.log(`[DIVER_SCHEDULER] Starting game state broadcast...`);
      this.diverGameHandler.startGameStateBroadcast(this.GAME_CODE);

      // Start gradual mock bets addition
      this.startGradualMockBetsAddition();

      if (this.waitTimer) {
        clearTimeout(this.waitTimer);
      }
      this.logger.log(`[DIVER_SCHEDULER] Setting wait timer for ${this.WAIT_TIME_MS}ms before transitioning to IN_GAME`);
      this.waitTimer = setTimeout(async () => {
        if (this.isLeader) {
          this.logger.log(`[DIVER_SCHEDULER] Wait timer expired, transitioning to IN_GAME...`);
          await this.transitionToInGame();
        } else {
          this.logger.warn(`[DIVER_SCHEDULER] Wait timer expired but not leader anymore, skipping transition`);
        }
      }, this.WAIT_TIME_MS);
      
      this.logger.log(`[DIVER_SCHEDULER] ✅ New round setup complete`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[DIVER_SCHEDULER] ❌ Error starting new round: ${errorMessage}${errorStack ? `\nStack: ${errorStack}` : ''}`,
      );
      // Retry after 5 seconds if there's an error (only if still leader and running)
      if (this.isLeader && this.isRunning) {
        // Clear any existing retry timer
        if (this.retryTimer) {
          clearTimeout(this.retryTimer);
        }
        this.logger.log(`[DIVER_SCHEDULER] Retrying in 5 seconds...`);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (this.isLeader && this.isRunning) {
            this.startNewRound();
          }
        }, 5000);
      } else {
        this.logger.warn(`[DIVER_SCHEDULER] Not retrying - isLeader=${this.isLeader} isRunning=${this.isRunning}`);
      }
    }
  }

  private async endRound(): Promise<void> {
    if (!this.isLeader) {
      this.logger.debug(`[SCHEDULER_END_ROUND] Not the leader, skipping endRound`);
      return;
    }

    try {
      const activeRound = await this.diverGameService.getActiveRound();
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

      this.diverGameHandler.stopCoefficientBroadcast();

      const roundId = activeRound.roundId;
      await this.diverGameService.endRound();

      await this.diverGameBetService.settleUncashedBets(
        roundId,
        this.GAME_CODE,
      );

      const gameState = await this.diverGameService.getCurrentGameState();
      if (gameState) {
        this.logger.log(
          `[SCHEDULER_END_ROUND] Broadcasting FINISH_GAME state: roundId=${gameState.roundId} status=${gameState.status} crashCoeff=${gameState.coeffCrash || 'N/A'} betsCount=${gameState.bets.values.length}`,
        );
        this.diverGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
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

  private async transitionToInGame(): Promise<void> {
    if (!this.isLeader) {
      this.logger.warn(`[DIVER_SCHEDULER] Cannot transition to IN_GAME - not the leader`);
      return;
    }

    try {
      this.logger.log(`[DIVER_SCHEDULER] Transitioning to IN_GAME...`);
      const activeRound = await this.diverGameService.getActiveRound();
      if (!activeRound) {
        this.logger.error(`[DIVER_SCHEDULER] ❌ No active round found when transitioning to IN_GAME`);
        return;
      }
      
      if (activeRound.status !== GameStatus.WAIT_GAME) {
        this.logger.warn(`[DIVER_SCHEDULER] Round is not in WAIT_GAME status (current: ${activeRound.status}), skipping transition`);
        return;
      }

      this.logger.log(`[DIVER_SCHEDULER] Starting game (roundId=${activeRound.roundId})...`);
      await this.diverGameService.startGame();
      this.logger.log(`[DIVER_SCHEDULER] ✅ Game started successfully`);

      const gameState = await this.diverGameService.getCurrentGameState();
      if (gameState) {
        this.logger.log(`[DIVER_SCHEDULER] Broadcasting IN_GAME state: roundId=${gameState.roundId}`);
        this.diverGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      } else {
        this.logger.error(`[DIVER_SCHEDULER] ❌ Failed to get game state after starting game`);
      }

      this.logger.log(`[DIVER_SCHEDULER] Starting coefficient broadcast...`);
      this.diverGameHandler.startCoefficientBroadcast(this.GAME_CODE);
      this.logger.log(`[DIVER_SCHEDULER] ✅ Transition to IN_GAME complete`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[DIVER_SCHEDULER] ❌ Error transitioning to IN_GAME: ${errorMessage}${errorStack ? `\nStack: ${errorStack}` : ''}`,
      );
    }
  }
}
