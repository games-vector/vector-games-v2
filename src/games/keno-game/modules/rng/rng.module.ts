import { Module } from '@nestjs/common';
import { RngService } from './rng.service';

@Module({
  providers: [RngService],
  exports: [RngService],
})
export class RngModule {}
