import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsBoolean } from 'class-validator';

export class CreateGameDto {
  @ApiProperty({
    description: 'Unique game code (e.g., chicken-road-gold)',
    example: 'chicken-road-gold',
  })
  @IsString()
  @IsNotEmpty()
  gameCode: string;

  @ApiProperty({
    description: 'Display name of the game',
    example: 'Chicken Road Gold',
  })
  @IsString()
  @IsNotEmpty()
  gameName: string;

  @ApiProperty({
    description: 'Platform identifier',
    example: 'SPADE',
    default: 'SPADE',
  })
  @IsString()
  @IsNotEmpty()
  platform: string;

  @ApiProperty({
    description: 'Game type',
    example: 'LIVE',
    default: 'LIVE',
  })
  @IsString()
  @IsNotEmpty()
  gameType: string;

  @ApiProperty({
    description: 'Settlement type',
    example: 'platformTxId',
    default: 'platformTxId',
  })
  @IsString()
  @IsNotEmpty()
  settleType: string;
}

export interface CreateGameResponse {
  success: boolean;
  message: string;
  game: {
    id: string;
    gameCode: string;
    gameName: string;
    platform: string;
    gameType: string;
    settleType: string;
    isActive: boolean;
  };
  configTableCreated: boolean;
  configsCopied: number;
  hazardsInitialized: boolean;
}

