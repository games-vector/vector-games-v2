import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtTokenService, JwtTokenServiceConfig } from '@games-vector/game-core';

/**
 * Wrapper module that adds forRootAsync support to JwtTokenModule
 * This allows reading JWT config from game config table (database)
 */
@Module({})
export class JwtTokenWrapperModule {
  static forRootAsync(options: {
    imports?: any[];
    inject?: any[];
    useFactory: (...args: any[]) => Promise<JwtTokenServiceConfig> | JwtTokenServiceConfig;
  }): DynamicModule {
    return {
      module: JwtTokenWrapperModule,
      global: true, // Make module global so JwtTokenService is available everywhere
      imports: [
        ...(options.imports || []),
        JwtModule.register({}),
      ],
      providers: [
        {
          provide: 'JWT_CONFIG',
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        JwtTokenService,
      ],
      exports: [JwtTokenService],
    };
  }

  static forRoot(config: JwtTokenServiceConfig): DynamicModule {
    // Delegate to original module pattern
    return {
      module: JwtTokenWrapperModule,
      global: true,
      imports: [JwtModule.register({})],
      providers: [
        {
          provide: 'JWT_CONFIG',
          useValue: config,
        },
        JwtTokenService,
      ],
      exports: [JwtTokenService],
    };
  }
}
