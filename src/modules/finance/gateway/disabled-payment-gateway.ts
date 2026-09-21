import { ServiceUnavailableException } from '@nestjs/common';
import { PaymentGateway, CreateOrderInput, GatewayOrder, VerifyInput } from './payment-gateway.interface';
/** Keep non-payment operations available while production payment integration is absent. */
export class DisabledPaymentGateway implements PaymentGateway {
  readonly provider = 'disabled';
  async createOrder(_input: CreateOrderInput): Promise<GatewayOrder> {
    throw new ServiceUnavailableException('Payments are not available. Please try again later.');
  }
  verifyPaymentSignature(_input: VerifyInput): boolean {
    throw new ServiceUnavailableException('Payments are not available.');
  }
}
