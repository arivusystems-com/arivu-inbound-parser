import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Env } from '@arivu/config';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function extractApiKey(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  const apiKey = req.headers['x-arivu-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) return apiKey.trim();
  return undefined;
}

/** Require CRM_API_KEY in production; optional in development when unset. */
export function requireCrmApiKey(config: Env) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const expected = config.CRM_API_KEY;
    if (!expected) {
      if (config.NODE_ENV === 'development') {
        return next();
      }
      res.status(503).json({
        error: 'CRM_API_KEY is not configured — provisioning API is disabled',
      });
      return;
    }

    const provided = extractApiKey(req);
    if (!provided || !safeEqual(provided, expected)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
