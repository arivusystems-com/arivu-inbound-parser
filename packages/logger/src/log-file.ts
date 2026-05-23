import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function findMonorepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Path to shared JSON log file for admin UI tail (default: repo/logs/arivu.log). */
export function resolveLogFilePath(): string | null {
  const explicit = process.env.LOG_FILE;
  if (explicit === 'false' || explicit === '0') return null;
  if (explicit && explicit.length > 0) return explicit;

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const root = findMonorepoRoot(moduleDir) ?? findMonorepoRoot(process.cwd());
  if (!root) return null;

  const dir = join(root, 'logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'arivu.log');
}
