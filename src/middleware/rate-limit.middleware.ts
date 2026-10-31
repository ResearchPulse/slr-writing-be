import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../shared/errors/app-error.js';
import type { AuthenticatedRequest } from '../shared/types/common.types.js';

/**
 * Limits calls per signed-in user, counted in memory (one process). Behind several instances each keeps its own count,
 * so the real ceiling is the limit times the number of instances; move the store to Redis if that ever matters.
 * Must run after authentication: a request without a user is not counted against anyone's quota but cannot get here anyway.
 */
export function createUserRateLimiter(options: { max?: number; windowMs?: number; code?: string } = {}) {
  const limit = options.max ?? env.FROM_SLR_RATE_LIMIT_PER_MINUTE;
  return rateLimit({
    windowMs: options.windowMs ?? 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthenticatedRequest).user?.uid ?? 'anonymous',
    handler: (_req, _res, next) => next(new AppError('Too many requests, try again in a minute', 429, options.code ?? 'RATE_LIMITED')),
  });
}
