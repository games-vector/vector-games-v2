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
  betNumber: number;
  gameAvatar: number | null;
  playerGameId: string;
  coeffAuto?: string;
  coeffWin?: string;
  winAmount?: string;
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
  coeffCrash?: number;
  coefficients?: CoefficientHistory[];
}

export interface CoefficientChangePayload {
  coeff: number;
}

export interface LatencyTestPayload {
  date: number;
}

export interface PendingBet {
  userId: string;
  agentId: string;
  operatorId: string;
  betAmount: string;
  currency: string;
  coeffAuto?: string;
  betNumber: number;
  nickname: string;
  gameAvatar: number | null;
  userAvatar?: string | null;
  queuedAt: number;
  platformTxId: string;
  gameCode: string;
  playerGameId: string;
}

export interface ConnectGameState {
  bets: BetsData;
  roundId: number;
  status: GameStatus;
  waitTime: number | null;
  coeffCrash: number | null;
}

export interface OnConnectGamePayload {
  success: boolean;
  myBets: BetData[];
  myNextGameBets: BetData[];
  isNextRoundBetExist: boolean;
  state: ConnectGameState;
  coefficients: CoefficientHistory[];
}
