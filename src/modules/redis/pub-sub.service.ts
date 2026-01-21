import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

/**
 * Redis Pub/Sub service for distributed notifications
 * Provides publish-subscribe messaging for cache invalidation and coordination
 * 
 * Features:
 * - Publish messages to channels
 * - Subscribe to channels with callback handlers
 * - Automatic reconnection handling
 * - Graceful cleanup on shutdown
 */
@Injectable()
export class PubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private subscriber: Redis | null = null;
  private readonly subscriptions: Map<string, Set<(message: string) => void>> = new Map();

  constructor(private readonly redisService: RedisService) {
    this.logger.log('Pub/Sub service initialized');
  }

  /**
   * Get or create subscriber client
   * Uses a duplicate connection to avoid blocking the main Redis client
   */
  private getSubscriber(): Redis {
    if (!this.subscriber) {
      this.subscriber = this.redisService.getClient().duplicate();
      
      this.subscriber.on('error', (error) => {
        this.logger.error(`Subscriber error: ${error.message}`, error.stack);
      });

      this.subscriber.on('connect', () => {
        this.logger.debug('Subscriber connected');
      });

      this.subscriber.on('close', () => {
        this.logger.warn('Subscriber connection closed');
      });

      // Handle incoming messages
      this.subscriber.on('message', (channel: string, message: string) => {
        this.handleMessage(channel, message);
      });
    }

    return this.subscriber;
  }

  /**
   * Publish a message to a channel
   * @param channel Channel name to publish to
   * @param message Message to publish (will be JSON stringified if object)
   * @returns Number of subscribers that received the message
   */
  async publish(channel: string, message: string | object): Promise<number> {
    try {
      const client = this.redisService.getClient();
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      
      const subscribers = await client.publish(channel, messageStr);
      
      this.logger.debug(
        `Published message to channel=${channel} subscribers=${subscribers} messageLength=${messageStr.length}`,
      );

      return subscribers;
    } catch (error) {
      this.logger.error(
        `Failed to publish message to channel=${channel}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Subscribe to a channel with a callback handler
   * Multiple callbacks can be registered for the same channel
   * @param channel Channel name to subscribe to
   * @param callback Callback function to handle messages
   * @returns Promise that resolves when subscription is confirmed
   */
  async subscribe(
    channel: string,
    callback: (message: string) => void,
  ): Promise<void> {
    try {
      const subscriber = this.getSubscriber();

      // Track subscription
      if (!this.subscriptions.has(channel)) {
        this.subscriptions.set(channel, new Set());
        await subscriber.subscribe(channel);
        this.logger.log(`Subscribed to channel: ${channel}`);
      }

      // Add callback
      this.subscriptions.get(channel)!.add(callback);
      this.logger.debug(
        `Added callback for channel=${channel} totalCallbacks=${this.subscriptions.get(channel)!.size}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to subscribe to channel=${channel}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Unsubscribe from a channel
   * If no callbacks remain, unsubscribes from the channel entirely
   * @param channel Channel name to unsubscribe from
   * @param callback Optional callback to remove (if not provided, removes all)
   */
  async unsubscribe(
    channel: string,
    callback?: (message: string) => void,
  ): Promise<void> {
    try {
      const callbacks = this.subscriptions.get(channel);
      if (!callbacks) {
        this.logger.debug(`Not subscribed to channel: ${channel}`);
        return;
      }

      if (callback) {
        callbacks.delete(callback);
        this.logger.debug(
          `Removed callback for channel=${channel} remainingCallbacks=${callbacks.size}`,
        );
      } else {
        callbacks.clear();
        this.logger.debug(`Cleared all callbacks for channel=${channel}`);
      }

      // If no callbacks remain, unsubscribe from channel
      if (callbacks.size === 0) {
        const subscriber = this.getSubscriber();
        await subscriber.unsubscribe(channel);
        this.subscriptions.delete(channel);
        this.logger.log(`Unsubscribed from channel: ${channel}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to unsubscribe from channel=${channel}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Handle incoming message from Redis
   * Distributes message to all registered callbacks for the channel
   */
  private handleMessage(channel: string, message: string): void {
    const callbacks = this.subscriptions.get(channel);
    if (!callbacks || callbacks.size === 0) {
      this.logger.warn(
        `Received message for channel=${channel} but no callbacks registered`,
      );
      return;
    }

    this.logger.debug(
      `Received message on channel=${channel} callbacks=${callbacks.size} messageLength=${message.length}`,
    );

    // Execute all callbacks
    callbacks.forEach((callback) => {
      try {
        callback(message);
      } catch (error) {
        this.logger.error(
          `Error in callback for channel=${channel}: ${error.message}`,
          error.stack,
        );
      }
    });
  }

  /**
   * Get list of subscribed channels
   */
  getSubscribedChannels(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Check if subscribed to a channel
   */
  isSubscribed(channel: string): boolean {
    return this.subscriptions.has(channel);
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy() {
    this.logger.log('Cleaning up Pub/Sub service');

    // Unsubscribe from all channels
    const channels = Array.from(this.subscriptions.keys());
    for (const channel of channels) {
      this.unsubscribe(channel).catch((error) => {
        this.logger.error(
          `Error unsubscribing from channel=${channel} on shutdown: ${error.message}`,
        );
      });
    }

    // Close subscriber connection
    if (this.subscriber) {
      this.subscriber.quit().catch((error) => {
        this.logger.error(
          `Error closing subscriber connection: ${error.message}`,
        );
      });
      this.subscriber = null;
    }

    this.subscriptions.clear();
    this.logger.log('Pub/Sub service cleaned up');
  }
}
