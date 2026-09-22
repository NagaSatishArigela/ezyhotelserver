import { StorageService } from '../storage.service';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn().mockResolvedValue('https://signed.example.test/object') }));
const config: Record<string, string> = { S3_ENDPOINT: 'https://storage.example.test', S3_BUCKET: 'public', S3_PRIVATE_BUCKET: 'private', S3_PUBLIC_BASE_URL: 'https://public.example.test', API_PUBLIC_URL: 'https://api.example.test', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test' };
const propertyId = '11111111-1111-4111-8111-111111111111';
const file = '22222222-2222-4222-8222-222222222222.pdf';
const create = (values = config) => new StorageService({ get: (k: string, fallback: unknown) => values[k] ?? fallback, getOrThrow: (k: string) => values[k] } as never);
beforeEach(() => jest.clearAllMocks());
it('signs the declared length and stores documents in a separate bucket', async () => {
  const result = await create().presignPut({ propertyId, kind: 'document', contentType: 'application/pdf', fileName: 'test.pdf', size: 128 });
  const args = jest.mocked(getSignedUrl).mock.calls[0];
  expect(args[1].input).toMatchObject({ Bucket: 'private', ContentLength: 128 });
  expect(result.url).toContain('https://api.example.test/uploads/documents/' + propertyId + '/');
});
it('uses the configured public bucket temporarily when no private bucket is set', async () => {
  await create({ ...config, S3_PRIVATE_BUCKET: '' }).presignPut({ propertyId, kind: 'document', contentType: 'application/pdf', fileName: 'test.pdf', size: 128 });
  expect(jest.mocked(getSignedUrl).mock.calls[0][1].input).toMatchObject({ Bucket: 'public' });
});
it('supports a separate private bucket when configured', async () => {
  await create({ ...config, S3_PRIVATE_BUCKET: 'private' }).readDocument(propertyId, file);
  expect(jest.mocked(getSignedUrl).mock.calls[0][1].input).toMatchObject({ Bucket: 'private' });
});
it('keeps photos in public storage with size binding', async () => {
  const result = await create().presignPut({ propertyId, kind: 'photo', contentType: 'image/jpeg', fileName: 'test.jpg', size: 256 });
  expect(jest.mocked(getSignedUrl).mock.calls[0][1].input).toMatchObject({ Bucket: 'public', ContentLength: 256 });
  expect(result.url).toContain('https://public.example.test/');
});
it('rejects foreign-property and external references before contacting storage', async () => {
  await expect(create().validateDocument(propertyId, 'https://api.example.test/uploads/documents/other/' + file)).rejects.toThrow('private storage');
  await expect(create().validateDocument(propertyId, 'https://public.example.test/document.pdf')).rejects.toThrow('private storage');
});
it('rejects key traversal', async () => { await expect(create().readDocument(propertyId, '../' + file)).rejects.toThrow('Invalid document'); });
it('signs private reads for only 60 seconds', async () => { await create().readDocument(propertyId, file); expect(jest.mocked(getSignedUrl).mock.calls[0][2]).toEqual({ expiresIn: 60 }); });
it('rejects objects over the document limit before compliance persistence', async () => {
  const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({ ContentLength: 11 * 1024 * 1024, ContentType: 'application/pdf' } as never);
  try { await expect(create().validateDocument(propertyId, 'https://api.example.test/uploads/documents/' + propertyId + '/' + file)).rejects.toThrow('size'); } finally { send.mockRestore(); }
});
