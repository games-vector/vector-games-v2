export enum WheelGameAction {
  GET_GAME_CONFIG = 'get-game-config',
  GET_GAME_STATE = 'get-game-state',
  MAKE_BET = 'make-bet',
  GET_MY_BETS_HISTORY = 'get-my-bets-history',
  GET_GAME_SEEDS = 'getGameSeeds',
}

export interface WheelGameActionDto {
  action: WheelGameAction;
  payload?: any;
}
