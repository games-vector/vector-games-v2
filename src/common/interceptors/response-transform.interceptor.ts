import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ERROR_CODES } from '../constants';
import { DEFAULTS } from '../../config/defaults.config';

interface ResponseWithStatus {
  status: string;
  [key: string]: any;
}

@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const path = request.url;
    
    // Skip transformation for online-counter endpoint (should not have status field)
    if (path === '/api/online-counter/v1/data') {
      return next.handle();
    }
    
    return next.handle().pipe(map((data) => this.transformResponse(data)));
  }

  private transformResponse(data: unknown): ResponseWithStatus {
    if (this.isObjectWithoutStatus(data)) {
      (data as ResponseWithStatus).status = ERROR_CODES.SUCCESS;
      return data as ResponseWithStatus;
    }

    if (this.isObjectWithStatus(data)) {
      return data;
    }

    return this.wrapPrimitiveResponse(data);
  }

  private isObjectWithoutStatus(data: unknown): boolean {
    return data !== null && typeof data === 'object' && !('status' in data);
  }

  private isObjectWithStatus(data: unknown): data is ResponseWithStatus {
    return data !== null && typeof data === 'object' && 'status' in data;
  }

  private wrapPrimitiveResponse(data: unknown): ResponseWithStatus {
    return {
      status: ERROR_CODES.SUCCESS,
      desc: DEFAULTS.RESPONSE.DEFAULT_SUCCESS_DESC,
      value: data,
    };
  }
}
