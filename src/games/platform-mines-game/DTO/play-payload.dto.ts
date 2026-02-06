import { IsNumber, IsString, IsOptional, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PlayValue {
  @IsNumber()
  @Min(1)
  @Max(24)
  minesCount: number;
}

export class PlayPayloadDto {
  @IsString()
  gameType: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  currency: string;

  @ValidateNested()
  @Type(() => PlayValue)
  value: PlayValue;

  @IsOptional()
  @IsString()
  bonusId?: string | null;
}
