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

  /** CRM webhook URL for email.received (optional — logs to stdout when unset). */
  CRM_WEBHOOK_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  /** HMAC-SHA256 secret for X-Arivu-Signature header (optional). */
  CRM_WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),

  /**
   * API key for CRM → parser provisioning (POST /integrations/v1/*).
   * Required in production. In development, integration routes work without a key when unset.
   */
  CRM_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),

  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  QUEUE_BACKOFF_MS: z.coerce.number().int().positive().default(2000),

  /** Shared log file for admin UI (JSON lines). Set LOG_FILE=false to disable. */
  LOG_FILE: z
    .string()
    .optional()
    .transform((v) => (v === 'false' || v === '0' ? undefined : v)),

  /** SPF/DKIM/DMARC: off | monitor (log only) | enforce (reject failed auth). */
  SECURITY_AUTH_MODE: z.enum(['off', 'monitor', 'enforce']).default('off'),

  SECURITY_RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().positive().default(120),
  SECURITY_RATE_LIMIT_TENANT_PER_MIN: z.coerce.number().int().positive().default(300),
  SECURITY_IP_ALLOWLIST: z.string().optional().default(''),
  SECURITY_IP_BLOCKLIST: z.string().optional().default(''),
  SECURITY_GREYLIST_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  SECURITY_GREYLIST_TTL_SEC: z.coerce.number().int().positive().default(300),

  SMTP_TLS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  SMTP_TLS_KEY_PATH: z.string().optional(),
  SMTP_TLS_CERT_PATH: z.string().optional(),
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
