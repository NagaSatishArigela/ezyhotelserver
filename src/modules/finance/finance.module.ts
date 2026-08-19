import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerService } from './ledger.service';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateway/payment-gateway.interface';
import { SandboxPaymentGateway } from './gateway/sandbox-payment-gateway';

/**
 * Finance infrastructure (Layer C): the double-entry LedgerService and the
 * PaymentGateway provider. Global so domain modules that must post ledger
 * entries or take payment (bookings, payouts) can inject without import wiring —
 * same shared-kernel pattern as DatabaseModule/PlatformModule.
 *
 * The gateway is selected by PAYMENT_PROVIDER at boot. Only "sandbox" exists
 * today; adding "razorpay" is a new adapter class + a case here — no caller
 * changes, because everyone depends on the PaymentGateway interface.
 */
@Global()
@Module({
  providers: [
    LedgerService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentGateway => {
        const provider = config.get<string>('PAYMENT_PROVIDER') ?? 'sandbox';
        switch (provider) {
          case 'sandbox': {
            const secret = config.get<string>('SANDBOX_PAYMENT_SECRET') ?? 'sandbox_dev_secret';
            return new SandboxPaymentGateway(secret);
          }
          // case 'razorpay': return new RazorpayPaymentGateway(config); // pilot
          default:
            throw new Error(`Unsupported PAYMENT_PROVIDER: ${provider}`);
        }
      },
    },
  ],
  exports: [LedgerService, PAYMENT_GATEWAY],
})
export class FinanceModule {}
