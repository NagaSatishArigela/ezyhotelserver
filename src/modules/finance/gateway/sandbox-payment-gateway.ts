import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  CreateOrderInput,
  GatewayOrder,
  PaymentGateway,
  VerifyInput,
} from './payment-gateway.interface';

/**
 * Demo/pilot-safe gateway. No network, nothing charged — but the signature is
 * REAL HMAC-SHA256 over `${orderId}|${paymentId}` keyed with a server-only
 * secret, exactly like Razorpay. A forged {paymentId, signature} therefore
 * fails verification, so this exercises the true security path.
 *
 * `simulateCheckout()` is the ONE sandbox-only extra: it plays the role the
 * gateway's hosted checkout widget performs in production (mint a paymentId and
 * sign it). The real adapter will not expose it — the client's browser gets the
 * signed pair from the gateway instead.
 */
@Injectable()
export class SandboxPaymentGateway implements PaymentGateway {
  readonly provider = 'sandbox';

  constructor(private readonly secret: string) {}

  async createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    const orderId = `order_sbx_${randomBytes(12).toString('hex')}`;
    return {
      provider: this.provider,
      orderId,
      amountPaise: input.amountPaise,
      keyId: '', // sandbox needs no public key
    };
  }

  verifyPaymentSignature(input: VerifyInput): boolean {
    const expected = this.sign(input.orderId, input.paymentId);
    const a = Buffer.from(expected);
    const b = Buffer.from(input.signature);
    // timingSafeEqual throws on length mismatch — guard first.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Sandbox-only: emulate the hosted checkout returning a signed payment. */
  simulateCheckout(orderId: string): { paymentId: string; signature: string } {
    const paymentId = `pay_sbx_${randomBytes(12).toString('hex')}`;
    return { paymentId, signature: this.sign(orderId, paymentId) };
  }

  private sign(orderId: string, paymentId: string): string {
    return createHmac('sha256', this.secret).update(`${orderId}|${paymentId}`).digest('hex');
  }
}
