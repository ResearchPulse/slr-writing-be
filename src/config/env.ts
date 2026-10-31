import 'dotenv/config';
import { z } from 'zod';

const optionalBooleanEnv = z.enum(['true', 'false']).optional().transform((value) =>
  value === undefined ? undefined : value === 'true',
);

const booleanEnv = (fallback: boolean) => z.enum(['true', 'false']).default(fallback ? 'true' : 'false').transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  LOG_PRETTY: optionalBooleanEnv,
  PORT: z.coerce.number().default(5100),
  FRONTEND_URL: z.string().default('http://localhost:5173,http://localhost:3000'),
  SLR_API_BASE_URL: z.string().url().default('http://localhost:5000'),
  SLR_API_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  SLR_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // Development-only auth. It is ignored in production, so a missing deployment setting can never open the API.
  DEV_AUTH_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DEV_AUTH_UID: z.string().default('dev_user'),
  DEV_AUTH_EMAIL: z.string().default('dev@slr-writing.local'),
  // Firebase project that issues the ID tokens (shared with slr-be). Required in production: without it every request is rejected.
  FIREBASE_PROJECT_ID: z.string().trim().min(1).optional(),
  // Also reject tokens that were revoked. This asks Firebase Auth, which needs service-account credentials in the environment.
  FIREBASE_CHECK_REVOKED: booleanEnv(false),
  // When on, creating a project asks slr-be whether the caller belongs to the SLR project being linked.
  SLR_VERIFY_PROJECT_ACCESS: booleanEnv(true),
  // Importing a run posted by the client is not backed by slr-be. Off by default in production.
  ALLOW_MANUAL_SNAPSHOT_IMPORT: z.enum(['true', 'false']).optional().transform((value) => (value === undefined ? undefined : value === 'true')),
  FROM_SLR_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  JSON_BODY_LIMIT: z.string().default('50mb'),
  DATABASE_URL: z.string().min(1).default('postgresql://slr_writing:slr_writing@localhost:5433/slr_writing?schema=public'),
});

/** Parses and checks an environment. Exported so the production rules can be tested without touching process.env. */
export function parseEnv(source: NodeJS.ProcessEnv) {
  const parsed = envSchema.parse(source);
  // Fail closed: a production server that cannot verify tokens would reject everything, so refuse to start instead.
  if (parsed.NODE_ENV === 'production' && !parsed.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID is required when NODE_ENV=production');
  }
  return {
    ...parsed,
    ALLOW_MANUAL_SNAPSHOT_IMPORT: parsed.ALLOW_MANUAL_SNAPSHOT_IMPORT ?? parsed.NODE_ENV !== 'production',
  };
}

export const env = parseEnv(process.env);
