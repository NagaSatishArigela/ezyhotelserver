import { EncryptionService } from '../../common/crypto/encryption.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { PresignUploadDto } from './presign-upload.dto';

interface UploadGrant {
  key: string;
  contentType: string;
  size: number;
  expiresAt: number;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
};

@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService, private readonly encryption: EncryptionService) {}

  presign(dto: PresignUploadDto) {
    if (!EXTENSIONS[dto.contentType] || (dto.kind === 'photo' && dto.contentType === 'application/pdf')) {
      throw new BadRequestException('Unsupported file type for this upload');
    }
    const key = `${dto.propertyId}/${dto.kind}/${randomUUID()}.${EXTENSIONS[dto.contentType]}`;
    const grant: UploadGrant = { key, contentType: dto.contentType, size: dto.size, expiresAt: Date.now() + 10 * 60_000 };
    const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
    const token = `${payload}.${this.sign(payload).toString('base64url')}`;
    const base = (this.config.get<string>('UPLOAD_PUBLIC_BASE_URL') ?? `http://localhost:${this.config.get<number>('PORT', 4000)}`).replace(/\/$/, '');
    return { key, url: `${base}/uploads/${key}`, uploadUrl: `${base}/uploads/put/${token}` };
  }

  verify(token: string): UploadGrant {
    if (token.length > 2000) throw new UnauthorizedException('Invalid upload grant');
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) throw new UnauthorizedException('Invalid upload grant');
    const received = Buffer.from(signature, 'base64url');
    const expected = this.sign(payload);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException('Invalid upload grant');
    }
    let grant: UploadGrant;
    try { grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as UploadGrant; }
    catch { throw new UnauthorizedException('Invalid upload grant'); }
    if (!Number.isFinite(grant.expiresAt) || grant.expiresAt < Date.now()) throw new UnauthorizedException('Upload grant expired');
    if (!/^[a-f0-9-]{36}\/(photo|document)\/[a-f0-9-]{36}\.(jpg|png|webp|pdf)$/.test(grant.key)
      || !EXTENSIONS[grant.contentType] || !Number.isInteger(grant.size) || grant.size < 1 || grant.size > 10485760) {
      throw new UnauthorizedException('Invalid upload grant');
    }
    return grant;
  }

  async store(token: string, contentType: string | undefined, body: AsyncIterable<Uint8Array>) {
    const grant = this.verify(token);
    if (contentType?.split(';')[0].trim().toLowerCase() !== grant.contentType) throw new BadRequestException('File content type does not match the upload grant');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > grant.size) throw new BadRequestException('File exceeds the declared upload size');
      chunks.push(buffer);
    }
    const file = Buffer.concat(chunks);
    if (size !== grant.size || !this.matchesFileType(file, grant.contentType)) throw new BadRequestException('File size or contents do not match the upload grant');
    const isDocument = grant.key.split('/')[1] === 'document';
    const path = join(this.storageRoot(), isDocument ? 'private-uploads' : 'uploads', grant.key + (isDocument ? '.enc' : ''));
    const contents = isDocument ? this.encryption.encrypt(file.toString('base64')) : file;
    await mkdir(dirname(path), { recursive: true });
    try { await writeFile(path, contents, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConflictException('This upload grant has already been used');
      throw error;
    }
    return { key: grant.key };
  }

  async document(propertyId: string, fileName: string): Promise<{ file: Buffer; contentType: string }> {
    if (!/^[a-f0-9-]{36}$/i.test(propertyId) || !/^[a-f0-9-]{36}\.(jpg|png|webp|pdf)$/i.test(fileName)) {
      throw new NotFoundException('Document not found');
    }
    const key = `${propertyId}/document/${fileName}`;
    let file: Buffer;
    try {
      const encrypted = await readFile(join(this.storageRoot(), 'private-uploads', `${key}.enc`), 'utf8');
      file = Buffer.from(this.encryption.decrypt(encrypted), 'base64');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Previously uploaded documents remain available through the same protected URL.
      try { file = await readFile(join(this.storageRoot(), 'uploads', key)); }
      catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('Document not found');
        throw legacyError;
      }
    }
    const extension = fileName.split('.').pop()?.toLowerCase();
    const contentType = Object.entries(EXTENSIONS).find(([, value]) => value === extension)?.[0];
    if (!contentType) throw new NotFoundException('Document not found');
    return { file, contentType };
  }

  private storageRoot(): string {
    return this.config.get<string>('UPLOAD_STORAGE_ROOT') ?? process.cwd();
  }

  private sign(payload: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_ACCESS_SECRET')).update(`upload:${payload}`).digest();
  }

  private matchesFileType(file: Buffer, contentType: string): boolean {
    if (contentType === 'image/jpeg') return file.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if (contentType === 'image/png') return file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (contentType === 'image/webp') return file.subarray(0, 4).toString() === 'RIFF' && file.subarray(8, 12).toString() === 'WEBP';
    return contentType === 'application/pdf' && file.subarray(0, 5).toString() === '%PDF-';
  }
}
