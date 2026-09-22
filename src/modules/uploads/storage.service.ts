import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { PresignUploadDto } from './dto/presign-upload.dto';

const EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

export interface PresignedUpload {
  key: string;
  uploadUrl: string;
  url: string;
  expiresIn: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly presignExpiresIn = 900;

  constructor(private readonly config: ConfigService) {
    const endpointValue = this.config.get<string>('S3_ENDPOINT', '').trim();
    this.bucket = this.config.get<string>('S3_BUCKET', 'ezyhotels-staging').trim();
    this.publicBaseUrl = this.config.get<string>('S3_PUBLIC_BASE_URL', '').trim().replace(/\/$/, '');

    if (!endpointValue || !this.config.get<string>('S3_ACCESS_KEY_ID') || !this.config.get<string>('S3_SECRET_ACCESS_KEY')) {
      this.client = null;
      return;
    }

    const endpoint = new URL(endpointValue);
    this.client = new S3Client({
      endpoint: endpoint.origin,
      region: this.config.get<string>('S3_REGION', 'auto'),
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
      },
    });
  }

  private privateBucket(): string {
    // Temporary staging mode: use the configured bucket until a dedicated
    // private bucket is provisioned. Set S3_PRIVATE_BUCKET later to split it.
    return this.config.get<string>('S3_PRIVATE_BUCKET', '').trim() || this.bucket;
  }
  private documentBase(): string {
    const base = this.config.get<string>('API_PUBLIC_URL', '').replace(/\/$/, '');
    if (!base || !/^https?:\/\//.test(base)) throw new ServiceUnavailableException('Document API URL is not configured');
    return base + '/uploads/documents';
  }
  private documentKey(propertyId: string, file: string): string {
    if (!/^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/.test(file)) throw new BadRequestException('Invalid document reference');
    return 'properties/' + propertyId + '/document/' + file;
  }
  async validateDocument(propertyId: string, url: string): Promise<void> {
    if (!this.client) throw new ServiceUnavailableException('Object storage is not configured');
    const prefix = this.documentBase() + '/' + propertyId + '/';
    if (!url.startsWith(prefix)) throw new BadRequestException('Upload documents to private storage before saving');
    const key = this.documentKey(propertyId, url.slice(prefix.length));
    const object = await this.client.send(new HeadObjectCommand({ Bucket: this.privateBucket(), Key: key }));
    if (!object.ContentLength || object.ContentLength > 10 * 1024 * 1024 || !Object.keys(EXT_MAP).includes(object.ContentType ?? '')) {
      throw new BadRequestException('Document size or content type is invalid');
    }
  }
  async readDocument(propertyId: string, file: string): Promise<{ url: string }> {
    if (!this.client) throw new ServiceUnavailableException('Object storage is not configured');
    const key = this.documentKey(propertyId, file);
    return { url: await getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.privateBucket(), Key: key, ResponseCacheControl: 'private, no-store',
    }), { expiresIn: 60 }) };
  }
  async presignPut(dto: PresignUploadDto): Promise<PresignedUpload> {
    if (!this.client) {
      throw new ServiceUnavailableException('Object storage is not configured');
    }

    const extension = EXT_MAP[dto.contentType];
    const key = `properties/${dto.propertyId}/${dto.kind}/${randomUUID()}${extension}`;
    const command = new PutObjectCommand({
      Bucket: dto.kind === 'document' ? this.privateBucket() : this.bucket,
      Key: key,
      ContentType: dto.contentType,
      ContentLength: dto.size,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.presignExpiresIn,
      signableHeaders: new Set(['content-type', 'content-length']),
    });

    this.logger.log({ event: 'storage.upload_presigned', propertyId: dto.propertyId, kind: dto.kind });

    return {
      key,
      uploadUrl,
      url: dto.kind === 'document' ? this.documentBase() + '/' + dto.propertyId + '/' + key.split('/').pop() : this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : `${endpointForObject(this.config, this.bucket, key)}`,
      expiresIn: this.presignExpiresIn,
    };
  }
}

function endpointForObject(config: ConfigService, bucket: string, key: string): string {
  const endpoint = config.getOrThrow<string>('S3_ENDPOINT').replace(/\/$/, '');
  if (endpoint.endsWith(`/${bucket}`)) return `${endpoint}/${key}`;
  return `${endpoint}/${bucket}/${key}`;
}
