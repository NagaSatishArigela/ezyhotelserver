import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../../auth/guards/property-role.guard';
import { StorageService } from '../storage.service';
import { UploadsController } from '../uploads.controller';

describe('onboarding upload rate limits', () => {
  let app: INestApplication;
  const propertyId = '11111111-1111-4111-8111-111111111111';
  const storage = {
    presignPut: jest.fn().mockResolvedValue({ uploadUrl: 'https://storage.test/upload', url: 'https://api.test/document', key: 'document' }),
    readDocument: jest.fn().mockResolvedValue({ url: 'https://storage.test/document' }),
    readPhoto: jest.fn().mockResolvedValue({ url: 'https://storage.test/photo' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([
        { name: 'default', ttl: 60_000, limit: 200 },
        { name: 'strict', ttl: 60_000, limit: 10 },
        { name: 'upload', ttl: 3_600_000, limit: 20 },
      ])],
      controllers: [UploadsController],
      providers: [
        { provide: StorageService, useValue: storage },
        // Use the real guard: the application's test-aware guard skips limits in Jest.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(PropertyRoleGuard).useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => { await app?.close(); });

  it('allows a full gallery and KYC batch, including a later FSSAI upload, while retaining a burst cap', async () => {
    for (let index = 0; index < 60; index++) {
      const photo = index < 25;
      const result = await request(app.getHttpServer()).post('/uploads/presign').send({
        propertyId,
        kind: photo ? 'photo' : 'document',
        fileName: photo ? 'photo.jpg' : 'fssai.pdf',
        contentType: photo ? 'image/jpeg' : 'application/pdf',
        size: 100,
      }).expect(201);
      expect(result.headers['x-ratelimit-limit-upload']).toBe('120');
    }
    const limited = await request(app.getHttpServer()).post('/uploads/presign').send({
      propertyId, kind: 'document', fileName: 'fssai.pdf', contentType: 'application/pdf', size: 100,
    }).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(storage.presignPut).toHaveBeenCalledTimes(60);
  });

  it.each(['photos', 'documents'])('allows repeated %s previews without the upload-hour or strict limits', async (kind) => {
    for (let index = 0; index < 25; index++) {
      const result = await request(app.getHttpServer())
        .get(`/uploads/${kind}/${propertyId}/file.pdf`).expect(200);
      expect(result.headers['x-ratelimit-limit']).toBe('200');
      expect(result.headers['x-ratelimit-limit-upload']).toBeUndefined();
      expect(result.headers['x-ratelimit-limit-strict']).toBeUndefined();
    }
  });
});
