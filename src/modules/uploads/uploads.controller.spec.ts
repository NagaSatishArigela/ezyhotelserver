import { ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GlobalRole } from '@prisma/client';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import request from 'supertest';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../auth/guards/property-role.guard';
import { UsersRepository } from '../auth/repositories/user.repository';
import { publicUploads } from './public-uploads.middleware';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

describe('Uploads HTTP flow', () => {
  let app: INestApplication;
  let root: string;
  const users = { hasPropertyRole: jest.fn() };
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
  const dto = { propertyId: 'a1234567-1234-4123-8123-123456789012', kind: 'photo', fileName: 'photo.jpg', contentType: 'image/jpeg', size: photo.length };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ezy-private-uploads-test-'));
    const config = new ConfigService({ JWT_ACCESS_SECRET: 'test-secret', ENCRYPTION_KEY: '11'.repeat(32), HMAC_LOOKUP_PEPPER: 'test-pepper', UPLOAD_PUBLIC_BASE_URL: 'http://localhost', UPLOAD_STORAGE_ROOT: root });
    const module = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [UploadsService, PropertyRoleGuard, EncryptionService,
        { provide: ConfigService, useValue: config },
        { provide: UsersRepository, useValue: users },
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
  beforeEach(() => { jest.clearAllMocks(); users.hasPropertyRole.mockResolvedValue(true); });
  afterAll(async () => { await app?.close(); if (root) await rm(root, { recursive: true, force: true }); });

  it('keeps photo uploads and public photo display working', async () => {
    const presign = await request(app.getHttpServer()).post('/uploads/presign').auth('owner', { type: 'bearer' }).send(dto).expect(201);
    expect(users.hasPropertyRole).toHaveBeenCalledWith('owner-1', dto.propertyId, ['OWNER']);
    await request(app.getHttpServer()).put(new URL(presign.body.uploadUrl).pathname).set('Content-Type', 'image/jpeg').send(photo).expect(200);
    const result = await request(app.getHttpServer()).get(new URL(presign.body.url).pathname).expect(200);
    expect(result.body).toEqual(photo);
  });

  it('requires authorization for documents while keeping owner and admin previews working', async () => {
    const pdf = Buffer.from('%PDF-1.7 private test document');
    const presign = await request(app.getHttpServer()).post('/uploads/presign').auth('owner', { type: 'bearer' }).send({ ...dto, kind: 'document', fileName: 'id.pdf', contentType: 'application/pdf', size: pdf.length }).expect(201);
    await request(app.getHttpServer()).put(new URL(presign.body.uploadUrl).pathname).set('Content-Type', 'application/pdf').send(pdf).expect(200);
    const path = new URL(presign.body.url).pathname;
    expect(await readFile(join(root, 'private-uploads', presign.body.key + '.enc'), 'utf8')).not.toContain('%PDF');
    await request(app.getHttpServer()).get(path).expect(401);
    users.hasPropertyRole.mockResolvedValue(false);
    await request(app.getHttpServer()).get(path).auth('stranger', { type: 'bearer' }).expect(403);
    const admin = await request(app.getHttpServer()).get(path).auth('admin', { type: 'bearer' }).expect(200);
    expect(admin.body).toEqual(pdf);
    users.hasPropertyRole.mockResolvedValue(true);
    const owner = await request(app.getHttpServer()).get(path).auth('owner', { type: 'bearer' }).expect(200);
    expect(owner.body).toEqual(pdf);
    expect(owner.headers['cache-control']).toBe('no-store');
  });

  it('protects previously uploaded documents without changing their saved URL or moving files', async () => {
    const path = `/uploads/${dto.propertyId}/document/b1234567-1234-4123-8123-123456789012.pdf`;
    const file = join(root, path.slice(1));
    const pdf = Buffer.from('%PDF-1.7 legacy test document');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, pdf);
    await request(app.getHttpServer()).get(path).expect(401);
    const owner = await request(app.getHttpServer()).get(path).auth('owner', { type: 'bearer' }).expect(200);
    expect(owner.body).toEqual(pdf);
    const encoded = await request(app.getHttpServer()).get(path.replace('/document/', '/%64ocument/'));
    expect(encoded.status).not.toBe(200);
  });

  it('rejects uploads to another owner property', async () => {
    users.hasPropertyRole.mockResolvedValue(false);
    await request(app.getHttpServer()).post('/uploads/presign').auth('owner', { type: 'bearer' }).send(dto).expect(403);
  });

  it('rejects an oversized declaration and an unsigned PUT', async () => {
    await request(app.getHttpServer()).post('/uploads/presign').auth('owner', { type: 'bearer' }).send({ ...dto, size: 10485761 }).expect(400);
    await request(app.getHttpServer()).put('/uploads/put/invalid').set('Content-Type', 'image/jpeg').send(photo).expect(401);
  });
});
