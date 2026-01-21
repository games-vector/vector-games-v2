import { Global, Module } from '@nestjs/common';
import { GameDispatcherService } from './game-dispatcher.service';
import { GameRegistryService } from './game-registry.service';

/**
 * Games Module
 * 
 * Global module that provides:
 * - GameDispatcherService: Routes WebSocket connections to game handlers
 * - GameRegistryService: Centralized game information and statistics
 * 
 * This module must be imported before any game-specific modules
 * to ensure GameDispatcherService is available for handler registration.
 */
@Global()
@Module({
  providers: [GameDispatcherService, GameRegistryService],
  exports: [GameDispatcherService, GameRegistryService],
})
export class GamesModule {}
