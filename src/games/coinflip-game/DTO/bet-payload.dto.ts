import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, ValidateIf } from 'class-validator';

export enum PlayMode {
  QUICK = 'QUICK',
  ROUNDS = 'ROUNDS',
}

export enum CoinChoice {
  HEADS = 'HEADS',
  TAILS = 'TAILS',
}

export class BetPayloadDto {
  @ApiProperty({
    example: '0.30',
    description: 'Amount of the bet placed by the user as a stringified decimal',
  })
  @IsNumberString()
  @IsNotEmpty()
  betAmount: string;

  @ApiProperty({
    example: 'INR',
    description: 'Currency code for the bet amount',
  })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiProperty({
    enum: CoinChoice,
    example: CoinChoice.HEADS,
    description: 'Player choice (HEADS or TAILS). Required for QUICK mode, null for ROUNDS mode.',
    required: false,
    nullable: true,
  })
  @ValidateIf((o) => o.playMode === PlayMode.QUICK)
  @IsEnum(CoinChoice)
  @IsOptional()
  choice: CoinChoice | null;

  @ApiProperty({
    enum: PlayMode,
    example: PlayMode.QUICK,
    description: 'Game mode: QUICK (single flip) or ROUNDS (progressive)',
  })
  @IsEnum(PlayMode)
  @IsNotEmpty()
  playMode: PlayMode;

  @ApiProperty({
    example: 'IN',
    description: 'Country code of the user placing the bet',
    required: false,
    nullable: true,
  })
  @IsString()
  @IsOptional()
  countryCode?: string | null;
}
