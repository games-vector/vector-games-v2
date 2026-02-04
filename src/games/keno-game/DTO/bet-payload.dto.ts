import { ApiProperty } from '@nestjs/swagger';
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
 * Maps to UI labels: LOW = EASY, MEDIUM = MEDIUM, HIGH = HIGH
 */
export enum Risk {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
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
    description: 'Selected risk level impacting odds/payout (LOW = EASY UI)',
  })
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
