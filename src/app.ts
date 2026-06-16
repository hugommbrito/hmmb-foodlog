import Fastify from 'fastify';
import { healthRoutes } from './routes/health';
import { webhookRoutes } from './routes/webhook';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(healthRoutes);
  app.register(webhookRoutes);

  return app;
}
