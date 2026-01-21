import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class StepPayloadDto {
  @ApiProperty({
    example: 3,
    description: 'Line number the player wishes to move to',
  })
  @IsNumber()
  @IsNotEmpty()
  lineNumber: number;
}
