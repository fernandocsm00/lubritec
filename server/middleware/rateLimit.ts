import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Test-only helper: clear all rate-limit state. Used by tests so per-test
// re-runs don't share buckets across test cases (which would cause the
// 6th login from the same IP to receive a 429 and break integration tests).
export function __resetRateLimitBuckets() {
  buckets.clear();
}

export function rateLimit(opts: { windowMs: number; max: number; keyFn?: (req: Request) => string }) {
  const keyFn = opts.keyFn ?? ((req: Request) => req.ip || 'unknown');
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path}:${keyFn(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    if (bucket.count >= opts.max) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    bucket.count++;
    next();
  };
}
