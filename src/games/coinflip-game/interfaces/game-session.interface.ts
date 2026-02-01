import { CoinChoice, PlayMode } from '../DTO/bet-payload.dto';

export interface CoinFlipGameSession {
  // Wallet/Odds integration
  oddsId?: string;
  oddsToken?: string;
  oddsState?: string;

  // User identification
  userId: string;
  agentId: string;

  // Game configuration
  currency: string;
  playMode: PlayMode;
  betAmount: number;
  gameCode: string;

  // Game state
  currentRound: number;
  choices: CoinChoice[];
  results: CoinChoice[];
  isActive: boolean;
  isWin: boolean;
  currentCoeff: string;
  winAmount: number;

  // Transaction tracking
  platformBetTxId: string;
  roundId: string;

  // Timestamps
  createdAt: Date;

  // Fairness/Provably fair data
  serverSeed?: string;
  userSeed?: string;
  hashedServerSeed?: string;
  nonce?: number;
}

export interface CoinFlipGameStateResponse {
  isFinished: boolean;
  isWin: boolean;
  currency: string;
  betAmount: string;
  coeff?: string;
  choices: CoinChoice[];
  roundNumber: number;
  playMode: PlayMode;
  winAmount?: string;
  quickGamesHistory?: QuickGameResult[];
}

export interface QuickGameResult {
  isWin: boolean;
  result: CoinChoice;
  datetime: string;
}
