import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import { withOutboundAudit } from './audit';
import { MAX_IMAGE_BYTES } from './ai';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY,
    secretAccessKey: config.R2_SECRET_KEY,
  },
});

// Reduces the photo to fit within MAX_IMAGE_BYTES before upload/AI analysis.
// Tries quality 80 first; if still too large, caps dimensions at 2048 px and
// drops to quality 60. Always outputs JPEG — input format does not matter.
// Returns the original buffer unchanged when it already fits.
export async function compressForAi(
  buffer: Buffer,
  mimetype: string
): Promise<{ buffer: Buffer; mimetype: string }> {
  if (buffer.length <= MAX_IMAGE_BYTES) {
    return { buffer, mimetype };
  }
  const originalMb = (buffer.length / 1024 / 1024).toFixed(1);
  let out = await sharp(buffer).jpeg({ quality: 80 }).toBuffer();
  if (out.length > MAX_IMAGE_BYTES) {
    out = await sharp(buffer)
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();
  }
  console.log(`[storage] Photo compressed ${originalMb} MB → ${(out.length / 1024 / 1024).toFixed(1)} MB`);
  return { buffer: out, mimetype: 'image/jpeg' };
}

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
