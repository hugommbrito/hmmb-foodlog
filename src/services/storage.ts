import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import { withOutboundAudit } from './audit';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY,
    secretAccessKey: config.R2_SECRET_KEY,
  },
});

export async function uploadPhoto(buffer: Buffer, key: string, mimetype: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  });

  await withOutboundAudit(
    'r2',
    'put-object',
    { key, bytes: buffer.length, mimetype },
    () => s3.send(command)
  );

  const base = config.R2_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/${key}`;
}
