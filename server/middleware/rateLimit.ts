import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

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
