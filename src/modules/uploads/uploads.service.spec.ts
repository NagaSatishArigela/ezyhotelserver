import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { UploadsService } from './uploads.service';

jest.mock('fs/promises', () => ({ mkdir: jest.fn(), writeFile: jest.fn() }));

describe('UploadsService', () => {
  const config = { getOrThrow: jest.fn(() => 'test-upload-secret'), get: jest.fn((key: string) => key === 'UPLOAD_PUBLIC_BASE_URL' ? 'https://api.example.test' : undefined) };
  const encryption = { encrypt: jest.fn((value: string) => `encrypted:${value}`), decrypt: jest.fn() };
  const service = new UploadsService(config as never, encryption as never);
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
  const dto = { propertyId: 'a1234567-1234-4123-8123-123456789012', kind: 'photo' as const, fileName: '../unsafe.jpg', contentType: 'image/jpeg', size: photo.length };
  const token = (url: string) => url.split('/put/')[1];
  const body = async function* (file: Buffer) { yield file; };

  beforeEach(() => { jest.clearAllMocks(); jest.mocked(writeFile).mockResolvedValue(); });
  afterEach(() => jest.restoreAllMocks());

  it('issues a signed grant with a generated storage path and accepts the matching raw upload', async () => {
    const grant = service.presign(dto);
    expect(grant.url).toBe(`https://api.example.test/uploads/${grant.key}`);
    expect(grant.key).not.toContain('unsafe');
    await expect(service.store(token(grant.uploadUrl), 'image/jpeg', body(photo))).resolves.toEqual({ key: grant.key });
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(join(process.cwd(), 'uploads', grant.key), photo, expect.objectContaining({ flag: 'wx' }));
  });

  it('rejects altered or expired grants before writing a file', () => {
    const grant = service.presign(dto);
    expect(() => service.verify(`x${token(grant.uploadUrl)}`)).toThrow(UnauthorizedException);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    expect(() => service.verify(token(grant.uploadUrl))).toThrow(UnauthorizedException);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects type spoofing, excess bytes and truncated uploads', async () => {
    const grant = service.presign(dto);
    await expect(service.store(token(grant.uploadUrl), 'application/pdf', body(photo))).rejects.toThrow(BadRequestException);
    await expect(service.store(token(grant.uploadUrl), 'image/jpeg', body(Buffer.alloc(5)))).rejects.toThrow(BadRequestException);
    await expect(service.store(token(grant.uploadUrl), 'image/jpeg', body(Buffer.alloc(4)))).rejects.toThrow(BadRequestException);
    await expect(service.store(token(grant.uploadUrl), 'image/jpeg', body(photo.subarray(0, 2)))).rejects.toThrow(BadRequestException);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('accepts PDFs for documents and refuses PDFs as photos', async () => {
    expect(() => service.presign({ ...dto, contentType: 'application/pdf' })).toThrow(BadRequestException);
    const file = Buffer.from('%PDF-1.7');
    const grant = service.presign({ ...dto, kind: 'document', contentType: 'application/pdf', size: file.length });
    await expect(service.store(token(grant.uploadUrl), 'application/pdf', body(file))).resolves.toEqual({ key: grant.key });
    expect(encryption.encrypt).toHaveBeenCalledWith(file.toString('base64'));
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('private-uploads'), `encrypted:${file.toString('base64')}`, expect.anything());
  });

  it('prevents a grant from overwriting an existing upload', async () => {
    jest.mocked(writeFile).mockRejectedValue(Object.assign(new Error('exists'), { code: 'EEXIST' }));
    const grant = service.presign(dto);
    await expect(service.store(token(grant.uploadUrl), 'image/jpeg', body(photo))).rejects.toThrow(ConflictException);
  });
});
