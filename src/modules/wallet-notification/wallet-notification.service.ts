import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { GameConfigService } from '../game-config/game-config.service';

interface EmailConfig {
  to: string;
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
}

interface ErrorDetails {
  agentId: string;
  errorType: string;
  errorMessage: string;
  apiAction: string;
  callbackUrl?: string;
  timestamp: Date;
}

@Injectable()
export class WalletNotificationService {
  private readonly logger = new Logger(WalletNotificationService.name);
  private emailConfig: EmailConfig | null = null;
  private configLoadAttempted = false;

  constructor(private readonly gameConfigService: GameConfigService) {}

  /**
   * Load email configuration from platform config table
   * Caches config in memory to avoid repeated DB queries
   */
  private async loadEmailConfig(): Promise<EmailConfig | null> {
    if (this.emailConfig) {
      return this.emailConfig;
    }

    if (this.configLoadAttempted) {
      // Already tried loading, return null to avoid repeated errors
      return null;
    }

    try {
      const configValue = await this.gameConfigService.getConfig('platform', 'email_notification_config');
      
      if (!configValue) {
        this.logger.error(
          '[WALLET_NOTIFICATION] Email notification config not found in game_config_platform table. Key: email_notification_config',
        );
        this.configLoadAttempted = true;
        return null;
      }

      try {
        const parsed = JSON.parse(configValue) as EmailConfig;
        
        // Validate required fields
        if (!parsed.to || !parsed.smtp || !parsed.smtp.host || !parsed.smtp.user || !parsed.smtp.pass) {
          this.logger.error(
            '[WALLET_NOTIFICATION] Email notification config is missing required fields (to, smtp.host, smtp.user, smtp.pass)',
          );
          this.configLoadAttempted = true;
          return null;
        }

        this.emailConfig = parsed;
        this.logger.log('[WALLET_NOTIFICATION] Email notification config loaded successfully');
        return this.emailConfig;
      } catch (parseError) {
        this.logger.error(
          `[WALLET_NOTIFICATION] Failed to parse email notification config JSON: ${(parseError as Error).message}`,
        );
        this.configLoadAttempted = true;
        return null;
      }
    } catch (error) {
      this.logger.error(
        `[WALLET_NOTIFICATION] Error loading email notification config: ${(error as Error).message}`,
      );
      this.configLoadAttempted = true;
      return null;
    }
  }

  /**
   * Send email notification for wallet failure
   * Returns true if email was sent successfully, false otherwise
   */
  async sendEmailNotification(errorDetails: ErrorDetails): Promise<boolean> {
    const config = await this.loadEmailConfig();
    
    if (!config) {
      // Config not available, skip notification (already logged)
      return false;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port || 587,
        secure: false, // true for 465, false for other ports
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
      });

      const subject = `[Wallet Failure] Agent ${errorDetails.agentId} - ${errorDetails.errorType}`;
      const body = this.buildEmailBody(errorDetails);

      const mailOptions = {
        from: config.smtp.from,
        to: config.to,
        subject,
        text: body,
        html: this.buildEmailHtml(errorDetails),
      };

      await transporter.sendMail(mailOptions);
      
      this.logger.log(
        `[WALLET_NOTIFICATION] Email notification sent successfully for agent ${errorDetails.agentId}`,
      );
      return true;
    } catch (error) {
      // Log error but don't crash application
      this.logger.error(
        `[WALLET_NOTIFICATION] Failed to send email notification for agent ${errorDetails.agentId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Build plain text email body
   */
  private buildEmailBody(errorDetails: ErrorDetails): string {
    return `
Wallet Service Failure Alert

Agent ID: ${errorDetails.agentId}
Error Type: ${errorDetails.errorType}
API Action: ${errorDetails.apiAction}
Timestamp: ${errorDetails.timestamp.toISOString()}
Callback URL: ${errorDetails.callbackUrl || 'N/A'}

Error Message:
${errorDetails.errorMessage}

---
This is an automated notification from the wallet failure monitoring system.
Please investigate the wallet service for agent ${errorDetails.agentId}.
    `.trim();
  }

  /**
   * Build HTML email body
   */
  private buildEmailHtml(errorDetails: ErrorDetails): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #dc3545; color: white; padding: 15px; border-radius: 5px 5px 0 0; }
    .content { background-color: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; }
    .detail-row { margin: 10px 0; padding: 10px; background-color: white; border-left: 3px solid #dc3545; }
    .label { font-weight: bold; color: #495057; }
    .value { color: #212529; }
    .error-message { background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 15px 0; }
    .footer { margin-top: 20px; padding: 10px; font-size: 12px; color: #6c757d; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>⚠️ Wallet Service Failure Alert</h2>
    </div>
    <div class="content">
      <div class="detail-row">
        <span class="label">Agent ID:</span>
        <span class="value">${errorDetails.agentId}</span>
      </div>
      <div class="detail-row">
        <span class="label">Error Type:</span>
        <span class="value">${errorDetails.errorType}</span>
      </div>
      <div class="detail-row">
        <span class="label">API Action:</span>
        <span class="value">${errorDetails.apiAction}</span>
      </div>
      <div class="detail-row">
        <span class="label">Timestamp:</span>
        <span class="value">${errorDetails.timestamp.toISOString()}</span>
      </div>
      <div class="detail-row">
        <span class="label">Callback URL:</span>
        <span class="value">${errorDetails.callbackUrl || 'N/A'}</span>
      </div>
      <div class="error-message">
        <strong>Error Message:</strong><br>
        ${errorDetails.errorMessage.replace(/\n/g, '<br>')}
      </div>
    </div>
    <div class="footer">
      This is an automated notification from the wallet failure monitoring system.<br>
      Please investigate the wallet service for agent ${errorDetails.agentId}.
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Clear cached config (useful for testing or config updates)
   */
  clearConfigCache(): void {
    this.emailConfig = null;
    this.configLoadAttempted = false;
  }
}
