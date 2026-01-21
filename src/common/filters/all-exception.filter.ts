import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ERROR_CODES } from '../constants';

const ERROR_MESSAGES = {
  ACCOUNT_EXISTS: 'Account already exists',
  ACCOUNT_NOT_FOUND: 'Account not found',
  INVALID_PARAMETERS: 'Invalid or missing parameters',
  AGENT_FORBIDDEN: 'Agent forbidden',
  UNAUTHORIZED: 'Unauthorized',
  IP_MISMATCH: 'IP mismatch',
  INTERNAL_ERROR: 'Internal server error',
  UNKNOWN_ERROR: 'Error',
} as const;

const API_PATH_PREFIX = '/api/';
const IP_MISMATCH_KEYWORD = 'ip mismatch';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const requestUrl = request.url as string;

    if (requestUrl?.startsWith(API_PATH_PREFIX)) {
      this.handleApiException(exception, request, response, requestUrl);
      return;
    }

    // Health endpoint should return proper HTTP status codes
    if (requestUrl === '/health' || requestUrl?.startsWith('/health')) {
      this.handleHealthException(exception, request, response, requestUrl);
      return;
    }

    const { code, desc } = this.mapException(exception);
    this.logger.error(
      `Exception: code=${code} desc="${desc}" path=${requestUrl}`,
    );
    response.status(HttpStatus.OK).json({ status: code, desc });
  }

  private handleApiException(
    exception: unknown,
    request: any,
    response: any,
    requestUrl: string,
  ): void {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      this.logger.error(
        `HTTP ${status} on ${requestUrl}: ${this.safeStringify(exceptionResponse)}`,
      );
      response.status(status).json(exceptionResponse);
      return;
    }

    this.logger.error(
      `Unhandled exception on ${requestUrl}: ${this.safeStringify(exception)}`,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: ERROR_MESSAGES.INTERNAL_ERROR,
    });
  }

  private handleHealthException(
    exception: unknown,
    request: any,
    response: any,
    requestUrl: string,
  ): void {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      this.logger.error(
        `Health check error on ${requestUrl}: ${this.safeStringify(exceptionResponse)}`,
      );
      response.status(status).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: this.normalizeMessage(exceptionResponse),
      });
      return;
    }

    this.logger.error(
      `Unhandled exception on health endpoint ${requestUrl}: ${this.safeStringify(exception)}`,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: ERROR_MESSAGES.INTERNAL_ERROR,
    });
  }

  private mapException(exception: unknown): { code: string; desc: string } {
    if (this.hasCodeAndDesc(exception)) {
      return {
        code: String(exception.code) || ERROR_CODES.FAIL,
        desc: String(exception.desc) || ERROR_MESSAGES.UNKNOWN_ERROR,
      };
    }

    if (exception instanceof ConflictException) {
      return {
        code: ERROR_CODES.ACCOUNT_EXIST,
        desc: ERROR_MESSAGES.ACCOUNT_EXISTS,
      };
    }

    if (exception instanceof NotFoundException) {
      return {
        code: ERROR_CODES.ACCOUNT_NOT_EXIST,
        desc: ERROR_MESSAGES.ACCOUNT_NOT_FOUND,
      };
    }

    if (exception instanceof BadRequestException) {
      return {
        code: ERROR_CODES.PARAMETER_MISSING,
        desc: ERROR_MESSAGES.INVALID_PARAMETERS,
      };
    }

    if (exception instanceof ForbiddenException) {
      return {
        code: ERROR_CODES.INVALID_AGENT_ID,
        desc: ERROR_MESSAGES.AGENT_FORBIDDEN,
      };
    }

    if (exception instanceof UnauthorizedException) {
      const message = String((exception as any).message || '').toLowerCase();
      if (message.includes(IP_MISMATCH_KEYWORD)) {
        return {
          code: ERROR_CODES.INVALID_IP_ADDRESS,
          desc: ERROR_MESSAGES.IP_MISMATCH,
        };
      }
      return {
        code: ERROR_CODES.INVALID_AGENT_ID,
        desc: ERROR_MESSAGES.UNAUTHORIZED,
      };
    }

    if (exception instanceof HttpException) {
      return {
        code: ERROR_CODES.UNABLE_TO_PROCEED,
        desc: this.normalizeMessage(exception.getResponse()),
      };
    }

    return {
      code: ERROR_CODES.UNABLE_TO_PROCEED,
      desc: ERROR_MESSAGES.INTERNAL_ERROR,
    };
  }

  private hasCodeAndDesc(
    exception: unknown,
  ): exception is { code: string; desc: string } {
    return (
      exception !== null &&
      typeof exception === 'object' &&
      'code' in exception &&
      'desc' in exception
    );
  }

  private normalizeMessage(response: unknown): string {
    if (!response) return ERROR_MESSAGES.UNKNOWN_ERROR;
    if (typeof response === 'string') return response;

    if (typeof response === 'object') {
      const obj = response as Record<string, any>;

      if ('message' in obj) {
        const message = obj.message;
        if (Array.isArray(message)) return message.join(', ');
        if (typeof message === 'string') return message;
      }

      if ('error' in obj && typeof obj.error === 'string') {
        return obj.error;
      }
    }

    return ERROR_MESSAGES.UNKNOWN_ERROR;
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unstringifiable]';
    }
  }
}
