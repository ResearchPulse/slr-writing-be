import { pino, type Logger } from 'pino';
import { env } from './env.js';

const isTest = env.NODE_ENV === 'test';
const pretty = !isTest && (env.LOG_PRETTY ?? env.NODE_ENV === 'development');
const sensitiveFields = [
  'password', 'token', 'accessToken', 'refreshToken', 'authorization',
  'apiKey', 'api_key', 'secret', 'privateKey',
];

export const logger = pino({
  level: env.LOG_LEVEL ?? (isTest ? 'silent' : env.NODE_ENV === 'development' ? 'debug' : 'info'),
  redact: {
    paths: [
      ...sensitiveFields.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
      'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]',
    ],
    censor: '[Redacted]',
  },
  ...(pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: Boolean(process.stdout.isTTY),
            levelFirst: true,
            messageFormat: '[{context}] {msg}',
            ignore: 'pid,hostname,context',
            translateTime: 'SYS:standard',
          },
        },
      }
    : {}),
});

/** Create a child logger that tags every record with its owning module. */
export const createLogger = (context: string): Logger =>
  logger.child({ context: context.trim().toUpperCase() || 'APP' });
