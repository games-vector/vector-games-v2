import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { DEFAULTS } from '../../config/defaults.config';

@Injectable()
export class UserSessionService {
  private readonly logger = new Logger(UserSessionService.name);
  private readonly SESSION_KEY = 'loggedInUsers:set';

  constructor(private readonly redisService: RedisService) {}

  async addSession(userId: string, agentId: string, gameCode: string = 'sugar-daddy'): Promise<void> {
    const sessionId = `${userId}:${agentId}`;
    const client = this.redisService.getClient();
    const ttl = DEFAULTS.REDIS.DEFAULT_TTL; // Use default TTL
    
    const added = await client.sadd(this.SESSION_KEY, sessionId);
    await client.expire(this.SESSION_KEY, ttl);
    
    this.logger.log(`[USER_SESSION] Added session: ${sessionId} (was new: ${added === 1})`);
  }

  async removeSession(userId: string, agentId: string): Promise<void> {
    const sessionId = `${userId}:${agentId}`;
    const client = this.redisService.getClient();
    
    await client.srem(this.SESSION_KEY, sessionId);
    
    this.logger.debug(`[USER_SESSION] Removed session: ${sessionId}`);
  }

  async removeSessions(userIds: string[], agentId: string): Promise<void> {
    if (userIds.length === 0) return;
    
    const client = this.redisService.getClient();
    const sessionIds = userIds.map(userId => `${userId}:${agentId}`);
    
    await client.srem(this.SESSION_KEY, ...sessionIds);
    
    this.logger.debug(`[USER_SESSION] Removed ${sessionIds.length} sessions for agentId: ${agentId}`);
  }

  async getLoggedInUserCount(): Promise<number> {
    const client = this.redisService.getClient();
    const count = await client.scard(this.SESSION_KEY);
    this.logger.debug(`[USER_SESSION] Logged-in user count: ${count}`);
    return count || 0;
  }
}
