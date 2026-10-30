import type { NextFunction, Response } from 'express';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../shared/errors/app-error.js';
import type { AuthenticatedRequest, AuthUser } from '../shared/types/common.types.js';

/**
 * Verifies a bearer token and returns the user, or null when the token is not valid.
 * Production verification (Firebase ID tokens, see ADR-001) is not wired yet, so no verifier is registered by default.
 */
export type TokenVerifier = (token: string) => Promise<AuthUser | null>;

let tokenVerifier: TokenVerifier | null = null;

export const setTokenVerifier = (verifier: TokenVerifier | null) => {
  tokenVerifier = verifier;
};

const devAuthAllowed = () => env.DEV_AUTH_ENABLED && env.NODE_ENV !== 'production';

/**
 * Fail closed: without a valid token (or explicit dev auth outside production) every request is rejected.
 * Dev auth acts as `DEV_AUTH_UID`, or as the user named in the `X-Dev-User-Id` header, so ownership can be tested.
 */
export const requireAuth = async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  try {
    const header = req.header('authorization');
    const token = header?.match(/^Bearer (.+)$/i)?.[1];

    if (token && tokenVerifier) {
      const user = await tokenVerifier(token);
      if (!user) throw new UnauthorizedError('Invalid or expired token', 'INVALID_TOKEN');
      req.user = user;
      return next();
    }

    if (devAuthAllowed()) {
      req.user = { uid: req.header('x-dev-user-id')?.trim() || env.DEV_AUTH_UID, email: env.DEV_AUTH_EMAIL };
      return next();
    }

    throw new UnauthorizedError(token ? 'Token verification is not configured' : 'Authentication required');
  } catch (error) {
    return next(error);
  }
};
