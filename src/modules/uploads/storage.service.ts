import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

  async presignPut(dto: PresignUploadDto): Promise<PresignedUpload> {
    if (!this.client) {
      throw new ServiceUnavailableException('Object storage is not configured');
    }

    const extension = EXT_MAP[dto.contentType];
    const key = `properties/${dto.propertyId}/${dto.kind}/${randomUUID()}${extension}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: dto.contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.presignExpiresIn,
    });

    this.logger.log({ event: 'storage.upload_presigned', propertyId: dto.propertyId, kind: dto.kind });

    return {
      key,
      uploadUrl,
      url: this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : `${endpointForObject(this.config, this.bucket, key)}`,
      expiresIn: this.presignExpiresIn,
    };
  }
}

function endpointForObject(config: ConfigService, bucket: string, key: string): string {
  const endpoint = config.getOrThrow<string>('S3_ENDPOINT').replace(/\/$/, '');
  if (endpoint.endsWith(`/${bucket}`)) return `${endpoint}/${key}`;
  return `${endpoint}/${bucket}/${key}`;
}
