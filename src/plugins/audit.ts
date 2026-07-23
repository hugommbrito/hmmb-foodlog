import { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config';
import { logInbound, redactHeaders, scrubSecrets, truncate } from '../services/audit';

// onSend needs the start time recorded in onRequest; stash it on the request.
declare module 'fastify' {
  interface FastifyRequest {
    auditStartedAt?: number;
  }
}

// Serializes the parsed request body for logging. Multipart bodies are streamed
// (request.body is undefined) — never persist the binary, only a placeholder.
function serializeBody(request: FastifyRequest): string | null {
  if (typeof request.isMultipart === 'function' && request.isMultipart()) {
    return '[multipart omitido]';
  }
  const body = request.body;
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === 'string') {
    return scrubSecrets(body);
  }
  try {
    return scrubSecrets(JSON.stringify(body));
  } catch {
    return null;
  }
}

// The onSend payload is the serialized response. Only text is logged; buffers
// and streams (e.g. file responses) are omitted.
function serializePayload(payload: unknown): string | null {
  if (payload === undefined || payload === null) {
    return null;
  }
  if (typeof payload === 'string') {
    return scrubSecrets(payload);
  }
  return '[corpo não-textual omitido]';
}

// Registers global inbound-capture hooks on the root instance. Hooks added to
// the root apply to all routes registered afterwards, so call this BEFORE the
// route plugins. No fastify-plugin needed (not installed) — root hooks are not
// encapsulated away from sibling route plugins when added at the root.
export function registerAuditHooks(app: FastifyInstance): void {
  if (config.AUDIT_ENABLED !== 'true') {
    return;
  }

  app.addHook('onRequest', async (request) => {
    request.auditStartedAt = Date.now();
  });

  app.addHook('onSend', async (request, reply, payload) => {
    // Skip our own endpoints so the audit UI does not log itself on every poll.
    if (!request.url.startsWith('/audit')) {
      try {
        const started = request.auditStartedAt;
        const [path, queryString] = request.url.split('?');
        logInbound({
          method: request.method,
          path,
          query: queryString ? scrubSecrets(queryString) : null,
          statusCode: reply.statusCode,
          durationMs: started !== undefined ? Date.now() - started : null,
          headers: redactHeaders(request.headers as Record<string, unknown>),
          requestBody: truncate(serializeBody(request)),
          responseBody: truncate(serializePayload(payload)),
          remoteIp: request.ip ?? null,
        });
      } catch (err) {
        // Auditing must never break the response.
        console.error('[audit] onSend hook error:', (err as Error).message);
      }
    }
    // Always return the payload unchanged — never alter the response.
    return payload;
  });
}
