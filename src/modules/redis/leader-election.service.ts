import { Logger, OnModuleDestroy } from '@nestjs/common';
import { RedisService } from './redis.service';
import { DEFAULTS } from '../../config/defaults.config';

/**
 * Distributed leader election service using Redis
 * Provides atomic leader election with automatic lease renewal and failover
 * 
 * Features:
 * - Atomic leader election using Redis SET NX
 * - Automatic lease renewal to maintain leadership
 * - Graceful failover when leader dies
 * - Thread-safe and scalable across multiple servers
 * 
 * Note: This service is manually instantiated (not injected via DI) to allow
 * different service names per instance (e.g., 'hazard-scheduler', 'game-engine', etc.)
 */
export class LeaderElectionService implements OnModuleDestroy {
  private readonly logger = new Logger(LeaderElectionService.name);
  private readonly serverId: string;
  private readonly leaseTTL: number = DEFAULTS.GAMES.CHICKEN_ROAD.GAME.LEADER_LEASE_TTL; // seconds
  private readonly renewalInterval: number = 2000; // milliseconds (renew every 2 seconds)
  
  private leaseRenewalTimer?: NodeJS.Timeout;
  private isCurrentlyLeader: boolean = false;
  private leadershipKey: string;

  constructor(
    private readonly redisService: RedisService,
    private readonly serviceName: string = 'hazard-scheduler',
  ) {
    // Generate unique server identifier
    const hostname = process.env.HOSTNAME || 'server';
    const pid = process.pid;
    this.serverId = `${hostname}-${pid}`;
    this.leadershipKey = `leader:${serviceName}`;
    
    this.logger.log(
      `Leader election service initialized: serverId=${this.serverId} service=${serviceName}`,
    );
  }

