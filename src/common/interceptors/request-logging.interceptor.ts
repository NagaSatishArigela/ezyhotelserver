import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logRequest(request, response, startedAt);
        },
        error: (error: unknown) => {
          this.logRequest(request, response, startedAt, error);
        },
      }),
    );
  }

  private logRequest(
    request: Request,
    response: Response,
    startedAt: number,
    error?: unknown,
  ): void {
    const durationMs = Date.now() - startedAt;
    const userAgent = request.get('user-agent') ?? 'unknown';
    const statusCode = response.statusCode;
    const payload = {
      method: request.method,
      path: request.originalUrl,
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
