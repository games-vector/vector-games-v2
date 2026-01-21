import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Difficulty } from '../../DTO/bet-payload.dto';
import { GameConfigService } from '../../../../modules/game-config/game-config.service';
import { LeaderElectionService } from '../../../../modules/redis/leader-election.service';
import { PubSubService } from '../../../../modules/redis/pub-sub.service';
import { RedisService } from '../../../../modules/redis/redis.service';
import { HazardGeneratorService } from './hazard-generator.service';
import { HazardState } from './interfaces/hazard-state.interface';
import { DEFAULTS } from '../../../../config/defaults.config';

/**
 * Manages hazard column rotation per game and difficulty
 * Uses leader election to ensure only one server rotates hazards
 * Implements current/next pattern system with configurable rotation intervals
 * Uses pub/sub for cache invalidation across multiple servers
 * Hazards are isolated per game+difficulty combination
 */
@Injectable()
export class HazardSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HazardSchedulerService.name);

  // Timers for each game+difficulty combination (only active on leader)
  // Key format: `${gameCode}-${difficulty}`
  private timers: Record<string, NodeJS.Timeout> = {};

  // In-memory cache of current states
  // Key format: `${gameCode}-${difficulty}`
  private states: Record<string, HazardState> = {};

  // Leader election service instance (created per scheduler)
  private leaderElection: LeaderElectionService;
  private isLeader: boolean = false;

  // Hardcoded default configuration (used if DB config not available)
  private readonly DEFAULT_CONFIG = {
    totalColumns: DEFAULTS.GAMES.CHICKEN_ROAD.hazardConfig.totalColumns,
    hazardRefreshMs: DEFAULTS.GAMES.CHICKEN_ROAD.hazardConfig.hazardRefreshMs,
    hazards: {
      [Difficulty.EASY]: DEFAULTS.GAMES.CHICKEN_ROAD.hazardConfig.hazards.EASY,
      [Difficulty.MEDIUM]: DEFAULTS.GAMES.CHICKEN_ROAD.hazardConfig.hazards.MEDIUM,
      [Difficulty.HARD]: DEFAULTS.GAMES.CHICKEN_ROAD.hazardConfig.hazards.HARD,
      [Difficulty.DAREDEVIL]: DEFAULTS.GAMES.CHICKEN_ROAD.hazardConfig.hazards.DAREDEVIL,
    },
  };

  // Per-game configuration cache
  // Key: gameCode, Value: config for that game
  private gameConfigs: Record<string, {
    totalColumns: Record<Difficulty, number>;
    hazardRefreshMs: number;
    hazards: Record<Difficulty, number>;
  }> = {};
  
  constructor(
    private readonly redisService: RedisService,
    private readonly gameConfigService: GameConfigService,
    private readonly hazardGenerator: HazardGeneratorService,
    private readonly pubSubService: PubSubService,
  ) {
    // Create leader election instance for hazard scheduler with specific service name
    // This allows multiple services to use leader election independently
    this.leaderElection = new LeaderElectionService(
      this.redisService,
      'hazard-scheduler',
    );
  }

  /**
   * Bootstrap hazard system on application startup
   * Attempts to become leader
   * Hazards are lazy-initialized (only when first accessed per game)
   * All servers listen for rotation notifications
   */
  async onModuleInit() {
    // Try to become leader
    const becameLeader = await this.leaderElection.tryBecomeLeader();
    this.isLeader = becameLeader;

    if (becameLeader) {
      this.logger.log(
        `✅ Hazard scheduler started as LEADER: serverId=${this.leaderElection.getServerId()}`,
      );
    } else {
      const currentLeader = await this.leaderElection.getCurrentLeader();
      this.logger.log(
        `✅ Hazard scheduler started as FOLLOWER: serverId=${this.leaderElection.getServerId()} currentLeader=${currentLeader}`,
      );
    }

    // All servers (leader and followers) listen for rotation notifications
    // Note: We'll subscribe to channels dynamically when games are accessed
    
    this.logger.log(
      `Hazard scheduler initialization complete: isLeader=${this.isLeader} serverId=${this.leaderElection.getServerId()}`,
    );
  }

  /**
   * Cleanup on shutdown
   */
  onModuleDestroy() {
    this.logger.log(
      `Shutting down hazard scheduler: isLeader=${this.isLeader} serverId=${this.leaderElection.getServerId()}`,
    );
    this.stopAll();
    // Leader election service handles its own cleanup
  }

  /**
   * Invalidate cached config for a game (call when config changes)
   * This ensures all pods reload the latest config on next access
   */
  invalidateGameConfig(gameCode: string): void {
    delete this.gameConfigs[gameCode];
    this.logger.debug(`[${gameCode}] Config cache invalidated`);
  }

  /**
   * Load and cache hazard configuration for a specific game
   * Configs are cached per game to reduce database calls
   * In multi-pod environment: each pod caches independently
   * Use invalidateGameConfig() to force reload when config changes
   */
  private async loadGameConfig(gameCode: string): Promise<{
    totalColumns: Record<Difficulty, number>;
    hazardRefreshMs: number;
    hazards: Record<Difficulty, number>;
  }> {
    // Return cached config if available
    if (this.gameConfigs[gameCode]) {
      return this.gameConfigs[gameCode];
    }

    try {
      const rawConfig = await this.gameConfigService.getConfig(gameCode, 'hazardConfig');
      if (!rawConfig) {
        throw new Error(`Config 'hazardConfig' not found for game ${gameCode}`);
      }
      const config =
        typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;

      let totalColumns: Record<Difficulty, number>;
      let hazardRefreshMs: number;
      let hazards: Record<Difficulty, number>;

      // Handle both legacy (single number) and new (per-difficulty) formats
      if (typeof config.totalColumns === 'number') {
        // Legacy format: convert single number to per-difficulty object
        this.logger.warn(
          `[${gameCode}] Legacy totalColumns format detected (single number). Converting to per-difficulty format.`,
        );
        totalColumns = {
          [Difficulty.EASY]: config.totalColumns,
          [Difficulty.MEDIUM]: config.totalColumns,
          [Difficulty.HARD]: config.totalColumns,
          [Difficulty.DAREDEVIL]: config.totalColumns,
        };
      } else {
        totalColumns = config.totalColumns || this.DEFAULT_CONFIG.totalColumns;
      }

      hazardRefreshMs = config.hazardRefreshMs || this.DEFAULT_CONFIG.hazardRefreshMs;
      hazards = config.hazards || this.DEFAULT_CONFIG.hazards;

      // Cache the config
      this.gameConfigs[gameCode] = {
        totalColumns,
        hazardRefreshMs,
        hazards,
      };

      this.logger.log(
        `[${gameCode}] Hazard configuration loaded: totalColumns=${JSON.stringify(totalColumns)} hazardRefreshMs=${hazardRefreshMs}`,
      );

      return this.gameConfigs[gameCode];
    } catch (error) {
      this.logger.warn(
        `[${gameCode}] Failed to load hazard config from database, using defaults: ${error.message}`,
      );
      // Use defaults and cache them
      const defaultConfig = {
        totalColumns: this.DEFAULT_CONFIG.totalColumns,
        hazardRefreshMs: this.DEFAULT_CONFIG.hazardRefreshMs,
        hazards: this.DEFAULT_CONFIG.hazards,
      };
      this.gameConfigs[gameCode] = defaultConfig;
      return defaultConfig;
    }
  }

  /**
   * Get total columns for a specific game and difficulty
   */
  private async getTotalColumns(gameCode: string, difficulty: Difficulty): Promise<number> {
    const config = await this.loadGameConfig(gameCode);
    return config.totalColumns[difficulty] || DEFAULTS.GAMES.CHICKEN_ROAD.hazardConfig.totalColumns[difficulty];
  }

  /**
   * Get hazard count for a specific game and difficulty
   */
  private async getHazardCount(gameCode: string, difficulty: Difficulty): Promise<number> {
    const config = await this.loadGameConfig(gameCode);
    return config.hazards[difficulty] || DEFAULTS.GAMES.CHICKEN_ROAD.hazardConfig.hazards[difficulty];
  }

  /**
   * Get refresh interval for a specific game
   */
  private async getRefreshMs(gameCode: string): Promise<number> {
    const config = await this.loadGameConfig(gameCode);
    return config.hazardRefreshMs || this.DEFAULT_CONFIG.hazardRefreshMs;
  }

  /**
   * Generate Redis key for a game and difficulty
   */
  private redisKey(gameCode: string, difficulty: Difficulty): string {
    return `hazards-${gameCode}-${difficulty}`;
  }

  /**
   * Generate state key for in-memory cache
   */
  private stateKey(gameCode: string, difficulty: Difficulty): string {
    return `${gameCode}-${difficulty}`;
  }

  /**
   * Generate pub/sub channel for rotation notifications
   */
  private rotationChannel(gameCode: string, difficulty: Difficulty): string {
    return `hazard-rotation-${gameCode}-${difficulty}`;
  }

  /**
   * Generate history key for a game and difficulty
   */
  private historyKey(gameCode: string, difficulty: Difficulty): string {
    return `hazards-history-${gameCode}-${difficulty}`;
  }

  /**
   * Initialize state for a specific game and difficulty level
   * Lazy initialization - only called when first accessed
   * Uses distributed lock to prevent race conditions in multi-pod environment
   */
  private async initializeGameDifficulty(gameCode: string, difficulty: Difficulty) {
    const stateKey = this.stateKey(gameCode, difficulty);
    const redisKey = this.redisKey(gameCode, difficulty);
    const lockKey = `lock:${redisKey}`;
    
    // Check if already initialized in local memory
    if (this.states[stateKey]) {
      return;
    }

    // Check if already exists in Redis (another pod might have initialized it)
    const existingState = await this.redisService.get<HazardState>(redisKey);
    if (existingState) {
      this.states[stateKey] = existingState;
      await this.ensureRotationListener(gameCode, difficulty);
      this.logger.debug(
        `[${gameCode}] ${difficulty}: State already exists in Redis, loaded into memory`,
      );
      return;
    }

    // Acquire distributed lock to prevent concurrent initialization
    const lockAcquired = await this.redisService.acquireLock(lockKey, 10);
    if (!lockAcquired) {
      // Another pod is initializing, wait a bit and check Redis again
      this.logger.debug(
        `[${gameCode}] ${difficulty}: Lock not acquired, waiting for other pod to initialize`,
      );
      await new Promise(resolve => setTimeout(resolve, 100));
      const stateAfterWait = await this.redisService.get<HazardState>(redisKey);
      if (stateAfterWait) {
        this.states[stateKey] = stateAfterWait;
        await this.ensureRotationListener(gameCode, difficulty);
        return;
      }
      // If still no state after wait, log warning but continue (shouldn't happen)
      this.logger.warn(
        `[${gameCode}] ${difficulty}: Lock not acquired and no state found after wait`,
      );
    }

    try {
      // Double-check Redis after acquiring lock (another pod might have initialized)
      const doubleCheckState = await this.redisService.get<HazardState>(redisKey);
      if (doubleCheckState) {
        this.states[stateKey] = doubleCheckState;
        await this.ensureRotationListener(gameCode, difficulty);
        this.logger.debug(
          `[${gameCode}] ${difficulty}: State appeared in Redis after lock acquisition`,
        );
        return;
      }

      this.logger.debug(
        `[${gameCode}] ${difficulty}: Starting initialization - loading config...`,
      );
      
      const hazardCount = await this.getHazardCount(gameCode, difficulty);
      const refreshMs = await this.getRefreshMs(gameCode);
      const now = Date.now();
      const changeAt = now + refreshMs;

      // Get total columns for this game and difficulty
      const totalColumns = await this.getTotalColumns(gameCode, difficulty);
      
      this.logger.debug(
        `[${gameCode}] ${difficulty}: Config loaded - hazardCount=${hazardCount}, totalColumns=${totalColumns}, refreshMs=${refreshMs}`,
      );

      // Generate initial current and next patterns
      const current = this.hazardGenerator.generateRandomPattern(
        hazardCount,
        totalColumns,
      );
      const next = this.hazardGenerator.generateRandomPattern(
        hazardCount,
        totalColumns,
      );

      const state: HazardState = {
        gameCode,
        difficulty,
        current,
        next,
        changeAt,
        hazardCount,
        generatedAt: new Date(now).toISOString(),
      };

      // Store in memory
      this.states[stateKey] = state;

      // Store in Redis with TTL slightly longer than refresh interval
      const ttlSeconds = Math.ceil((refreshMs * DEFAULTS.GAMES.CHICKEN_ROAD.GAME.HAZARD_TTL_MULTIPLIER) / 1000);
      await this.redisService.set(redisKey, state, ttlSeconds);

      // Optional: Store in history
      await this.addToHistory(gameCode, difficulty, state);

      // Setup pub/sub listener for this game+difficulty if not already done
      await this.ensureRotationListener(gameCode, difficulty);

      // Schedule first rotation (only if leader)
      await this.scheduleRotation(gameCode, difficulty);

      this.logger.log(
        `[${gameCode}] ${difficulty}: Initialized [${current.join(',')}] @ ${new Date(now).toISOString()}`,
      );
    } finally {
      // Release lock if we acquired it
      if (lockAcquired) {
        await this.redisService.releaseLock(lockKey);
      }
    }
  }

  /**
   * Schedule next rotation for a game and difficulty
   * Only schedules if this server is the leader
   */
  private async scheduleRotation(gameCode: string, difficulty: Difficulty) {
    const stateKey = this.stateKey(gameCode, difficulty);
    const refreshMs = await this.getRefreshMs(gameCode);

    // Check if we're still the leader before scheduling
    const isLeader = await this.leaderElection.isLeader();
    if (!isLeader) {
      this.logger.debug(
        `[${gameCode}] ${difficulty}: Not leader, skipping rotation schedule. serverId=${this.leaderElection.getServerId()}`,
      );
      this.isLeader = false;
      return;
    }

    this.isLeader = true;

    // Clear existing timer if any
    if (this.timers[stateKey]) {
      clearTimeout(this.timers[stateKey]);
    }

    // Schedule rotation
    this.timers[stateKey] = setTimeout(() => {
      this.rotateGameDifficulty(gameCode, difficulty).catch((error) => {
        this.logger.error(
          `[${gameCode}] Error rotating ${difficulty}: ${error.message}`,
          error.stack,
        );
      });
    }, refreshMs);

    this.logger.debug(
      `[${gameCode}] ${difficulty}: Rotation scheduled in ${refreshMs}ms (leader=${this.isLeader})`,
    );
  }

  /**
   * Perform rotation for a game and difficulty level
   * Moves 'next' to 'current' and generates new 'next'
   * Only executes if this server is the leader
   */
  private async rotateGameDifficulty(gameCode: string, difficulty: Difficulty) {
    const stateKey = this.stateKey(gameCode, difficulty);

    // Double-check we're still the leader before rotating
    const isLeader = await this.leaderElection.isLeader();
    if (!isLeader) {
      this.logger.debug(
        `[${gameCode}] ${difficulty}: No longer leader, skipping rotation. serverId=${this.leaderElection.getServerId()}`,
      );
      this.isLeader = false;
      return;
    }

    this.isLeader = true;

    try {
      const hazardCount = await this.getHazardCount(gameCode, difficulty);
      const refreshMs = await this.getRefreshMs(gameCode);
      const now = Date.now();
      const changeAt = now + refreshMs;

      // Get previous state from Redis (not local cache) to ensure consistency
      const prevStateRedis = await this.redisService.get<HazardState>(
        this.redisKey(gameCode, difficulty),
      );
      const prevState = prevStateRedis || this.states[stateKey];

      // Get total columns for this game and difficulty
      const totalColumns = await this.getTotalColumns(gameCode, difficulty);

      // Move 'next' to 'current', generate new 'next'
      const current =
        prevState?.next ||
        this.hazardGenerator.generateRandomPattern(
          hazardCount,
          totalColumns,
        );
      const next = this.hazardGenerator.generateRandomPattern(
        hazardCount,
        totalColumns,
      );

      const state: HazardState = {
        gameCode,
        difficulty,
        current,
        next,
        changeAt,
        hazardCount,
        generatedAt: new Date(now).toISOString(),
      };

      // Update memory
      this.states[stateKey] = state;

      // Update Redis (single source of truth)
      const ttlSeconds = Math.ceil((refreshMs * DEFAULTS.GAMES.CHICKEN_ROAD.GAME.HAZARD_TTL_MULTIPLIER) / 1000);
      await this.redisService.set(this.redisKey(gameCode, difficulty), state, ttlSeconds);

      // Notify other servers via pub/sub
      await this.notifyRotation(gameCode, difficulty, state);

      // Add to history
      await this.addToHistory(gameCode, difficulty, state);

      // Schedule next rotation
      await this.scheduleRotation(gameCode, difficulty);

      this.logger.log(
        `[${gameCode}] ${difficulty}: Rotated [${current.join(',')}] → next [${next.join(',')}] @ ${new Date(now).toISOString()} serverId=${this.leaderElection.getServerId()}`,
      );
    } catch (error) {
      this.logger.error(
        `[${gameCode}] Failed to rotate ${difficulty}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Add state to history (optional, for audit/debugging)
   */
  private async addToHistory(gameCode: string, difficulty: Difficulty, state: HazardState) {
    try {
      const historyKey = this.historyKey(gameCode, difficulty);
      const client = this.redisService.getClient();
      await client.lpush(historyKey, JSON.stringify(state));
      await client.ltrim(historyKey, 0, DEFAULTS.GAMES.CHICKEN_ROAD.GAME.HAZARD_HISTORY_LIMIT - 1);
      this.logger.debug(
        `[${gameCode}] ${difficulty}: State added to history: current=[${state.current.join(',')}]`,
      );
    } catch (error) {
      // History is optional, log but don't fail rotation
      this.logger.warn(
        `[${gameCode}] Failed to add ${difficulty} state to history: ${error.message}`,
      );
    }
  }

  /**
   * Stop scheduler for a specific game and difficulty
   */
  stopGameDifficulty(gameCode: string, difficulty: Difficulty) {
    const stateKey = this.stateKey(gameCode, difficulty);
    if (this.timers[stateKey]) {
      clearTimeout(this.timers[stateKey]);
      delete this.timers[stateKey];
    }
  }

  /**
   * Stop all schedulers
   */
  stopAll() {
    for (const timerKey of Object.keys(this.timers)) {
      clearTimeout(this.timers[timerKey]);
      delete this.timers[timerKey];
    }
  }

  /**
   * Get current state for a game and difficulty (with auto-recovery)
   * Lazy initialization - initializes on first access
   * Followers read from Redis, only leader can trigger rotation
   */
  async getCurrentState(
    gameCode: string,
    difficulty: Difficulty,
  ): Promise<HazardState | undefined> {
    const stateKey = this.stateKey(gameCode, difficulty);

    // Try memory first
    let state = this.states[stateKey];

    // If not in memory or expired, try Redis
    const now = Date.now();
    if (!state || (state.changeAt && now >= state.changeAt)) {
      const redisState = await this.redisService.get<HazardState>(
        this.redisKey(gameCode, difficulty),
      );
      if (redisState) {
        state = redisState;
        this.states[stateKey] = state;
        this.logger.debug(
          `[${gameCode}] ${difficulty}: State refreshed from Redis: current=[${state.current.join(',')}] next=[${state.next.join(',')}]`,
        );
      }
    }

    if (state && now >= state.changeAt) {
      const isLeader = await this.leaderElection.isLeader();
      if (isLeader) {
        this.logger.debug(
          `[${gameCode}] ${difficulty}: State expired, leader triggering rotation`,
        );
        await this.rotateGameDifficulty(gameCode, difficulty);
        state = this.states[stateKey];
      } else {
        this.logger.debug(
          `[${gameCode}] ${difficulty}: State expired, but not leader. Waiting for leader rotation.`,
        );
        // Try to refresh from Redis one more time (leader might have rotated)
        const freshState = await this.redisService.get<HazardState>(
          this.redisKey(gameCode, difficulty),
        );
        if (freshState && freshState.changeAt > state.changeAt) {
          state = freshState;
          this.states[stateKey] = state;
        }
      }
    }

    // If still no state, initialize (lazy initialization)
    if (!state) {
      const isLeader = await this.leaderElection.isLeader();
      if (isLeader) {
        this.logger.log(
          `[${gameCode}] ${difficulty}: No state found, leader initializing`,
        );
        try {
          await this.initializeGameDifficulty(gameCode, difficulty);
          state = this.states[stateKey];
          if (!state) {
            this.logger.error(
              `[${gameCode}] ${difficulty}: Initialization completed but state is still null`,
            );
          }
        } catch (error) {
          this.logger.error(
            `[${gameCode}] ${difficulty}: Failed to initialize hazards: ${error.message}`,
            error.stack,
          );
          // Try to use defaults as fallback
          try {
            const hazardCount = await this.getHazardCount(gameCode, difficulty);
            const totalColumns = await this.getTotalColumns(gameCode, difficulty);
            const refreshMs = await this.getRefreshMs(gameCode);
            const now = Date.now();
            const current = this.hazardGenerator.generateRandomPattern(hazardCount, totalColumns);
            const next = this.hazardGenerator.generateRandomPattern(hazardCount, totalColumns);
            state = {
              gameCode,
              difficulty,
              current,
              next,
              changeAt: now + refreshMs,
              hazardCount,
              generatedAt: new Date(now).toISOString(),
            };
            this.states[stateKey] = state;
            const ttlSeconds = Math.ceil((refreshMs * DEFAULTS.GAMES.CHICKEN_ROAD.GAME.HAZARD_TTL_MULTIPLIER) / 1000);
            await this.redisService.set(this.redisKey(gameCode, difficulty), state, ttlSeconds);
            this.logger.log(
              `[${gameCode}] ${difficulty}: Created fallback state [${current.join(',')}]`,
            );
          } catch (fallbackError) {
            this.logger.error(
              `[${gameCode}] ${difficulty}: Fallback initialization also failed: ${fallbackError.message}`,
            );
          }
        }
      } else {
        // Follower: try to get from Redis one more time, then wait a bit
        this.logger.debug(
          `[${gameCode}] ${difficulty}: No state found and not leader. Checking Redis again...`,
        );
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for leader to initialize
        const redisState = await this.redisService.get<HazardState>(
          this.redisKey(gameCode, difficulty),
        );
        if (redisState) {
          state = redisState;
          this.states[stateKey] = state;
          await this.ensureRotationListener(gameCode, difficulty);
          this.logger.log(
            `[${gameCode}] ${difficulty}: State loaded from Redis after wait: [${state.current.join(',')}]`,
          );
        } else {
          // Leader hasn't initialized after wait - follower should initialize as fallback
          // This prevents the system from being stuck if leader is slow or has issues
          // Note: initializeGameDifficulty uses distributed lock, so it's safe for followers to call
          this.logger.warn(
            `[${gameCode}] ${difficulty}: No state found after waiting for leader. Follower will initialize as fallback.`,
          );
          try {
            await this.initializeGameDifficulty(gameCode, difficulty);
            state = this.states[stateKey];
            if (state) {
              this.logger.log(
                `[${gameCode}] ${difficulty}: Follower initialized state: [${state.current.join(',')}]`,
              );
            } else {
              // If initialization didn't create state, try one more time with fallback
              this.logger.warn(
                `[${gameCode}] ${difficulty}: Initialization didn't create state, trying fallback creation`,
              );
              const hazardCount = await this.getHazardCount(gameCode, difficulty);
              const totalColumns = await this.getTotalColumns(gameCode, difficulty);
              const refreshMs = await this.getRefreshMs(gameCode);
              const now = Date.now();
              const current = this.hazardGenerator.generateRandomPattern(hazardCount, totalColumns);
              const next = this.hazardGenerator.generateRandomPattern(hazardCount, totalColumns);
              state = {
                gameCode,
                difficulty,
                current,
                next,
                changeAt: now + refreshMs,
                hazardCount,
                generatedAt: new Date(now).toISOString(),
              };
              this.states[stateKey] = state;
              const ttlSeconds = Math.ceil((refreshMs * DEFAULTS.GAMES.CHICKEN_ROAD.GAME.HAZARD_TTL_MULTIPLIER) / 1000);
              await this.redisService.set(this.redisKey(gameCode, difficulty), state, ttlSeconds);
              await this.ensureRotationListener(gameCode, difficulty);
              this.logger.log(
                `[${gameCode}] ${difficulty}: Follower created fallback state [${current.join(',')}]`,
              );
            }
          } catch (initError) {
            this.logger.error(
              `[${gameCode}] ${difficulty}: Follower initialization failed: ${initError.message}`,
              initError.stack,
            );
          }
        }
      }
    }

    return state;
  }

  /**
   * Get active hazard columns for a game and difficulty
   */
  async getActiveHazards(gameCode: string, difficulty: Difficulty): Promise<number[]> {
    const state = await this.getCurrentState(gameCode, difficulty);
    if (!state) {
      this.logger.error(
        `[${gameCode}] ${difficulty}: No hazard state available, returning empty array`,
      );
      // Return empty array if state is not available (shouldn't happen, but prevents crashes)
      return [];
    }
    return this.hazardGenerator.getActivePattern(state);
  }

  /**
   * Check if a column is currently a hazard for a game and difficulty
   */
  async isHazard(
    gameCode: string,
    difficulty: Difficulty,
    columnIndex: number,
  ): Promise<boolean> {
    const state = await this.getCurrentState(gameCode, difficulty);
    if (!state) return false;
    return this.hazardGenerator.isColumnHazard(columnIndex, state);
  }

  /**
   * Get all current states for a game (for debugging/admin API)
   */
  async getAllStatesForGame(gameCode: string): Promise<Record<string, HazardState | undefined>> {
    const states: Record<string, HazardState | undefined> = {};
    for (const difficulty of Object.values(Difficulty) as Difficulty[]) {
      states[difficulty] = await this.getCurrentState(gameCode, difficulty);
    }
    return states;
  }

  /**
   * Force immediate rotation for a game and difficulty (for testing/admin)
   * Only works if this server is the leader
   */
  async forceRotate(gameCode: string, difficulty: Difficulty): Promise<HazardState> {
    const isLeader = await this.leaderElection.isLeader();
    if (!isLeader) {
      throw new Error(
        `Cannot force rotate: not leader. Current leader: ${await this.leaderElection.getCurrentLeader()}`,
      );
    }
    await this.rotateGameDifficulty(gameCode, difficulty);
    const stateKey = this.stateKey(gameCode, difficulty);
    return this.states[stateKey];
  }

  /**
   * Force initialization of hazards for a game and difficulty
   * Can be called by any server (uses distributed lock)
   * Useful for ensuring hazards are initialized for new games
   */
  async forceInitialize(gameCode: string, difficulty: Difficulty): Promise<HazardState> {
    this.logger.log(
      `[${gameCode}] ${difficulty}: Force initialization requested`,
    );
    await this.initializeGameDifficulty(gameCode, difficulty);
    const stateKey = this.stateKey(gameCode, difficulty);
    const state = this.states[stateKey];
    if (!state) {
      throw new Error(
        `Failed to initialize hazards for ${gameCode} ${difficulty}`,
      );
    }
    return state;
  }

  /**
   * Track which channels we've subscribed to (to avoid duplicate subscriptions)
   */
  private subscribedChannels: Set<string> = new Set();

  /**
   * Ensure pub/sub listener is set up for a specific game+difficulty
   * Called lazily when a game+difficulty is first accessed
   */
  private async ensureRotationListener(gameCode: string, difficulty: Difficulty): Promise<void> {
    const channel = this.rotationChannel(gameCode, difficulty);
    
    // Skip if already subscribed
    if (this.subscribedChannels.has(channel)) {
      return;
    }

    try {
      await this.pubSubService.subscribe(channel, (message: string) => {
        try {
          const notification = JSON.parse(message);
          const stateKey = this.stateKey(gameCode, difficulty);
          
          this.logger.debug(
            `[${gameCode}] Received rotation notification: difficulty=${difficulty} timestamp=${notification.timestamp} serverId=${this.leaderElection.getServerId()}`,
          );

          // Clear local cache to force refresh from Redis
          delete this.states[stateKey];
          this.logger.debug(
            `[${gameCode}] ${difficulty}: Local cache invalidated, will refresh from Redis on next read`,
          );
        } catch (error) {
          this.logger.error(
            `[${gameCode}] Error processing rotation notification for ${difficulty}: ${error.message}`,
            error.stack,
          );
        }
      });

      this.subscribedChannels.add(channel);
      this.logger.debug(
        `Subscribed to rotation notifications: channel=${channel}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to setup rotation listener for ${channel}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Notify other servers about rotation via pub/sub
   * Called by leader after successful rotation
   */
  private async notifyRotation(
    gameCode: string,
    difficulty: Difficulty,
    state: HazardState,
  ): Promise<void> {
    try {
      const channel = this.rotationChannel(gameCode, difficulty);
      const notification = {
        gameCode,
        difficulty,
        timestamp: Date.now(),
        changeAt: state.changeAt,
        current: state.current,
        next: state.next,
        serverId: this.leaderElection.getServerId(),
      };

      const subscribers = await this.pubSubService.publish(channel, notification);
      this.logger.debug(
        `[${gameCode}] Published rotation notification: channel=${channel} subscribers=${subscribers} serverId=${this.leaderElection.getServerId()}`,
      );
    } catch (error) {
      this.logger.error(
        `[${gameCode}] Failed to publish rotation notification for ${difficulty}: ${error.message}`,
        error.stack,
      );
      // Don't throw - rotation succeeded, notification is best-effort
    }
  }

  /**
   * Load initial state from Redis for a specific game+difficulty (for followers)
   * Called lazily when state is first accessed
   */
  private async loadInitialStateFromRedis(gameCode: string, difficulty: Difficulty): Promise<HazardState | null> {
    try {
      const state = await this.redisService.get<HazardState>(
        this.redisKey(gameCode, difficulty),
      );
      if (state) {
        const stateKey = this.stateKey(gameCode, difficulty);
        this.states[stateKey] = state;
        this.logger.debug(
          `[${gameCode}] ${difficulty}: Loaded initial state from Redis: current=[${state.current.join(',')}] next=[${state.next.join(',')}]`,
        );
        return state;
      }
      return null;
    } catch (error) {
      this.logger.error(
        `[${gameCode}] Failed to load initial state from Redis for ${difficulty}: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  /**
   * Update refresh interval for a specific game and reschedule all timers for that game
   * (Call this if config changes at runtime)
   */
  async updateRefreshInterval(gameCode: string, newIntervalMs: number) {
    if (newIntervalMs < DEFAULTS.GAMES.CHICKEN_ROAD.GAME.HAZARD_REFRESH_MIN_MS || newIntervalMs > DEFAULTS.GAMES.CHICKEN_ROAD.GAME.HAZARD_REFRESH_MAX_MS) {
      throw new Error(`Refresh interval must be between ${DEFAULTS.GAMES.CHICKEN_ROAD.GAME.HAZARD_REFRESH_MIN_MS}ms and ${DEFAULTS.GAMES.CHICKEN_ROAD.GAME.HAZARD_REFRESH_MAX_MS}ms`);
    }

    // Update cached config
    if (this.gameConfigs[gameCode]) {
      this.gameConfigs[gameCode].hazardRefreshMs = newIntervalMs;
    }

    // Reschedule all difficulties for this game
    for (const difficulty of Object.values(Difficulty) as Difficulty[]) {
      const stateKey = this.stateKey(gameCode, difficulty);
      if (this.timers[stateKey]) {
        await this.scheduleRotation(gameCode, difficulty);
      }
    }
  }
}