  /**
   * Attempt to become the leader
   * Uses Redis SET NX EX for atomic leader election
   * @returns true if successfully became leader, false otherwise
   */
  async tryBecomeLeader(): Promise<boolean> {
    try {
      const client = this.redisService.getClient();
      
      // Atomic operation: SET key value EX ttl NX
      // Only succeeds if key doesn't exist (no current leader)
      const result = await client.set(
        this.leadershipKey,
        this.serverId,
        'EX',
        this.leaseTTL,
        'NX',
      );

      const acquired = result === 'OK';
      
      if (acquired) {
        this.isCurrentlyLeader = true;
        this.logger.log(
          `✅ Leadership acquired: serverId=${this.serverId} service=${this.serviceName} leaseTTL=${this.leaseTTL}s`,
        );
        this.startLeaseRenewal();
      } else {
        const currentLeader = await client.get(this.leadershipKey);
        this.logger.debug(
          `❌ Leadership not acquired: currentLeader=${currentLeader} serverId=${this.serverId}`,
        );
      }

      return acquired;
    } catch (error) {
      this.logger.error(
        `Failed to acquire leadership: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Check if this server is currently the leader
   * @returns true if this server is the leader, false otherwise
   */
  async isLeader(): Promise<boolean> {
    try {
      const client = this.redisService.getClient();
      const currentLeader = await client.get(this.leadershipKey);
      const isLeader = currentLeader === this.serverId;
      
      // Update internal state
      if (this.isCurrentlyLeader && !isLeader) {
        this.logger.warn(
          `⚠️ Leadership lost: serverId=${this.serverId} newLeader=${currentLeader}`,
        );
        this.isCurrentlyLeader = false;
        this.stopLeaseRenewal();
      } else if (!this.isCurrentlyLeader && isLeader) {
        this.logger.log(
          `✅ Leadership regained: serverId=${this.serverId}`,
        );
        this.isCurrentlyLeader = true;
        this.startLeaseRenewal();
      }

      return isLeader;
    } catch (error) {
      this.logger.error(
        `Failed to check leadership status: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Renew the leadership lease
   * Should be called periodically to maintain leadership
   * @returns true if lease was renewed successfully, false if no longer leader
   */
  async renewLease(): Promise<boolean> {
    try {
      const client = this.redisService.getClient();
      
      // Check if we're still the leader
      const currentLeader = await client.get(this.leadershipKey);
      
      if (currentLeader !== this.serverId) {
        this.logger.warn(
          `Lease renewal failed: no longer leader. currentLeader=${currentLeader} serverId=${this.serverId}`,
        );
        this.isCurrentlyLeader = false;
        this.stopLeaseRenewal();
        return false;
      }

      // Renew the lease
      await client.set(
        this.leadershipKey,
        this.serverId,
        'EX',
        this.leaseTTL,
      );

      this.logger.debug(
        `Lease renewed: serverId=${this.serverId} service=${this.serviceName} ttl=${this.leaseTTL}s`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to renew lease: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Voluntarily release leadership
   * Useful for graceful shutdown or manual leadership transfer
   */
  async releaseLeadership(): Promise<void> {
    try {
      const client = this.redisService.getClient();
      const currentLeader = await client.get(this.leadershipKey);
      
      if (currentLeader === this.serverId) {
        await client.del(this.leadershipKey);
        this.logger.log(
          `Leadership released: serverId=${this.serverId} service=${this.serviceName}`,
        );
      } else {
        this.logger.debug(
          `Cannot release leadership: not current leader. currentLeader=${currentLeader} serverId=${this.serverId}`,
        );
      }

      this.isCurrentlyLeader = false;
      this.stopLeaseRenewal();
    } catch (error) {
      this.logger.error(
        `Failed to release leadership: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Get the current leader's server ID
   * @returns server ID of current leader, or null if no leader
   */
  async getCurrentLeader(): Promise<string | null> {
    try {
      const client = this.redisService.getClient();
      return await client.get(this.leadershipKey);
    } catch (error) {
      this.logger.error(
        `Failed to get current leader: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  /**
   * Start automatic lease renewal
   * Renews lease every renewalInterval to maintain leadership
   */
  private startLeaseRenewal(): void {
    if (this.leaseRenewalTimer) {
      this.logger.debug('Lease renewal already running');
      return;
    }

    this.logger.debug(
      `Starting lease renewal: interval=${this.renewalInterval}ms ttl=${this.leaseTTL}s`,
    );

    this.leaseRenewalTimer = setInterval(async () => {
      const renewed = await this.renewLease();
      if (!renewed && this.isCurrentlyLeader) {
        // Lost leadership unexpectedly, try to regain
        this.logger.warn(
          `Lease renewal failed, attempting to regain leadership: serverId=${this.serverId}`,
        );
        const regained = await this.tryBecomeLeader();
        if (regained) {
          this.logger.log(
            `✅ Successfully regained leadership: serverId=${this.serverId}`,
          );
        }
      }
    }, this.renewalInterval);
  }

  /**
   * Stop automatic lease renewal
   */
  private stopLeaseRenewal(): void {
    if (this.leaseRenewalTimer) {
      clearInterval(this.leaseRenewalTimer);
      this.leaseRenewalTimer = undefined;
      this.logger.debug('Lease renewal stopped');
    }
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy() {
    this.logger.log(
      `Cleaning up leader election service: serverId=${this.serverId} service=${this.serviceName}`,
    );
    this.stopLeaseRenewal();
    
    // Optionally release leadership on shutdown (graceful)
    // Uncomment if you want to release leadership on shutdown
    // this.releaseLeadership().catch(err => {
    //   this.logger.error(`Error releasing leadership on shutdown: ${err.message}`);
    // });
  }

  /**
   * Get server identifier
   */
  getServerId(): string {
    return this.serverId;
  }

  /**
   * Check if currently leader (cached value, may be stale)
   * For real-time check, use isLeader() instead
   */
  getIsCurrentlyLeader(): boolean {
    return this.isCurrentlyLeader;
  }
}
