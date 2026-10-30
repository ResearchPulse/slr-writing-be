import 'dotenv/config';
import { z } from 'zod';

const optionalBooleanEnv = z.enum(['true', 'false']).optional().transform((value) =>
  value === undefined ? undefined : value === 'true',
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  LOG_PRETTY: optionalBooleanEnv,
  PORT: z.coerce.number().default(5100),
  FRONTEND_URL: z.string().default('http://localhost:5173,http://localhost:3000'),
  SLR_API_BASE_URL: z.string().url().default('http://localhost:5000'),
  SLR_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // Development-only auth. It is ignored in production, so a missing deployment setting can never open the API.
  DEV_AUTH_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DEV_AUTH_UID: z.string().default('dev_user'),
  DEV_AUTH_EMAIL: z.string().default('dev@slr-writing.local'),
  JSON_BODY_LIMIT: z.string().default('50mb'),
  DATABASE_URL: z.string().min(1).default('postgresql://slr_writing:slr_writing@localhost:5433/slr_writing?schema=public'),
});

export const env = envSchema.parse(process.env);
