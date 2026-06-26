import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96-bit IV is recommended for GCM
const KEY_LENGTH_BYTES = 32; // 256-bit key

/**
 * Field-level encryption for sensitive PII/financial data (bank details,
 * GSTIN, PAN, etc.) per the platform's compliance requirements:
 *  - AES-256-GCM at rest, format `iv:authTag:ciphertext` (all base64)
 *  - HMAC-SHA256 deterministic lookup hashes for deduplication on encrypted
 *    fields (e.g. gstin_hash, pan_hash) using a SEPARATE pepper from
 *    OTP/verification-token peppers
 *
 * This service is the single point of truth for encrypt/decrypt/hash so
 * every domain module (properties.HotelDocuments, properties.BankDetails,
 * etc.) applies the same scheme consistently.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private key!: Buffer;
  private hmacPepper!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const keyHex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `ENCRYPTION_KEY must be a ${KEY_LENGTH_BYTES * 2}-character hex string ` +
          `(${KEY_LENGTH_BYTES} bytes); got ${key.length} bytes`,
      );
    }
    this.key = key;
    this.hmacPepper = this.config.getOrThrow<string>('HMAC_LOOKUP_PEPPER');
  }

  /**
   * Encrypt a plaintext string. Returns `iv:authTag:ciphertext` with each
   * segment base64-encoded. Returns null/undefined unchanged so optional
   * fields can be passed through transparently.
   */
  encrypt(plaintext: string): string;
  encrypt(plaintext: null | undefined): null;
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined) {
      return null;
    }

    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypt a value produced by encrypt(). Returns null/undefined unchanged.
   * Throws if the value is malformed or the auth tag does not verify
   * (tampering or wrong key).
   */
  decrypt(value: string): string;
  decrypt(value: null | undefined): null;
  decrypt(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const parts = value.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted value format');
    }
    const [ivB64, authTagB64, ciphertextB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  /**
   * Deterministic HMAC-SHA256 lookup hash for an encrypted field, used for
   * uniqueness/dedup checks (e.g. gstin_hash, pan_hash, account_number_hash)
   * without storing or comparing plaintext. Normalizes input (trim + upper)
   * so formatting differences don't create duplicate "unique" records.
   */
  lookupHash(value: string): string {
    const normalized = value.trim().toUpperCase();
    return createHmac('sha256', this.hmacPepper).update(normalized).digest('hex');
  }

  /**
   * Constant-time comparison of two lookup hashes (defense in depth - hashes
   * are not secret, but avoids any short-circuit timing differences).
   */
  hashesMatch(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  /**
   * Mask a sensitive value for API responses, e.g.:
   *   maskValue('1234567890123456', { keepStart: 0, keepEnd: 4 }) -> '************3456'
   *   maskValue('22AAAAA0000A1Z5', { keepStart: 2, keepEnd: 5 })  -> '22********A1Z5'
   * Full reveal requires a separate OTP-gated endpoint.
   */
  maskValue(
    value: string,
    options: { keepStart?: number; keepEnd?: number } = {},
  ): string {
    const keepStart = options.keepStart ?? 0;
    const keepEnd = options.keepEnd ?? 4;
    if (value.length <= keepStart + keepEnd) {
      return '*'.repeat(value.length);
    }
    const start = value.slice(0, keepStart);
    const end = value.slice(value.length - keepEnd);
    const middle = '*'.repeat(value.length - keepStart - keepEnd);
    return `${start}${middle}${end}`;
  }
}
