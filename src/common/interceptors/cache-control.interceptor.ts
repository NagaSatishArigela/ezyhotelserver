import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();
    // Prevent browsers and proxies from caching any API response.
    // Sensitive data (tokens, bookings, payout amounts) must never be served
    // from a stale cache, and must not persist in shared proxy stores.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache'); // HTTP/1.0 compat for older clients
    return next.handle();
  }
}
