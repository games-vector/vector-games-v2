import { WheelColor } from './game-state.dto';

export interface WheelBetPayloadDto {
  betAmount: string;
  color: WheelColor;
  currency: string;
}
