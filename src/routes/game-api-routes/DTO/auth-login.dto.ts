import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AuthLoginDto {
  @ApiProperty({
    description: 'Operator ID (Agent ID)',
    example: 'ee2013ed-e1f0-4d6e-97d2-f36619e2eb52',
  })
  @IsString()
  @IsNotEmpty()
  operator: string;

  @ApiProperty({
    description: 'Auth token (JWT)',
    example: '177ddb17-8200-4ece-aefd-47ffee305b32',
  })
  @IsString()
  @IsNotEmpty()
  auth_token: string;

  @ApiProperty({
    description: 'Currency code',
    example: 'USD',
  })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiProperty({
    description: 'Game mode',
    example: 'chicken-road',
  })
  @IsString()
  @IsNotEmpty()
  game_mode: string;
}

export interface AuthLoginResponse {
  success: boolean;
  result: string;
  data: string;
  gameConfig: any;
  bonuses: any[];
  isLobbyEnabled: boolean;
  isPromoCodeEnabled: boolean;
  isSoundEnabled: boolean;
  isMusicEnabled: boolean;
}
