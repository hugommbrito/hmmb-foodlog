import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  ANALYSIS_WAIT_TIMEOUT_MS: z.string().default('50000').transform(Number).pipe(z.number().int().positive()),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  ZAPI_INSTANCE: z.string().min(1, 'ZAPI_INSTANCE is required'),
  ZAPI_TOKEN: z.string().min(1, 'ZAPI_TOKEN is required'),
  ZAPI_WEBHOOK_SECRET: z.string().optional(),
  R2_BUCKET: z.string().min(1, 'R2_BUCKET is required'),
  R2_ACCOUNT_ID: z.string().min(1, 'R2_ACCOUNT_ID is required'),
  R2_ACCESS_KEY: z.string().min(1, 'R2_ACCESS_KEY is required'),
  R2_SECRET_KEY: z.string().min(1, 'R2_SECRET_KEY is required'),
  R2_PUBLIC_URL: z.string().min(1, 'R2_PUBLIC_URL is required'),
  // Allowed origin for the daily-review web app (CAP-3). Optional: when absent,
  // CORS reflects any origin (acceptable for personal use — auth is Bearer, not cookies).
  WEB_APP_ORIGIN: z.string().optional(),
  // Audit module: when 'true' (default), every inbound request is persisted to
  // request_logs. Set to 'false' to disable logging (e.g. if the table grows).
  AUDIT_ENABLED: z.string().default('true'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const missing = result.error.errors
    .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
    .join('\n');
  console.error(`[config] Missing or invalid environment variables:\n${missing}`);
  process.exit(1);
}

export const config = result.data;
