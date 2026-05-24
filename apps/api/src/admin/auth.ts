import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { isAdminAuthEnabled, type Env } from '@arivu/config';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

interface SessionPayload {
  u: string;
  exp: number;
}

function signPayload(payload: SessionPayload, secret: string): string {
  return createHmac('sha256', secret).update(`${payload.u}:${payload.exp}`).digest('hex');
}

export function createAdminToken(username: string, secret: string): string {
  const payload: SessionPayload = { u: username, exp: Date.now() + TOKEN_TTL_MS };
  const sig = signPayload(payload, secret);
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url');
}

export function verifyAdminToken(token: string | undefined, config: Env): boolean {
  if (!isAdminAuthEnabled(config) || !token || !config.ADMIN_SESSION_SECRET) return false;
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as SessionPayload & {
      sig?: string;
    };
    if (!parsed.u || !parsed.exp || !parsed.sig) return false;
    if (parsed.exp < Date.now()) return false;
    const expected = signPayload(parsed, config.ADMIN_SESSION_SECRET);
    const a = Buffer.from(expected);
    const b = Buffer.from(parsed.sig);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return undefined;
}

export function requireAdminAuth(config: Env) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAdminAuthEnabled(config)) {
      next();
      return;
    }
    const token = extractBearerToken(req);
    if (!verifyAdminToken(token, config)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}

export function handleAdminLogin(config: Env) {
  return (req: Request, res: Response): void => {
    if (!isAdminAuthEnabled(config)) {
      res.json({ authEnabled: false, token: null });
      return;
    }

    const body = req.body as { username?: string; password?: string } | undefined;
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (
      !safeEqualString(username, config.ADMIN_USERNAME) ||
      !config.ADMIN_PASSWORD ||
      !safeEqualString(password, config.ADMIN_PASSWORD)
    ) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = createAdminToken(username, config.ADMIN_SESSION_SECRET!);
    res.json({ authEnabled: true, token, username });
  };
}

/** Suggested secret for .env: openssl rand -hex 32 */
export function generateSessionSecret(): string {
  return randomBytes(32).toString('hex');
}
