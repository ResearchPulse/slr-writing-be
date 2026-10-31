import type { Request } from 'express';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; requestId?: string; details?: unknown };
}

export interface AuthUser {
  uid: string;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
