import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import { config } from './config';
import { healthRoutes } from './routes/health';
import { webhookRoutes } from './routes/webhook';
import { entriesRoutes } from './routes/entries';
import { auditRoutes } from './routes/audit';
import { registerAuditHooks } from './plugins/audit';

const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // 20 MB per photo
const MAX_PHOTOS_PER_REQUEST = 10;

export function buildApp() {
  const app = Fastify({ logger: true });

  // CAP-3 web app runs on a separate origin. Bearer-token auth (no cookies) makes
  // an open reflect acceptable for personal use; pin WEB_APP_ORIGIN to lock it down.
  // `methods` must be explicit: @fastify/cors v11 defaults to 'GET,HEAD,POST', which
  // blocks the web app's PATCH (accept) and DELETE (purge / delete entry) preflights.
  app.register(cors, {
    origin: config.WEB_APP_ORIGIN ?? true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  });

  app.register(multipart, {
    limits: {
      fileSize: MAX_PHOTO_BYTES,
      files: MAX_PHOTOS_PER_REQUEST,
    },
  });

  // Inbound audit hooks must be registered before the route plugins so they
  // apply to every route. Fire-and-forget — never affects the response.
  registerAuditHooks(app);

  app.register(healthRoutes);
  app.register(webhookRoutes);
  app.register(entriesRoutes);
  app.register(auditRoutes);

  return app;
}
