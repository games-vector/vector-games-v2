/**
 * DTOs for Sugar Daddy game state and events
 */

export enum GameStatus {
  WAIT_GAME = 'WAIT_GAME',
  IN_GAME = 'IN_GAME',
  FINISH_GAME = 'FINISH_GAME',
}

export interface BetData {
  userId: string;
  operatorId: string;
  multiplayerGameId: string;
  nickname: string;
  currency: string;
  betAmount: string;
  betNumber: number; // 0 or 1 (0 = manual, 1 = auto)
  gameAvatar: number | null;
  playerGameId: string;
  coeffAuto?: string; // Auto cashout coefficient
  coeffWin?: string; // Winning coefficient
  winAmount?: string; // Win amount
  userAvatar?: string | null;
}

export interface BetsData {
  totalBetsAmount: number;
  values: BetData[];
}

export interface PreviousBetsData {
  totalBetsAmount: number;
  values: BetData[];
}

export interface CoefficientHistory {
  coeff: number;
  gameId: number;
  gameUUID: string;
  serverSeed: string;
  clientsSeeds: Array<{
    userId: string;
    seed: string;
    nickname: string;
    gameAvatar: number | null;
  }>;
  combinedHash: string;
  decimal: string;
}

export interface GameStateChangePayload {
  status: GameStatus;
  roundId: number;
  waitTime: number | null;
  bets: BetsData;
  previousBets: PreviousBetsData;
  coeffCrash?: number; // Only present in FINISH_GAME
  coefficients?: CoefficientHistory[]; // Only present in FINISH_GAME
}

export interface CoefficientChangePayload {
  coeff: number;
}

export interface LatencyTestPayload {
  date: number;
}

/**
 * Pending bet that will be placed in the next round
 */
export interface PendingBet {
  userId: string;
  agentId: string;
  operatorId: string;
  betAmount: string;
  currency: string;
  coeffAuto?: string;
  betNumber: number; // 0 = manual, 1 = auto
  nickname: string;
  gameAvatar: number | null;
  userAvatar?: string | null;
  queuedAt: number; // timestamp when bet was queued
  platformTxId: string; // Transaction ID from wallet API when balance was deducted
  gameCode: string; // Game code from WebSocket connection
  playerGameId: string; // The playerGameId returned to the user (preserved from queue time)
}

/**
 * Game state for onConnectGame response (user-specific)
 * Note: This is different from GameStateChangePayload - it doesn't include previousBets
 */
export interface ConnectGameState {
  bets: BetsData;
  roundId: number;
  status: GameStatus;
  waitTime: number | null;
  coeffCrash: number | null;
}

/**
 * Response payload for gameService-onConnectGame event
 * Sent when client sends {"action": "join"}
 */
export interface OnConnectGamePayload {
  success: boolean;
  myBets: BetData[]; // User's bets for current round
  myNextGameBets: BetData[]; // User's bets for next round
  isNextRoundBetExist: boolean; // Whether user has bets for next round
  state: ConnectGameState;
  coefficients: CoefficientHistory[]; // Previous rounds' coefficients (up to 50)
}