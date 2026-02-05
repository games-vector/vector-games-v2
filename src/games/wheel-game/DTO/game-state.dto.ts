export enum GameStatus {
  WAIT_GAME = 'WAIT_GAME',
  IN_GAME = 'IN_GAME',
  FINISH_GAME = 'FINISH_GAME',
}

export enum WheelColor {
  BLACK = 'BLACK',
  RED = 'RED',
  BLUE = 'BLUE',
  GREEN = 'GREEN',
}

export interface WheelBetData {
  id: string; // Format: "operatorId::userId"
  playerGameId: string;
  placedAt: string; // ISO 8601
  userId: string;
  operatorId: string;
  nickname: string;
  gameAvatar: number | null;
  betAmount: string;
  color: WheelColor;
  currency: string;
  isNextRoundBet?: boolean;
  userAvatar?: string | null;
}

export interface WheelBetListPayload {
  sumInUSD: number;
  bets: {
    BLACK: WheelBetData[];
    RED: WheelBetData[];
    BLUE: WheelBetData[];
    GREEN: WheelBetData[];
  };
}

export interface PrevRoundResult {
  cellIndex: number;
  cellColor: WheelColor;
}

export interface GameStatusChangedPayload {
  status: GameStatus;
  nextChangeInMs: number;

  // Present in WAIT_GAME:
  gameId?: number;
  prevRoundResults?: PrevRoundResult[];

  // Present in IN_GAME and FINISH_GAME:
  cellIndex?: number;
  cellColor?: WheelColor;
  inCellOffset?: number;
}

export interface WithdrawResultPayload {
  currency: string;
  winAmount: string;
  winCoeff: number;
}

export interface WheelPendingBet {
  userId: string;
  agentId: string;
  operatorId: string;
  betAmount: string;
  color: WheelColor;
  currency: string;
  nickname: string;
  gameAvatar: number | null;
  userAvatar?: string | null;
  queuedAt: number;
  platformTxId: string;
  gameCode: string;
  playerGameId: string;
}

export interface WheelRound {
  roundId: number;
  gameUUID: string;
  status: GameStatus;
  bets: Map<string, WheelBetData>; // playerGameId -> bet
  cellIndex: number;
  cellColor: WheelColor;
  inCellOffset: number;
  serverSeed: string;
  hashedServerSeed: string;
  createdAt: number;
}

export interface WheelGameStateResponse {
  gameId: number;
  status: GameStatus;
  allBets: WheelBetListPayload;
}
