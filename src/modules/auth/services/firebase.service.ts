import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);

  constructor(private readonly config: ConfigService) {
    this.initFirebase();
  }

  private initFirebase(): void {
    if (admin.apps.length > 0) {
      return;
    }

    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY');
    const databaseUrl = this.config.get<string>('FIREBASE_DATABASE_URL');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase auth is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.',
      );
      return;
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
      ...(databaseUrl ? { databaseURL: databaseUrl } : {}),
    });

    this.logger.log('Firebase admin initialized successfully');
  }

  private static readonly VERIFY_TIMEOUT_MS = 5_000;

  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    if (admin.apps.length === 0) {
      throw new UnauthorizedException('Firebase is not configured');
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Firebase verification timeout')), FirebaseService.VERIFY_TIMEOUT_MS),
    );

    try {
      return await Promise.race([admin.auth().verifyIdToken(idToken), timeout]);
    } catch (error) {
      if (error instanceof Error && error.message === 'Firebase verification timeout') {
        this.logger.warn({ event: 'firebase.verify_id_token_timeout' });
        throw new ServiceUnavailableException('Authentication service temporarily unavailable. Please try again.');
      }
      this.logger.warn({ event: 'firebase.verify_id_token_failed', error });
      throw new UnauthorizedException('Invalid Firebase ID token');
    }
  }
}
