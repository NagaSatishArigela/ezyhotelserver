import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../encryption.service';

describe(EncryptionService.name, () => {
  let service: EncryptionService;

  const config = {
    getOrThrow: jest.fn((key: string) => {
      switch (key) {
        case 'ENCRYPTION_KEY':
          return 'a'.repeat(64); // 32 bytes hex
        case 'HMAC_LOOKUP_PEPPER':
          return 'test-hmac-pepper';
        default:
          throw new Error(`Unexpected config key ${key}`);
      }
    }),
  };

  beforeEach(() => {
    service = new EncryptionService(config as unknown as ConfigService);
    service.onModuleInit();
  });

  describe('encrypt/decrypt', () => {
    it('round-trips a plaintext value', () => {
      const plaintext = '22AAAAA0000A1Z5';
      const encrypted = service.encrypt(plaintext);

      expect(encrypted).not.toEqual(plaintext);
      expect(encrypted.split(':')).toHaveLength(3);
      expect(service.decrypt(encrypted)).toEqual(plaintext);
    });

    it('produces a different ciphertext each time (random IV)', () => {
      const plaintext = 'AAAAA1234A';
      const first = service.encrypt(plaintext);
      const second = service.encrypt(plaintext);

      expect(first).not.toEqual(second);
      expect(service.decrypt(first)).toEqual(plaintext);
      expect(service.decrypt(second)).toEqual(plaintext);
    });

    it('passes through null/undefined unchanged', () => {
      expect(service.encrypt(null)).toBeNull();
      expect(service.encrypt(undefined)).toBeNull();
      expect(service.decrypt(null)).toBeNull();
      expect(service.decrypt(undefined)).toBeNull();
    });

    it('throws on malformed ciphertext', () => {
      expect(() => service.decrypt('not-a-valid-format')).toThrow();
    });

    it('throws if the ciphertext has been tampered with', () => {
      const encrypted = service.encrypt('sensitive-value');
      const [iv, authTag, ciphertext] = encrypted.split(':');
      const tamperedCiphertext = Buffer.from(ciphertext, 'base64');
      tamperedCiphertext[0] ^= 0xff;
      const tampered = `${iv}:${authTag}:${tamperedCiphertext.toString('base64')}`;

      expect(() => service.decrypt(tampered)).toThrow();
    });
  });

  describe('lookupHash', () => {
    it('produces a deterministic hash for the same input', () => {
      const a = service.lookupHash('22AAAAA0000A1Z5');
      const b = service.lookupHash('22AAAAA0000A1Z5');
      expect(a).toEqual(b);
    });

    it('normalizes case and surrounding whitespace before hashing', () => {
      const a = service.lookupHash('22aaaaa0000a1z5');
      const b = service.lookupHash('  22AAAAA0000A1Z5  ');
      expect(a).toEqual(b);
    });

    it('produces different hashes for different inputs', () => {
      const a = service.lookupHash('22AAAAA0000A1Z5');
      const b = service.lookupHash('33BBBBB1111B2Y6');
      expect(a).not.toEqual(b);
    });
  });

  describe('hashesMatch', () => {
    it('returns true for identical hashes', () => {
      const hash = service.lookupHash('22AAAAA0000A1Z5');
      expect(service.hashesMatch(hash, hash)).toBe(true);
    });

    it('returns false for different-length or different hashes', () => {
      const a = service.lookupHash('22AAAAA0000A1Z5');
      const b = service.lookupHash('33BBBBB1111B2Y6');
      expect(service.hashesMatch(a, b)).toBe(false);
      expect(service.hashesMatch(a, 'short')).toBe(false);
    });
  });

  describe('maskValue', () => {
    it('masks a bank account number keeping the last 4 digits', () => {
      expect(service.maskValue('123456789012', { keepEnd: 4 })).toEqual(
        '********9012',
      );
    });

    it('masks a GSTIN keeping start and end segments', () => {
      expect(
        service.maskValue('22AAAAA0000A1Z5', { keepStart: 2, keepEnd: 5 }),
      ).toEqual('22********0A1Z5');
    });

    it('masks the entire value if shorter than the visible portions', () => {
      expect(service.maskValue('123', { keepStart: 2, keepEnd: 4 })).toEqual(
        '***',
      );
    });
  });

  describe('onModuleInit', () => {
    it('throws if ENCRYPTION_KEY is not 32 bytes', () => {
      const badConfig = {
        getOrThrow: jest.fn((key: string) =>
          key === 'ENCRYPTION_KEY' ? 'tooshort' : 'pepper',
        ),
      };
      const badService = new EncryptionService(
        badConfig as unknown as ConfigService,
      );
      expect(() => badService.onModuleInit()).toThrow(/32 bytes/i);
    });
  });
});
