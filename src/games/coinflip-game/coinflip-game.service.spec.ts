/**
 * CoinFlip Game Service Tests
 * Tests the service layer logic against REQUIREMENTS.md
 */

import { CoinFlipGameService } from './coinflip-game.service';
import { CoinFlipFairnessService } from './modules/fairness/fairness.service';
import { CoinChoice, PlayMode } from './DTO/bet-payload.dto';
import { MULTIPLIERS, COINFLIP_CONSTANTS } from './constants/coinflip.constants';

// Mocks
const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn().mockResolvedValue(true),
};

const mockWalletService = {
  placeBet: jest.fn().mockResolvedValue({
    status: '0000',
    balance: '1000.00',
    balanceTs: new Date().toISOString(),
  }),
  settleBet: jest.fn().mockResolvedValue({
    status: '0000',
    balance: '1000.00',
  }),
  refundBet: jest.fn().mockResolvedValue({
    status: '0000',
  }),
  getBalance: jest.fn().mockResolvedValue({
    balance: 1000,
  }),
};

const mockBetService = {
  createPlacement: jest.fn().mockResolvedValue({ id: 'test-bet-id' }),
  recordSettlement: jest.fn().mockResolvedValue({}),
  listUserBetsByTimeRange: jest.fn().mockResolvedValue([]),
};

