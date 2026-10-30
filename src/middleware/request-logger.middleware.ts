import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../config/logger.js';

const logger = createLogger('HTTP');

declare module 'express-serve-static-core' {
  interface Request {
    id?: string;
  }
}

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  req.id = req.header('x-request-id') ?? randomUUID();
  res.setHeader('X-Request-Id', req.id);
  res.on('finish', () => {
    logger.info(
      { requestId: req.id, method: req.method, path: req.path, statusCode: res.statusCode, responseTimeMs: Date.now() - startedAt },
      'Request completed',
    );
  });
  next();
};
