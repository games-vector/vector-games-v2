import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthLoginDto, AuthLoginResponse } from './DTO/auth-login.dto';
import { OnlineCounterResponse } from './DTO/online-counter.dto';
import { CreateGameDto, CreateGameResponse } from './DTO/create-game.dto';
import { GameApiRoutesService } from './game-api-routes.service';

@ApiTags('game-api')
@Controller('api')
export class GameApiRoutesController {
  constructor(private readonly service: GameApiRoutesService) {}

  @Post('auth')
  async authenticate(@Body() body: AuthLoginDto): Promise<AuthLoginResponse> {
    return this.service.authenticateGame(body);
  }

  @Get('online-counter/v1/data')
  async getOnlineCounter(): Promise<OnlineCounterResponse> {
    return this.service.getOnlineCounter();
  }

  @Get('games')
  @ApiOperation({ summary: 'Get all active games available for login' })
  async getActiveGames(): Promise<Array<{ gameCode: string; gameName: string; isActive: boolean; displayName?: string }>> {
    return this.service.getActiveGames();
  }

  @Get('games/dashboard')
  @ApiOperation({ summary: 'Get all games with extended information for dashboard' })
  async getDashboardGames(): Promise<{ 
    userId: string;
    agentId: string;
    cert: string;
    games: Array<any> 
  }> {
    return this.service.getDashboardGames();
  }

  @Post('games')
  @ApiOperation({ summary: 'Create a new game with automatic onboarding' })
  async createGame(@Body() body: CreateGameDto): Promise<CreateGameResponse> {
    return this.service.createGameWithOnboarding(body);
  }
}
