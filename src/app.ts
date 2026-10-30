import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import routes from './routes.js';
import { errorHandler } from './middleware/error.middleware.js';
import { requestLogger } from './middleware/request-logger.middleware.js';
import { NotFoundError } from './shared/errors/app-error.js';
import { env } from './config/env.js';
import { openApiDocument } from './config/openapi.js';

export const createApp = () => {
  const app = express();

  // No CSP: Swagger UI needs inline scripts. The API is consumed from another origin.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(requestLogger);
  app.use(cors({
    origin: env.FRONTEND_URL.split(',').map((url) => url.trim()),
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  }));
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api-docs.json', (_req, res) => res.json(openApiDocument));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use('/api', routes);

  app.use((_req, _res, next) => next(new NotFoundError('The requested endpoint does not exist')));
  app.use(errorHandler);

  return app;
};
