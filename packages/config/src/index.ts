import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Find monorepo root (works regardless of process.cwd()). */
function findMonorepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Load .env from repo root — reliable when pnpm runs apps from apps/*. */
function loadEnvFile(): void {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const root =
    findMonorepoRoot(moduleDir) ??
    findMonorepoRoot(process.cwd());

  if (root) {
    const envPath = path.join(root, '.env');
    if (existsSync(envPath)) {
      loadDotenv({ path: envPath, override: false });
      return;
    }
  }

  // Fallback: walk up from cwd
  let dir = process.cwd();
  for (;;) {
    const envPath = path.join(dir, '.env');
    if (existsSync(envPath)) {
      loadDotenv({ path: envPath, override: false });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadEnvFile();

const mongoUri = z
  .string()
  .min(1)
  .refine((s) => s.startsWith('mongodb://') || s.startsWith('mongodb+srv://'), {
    message: 'Must be a MongoDB connection URI',
  });

const redisUrl = z
  .string()
  .min(1)
  .refine((s) => s.startsWith('redis://') || s.startsWith('rediss://'), {
    message: 'Must be a Redis connection URI',
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGODB_URI: mongoUri,
  REDIS_URL: redisUrl,

  STORAGE_ENDPOINT: z.string().min(1),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  SMTP_HOST: z.string().default('0.0.0.0'),
  SMTP_PORT: z.coerce.number().int().positive().default(2525),
  SMTP_DOMAIN: z.string().default('reply.arivusystems.com'),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3000),

  MAX_ATTACHMENT_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  STREAM_CHUNK_BYTES: z.coerce.number().int().positive().default(64 * 1024),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadConfig(overrides?: Partial<Record<keyof Env, string>>): Env {
  if (cached && !overrides) return cached;

  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(
      `Invalid configuration: ${JSON.stringify(details, null, 2)}\n` +
        'Ensure .env exists at the repo root (copy from .env.example).',
    );
  }

  if (!overrides) cached = parsed.data;
  return parsed.data;
}

export function resetConfigCache(): void {
  cached = null;
}
