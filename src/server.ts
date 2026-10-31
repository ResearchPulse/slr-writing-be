import { createApp } from './app.js';
import { env } from './config/env.js';
import { createLogger } from './config/logger.js';
import { configureAuth } from './modules/auth/auth.setup.js';

const logger = createLogger('SERVER');

configureAuth();
const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'Server listening');
});

const gracefulShutdown = () => {
  logger.info('Received kill signal, shutting down gracefully...');
  server.close(() => logger.flush(() => process.exit(0)));
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
