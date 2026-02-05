import { Module } from '@nestjs/common';
import { WheelRngService } from './wheel-rng.service';

@Module({
  providers: [WheelRngService],
  exports: [WheelRngService],
})
export class WheelRngModule {}