describe('CoinFlipGameService', () => {
  let service: CoinFlipGameService;
  let fairnessService: CoinFlipFairnessService;

  beforeEach(() => {
    jest.clearAllMocks();

    fairnessService = new CoinFlipFairnessService(mockRedisService as any);

    // Mock fairness service methods
    jest.spyOn(fairnessService, 'getOrCreateFairness').mockResolvedValue({
      userSeed: 'a1b2c3d4e5f67890',
      serverSeed: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      hashedServerSeed: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      nonce: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    jest.spyOn(fairnessService, 'rotateSeeds').mockResolvedValue({} as any);

    service = new CoinFlipGameService(
      mockRedisService as any,
      mockWalletService as any,
      mockBetService as any,
      fairnessService,
    );
  });

  describe('getGameConfig', () => {
    it('should return correct game configuration', () => {
      const config = service.getGameConfig();

      expect(config.betConfig).toBeDefined();
      expect(config.multipliers).toBe(MULTIPLIERS);
      expect(config.maxRounds).toBe(20);
      expect(config.baseMultiplier).toBe(1.94);
    });
  });

  describe('getGameState', () => {
    it('should return null when no active session exists', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const state = await service.getGameState('user1', 'agent1', 'coinflip');

      expect(state).toBeNull();
    });

    it('should return null when session is not active', async () => {
      mockRedisService.get.mockResolvedValue({
        isActive: false,
        userId: 'user1',
        agentId: 'agent1',
      });

      const state = await service.getGameState('user1', 'agent1', 'coinflip');

      expect(state).toBeNull();
    });

    it('should return game state when active session exists', async () => {
      mockRedisService.get.mockResolvedValue({
        isActive: true,
        isWin: false,
        userId: 'user1',
        agentId: 'agent1',
        currency: 'INR',
        betAmount: 10,
        choices: [],
        currentRound: 0,
        playMode: PlayMode.ROUNDS,
        currentCoeff: '1',
      });

      const state = await service.getGameState('user1', 'agent1', 'coinflip');

      expect(state).not.toBeNull();
      expect(state?.isFinished).toBe(false);
      expect(state?.playMode).toBe('ROUNDS');
    });
  });

  describe('performBetFlow - QUICK Mode', () => {
    beforeEach(() => {
      mockRedisService.get.mockResolvedValue(null); // No existing session
    });

    it('should reject if active session exists', async () => {
      mockRedisService.get.mockResolvedValue({ isActive: true });

      const result = await service.performBetFlow('user1', 'agent1', 'coinflip', {
        betAmount: '10',
        currency: 'INR',
        choice: CoinChoice.HEADS,
        playMode: PlayMode.QUICK,
      });

      expect(result).toHaveProperty('error');
      expect((result as any).error).toBe('active_session_exists');
    });

    it('should reject invalid bet amount', async () => {
      const result = await service.performBetFlow('user1', 'agent1', 'coinflip', {
        betAmount: '-10',
        currency: 'INR',
        choice: CoinChoice.HEADS,
        playMode: PlayMode.QUICK,
      });

      expect(result).toHaveProperty('error');
    });

    it('should reject QUICK mode without choice', async () => {
      const result = await service.performBetFlow('user1', 'agent1', 'coinflip', {
        betAmount: '10',
        currency: 'INR',
        choice: null,
        playMode: PlayMode.QUICK,
      });

      expect(result).toHaveProperty('error');
      expect((result as any).error).toBe('invalid_choice');
    });

    it('should process QUICK mode bet and return finished state', async () => {
      const result = await service.performBetFlow('user1', 'agent1', 'coinflip', {
        betAmount: '10',
        currency: 'INR',
        choice: CoinChoice.HEADS,
        playMode: PlayMode.QUICK,
      });

      expect(result).not.toHaveProperty('error');
      expect((result as any).isFinished).toBe(true);
      expect((result as any).playMode).toBe('QUICK');
      expect((result as any).roundNumber).toBe(0);
      expect((result as any).coeff).toBe('1.94');
      expect((result as any).choices).toHaveLength(1);
    });

    it('should call wallet placeBet and settleBet for QUICK mode', async () => {
      await service.performBetFlow('user1', 'agent1', 'coinflip', {
        betAmount: '10',
        currency: 'INR',
        choice: CoinChoice.HEADS,
        playMode: PlayMode.QUICK,
      });

      expect(mockWalletService.placeBet).toHaveBeenCalled();
      expect(mockWalletService.settleBet).toHaveBeenCalled();
    });

    it('should record bet placement and settlement', async () => {
      await service.performBetFlow('user1', 'agent1', 'coinflip', {
        betAmount: '10',
        currency: 'INR',
        choice: CoinChoice.HEADS,
        playMode: PlayMode.QUICK,
      });

      expect(mockBetService.createPlacement).toHaveBeenCalled();
      expect(mockBetService.recordSettlement).toHaveBeenCalled();
    });
  });

  describe('performBetFlow - ROUNDS Mode', () => {
    beforeEach(() => {
      mockRedisService.get.mockResolvedValue(null);
    });

    it('should create session and return unfinished state', async () => {
      const result = await service.performBetFlow('user1', 'agent1', 'coinflip', {
        betAmount: '10',
        currency: 'INR',
        choice: null,
        playMode: PlayMode.ROUNDS,
      });

      expect(result).not.toHaveProperty('error');
      expect((result as any).isFinished).toBe(false);
      expect((result as any).isWin).toBe(false);
      expect((result as any).playMode).toBe('ROUNDS');
      expect((result as any).roundNumber).toBe(0);
      expect((result as any).choices).toEqual([]);
    });

    it('should save session to Redis', async () => {
      await service.performBetFlow('user1', 'agent1', 'coinflip', {
        betAmount: '10',
        currency: 'INR',
        choice: null,
        playMode: PlayMode.ROUNDS,
      });

      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('should NOT call settleBet for ROUNDS mode initial bet', async () => {
      await service.performBetFlow('user1', 'agent1', 'coinflip', {
        betAmount: '10',
        currency: 'INR',
        choice: null,
        playMode: PlayMode.ROUNDS,
      });

      expect(mockWalletService.settleBet).not.toHaveBeenCalled();
    });
  });

  describe('performStepFlow', () => {
    const activeSession = {
      isActive: true,
      isWin: false,
      userId: 'user1',
      agentId: 'agent1',
      currency: 'INR',
      betAmount: 10,
      choices: [] as CoinChoice[],
      results: [] as CoinChoice[],
      currentRound: 0,
      currentCoeff: '1',
      winAmount: 0,
      playMode: PlayMode.ROUNDS,
      platformBetTxId: 'tx1',
      roundId: 'round1',
      gameCode: 'coinflip',
      serverSeed: 'test-server-seed',
      userSeed: 'test-user-seed',
      nonce: 0,
      createdAt: new Date(),
    };

    it('should reject if no active session', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.performStepFlow('user1', 'agent1', 'coinflip', {
        choice: CoinChoice.HEADS,
        roundNumber: 1,
      });

      expect(result).toHaveProperty('error');
      expect((result as any).error).toBe('no_active_session');
    });

    it('should reject invalid round number', async () => {
      mockRedisService.get.mockResolvedValue({ ...activeSession });

      const result = await service.performStepFlow('user1', 'agent1', 'coinflip', {
        choice: CoinChoice.HEADS,
        roundNumber: 5, // Should be 1
      });

      expect(result).toHaveProperty('error');
      expect((result as any).error).toBe('invalid_round_number');
    });

    it('should process step and update session on win', async () => {
      // Mock a winning result
      jest.spyOn(fairnessService, 'generateCoinFlipResult').mockReturnValue(CoinChoice.HEADS);
      mockRedisService.get.mockResolvedValue({ ...activeSession });

      const result = await service.performStepFlow('user1', 'agent1', 'coinflip', {
        choice: CoinChoice.HEADS,
        roundNumber: 1,
      });

      expect(result).not.toHaveProperty('error');
      expect((result as any).isWin).toBe(true);
      expect((result as any).roundNumber).toBe(1);
      expect((result as any).coeff).toBe('1.94');
    });

    it('should finish game on loss', async () => {
      // Mock a losing result
      jest.spyOn(fairnessService, 'generateCoinFlipResult').mockReturnValue(CoinChoice.TAILS);
      mockRedisService.get.mockResolvedValue({ ...activeSession });

      const result = await service.performStepFlow('user1', 'agent1', 'coinflip', {
        choice: CoinChoice.HEADS,
        roundNumber: 1,
      });

      expect(result).not.toHaveProperty('error');
      expect((result as any).isFinished).toBe(true);
      expect((result as any).isWin).toBe(false);
      expect((result as any).winAmount).toBe('0.00');
    });

    it('should auto-settle on max round (20) win', async () => {
      jest.spyOn(fairnessService, 'generateCoinFlipResult').mockReturnValue(CoinChoice.HEADS);

      const sessionAtRound19 = {
        ...activeSession,
        currentRound: 19,
        choices: new Array(19).fill(CoinChoice.HEADS),
        results: new Array(19).fill(CoinChoice.HEADS),
        isWin: true,
        currentCoeff: MULTIPLIERS[18],
      };
      mockRedisService.get.mockResolvedValue(sessionAtRound19);

      const result = await service.performStepFlow('user1', 'agent1', 'coinflip', {
        choice: CoinChoice.HEADS,
        roundNumber: 20,
      });

      expect(result).not.toHaveProperty('error');
      expect((result as any).isFinished).toBe(true);
      expect((result as any).isWin).toBe(true);
      expect((result as any).roundNumber).toBe(20);
      expect((result as any).coeff).toBe('1017118.72');
    });
  });

  describe('performCashOutFlow', () => {
    it('should reject if no active session', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.performCashOutFlow('user1', 'agent1', 'coinflip');

      expect(result).toHaveProperty('error');
      expect((result as any).error).toBe('no_active_session');
    });

    it('should reject if no rounds won yet', async () => {
      mockRedisService.get.mockResolvedValue({
        isActive: true,
        isWin: false,
        currentRound: 0,
        betAmount: 10,
        currency: 'INR',
        choices: [],
        playMode: PlayMode.ROUNDS,
      });

      const result = await service.performCashOutFlow('user1', 'agent1', 'coinflip');

      expect(result).toHaveProperty('error');
      expect((result as any).error).toBe('cashout_failed');
    });

    it('should process cashout after winning rounds', async () => {
      mockRedisService.get.mockResolvedValue({
        isActive: true,
        isWin: true,
        currentRound: 2,
        betAmount: 10,
        currency: 'INR',
        choices: [CoinChoice.HEADS, CoinChoice.HEADS],
        results: [CoinChoice.HEADS, CoinChoice.HEADS],
        currentCoeff: '3.88',
        winAmount: 38.8,
        playMode: PlayMode.ROUNDS,
        platformBetTxId: 'tx1',
        roundId: 'round1',
        gameCode: 'coinflip',
        agentId: 'agent1',
        userId: 'user1',
        serverSeed: 'test-server-seed',
        userSeed: 'test-user-seed',
      });

      const result = await service.performCashOutFlow('user1', 'agent1', 'coinflip');

      expect(result).not.toHaveProperty('error');
      expect((result as any).isFinished).toBe(true);
      expect((result as any).isWin).toBe(true);
      expect((result as any).coeff).toBe('3.88');
      expect((result as any).winAmount).toBe('38.80');
    });

    it('should call settleBet and delete session', async () => {
      mockRedisService.get.mockResolvedValue({
        isActive: true,
        isWin: true,
        currentRound: 1,
        betAmount: 10,
        currency: 'INR',
        choices: [CoinChoice.HEADS],
        results: [CoinChoice.HEADS],
        currentCoeff: '1.94',
        winAmount: 19.4,
        playMode: PlayMode.ROUNDS,
        platformBetTxId: 'tx1',
        roundId: 'round1',
        gameCode: 'coinflip',
        agentId: 'agent1',
        userId: 'user1',
        serverSeed: 'test-server-seed',
        userSeed: 'test-user-seed',
      });

      await service.performCashOutFlow('user1', 'agent1', 'coinflip');

      expect(mockWalletService.settleBet).toHaveBeenCalled();
      expect(mockRedisService.del).toHaveBeenCalled();
    });
  });

  describe('getGameSeeds', () => {
    it('should return user seed, hashed server seed, and nonce', async () => {
      const seeds = await service.getGameSeeds('user1', 'agent1');

      expect(seeds).toHaveProperty('userSeed');
      expect(seeds).toHaveProperty('hashedServerSeed');
      expect(seeds).toHaveProperty('nonce');
      expect(typeof seeds.nonce).toBe('string');
    });
  });

  describe('setUserSeed', () => {
    it('should update user seed', async () => {
      jest.spyOn(fairnessService, 'setUserSeed').mockResolvedValue({
        userSeed: 'newuserseed12345',
        serverSeed: 'server',
        hashedServerSeed: 'hashed',
        nonce: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.setUserSeed('user1', 'agent1', 'newuserseed12345');

      expect(result.success).toBe(true);
      expect(result.userSeed).toBe('newuserseed12345');
    });
  });

  describe('getCurrencies', () => {
    it('should return currency rates', async () => {
      const currencies = await service.getCurrencies();

      expect(currencies).toHaveProperty('INR');
      expect(typeof currencies.INR).toBe('number');
    });
  });
});
