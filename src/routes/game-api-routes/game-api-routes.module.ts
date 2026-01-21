import { Module } from '@nestjs/common';
import { JwtTokenModule } from '@vector-games/game-core';
import { UserSessionModule } from '../../modules/user-session/user-session.module';
import { GameModule } from '../../modules/games/game.module';
import { GameConfigModule } from '../../modules/game-config/game-config.module';
import { GamesModule } from '../../games/games.module';
import { GameApiRoutesController } from './game-api-routes.controller';
import { GameApiRoutesService } from './game-api-routes.service';
import { GamesHealthController } from './games/games-health.controller';

@Module({
  imports: [JwtTokenModule, UserSessionModule, GameModule, GameConfigModule, GamesModule],
  controllers: [GameApiRoutesController, GamesHealthController],
  providers: [GameApiRoutesService],
  exports: [GameApiRoutesService],
})
export class GameApiRoutesModule {}
