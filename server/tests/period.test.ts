import { describe, it, expect } from 'vitest';
import { resolvePeriod, type PeriodKey } from '../lib/period';

// Reference instant: 2026-05-15T13:00:00 in America/Sao_Paulo (UTC-3 -> 16:00 UTC)
const ref = new Date('2026-05-15T16:00:00.000Z');

describe('resolvePeriod', () => {
  it('today: start at 00:00 SP, end at now', () => {
    const r = resolvePeriod('today', ref);
    expect(r.start.toISOString()).toBe('2026-05-15T03:00:00.000Z');
    expect(r.end).toEqual(ref);
    expect(r.prevStart.toISOString()).toBe('2026-05-14T03:00:00.000Z');
    expect(r.prevEnd.toISOString()).toBe('2026-05-15T03:00:00.000Z');
  });

  it('7d: rolling 7 full days', () => {
    const r = resolvePeriod('7d', ref);
    // start = end - 7d
    expect(r.end.getTime() - r.start.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(r.prevEnd.getTime()).toBe(r.start.getTime());
    expect(r.prevStart.getTime()).toBe(r.start.getTime() - 7 * 24 * 3600 * 1000);
  });

  it('month: 1st of current month SP -> now; prev = full prev month', () => {
    const r = resolvePeriod('month', ref);
    expect(r.start.toISOString()).toBe('2026-05-01T03:00:00.000Z'); // May 1 00:00 SP
    expect(r.end).toEqual(ref);
    expect(r.prevStart.toISOString()).toBe('2026-04-01T03:00:00.000Z');
    expect(r.prevEnd.toISOString()).toBe('2026-05-01T03:00:00.000Z');
  });

  it('30d: rolling 30 days', () => {
    const r = resolvePeriod('30d', ref);
    expect(r.end.getTime() - r.start.getTime()).toBe(30 * 24 * 3600 * 1000);
  });

  it('quarter: current calendar quarter SP', () => {
    const r = resolvePeriod('quarter', ref);
    // Q2 2026 starts Apr 1
    expect(r.start.toISOString()).toBe('2026-04-01T03:00:00.000Z');
  });
});
