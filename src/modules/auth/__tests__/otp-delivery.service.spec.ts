import { InternalServerErrorException, Logger } from '@nestjs/common';
import { OtpDeliveryService } from '../services/otp-delivery.service';

describe(OtpDeliveryService.name, () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  const config = { get: jest.fn() };
  let service: OtpDeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OtpDeliveryService(config as never);
    (global as any).fetch = jest.fn();
  });

  it('sends OTP through configured SMS gateway when gateway settings are present', async () => {
    config.get.mockImplementation((key: string) => {
      switch (key) {
        case 'SMS_GATEWAY_URL':
          return 'https://example-sms-gateway.com/send';
        case 'SMS_GATEWAY_API_KEY':
          return 'test-api-key';
        default:
          return null;
      }
    });

    (global as any).fetch.mockResolvedValue({ ok: true, status: 200 });

    await expect(service.send('9876543210', '123456')).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledWith('https://example-sms-gateway.com/send', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-api-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: '+919876543210',
        message: 'Your EzyHotels verification OTP is 123456. It expires in 5 minutes.',
      }),
    });
  });

  it('logs OTP instead of sending when no gateway is configured in development', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      return null;
    });

    await expect(service.send('9876543210', '123456')).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Development OTP fallback for 98******10: ******56',
    );
  });

  it('throws if generic SMS gateway response is not ok', async () => {
    config.get.mockImplementation((key: string) => {
      switch (key) {
        case 'SMS_GATEWAY_URL':
          return 'https://example-sms-gateway.com/send';
        case 'SMS_GATEWAY_API_KEY':
          return 'test-api-key';
        default:
          return null;
      }
    });

    (global as any).fetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(service.send('9876543210', '123456')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(Logger.prototype.error).toHaveBeenCalledWith('SMS gateway failed with status 500');
  });
});
