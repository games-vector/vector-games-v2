import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsInt,
  Min,
  Max,
} from 'class-validator';

/**
 * Risk levels for Keno game
 * Maps to UI labels: EASY = LOW, MEDIUM = MEDIUM, HIGH = HIGH
 *
 * Note: Frontend may send "EASY" which maps to "LOW" internally
 * The Transform decorator handles this mapping automatically
 */
export enum Risk {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/**
 * Maps frontend difficulty names to internal Risk enum values
 * EASY -> LOW (lower risk, lower rewards)
 * MEDIUM -> MEDIUM (balanced)
 * HIGH -> HIGH (higher risk, higher rewards)
 */
export function mapDifficultyToRisk(value: string): Risk {
  const normalized = value?.toUpperCase?.() || '';
  if (normalized === 'EASY') return Risk.LOW;
  if (normalized === 'LOW') return Risk.LOW;
  if (normalized === 'MEDIUM') return Risk.MEDIUM;
  if (normalized === 'HIGH') return Risk.HIGH;
  return value as Risk; // Let validation fail if invalid
}

export class BetPayloadDto {
  @ApiProperty({
    example: '0.06',
    description: 'Amount of the bet placed by the user as a stringified decimal',
  })
  @IsNumberString()
  @IsNotEmpty()
  betAmount: string;

  @ApiProperty({
    enum: Risk,
    example: Risk.LOW,
    description: 'Selected risk level impacting odds/payout. Accepts EASY/LOW, MEDIUM, HIGH. EASY maps to LOW.',
  })
  @Transform(({ value }) => mapDifficultyToRisk(value))
  @IsEnum(Risk)
  @IsNotEmpty()
  risk: Risk;

  @ApiProperty({
    example: 'USD',
    description: 'Currency code for the bet amount (mandatory)',
  })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiProperty({
    example: [7, 14, 21, 28, 35],
    description: 'Array of 1-10 chosen numbers from 1-40',
    type: [Number],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(40, { each: true })
  chosenNumbers: number[];

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
