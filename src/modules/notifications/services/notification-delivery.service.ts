import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DOMAIN_EVENTS,
  NotificationRequestedPayload,
} from '../../../common/events/domain-events';
import { TypedEventEmitter } from '../../../common/events/typed-event-emitter.service';
import { UsersRepository } from '../../auth/repositories/user.repository';

/**
 * M2 spec §3.3: consumes `notification.requested` and dispatches via a
 * configurable HTTP gateway, mirroring `otp-delivery.service.ts`. Unlike OTP
 * delivery (synchronous, blocking), this is a best-effort async side effect
 * of an event listener - missing gateway config or a failed request is
 * logged and swallowed rather than thrown, so it never breaks the
 * approve/reject/request-revision flow that triggered it.
 */
@Injectable()
export class NotificationDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersRepository,
    private readonly events: TypedEventEmitter,
  ) {}

  onModuleInit(): void {
    this.events.on(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, (payload) =>
      this.deliver(payload).catch((error: Error) => {
        this.logger.error(`Notification delivery failed: ${error.message}`);
      }),
    );
  }

  private async deliver(payload: NotificationRequestedPayload): Promise<void> {
    if (payload.channel === 'push') {
      this.logger.debug(`Push notifications not yet supported (template ${payload.templateId})`);
      return;
    }

    const user = await this.users.findById(payload.recipientUserId);
    if (!user) {
      this.logger.warn(`Notification recipient ${payload.recipientUserId} not found`);
      return;
    }

    if (payload.channel === 'email') {
      await this.sendEmail(user.email, payload);
      return;
    }

    await this.sendSms(user.phone, payload);
  }

  private async sendEmail(
    email: string,
    payload: NotificationRequestedPayload,
  ): Promise<void> {
    const gatewayUrl = this.config.get<string>('EMAIL_GATEWAY_URL');
    const gatewayKey = this.config.get<string>('EMAIL_GATEWAY_API_KEY');

    if (!gatewayUrl || !gatewayKey) {
      this.logger.warn(
        `Email gateway not configured - skipping "${payload.templateId}" for ${email}`,
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
        to: email,
        templateId: payload.templateId,
        data: payload.data,
      }),
    });

    if (!response.ok) {
      this.logger.error(
        `Email gateway failed with status ${response.status} for "${payload.templateId}"`,
      );
    }
  }

  private async sendSms(
    phone: string,
    payload: NotificationRequestedPayload,
  ): Promise<void> {
    const gatewayUrl = this.config.get<string>('SMS_GATEWAY_URL');
    const gatewayKey = this.config.get<string>('SMS_GATEWAY_API_KEY');

    if (!gatewayUrl || !gatewayKey) {
      this.logger.warn(
        `SMS gateway not configured - skipping "${payload.templateId}" for ${this.maskPhone(phone)}`,
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
        templateId: payload.templateId,
        data: payload.data,
      }),
    });

    if (!response.ok) {
      this.logger.error(
        `SMS gateway failed with status ${response.status} for "${payload.templateId}"`,
      );
    }
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 4) {
      return '*'.repeat(phone.length);
    }
    return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
  }
}
