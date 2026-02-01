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
      this.sugarDaddyGameHandler.setOnRoundEndCallback(() => {
        this.onRoundEnded();
      });
      
      setTimeout(() => {
        this.startLeaderElection().catch((error) => {
          this.logger.error(`[LEADER_ELECTION] Error: ${(error as Error).message}`);
        });
      }, 2000);
    } catch (error) {
      this.logger.error(`[SCHEDULER] Init error: ${(error as Error).message}`);
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
      const acquired = await this.sugarDaddyGameService.acquireLeaderLock(this.POD_ID);
      
      if (acquired) {
        this.isLeader = true;
        this.startGameLoop();
        this.startLeaderRenewal();
      } else {
        this.leaderElectionTimer = setTimeout(() => {
          this.startLeaderElection().catch((error) => {
            this.logger.error(`[LEADER_ELECTION] Retry error: ${(error as Error).message}`);
          });
        }, 5000);
      }
    } catch (error) {
      this.leaderElectionTimer = setTimeout(() => {
        this.startLeaderElection().catch((err) => {
          this.logger.error(`[LEADER_ELECTION] Error retry: ${(err as Error).message}`);
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
    if (this.isRunning || !this.isLeader) {
      return;
    }

    this.isRunning = true;
    this.startNewRound();
  }

  /**
   * Stop the game loop
   */
  private stopGameLoop(): void {
    this.clearAllTimers();
    this.isRunning = false;
    this.sugarDaddyGameHandler.stopCoefficientBroadcast();
    this.sugarDaddyGameHandler.stopGameStateBroadcast();
  }

  private clearAllTimers(): void {
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
    if (this.leaderElectionTimer) {
      clearTimeout(this.leaderElectionTimer);
      this.leaderElectionTimer = null;
    }
    if (this.leaderRenewTimer) {
      clearInterval(this.leaderRenewTimer);
      this.leaderRenewTimer = null;
    }
    if (this.mockBetsAdditionTimer) {
      clearInterval(this.mockBetsAdditionTimer);
      this.mockBetsAdditionTimer = null;
    }
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
      return;
    }

    try {
      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (activeRound) {
        if (activeRound.status === GameStatus.FINISH_GAME) {
          await this.sugarDaddyGameService.clearActiveRound();
        } else {
          await this.endRound();
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.sugarDaddyGameService.clearActiveRound();
        }
      }

      const round = await this.sugarDaddyGameService.startNewRound();

      const pendingBetsResult = await this.sugarDaddyGameBetService.processPendingBets(
        round.roundId,
        round.gameUUID,
      );
      
      if (pendingBetsResult.errors.length > 0) {
        this.logger.warn(`[SCHEDULER] Pending bet errors: ${pendingBetsResult.errors.length}`);
      }

      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      }

      this.startGradualMockBetsAddition();
      this.sugarDaddyGameHandler.startGameStateBroadcast(this.GAME_CODE);

      if (this.waitTimer) {
        clearTimeout(this.waitTimer);
      }
      
      this.waitTimer = setTimeout(async () => {
        if (this.isLeader) {
          await this.transitionToInGame();
        }
      }, this.WAIT_TIME_MS);
    } catch (error) {
      this.logger.error(`[SCHEDULER] Error starting round: ${(error as Error).message}`);
      if (this.isLeader && this.isRunning) {
        if (this.retryTimer) {
          clearTimeout(this.retryTimer);
        }
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (this.isLeader && this.isRunning) {
            this.startNewRound();
          }
        }, 5000);
      }
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

      await this.sugarDaddyGameBetService.settleUncashedBets(roundId, this.GAME_CODE);

      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      }
    } catch (error) {
      this.logger.error(`[END_ROUND] Error: ${(error as Error).message}`);
    }
  }

  private startGradualMockBetsAddition(): void {
    if (this.mockBetsAdditionTimer) {
      clearInterval(this.mockBetsAdditionTimer);
      this.mockBetsAdditionTimer = null;
    }

    const pendingMockBets = this.sugarDaddyGameService.getPendingMockBets();
    if (pendingMockBets.length === 0) {
      return;
    }

    const numBatches = Math.floor(Math.random() * 3) + 3;
    let batchIndex = 0;

    const addBatch = async () => {
      if (!this.isLeader) {
        this.clearIntervalTimer(this.mockBetsAdditionTimer);
        return;
      }

      const activeRound = await this.sugarDaddyGameService.getActiveRound();
      if (!activeRound || activeRound.status !== GameStatus.WAIT_GAME) {
        this.clearIntervalTimer(this.mockBetsAdditionTimer);
        return;
      }

      const remainingBets = this.sugarDaddyGameService.getPendingMockBets();
      if (remainingBets.length === 0) {
        this.clearIntervalTimer(this.mockBetsAdditionTimer);
        return;
      }

      const batchSize = Math.min(Math.floor(Math.random() * 7) + 2, remainingBets.length);
      const batch = remainingBets.slice(0, batchSize);
      
      await this.sugarDaddyGameService.addMockBetsBatch(batch);
      this.sugarDaddyGameService.removePendingMockBets(batch);

      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      }

      batchIndex++;

      if (remainingBets.length <= batchSize || batchIndex >= numBatches) {
        this.clearIntervalTimer(this.mockBetsAdditionTimer);
        
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

    setTimeout(() => {
      addBatch().catch((error) => {
        this.logger.error(`[MOCK_BETS] Error: ${(error as Error).message}`);
      });
    }, 500);

    this.mockBetsAdditionTimer = setInterval(() => {
      addBatch().catch((error) => {
        this.logger.error(`[MOCK_BETS] Error: ${(error as Error).message}`);
      });
    }, 1500 + Math.random() * 1000);
  }

  private clearIntervalTimer(timer: NodeJS.Timeout | null): void {
    if (timer) {
      clearInterval(timer);
      this.mockBetsAdditionTimer = null;
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

      await this.sugarDaddyGameService.startGame();

      const gameState = await this.sugarDaddyGameService.getCurrentGameState();
      if (gameState) {
        this.sugarDaddyGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      }

      this.sugarDaddyGameHandler.startCoefficientBroadcast(this.GAME_CODE);
    } catch (error) {
      this.logger.error(`[TRANSITION] Error: ${(error as Error).message}`);
    }
  }
}
