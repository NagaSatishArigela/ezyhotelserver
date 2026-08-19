import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Payload returned by the gateway checkout after the guest pays. The signature
 * is verified server-side against the order — a forged paymentId/signature is
 * rejected, replacing the old client-trusted `{ success: true }` confirm.
 */
export class VerifyPaymentDto {
  @ApiProperty({ description: 'Gateway order id from POST /payment/order' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ description: 'Gateway payment id from checkout' })
  @IsString()
  @IsNotEmpty()
  paymentId: string;

  @ApiProperty({ description: 'HMAC signature from checkout' })
  @IsString()
  @IsNotEmpty()
  signature: string;
}
