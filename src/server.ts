import { config } from './config';
import { buildApp } from './app';

const app = buildApp();

app.listen({ port: config.PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Server listening at ${address}`);
});
