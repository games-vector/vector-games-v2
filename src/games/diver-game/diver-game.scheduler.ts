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
  private isRunning = false;
  private isLeader = false;

  constructor(
    private readonly diverGameService: DiverGameService,
    private readonly diverGameHandler: DiverGameHandler,
    private readonly diverGameBetService: DiverGameBetService,
  ) {}

  onModuleInit() {
    this.diverGameHandler.setOnRoundEndCallback(() => {
      this.onRoundEnded();
    });
    
    setTimeout(() => {
      this.startLeaderElection();
    }, 2000);
  }

  onModuleDestroy() {
    this.stopGameLoop();
    this.stopLeaderElection();
    this.diverGameService.releaseLeaderLock(this.POD_ID).catch((error) => {
      this.logger.error(`[LEADER_ELECTION] Error releasing lock on shutdown: ${error.message}`);
    });
  }

  private async startLeaderElection(): Promise<void> {
    const acquired = await this.diverGameService.acquireLeaderLock(this.POD_ID);
    
    if (acquired) {
      this.isLeader = true;
      this.logger.log(`[LEADER_ELECTION] Pod ${this.POD_ID} is now the leader`);
      this.startGameLoop();
      this.startLeaderRenewal();
    } else {
      this.leaderElectionTimer = setTimeout(() => {
        this.startLeaderElection();
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
      return;
    }

    if (!this.isLeader) {
      return;
    }

    this.isRunning = true;
    this.startNewRound();
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
      this.logger.warn('[DIVER_SCHEDULER] Cannot start new round - not the leader');
      return;
    }

    try {
      const activeRound = await this.diverGameService.getActiveRound();
      if (activeRound) {
        if (activeRound.status === GameStatus.FINISH_GAME) {
          await this.diverGameService.clearActiveRound();
        } else {
          this.logger.warn('[DIVER_SCHEDULER] Previous round still active, forcing end');
          await this.endRound();
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.diverGameService.clearActiveRound();
        }
      }

      const round = await this.diverGameService.startNewRound();

      const pendingBetsResult = await this.diverGameBetService.processPendingBets(
        round.roundId,
        round.gameUUID,
      );
      
      if (pendingBetsResult.errors.length > 0) {
        this.logger.warn(
          `[DIVER_SCHEDULER] Pending bet errors: ${JSON.stringify(pendingBetsResult.errors)}`,
        );
      }

      const gameState = await this.diverGameService.getCurrentGameState();
      if (gameState) {
        this.diverGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      }

      this.diverGameHandler.startGameStateBroadcast(this.GAME_CODE);

      if (this.waitTimer) {
        clearTimeout(this.waitTimer);
      }
      this.waitTimer = setTimeout(async () => {
        if (this.isLeader) {
          await this.transitionToInGame();
        }
      }, this.WAIT_TIME_MS);
    } catch (error) {
      this.logger.error(`[DIVER_SCHEDULER] Error starting new round: ${error.message}`);
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
      return;
    }

    try {
      const activeRound = await this.diverGameService.getActiveRound();
      if (!activeRound || activeRound.status !== GameStatus.WAIT_GAME) {
        return;
      }

      await this.diverGameService.startGame();

      const gameState = await this.diverGameService.getCurrentGameState();
      if (gameState) {
        this.diverGameHandler.broadcastGameStateChange(this.GAME_CODE, gameState);
      }

      this.diverGameHandler.startCoefficientBroadcast(this.GAME_CODE);
    } catch (error) {
      this.logger.error(`[DIVER_SCHEDULER] Error transitioning to IN_GAME: ${error.message}`);
    }
  }
}
