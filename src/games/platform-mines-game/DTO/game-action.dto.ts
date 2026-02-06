export enum GameAction {
  PLAY = 'play',
  STEP = 'step',
  PAYOUT = 'payout',
  GET_GAME_STATE = 'get-game-state',
  GET_GAME_CONFIG = 'get-game-config',
  GET_RATES = 'get-rates',
  GET_GAME_SEEDS = 'get-game-seeds',
  SET_USER_SEED = 'set-user-seed',
  GET_GAME_HISTORY = 'get-game-history',
}

export interface GameActionDto {
  action: GameAction | string;
  payload?: any;
}
