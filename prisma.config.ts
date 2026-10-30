import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Not env('DATABASE_URL'): that throws when the variable is unset, which would break `prisma generate` in CI.
    url: process.env.DATABASE_URL ?? 'postgresql://slr_writing:slr_writing@localhost:5433/slr_writing?schema=public',
  },
});
