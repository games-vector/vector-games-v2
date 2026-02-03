import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WalletNotificationService } from './wallet-notification.service';

interface ErrorDetails {
  agentId: string;
  errorType: string;
  errorMessage: string;
  apiAction: string;
  callbackUrl?: string;
}

@Injectable()
export class WalletFailureTrackingService {
  private readonly logger = new Logger(WalletFailureTrackingService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly walletNotificationService: WalletNotificationService,
  ) {}

  /**
   * Check if notification has already been sent for this agent
   */
  async isNotificationAlreadySent(agentId: string): Promise<boolean> {
    try {
      const result = await this.dataSource.query(
        `SELECT wallet_failure_notification_sent FROM agents WHERE agentId = ? LIMIT 1`,
        [agentId],
      );

      if (!result || result.length === 0) {
        this.logger.warn(`[WALLET_FAILURE_TRACKING] Agent not found: ${agentId}`);
        return false;
      }

      return result[0].wallet_failure_notification_sent === 1 || result[0].wallet_failure_notification_sent === true;
    } catch (error) {
      this.logger.error(
        `[WALLET_FAILURE_TRACKING] Error checking notification flag for agent ${agentId}: ${(error as Error).message}`,
      );
      // On error, assume notification not sent to be safe
      return false;
    }
  }

  /**
   * Record wallet failure and send notification if not already sent
   */
  async recordFailure(errorDetails: ErrorDetails): Promise<void> {
    try {
      const isAlreadySent = await this.isNotificationAlreadySent(errorDetails.agentId);

      // Update failure tracking fields
      await this.updateFailureFields(errorDetails);

      // Send notification only if not already sent
      if (!isAlreadySent) {
        this.logger.log(
          `[WALLET_FAILURE_TRACKING] First failure for agent ${errorDetails.agentId}, sending notification`,
        );

        // Set notification flag
        await this.setNotificationFlag(errorDetails.agentId, true);

        // Send email notification (non-blocking)
        this.walletNotificationService
          .sendEmailNotification({
            ...errorDetails,
            timestamp: new Date(),
          })
          .catch((error) => {
            this.logger.error(
              `[WALLET_FAILURE_TRACKING] Failed to send notification for agent ${errorDetails.agentId}: ${(error as Error).message}`,
            );
          });
      } else {
        this.logger.debug(
          `[WALLET_FAILURE_TRACKING] Notification already sent for agent ${errorDetails.agentId}, skipping`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[WALLET_FAILURE_TRACKING] Error recording failure for agent ${errorDetails.agentId}: ${(error as Error).message}`,
      );
      // Don't throw - we don't want to break the application flow
    }
  }

  /**
   * Update failure tracking fields in agents table
   */
  private async updateFailureFields(errorDetails: ErrorDetails): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE agents 
         SET wallet_last_failure_at = NOW(),
             wallet_last_error_message = ?,
             wallet_last_error_type = ?
         WHERE agentId = ?`,
        [errorDetails.errorMessage, errorDetails.errorType, errorDetails.agentId],
      );
    } catch (error) {
      this.logger.error(
        `[WALLET_FAILURE_TRACKING] Error updating failure fields for agent ${errorDetails.agentId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Set notification flag in agents table
   */
  private async setNotificationFlag(agentId: string, value: boolean): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE agents SET wallet_failure_notification_sent = ? WHERE agentId = ?`,
        [value ? 1 : 0, agentId],
      );
    } catch (error) {
      this.logger.error(
        `[WALLET_FAILURE_TRACKING] Error setting notification flag for agent ${agentId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Reset notification flag (for manual SQL reset support)
   * This method is provided for completeness but typically reset is done via SQL
   */
  async resetNotificationFlag(agentId: string): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE agents 
         SET wallet_failure_notification_sent = FALSE,
             wallet_last_failure_at = NULL,
             wallet_last_error_message = NULL,
             wallet_last_error_type = NULL
         WHERE agentId = ?`,
        [agentId],
      );
      this.logger.log(`[WALLET_FAILURE_TRACKING] Notification flag reset for agent ${agentId}`);
    } catch (error) {
      this.logger.error(
        `[WALLET_FAILURE_TRACKING] Error resetting notification flag for agent ${agentId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
