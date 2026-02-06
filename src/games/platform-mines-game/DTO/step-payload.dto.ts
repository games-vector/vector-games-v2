import { IsNumber, Min, Max } from 'class-validator';

export class StepPayloadDto {
  @IsNumber()
  @Min(1)
  @Max(25)
  cellPosition: number;
}
