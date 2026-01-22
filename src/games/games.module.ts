import { Global, Module } from '@nestjs/common';
import { GameDispatcherService } from './game-dispatcher.service';
import { GameRegistryService } from './game-registry.service';
import { CriticalHandlersService } from './utils/critical-handlers.service';

/**
 * Games Module
 * 
 * Global module that provides:
 * - GameDispatcherService: Routes WebSocket connections to game handlers
 * - GameRegistryService: Centralized game information and statistics
 * - CriticalHandlersService: Registers critical handlers to prevent race conditions
 * 
 * This module must be imported before any game-specific modules
 * to ensure GameDispatcherService is available for handler registration.
 */
@Global()
@Module({
  providers: [GameDispatcherService, GameRegistryService, CriticalHandlersService],
  exports: [GameDispatcherService, GameRegistryService, CriticalHandlersService],
})
export class GamesModule {}
