import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors/app-error.js';
import { createLogger } from '../config/logger.js';
import { env } from '../config/env.js';

const logger = createLogger('API');

export const errorHandler = (err: Error | AppError, req: Request, res: Response, _next: NextFunction) => {
  const context = {
    err,
    requestId: req.id,
    path: req.path,
    method: req.method,
    statusCode: err instanceof AppError ? err.statusCode : 500,
  };
  if (err instanceof AppError && err.statusCode < 500) {
    logger.warn(context, 'Client request rejected');
  } else {
    logger.error(context, 'Request error occurred');
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, requestId: req.id, ...(err.details === undefined ? {} : { details: err.details }) },
    });
  }

  const isDev = env.NODE_ENV === 'development';
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isDev ? err.message : 'An unexpected error occurred. Please try again later.',
      requestId: req.id,
      ...(isDev ? { stack: err.stack } : {}),
    },
  });
};
