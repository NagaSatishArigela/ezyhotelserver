import { ExecutionContext, ForbiddenException, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GlobalRole } from '@prisma/client';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import request from 'supertest';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../auth/guards/property-role.guard';
import { PropertyAccessService } from '../auth/property-access.service';
import { StorageService } from './storage.service';
import { publicUploads } from './public-uploads.middleware';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

describe('Uploads HTTP flow', () => {
  let app: INestApplication;
  let root: string;
  const access = { authorize: jest.fn(async (user) => { if (user.id === 'other-owner') throw new ForbiddenException(); }) };
  const storage = { presignPut: jest.fn(async dto => ({ uploadUrl: 'https://storage.test/put', url: 'https://api.test/uploads/documents/' + dto.propertyId + '/file.pdf' })), readDocument: jest.fn(async () => ({ url: 'https://storage.test/signed.pdf' })) };
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
  const dto = { propertyId: 'a1234567-1234-4123-8123-123456789012', kind: 'photo', fileName: 'photo.jpg', contentType: 'image/jpeg', size: photo.length };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ezy-private-uploads-test-'));
    const config = new ConfigService({ JWT_ACCESS_SECRET: 'test-secret', ENCRYPTION_KEY: '11'.repeat(32), HMAC_LOOKUP_PEPPER: 'test-pepper', UPLOAD_PUBLIC_BASE_URL: 'http://localhost', UPLOAD_STORAGE_ROOT: root });
    const module = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [UploadsService, PropertyRoleGuard, EncryptionService,
        { provide: ConfigService, useValue: config },
        { provide: PropertyAccessService, useValue: access },
        { provide: StorageService, useValue: storage },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        const token = req.header('authorization');
        if (!token) throw new UnauthorizedException();
        req.user = { id: token === 'Bearer stranger' ? 'other-owner' : 'owner-1', globalRole: token === 'Bearer admin' ? GlobalRole.ADMIN : GlobalRole.USER };
        return true;
      },
    }).compile();
    app = module.createNestApplication();
    app.use('/uploads', publicUploads(join(root, 'uploads')));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => { jest.clearAllMocks(); });
  afterAll(async () => { await app?.close(); if (root) await rm(root, { recursive: true, force: true }); });

  it('authorizes presigned object-storage uploads for the property applicant', async () => {
    const result = await request(app.getHttpServer()).post('/uploads/presign').auth('owner', { type: 'bearer' }).send(dto).expect(201);
    expect(access.authorize).toHaveBeenCalledWith(expect.objectContaining({ id: 'owner-1' }), dto.propertyId, undefined, true, []);
    expect(result.body.uploadUrl).toBe('https://storage.test/put');
  });

  it('requires authorization for new document references', async () => {
    const path = '/uploads/documents/' + dto.propertyId + '/file.pdf';
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).get(path).auth('stranger', { type: 'bearer' }).expect(403);
    expect(storage.readDocument).not.toHaveBeenCalled();
    const result = await request(app.getHttpServer()).get(path).auth('owner', { type: 'bearer' }).expect(200);
    expect(result.body.url).toBe('https://storage.test/signed.pdf');
    expect(result.headers['cache-control']).toBe('private, no-store');
  });

  it('protects previously uploaded documents without changing their saved URL or moving files', async () => {
    const path = `/uploads/${dto.propertyId}/document/b1234567-1234-4123-8123-123456789012.pdf`;
    const file = join(root, path.slice(1));
    const pdf = Buffer.from('%PDF-1.7 legacy test document');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, pdf);
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).get(path).auth('stranger', { type: 'bearer' }).expect(403);
    const owner = await request(app.getHttpServer()).get(path).auth('owner', { type: 'bearer' }).expect(200);
    expect(owner.body).toEqual(pdf);
    const encoded = await request(app.getHttpServer()).get(path.replace('/document/', '/%64ocument/'));
    expect(encoded.status).not.toBe(200);
  });

  it('rejects uploads to another owner property', async () => {
    await request(app.getHttpServer()).post('/uploads/presign').auth('stranger', { type: 'bearer' }).send(dto).expect(403);
  });

  it('rejects an oversized declaration and an unauthenticated presign request', async () => {
    await request(app.getHttpServer()).post('/uploads/presign').auth('owner', { type: 'bearer' }).send({ ...dto, size: 10485761 }).expect(400);
    await request(app.getHttpServer()).post('/uploads/presign').send(dto).expect(401);
  });
});
