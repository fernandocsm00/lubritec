import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../lib/jwt';

describe('jwt', () => {
  it('signs and verifies an access token', () => {
    const token = signAccessToken({ userId: '11111111-1111-1111-1111-111111111111', role: 'admin' });
    const payload = verifyAccessToken(token);
    expect(payload.userId).toBe('11111111-1111-1111-1111-111111111111');
    expect(payload.role).toBe('admin');
  });

  it('rejects an invalid token', () => {
    expect(() => verifyAccessToken('garbage')).toThrow();
  });
});
