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
});

export const env = envSchema.parse(process.env);
