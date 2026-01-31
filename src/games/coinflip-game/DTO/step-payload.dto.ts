import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, Min, Max } from 'class-validator';
import { CoinChoice } from './bet-payload.dto';

export class StepPayloadDto {
  @ApiProperty({
    enum: CoinChoice,
    example: CoinChoice.HEADS,
    description: 'Player choice for this round (HEADS or TAILS)',
  })
  @IsEnum(CoinChoice)
  @IsNotEmpty()
  choice: CoinChoice;

  @ApiProperty({
    example: 1,
    description: 'Round number (1-indexed, 1-20)',
    minimum: 1,
    maximum: 20,
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @Max(20)
  roundNumber: number;
}
