import { describe, it, expect } from 'vitest';
import { login, refreshAccess, logout } from '../services/authService';
import { createUser } from './helpers';
import { db } from '../db/client';
import { sessions } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('authService.login', () => {
  it('returns access token and user when credentials are valid', async () => {
    await createUser({ email: 'a@b.com', password: 'pw12345', role: 'admin' });
    const result = await login({ email: 'a@b.com', password: 'pw12345', userAgent: 'jest', ip: '127.0.0.1' });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.user.email).toBe('a@b.com');
    expect(result.user.role).toBe('admin');
  });

  it('throws on wrong password', async () => {
    await createUser({ email: 'a@b.com', password: 'pw12345' });
    await expect(login({ email: 'a@b.com', password: 'wrong', userAgent: '', ip: '' })).rejects.toThrow();
  });

  it('throws on inactive user', async () => {
    await createUser({ email: 'a@b.com', password: 'pw12345', isActive: false });
    await expect(login({ email: 'a@b.com', password: 'pw12345', userAgent: '', ip: '' })).rejects.toThrow();
  });

  it('throws on missing user', async () => {
    await expect(login({ email: 'nope@b.com', password: 'pw12345', userAgent: '', ip: '' })).rejects.toThrow();
  });

  it('throws if password not yet set (invite pending)', async () => {
    await createUser({ email: 'a@b.com' }); // no password
    await expect(login({ email: 'a@b.com', password: 'pw12345', userAgent: '', ip: '' })).rejects.toThrow();
  });
});

describe('authService.refreshAccess', () => {
  it('returns new access token for valid refresh', async () => {
    const user = await createUser({ email: 'a@b.com', password: 'pw' });
    const { refreshToken } = await login({ email: 'a@b.com', password: 'pw', userAgent: '', ip: '' });
    const result = await refreshAccess(refreshToken);
    expect(result.accessToken).toBeTruthy();
    expect(result.user.id).toBe(user.id);
  });

  it('throws if refresh is revoked', async () => {
    await createUser({ email: 'a@b.com', password: 'pw' });
    const { refreshToken } = await login({ email: 'a@b.com', password: 'pw', userAgent: '', ip: '' });
    await logout(refreshToken);
    await expect(refreshAccess(refreshToken)).rejects.toThrow();
  });

  it('throws if refresh is bogus', async () => {
    await expect(refreshAccess('bogus')).rejects.toThrow();
  });
});

describe('authService.logout', () => {
  it('marks session as revoked', async () => {
    const user = await createUser({ email: 'a@b.com', password: 'pw' });
    const { refreshToken } = await login({ email: 'a@b.com', password: 'pw', userAgent: '', ip: '' });
    await logout(refreshToken);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows[0]?.revokedAt).not.toBeNull();
  });
});
