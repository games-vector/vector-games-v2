/**
 * Mock data for gameService-onConnectGame response
 * TODO: Replace with real data from database/services
 */

import { BetData, CoefficientHistory } from '../DTO/game-state.dto';

/**
 * Generate mock bet data
 * TODO: Replace with actual bet fetching from database
 */
export function getMockBets(): BetData[] {
  const bets: BetData[] = [];
  const currencies = ['PKR', 'USD', 'EUR', 'INR', 'BDT', 'BRL', 'TZS', 'EGP', 'XOF'];
  const nicknames = [
    'player1', 'player2', 'player3', 'player4', 'player5',
    'gamer123', 'betmaster', 'lucky7', 'winner99', 'progamer',
    'testuser1', 'testuser2', 'testuser3', 'testuser4', 'testuser5',
    'user001', 'user002', 'user003', 'user004', 'user005',
    'agent_123', 'agent_456', 'agent_789', 'agent_101', 'agent_202',
    'player_alpha', 'player_beta', 'player_gamma', 'player_delta', 'player_epsilon',
    'gamer_001', 'gamer_002', 'gamer_003', 'gamer_004', 'gamer_005',
    'bet_001', 'bet_002', 'bet_003', 'bet_004', 'bet_005',
    'user_alpha', 'user_beta', 'user_gamma', 'user_delta', 'user_epsilon',
    'test_001', 'test_002', 'test_003', 'test_004', 'test_005',
  ];

  for (let i = 0; i < 50; i++) {
    const hasWin = Math.random() > 0.5; // 50% chance of having win data
    const bet: BetData = {
      userId: `user_${i + 1}`,
      operatorId: `operator_${(i % 5) + 1}`,
      multiplayerGameId: `game_${Math.floor(i / 10) + 1}`,
      nickname: nicknames[i % nicknames.length],
      currency: currencies[i % currencies.length],
      betAmount: (Math.random() * 1000 + 1).toFixed(9),
      betNumber: i % 2, // Alternate between 0 and 1
      gameAvatar: i % 3 === 0 ? null : Math.floor(Math.random() * 12),
      playerGameId: `player_game_${i + 1}_${Date.now()}`,
    };

    // Add win data for some bets (finished bets)
    if (hasWin) {
      bet.coeffWin = (Math.random() * 10 + 1).toFixed(2);
      bet.winAmount = (parseFloat(bet.betAmount) * parseFloat(bet.coeffWin)).toFixed(2);
    }

    bets.push(bet);
  }

  return bets;
}

/**
 * Generate mock coefficient history
 * TODO: Replace with actual coefficient fetching from database
 */
export function getMockCoefficients(): CoefficientHistory[] {
  const coefficients: CoefficientHistory[] = [];
  const nicknames = [
    'player1', 'player2', 'player3', 'player4', 'player5',
    'gamer123', 'betmaster', 'lucky7', 'winner99', 'progamer',
  ];

  for (let i = 0; i < 50; i++) {
    const gameId = 1526000 + i;
    const numClients = Math.floor(Math.random() * 3) + 1; // 1-3 clients per round

    const clientsSeeds: Array<{
      userId: string;
      seed: string;
      nickname: string;
      gameAvatar: number | null;
    }> = [];
    for (let j = 0; j < numClients; j++) {
      clientsSeeds.push({
        userId: `user_${i}_${j}`,
        seed: Math.random().toString(16).substring(2, 18),
        nickname: nicknames[j % nicknames.length],
        gameAvatar: j % 3 === 0 ? null : Math.floor(Math.random() * 12),
      });
    }

    const coeff: CoefficientHistory = {
      coeff: parseFloat((Math.random() * 50 + 1).toFixed(2)),
      gameId: gameId,
      gameUUID: `uuid_${gameId}_${Date.now()}`,
      serverSeed: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      clientsSeeds: clientsSeeds,
      combinedHash: Array.from({ length: 128 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      decimal: `${Math.random() * 10}e+${Math.floor(Math.random() * 200) + 100}`,
    };

    coefficients.push(coeff);
  }

  return coefficients;
}
