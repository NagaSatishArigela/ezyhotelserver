import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard that disables rate limiting under the automated test env
 * (Jest sets NODE_ENV='test'). E2E suites fire many writes in seconds and would
 * otherwise trip the per-IP 'strict' limit. Production/dev behaviour is
 * unchanged — the skip is gated strictly on NODE_ENV === 'test'.
 */
@Injectable()
export class TestAwareThrottlerGuard extends ThrottlerGuard {
  protected shouldSkip(_context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(process.env.NODE_ENV === 'test');
  }
}
