import { describe, it, expect } from 'vitest';
import { inviteUser } from '../services/usersService';
import { setupPassword, requestReset, resetPassword, login } from '../services/authService';
import { createUser } from './helpers';
import { db } from '../db/client';
import { authTokens, users } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('usersService.inviteUser', () => {
  it('creates user without password and returns invite token', async () => {
    const result = await inviteUser({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    expect(result.tokenId).toBeTruthy();
    expect(result.rawToken).toMatch(/^[a-f0-9]{64}$/);
    const [u] = await db.select().from(users).where(eq(users.email, 'novo@b.com'));
    expect(u.passwordHash).toBeNull();
    expect(u.role).toBe('comercial');
  });

  it('rejects duplicate email', async () => {
    await createUser({ email: 'dup@b.com' });
    await expect(inviteUser({ email: 'dup@b.com', name: 'X', role: 'comercial' })).rejects.toThrow();
  });
});

describe('authService.setupPassword', () => {
  it('sets password using valid invite token and logs user in', async () => {
    const inv = await inviteUser({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    const result = await setupPassword({
      tokenId: inv.tokenId,
      rawToken: inv.rawToken,
      password: 'newpass123',
      userAgent: '',
      ip: '',
    });
    expect(result.accessToken).toBeTruthy();
    expect(result.user.email).toBe('novo@b.com');

    // Pode logar com a senha nova
    const lr = await login({ email: 'novo@b.com', password: 'newpass123', userAgent: '', ip: '' });
    expect(lr.accessToken).toBeTruthy();
  });

  it('rejects already-used token', async () => {
    const inv = await inviteUser({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    await setupPassword({ tokenId: inv.tokenId, rawToken: inv.rawToken, password: 'pw1234567', userAgent: '', ip: '' });
    await expect(
      setupPassword({ tokenId: inv.tokenId, rawToken: inv.rawToken, password: 'pw1234567', userAgent: '', ip: '' }),
    ).rejects.toThrow();
  });

  it('rejects wrong token', async () => {
    const inv = await inviteUser({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    await expect(
      setupPassword({ tokenId: inv.tokenId, rawToken: 'wrong'.padEnd(64, '0'), password: 'pw1234567', userAgent: '', ip: '' }),
    ).rejects.toThrow();
  });
});

describe('authService.requestReset + resetPassword', () => {
  it('issues a reset token and allows password change', async () => {
    await createUser({ email: 'a@b.com', password: 'oldpass' });
    const reset = await requestReset('a@b.com');
    expect(reset).not.toBeNull();
    const result = await resetPassword({
      tokenId: reset!.tokenId,
      rawToken: reset!.rawToken,
      password: 'newpass1',
      userAgent: '',
      ip: '',
    });
    expect(result.accessToken).toBeTruthy();
    // Login com nova senha funciona
    const lr = await login({ email: 'a@b.com', password: 'newpass1', userAgent: '', ip: '' });
    expect(lr.accessToken).toBeTruthy();
  });

  it('returns null when email does not exist (no leak)', async () => {
    const r = await requestReset('nope@b.com');
    expect(r).toBeNull();
  });

  it('rejects expired reset token', async () => {
    const user = await createUser({ email: 'a@b.com', password: 'pw' });
    const reset = await requestReset('a@b.com');
    // Forca expiracao
    await db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokens.userId, user.id));
    await expect(
      resetPassword({ tokenId: reset!.tokenId, rawToken: reset!.rawToken, password: 'pw9', userAgent: '', ip: '' }),
    ).rejects.toThrow();
  });
});
