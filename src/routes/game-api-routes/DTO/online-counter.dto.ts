export interface OnlineCounterResponse {
  result: {
    total: number;
    gameMode: Record<string, number>;
  };
}
