import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(private readonly config: ConfigService) {}

  async send(phone: string, otp: string): Promise<void> {
    const gatewayUrl = this.config.get<string>('SMS_GATEWAY_URL');
    const gatewayKey = this.config.get<string>('SMS_GATEWAY_API_KEY');

    if (!gatewayUrl || !gatewayKey) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new InternalServerErrorException('SMS gateway is not configured');
      }

      // Never log the OTP in plaintext, even in development - logs can be
      // shipped to third-party aggregators or shared in support tickets.
      // Only the last 2 digits are logged so a developer can sanity-check
      // delivery without exposing a usable code.
      this.logger.warn(
        `Development OTP fallback for ${this.maskPhone(phone)}: ******${otp.slice(-2)}`,
      );
      return;
    }

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gatewayKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: `+91${phone}`,
        message: `Your QuickNest verification OTP is ${otp}. It expires in 5 minutes.`,
      }),
    });

    if (!response.ok) {
      this.logger.error(`SMS gateway failed with status ${response.status}`);
      throw new InternalServerErrorException('Unable to send OTP');
    }
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 4) {
      return '*'.repeat(phone.length);
    }
    return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
  }
}
