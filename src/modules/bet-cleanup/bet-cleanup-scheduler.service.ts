import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BetService } from '@vector-games/game-core';
import { RedisService } from '../redis/redis.service';

/**
 * Monthly scheduler that deletes bets older than 2 months
 * Runs on the 1st of every month at 00:00:00 UTC
 * 
 * Example: On December 1st, keeps bets from October and November,
 * deletes everything before October 1st
 * 
 * Uses distributed lock to prevent concurrent execution across multiple instances
 * Stores last run date in Redis for multi-instance coordination
 */
@Injectable()
export class BetCleanupSchedulerService {
  private readonly logger = new Logger(BetCleanupSchedulerService.name);
  private readonly LOCK_KEY = 'bet-cleanup-scheduler-lock';
  private readonly LOCK_TTL_SECONDS = 3600; // 1 hour lock (should be enough for cleanup)
  private readonly LAST_RUN_KEY = 'bet-cleanup-last-run';

  constructor(
    private readonly betService: BetService,
    private readonly redisService: RedisService,
  ) {
    this.logger.log('Bet cleanup scheduler initialized');
  }

  /**
   * Cron job: Runs on the 1st of every month at 00:00:00 UTC
   * Cron expression: "0 0 1 * *" = minute 0, hour 0, day 1, every month, any day of week
   */
  @Cron('0 0 1 * *', {
    name: 'monthly-bet-cleanup',
    timeZone: 'UTC',
  })
  async handleMonthlyCleanup() {
    this.logger.log(
      `[BET_CLEANUP_TRIGGERED] Monthly cleanup cron triggered at ${new Date().toISOString()}`,
    );
    await this.runCleanup();
  }

  /**
   * Run the cleanup process
   * Deletes all bets older than 2 months (keeps current month and previous month)
   * Uses distributed lock to prevent concurrent execution
   */
  async runCleanup(): Promise<void> {
    // Acquire distributed lock to prevent concurrent processing across multiple instances
    const lockAcquired = await this.redisService.acquireLock(
      this.LOCK_KEY,
      this.LOCK_TTL_SECONDS,
    );

    if (!lockAcquired) {
      this.logger.debug(
        '[BET_CLEANUP_SKIPPED] Lock already held by another instance, skipping this run',
      );
      return;
    }

    try {
      // Check if we already ran today (prevent duplicate runs)
      const todayKey = this.getTodayKey();
      const lastRun = await this.redisService.get<string>(this.LAST_RUN_KEY);
      
      if (lastRun === todayKey) {
        this.logger.debug(
          `[BET_CLEANUP_SKIPPED] Already ran today (${todayKey}), skipping`,
        );
        return;
      }

      const now = new Date();
      
      // Calculate the cutoff date: 2 months before the current month
      // Example: If today is Dec 1, cutoff is Oct 1 (keeps Oct and Nov)
      const cutoffDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      cutoffDate.setHours(0, 0, 0, 0);

      this.logger.log(
        `[BET_CLEANUP_START] Starting bet cleanup - deleting bets before ${cutoffDate.toISOString()}`,
      );

      const deletedCount = await this.betService.deleteBetsBeforeDate(cutoffDate);

      // Store last run date in Redis (expires after 3 days to auto-cleanup)
      await this.redisService.set(this.LAST_RUN_KEY, todayKey, 3 * 24 * 60 * 60);

      this.logger.log(
        `[BET_CLEANUP_COMPLETE] Deleted ${deletedCount} bet(s) created before ${cutoffDate.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `[BET_CLEANUP_ERROR] Failed to run bet cleanup: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      // Always release the lock
      await this.redisService.releaseLock(this.LOCK_KEY);
    }
  }

  /**
   * Get today's key for tracking last run date
   */
  private getTodayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  }

  /**
   * Manually trigger cleanup (for testing or manual execution)
   */
  async manualCleanup(): Promise<number> {
    this.logger.log('[BET_CLEANUP_MANUAL] Manual cleanup triggered');
    await this.runCleanup();
    const now = new Date();
    const cutoffDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    cutoffDate.setHours(0, 0, 0, 0);
    return await this.betService.deleteBetsBeforeDate(cutoffDate);
  }
}
