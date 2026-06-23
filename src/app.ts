import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import { config } from './config';
import { healthRoutes } from './routes/health';
import { webhookRoutes } from './routes/webhook';
import { entriesRoutes } from './routes/entries';

const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // 20 MB per photo
const MAX_PHOTOS_PER_REQUEST = 10;

export function buildApp() {
  const app = Fastify({ logger: true });

  // CAP-3 web app runs on a separate origin. Bearer-token auth (no cookies) makes
  // an open reflect acceptable for personal use; pin WEB_APP_ORIGIN to lock it down.
  app.register(cors, {
    origin: config.WEB_APP_ORIGIN ?? true,
  });

  app.register(multipart, {
    limits: {
      fileSize: MAX_PHOTO_BYTES,
      files: MAX_PHOTOS_PER_REQUEST,
    },
  });

  app.register(healthRoutes);
  app.register(webhookRoutes);
  app.register(entriesRoutes);

  return app;
}
