import { describe, it, expect, vi } from 'vitest';
import { retry } from '../lib/retry';

describe('retry', () => {
  it('passa de primeira quando fn() resolve', async () => {
    const fn = vi.fn(async () => 'ok');
    expect(await retry(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('faz attempts retries em caso de falha', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    const r = await retry(fn, { attempts: 3, baseDelayMs: 1 });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('para quando atinge attempts e re-throw último erro', async () => {
    const err = new Error('final');
    const fn = vi.fn(async () => { throw err; });
    await expect(retry(fn, { attempts: 2, baseDelayMs: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('para quando shouldRetry retorna false', async () => {
    const fn = vi.fn(async () => { throw new Error('no-retry'); });
    await expect(
      retry(fn, { attempts: 5, baseDelayMs: 1, shouldRetry: () => false }),
    ).rejects.toThrow('no-retry');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('shouldRetry recebe o erro e o número da tentativa', async () => {
    const seen: Array<{ err: unknown; attempt: number }> = [];
    const fn = vi.fn(async () => { throw new Error('x'); });
    await expect(retry(fn, {
      attempts: 3,
      baseDelayMs: 1,
      shouldRetry: (err, attempt) => { seen.push({ err, attempt }); return true; },
    })).rejects.toThrow();
    expect(seen.map(s => s.attempt)).toEqual([1, 2]);
  });
});
