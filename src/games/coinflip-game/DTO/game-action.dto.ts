import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { BetPayloadDto } from './bet-payload.dto';
import { StepPayloadDto } from './step-payload.dto';

export enum GameAction {
  BET = 'bet',
  STEP = 'step',
  WITHDRAW = 'withdraw',
  GET_GAME_CONFIG = 'get-game-config',
  GET_GAME_STATE = 'get-game-state',
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
    description: 'Action-specific payload. Required for bet and step actions; optional for others.',
    required: false,
    oneOf: [
      { $ref: '#/components/schemas/BetPayloadDto' },
      { $ref: '#/components/schemas/StepPayloadDto' },
    ],
    examples: {
      bet: {
        value: { betAmount: '0.30', currency: 'INR', choice: 'HEADS', playMode: 'QUICK' },
      },
      step: { value: { choice: 'HEADS', roundNumber: 1 } },
      withdraw: { value: undefined },
    },
  })
  payload?: BetPayloadDto | StepPayloadDto | object;
}
