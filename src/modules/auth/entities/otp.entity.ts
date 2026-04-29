export interface OtpRecord {
  codeHash: string;
  expiresAt: string;
}

export interface OtpEntity {
  id: string;
  phone: string;
  code: string;
  attempts: number;
  expiresAt: Date;
  lockedUntil: Date | null;
  createdAt: Date;
}
