/**
 * Payment gateway abstraction (Layer C seam).
 *
 * Every provider (sandbox now, Razorpay/Stripe at pilot) implements this
 * interface. The service layer only ever talks to `PaymentGateway`, so
 * switching providers is a config change (PAYMENT_PROVIDER) — no rewrite.
 *
 * The signature scheme intentionally mirrors Razorpay's
 * `hmac_sha256(order_id + "|" + payment_id, key_secret)` so the real adapter is
 * a drop-in.
 */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface CreateOrderInput {
  amountPaise: number;
  /** Idempotency/reference string (we pass the booking ref). */
  receipt: string;
  notes?: Record<string, string>;
}

export interface GatewayOrder {
  provider: string;
  orderId: string;
  amountPaise: number;
  /** Public key id the client needs to open checkout (empty for sandbox). */
  keyId: string;
}

export interface VerifyInput {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface PaymentGateway {
  /** Provider slug persisted on the Payment row ("sandbox" | "razorpay"). */
  readonly provider: string;

  /** Create a gateway order for the given amount. */
  createOrder(input: CreateOrderInput): Promise<GatewayOrder>;

  /**
   * Verify the signature the client returned after paying. Real gateways sign
   * with a secret only the server and gateway know, so a forged
   * {paymentId, signature} cannot pass. Timing-safe comparison.
   */
  verifyPaymentSignature(input: VerifyInput): boolean;
}
