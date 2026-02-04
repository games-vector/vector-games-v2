import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { BetPayloadDto } from './bet-payload.dto';

export enum GameAction {
  BET = 'bet',
  GET_GAME_CONFIG = 'get-game-config',
  GET_GAME_SEEDS = 'get-game-seeds',
  SET_USER_SEED = 'set-user-seed',
  GET_MY_BETS_HISTORY = 'gameService-get-my-bets-history',
}

export class GameActionDto {
  @ApiProperty({
    enum: GameAction,
    example: GameAction.BET,
    description: 'Type of game action to perform',
  })
  @IsEnum(GameAction)
  action: GameAction;

  @ApiProperty({
    description: 'Action-specific payload. Required for bet action.',
    required: false,
    type: BetPayloadDto,
  })
  payload?: BetPayloadDto;
}
