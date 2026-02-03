import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WalletAuditStatus } from '@games-vector/game-core';
import { WalletFailureTrackingService } from './wallet-failure-tracking.service';

/**
 * Service that monitors WalletAudit for failures and triggers notifications
 * Uses scheduled job to check for recent failures (more reliable than interceptors for service-to-service calls)
 */
@Injectable()
export class WalletErrorInterceptor implements OnModuleInit {
  private readonly logger = new Logger(WalletErrorInterceptor.name);
  private readonly CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
  private lastCheckTime: Date = new Date(Date.now() - 60000); // Start 1 minute ago

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly walletFailureTrackingService: WalletFailureTrackingService,
  ) {}

  onModuleInit() {
    this.logger.log('[WALLET_ERROR_MONITOR] Starting wallet failure monitoring service');
    // Start monitoring immediately
    this.checkForFailures();
  }

  /**
   * Scheduled job to check for recent wallet failures
   * Runs every 30 seconds
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkForFailures(): Promise<void> {
    try {
      const now = new Date();
      
      // Query for failures since last check
      const failures = await this.dataSource.query(
        `SELECT agentId, apiAction, failureType, errorMessage, callbackUrl, createdAt, status
         FROM wallet_audit 
         WHERE status = ? 
         AND createdAt > ? 
         AND createdAt <= ?
         ORDER BY createdAt DESC 
         LIMIT 100`,
        ['FAILURE', this.lastCheckTime, now],
      );

      // Process failures
      for (const auditRow of failures) {
        // Only process if it's a failure status
        if (auditRow.status !== 'FAILURE') {
          continue;
        }

        await this.handleWalletFailure({
          agentId: auditRow.agentId,
          apiAction: auditRow.apiAction,
          failureType: auditRow.failureType,
          errorMessage: auditRow.errorMessage,
          callbackUrl: auditRow.callbackUrl,
        });
      }

      this.lastCheckTime = now;
    } catch (error) {
      this.logger.error(
        `[WALLET_ERROR_MONITOR] Error checking for failures: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Handle wallet failure from audit record
   */
  private async handleWalletFailure(audit: {
    agentId: string;
    apiAction: string;
    failureType?: string;
    errorMessage?: string;
    callbackUrl?: string;
  }): Promise<void> {
    try {
      if (!audit.agentId) {
        return;
      }

      await this.walletFailureTrackingService.recordFailure({
        agentId: audit.agentId,
        errorType: audit.failureType || 'UNKNOWN_ERROR',
        errorMessage: audit.errorMessage || 'Unknown error',
        apiAction: audit.apiAction,
        callbackUrl: audit.callbackUrl,
      });
    } catch (error) {
      this.logger.error(
        `[WALLET_ERROR_MONITOR] Error handling wallet failure: ${(error as Error).message}`,
      );
    }
  }

}
