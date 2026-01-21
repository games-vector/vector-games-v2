import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly cfg: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint', description: 'Returns the health status of the application' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Application is healthy' })
  health() {
    try {
      const appCfg = this.cfg.get<any>('app');
      const dbConnected = this.dataSource?.isInitialized ?? false;
      
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        env: appCfg?.env,
        authEnabled: appCfg?.enableAuth,
        db: { connected: dbConnected },
      };
    } catch (error) {
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }
}
