import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';

export enum Difficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
  DAREDEVIL = 'DAREDEVIL',
}

export class BetPayloadDto {
  @ApiProperty({
    example: '500.00',
    description:
      'Amount of the bet placed by the user as a stringified decimal',
  })
  @IsNumberString()
  @IsNotEmpty()
  betAmount: string;

  @ApiProperty({
    enum: Difficulty,
    example: Difficulty.MEDIUM,
    description: 'Selected difficulty level impacting odds/payout',
  })
  @IsEnum(Difficulty)
  @IsNotEmpty()
  difficulty: Difficulty;

  @ApiProperty({
    example: 'USD',
    description: 'Currency code for the bet amount (mandatory)',
  })
  @IsString()
  @IsNotEmpty()
  currency: string;

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
