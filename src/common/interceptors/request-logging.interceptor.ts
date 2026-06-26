import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Observable, tap } from 'rxjs';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();

    // Assign a unique request ID for log correlation; propagate in response header
    const requestId = randomUUID();
    request.headers['x-request-id'] = requestId;
    response.setHeader('x-request-id', requestId);

    return next.handle().pipe(
      tap({
        next: () => {
          this.logRequest(request, response, startedAt, requestId);
        },
        error: (error: unknown) => {
          this.logRequest(request, response, startedAt, requestId, error);
        },
      }),
    );
  }

  private logRequest(
    request: Request,
    response: Response,
    startedAt: number,
    requestId: string,
    error?: unknown,
  ): void {
    const durationMs = Date.now() - startedAt;
    const userAgent = request.get('user-agent') ?? 'unknown';
    const statusCode = response.statusCode;
    // Use request.path (no query params) to avoid logging sensitive filter values
    const payload = {
      requestId,
      method: request.method,
      path: request.path,
      statusCode,
      durationMs,
      ip: request.ip,
      userAgent,
    };

    if (error) {
      this.logger.error({
        ...payload,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }

    this.logger.log(payload);
  }
}
