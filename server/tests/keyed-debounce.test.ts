import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createKeyedDebouncer } from '../lib/keyedDebounce';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createKeyedDebouncer', () => {
  it('só dispara depois de ficar em silêncio pelo tempo todo, contado da última chamada', () => {
    const run = vi.fn();
    const d = createKeyedDebouncer<number>(() => 120_000, run);

    d.schedule('conv-1', 1);
    vi.advanceTimersByTime(60_000);
    d.schedule('conv-1', 2); // segunda mensagem: recomeça a espera

    vi.advanceTimersByTime(119_999);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('conv-1', 2);
  });

  it('chaves diferentes esperam cada uma o seu tempo', () => {
    const run = vi.fn();
    const d = createKeyedDebouncer<string>(() => 1_000, run);

    d.schedule('a', 'x');
    vi.advanceTimersByTime(500);
    d.schedule('b', 'y');
    vi.advanceTimersByTime(500);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('a', 'x');
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith('b', 'y');
  });

  it('has() diz se a chave ainda está esperando', () => {
    const d = createKeyedDebouncer<null>(() => 1_000, vi.fn());

    expect(d.has('a')).toBe(false);
    d.schedule('a', null);
    expect(d.has('a')).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(d.has('a')).toBe(false);
  });

  it('cancel() desiste da espera sem disparar', () => {
    const run = vi.fn();
    const d = createKeyedDebouncer<null>(() => 1_000, run);

    d.schedule('a', null);
    d.cancel('a');
    vi.advanceTimersByTime(5_000);

    expect(run).not.toHaveBeenCalled();
    expect(d.has('a')).toBe(false);
  });
});
