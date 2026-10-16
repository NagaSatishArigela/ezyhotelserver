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

      // No SMS gateway configured — log the full OTP so local dev and QA
      // can complete verification without a real phone. Never reaches
      // production because the gateway check above throws first.
      this.logger.warn(
        `Development OTP fallback for ${this.maskPhone(phone)}: ${this.maskOtp(otp)}`,
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
        message: `Your EzyHotels verification OTP is ${otp}. It expires in 5 minutes.`,
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

  private maskOtp(otp: string): string {
    if (otp.length <= 2) {
      return '*'.repeat(otp.length);
    }
    return `******${otp.slice(-2)}`;
  }
}
