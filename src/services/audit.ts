import { config } from '../config';
import { query } from '../db/client';

const MAX_BODY_CHARS = 16_000;

// Header names (lowercase) whose values must NEVER be persisted in clear.
const SENSITIVE_HEADERS = new Set(['authorization', 'client-token', 'cookie']);

// Known secret values from config. Any occurrence of these in logged text
// (bodies, query strings, header values) is masked. R2_PUBLIC_URL / R2_BUCKET
// are intentionally excluded — they appear in legitimate photo URLs.
const SECRETS: string[] = [
  config.ZAPI_TOKEN,
  config.ANTHROPIC_API_KEY,
  config.R2_ACCESS_KEY,
  config.R2_SECRET_KEY,
  config.DATABASE_URL,
  config.REDIS_URL,
  config.ZAPI_WEBHOOK_SECRET ?? '',
].filter((s) => s.length > 0);

// Replaces every known secret substring with '***'. split/join avoids regex
// escaping and works without String.prototype.replaceAll (target ES2020).
export function scrubSecrets(text: string): string {
  let out = text;
  for (const secret of SECRETS) {
    if (out.includes(secret)) {
      out = out.split(secret).join('***');
    }
  }
  return out;
}

// Lowercases header names, masks sensitive ones, scrubs secrets from the rest.
export function redactHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (SENSITIVE_HEADERS.has(key)) {
      out[key] = '***';
      continue;
    }
    const value = Array.isArray(v) ? v.join(', ') : String(v ?? '');
    out[key] = scrubSecrets(value);
  }
  return out;
}

export function truncate(s: string | null): string | null {
  if (s === null) {
    return null;
  }
  return s.length > MAX_BODY_CHARS ? `${s.slice(0, MAX_BODY_CHARS)}…[truncado]` : s;
}

export interface InboundLogRecord {
  method: string;
  path: string;
  query: string | null;
  statusCode: number | null;
  durationMs: number | null;
  headers: Record<string, string>;
  requestBody: string | null;
  responseBody: string | null;
  remoteIp: string | null;
}

// Fire-and-forget: callers never await this and it never throws. A logging
// failure must not affect the request being logged — it is only logged to stderr.
export function logInbound(record: InboundLogRecord): void {
  query(
    `INSERT INTO request_logs
       (method, path, query, status_code, duration_ms, request_headers, request_body, response_body, remote_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      record.method,
      record.path,
      record.query,
      record.statusCode,
      record.durationMs,
      JSON.stringify(record.headers),
      record.requestBody,
      record.responseBody,
      record.remoteIp,
    ]
  ).catch((err) => {
    console.error('[audit] Failed to persist request log:', (err as Error).message);
  });
}
