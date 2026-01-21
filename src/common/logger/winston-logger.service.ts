import { Injectable, LoggerService } from '@nestjs/common';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';
import { DEFAULTS } from '../../config/defaults.config';

@Injectable()
export class WinstonLoggerService implements LoggerService {
  private logger: winston.Logger;
  private readonly isProduction = process.env.NODE_ENV === 'production';
  private readonly enableFileLogging = process.env.ENABLE_FILE_LOGGING !== 'false';

  private readonly excludedFromFile = [
    'HazardSchedulerService',
  ];

  constructor() {
    const logDir = process.env.LOG_DIR || path.join(process.cwd(), DEFAULTS.LOGGER.DEFAULT_LOG_DIR);

    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, context, stack }) => {
        const contextStr = context ? `[${context}]` : '';
        const stackStr = stack ? `\n${stack}` : '';
        return `${timestamp} [${level.toUpperCase()}] ${contextStr} ${message}${stackStr}`;
      }),
    );

    const consoleTransport = new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat,
      ),
    });

    const transports: winston.transport[] = [consoleTransport];

    if (this.isProduction || this.enableFileLogging) {
      const fileTransport = new (DailyRotateFile as any)({
        filename: path.join(logDir, 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD-HH',
        maxFiles: '60d', // Keep log files for 2 months, then delete
        maxSize: '50m',
        format: winston.format.combine(
          winston.format((info: any) => {
            if (info.context && this.excludedFromFile.includes(info.context)) {
              return false;
            }
            return info;
          })(),
          logFormat,
        ),
        zippedArchive: false,
        createSymlink: true,
        symlinkName: 'app-current.log',
      });

      const errorFileTransport = new DailyRotateFile({
        filename: path.join(logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD-HH',
        level: 'error',
        maxFiles: '60d', // Keep log files for 2 months, then delete
        maxSize: '50m',
        format: logFormat,
        zippedArchive: false,
        createSymlink: true,
        symlinkName: 'error-current.log',
      });

      transports.push(fileTransport, errorFileTransport);
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || DEFAULTS.LOGGER.DEFAULT_LEVEL,
      transports,
      exitOnError: false,
    });

    if (this.isProduction || this.enableFileLogging) {
      this.logger.info(`Logging initialized. Logs directory: ${logDir}`, 'WinstonLogger');
    }
  }

  log(message: any, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: any, trace?: string, context?: string) {
    this.logger.error(message, { context, stack: trace });
  }

  warn(message: any, context?: string) {
    this.logger.warn(message, { context });
  }

  debug(message: any, context?: string) {
    this.logger.debug(message, { context });
  }

  verbose(message: any, context?: string) {
    this.logger.verbose(message, { context });
  }
}
