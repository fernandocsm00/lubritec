import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  login,
  refreshAccess,
  logout,
  getMe,
  setupPassword,
  requestReset,
  resetPassword,
} from '../services/authService';
import { sendResetEmail } from '../lib/mailer';

const REFRESH_COOKIE = 'lubritec_refresh';
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: Number(process.env.JWT_REFRESH_TTL_DAYS || 30) * 24 * 60 * 60 * 1000,
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = loginSchema.parse(req.body);
    const result = await login({
      email: body.email,
      password: body.password,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || '',
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, REFRESH_COOKIE_OPTS);
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (e) {
    next(e);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) return res.status(401).json({ error: 'No refresh cookie' });
    const result = await refreshAccess(refreshToken);
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (e) {
    next(e);
  }
}

export async function logoutHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (refreshToken) await logout(refreshToken);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const me = await getMe(req.user!.userId);
    res.json(me);
  } catch (e) {
    next(e);
  }
}

const setupSchema = z.object({
  tokenId: z.string().uuid(),
  rawToken: z.string().min(1),
  password: z.string().min(8),
});

export async function setupPasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = setupSchema.parse(req.body);
    const result = await setupPassword({
      ...body,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || '',
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, REFRESH_COOKIE_OPTS);
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (e) {
    next(e);
  }
}

const requestResetSchema = z.object({ email: z.string().email() });

export async function requestResetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = requestResetSchema.parse(req.body);
    const result = await requestReset(body.email);
    if (result) {
      await sendResetEmail(body.email, result.userName, result.tokenId, result.rawToken);
    }
    res.json({ ok: true }); // sempre 200
  } catch (e) {
    next(e);
  }
}

const resetSchema = z.object({
  tokenId: z.string().uuid(),
  rawToken: z.string().min(1),
  password: z.string().min(8),
});

export async function resetPasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = resetSchema.parse(req.body);
    const result = await resetPassword({
      ...body,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || '',
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, REFRESH_COOKIE_OPTS);
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (e) {
    next(e);
  }
}
