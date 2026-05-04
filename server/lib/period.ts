const TZ_OFFSET_MIN = -180; // America/Sao_Paulo: UTC-3, no DST since 2019

export type PeriodKey = 'today' | '7d' | 'month' | '30d' | 'quarter';

export interface PeriodRange {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  key: PeriodKey;
  label: string;
}

/** Returns the UTC instant equivalent to {y,m,d,h,mi,s} in America/Sao_Paulo. */
function spToUtc(y: number, m: number, d: number, h = 0, mi = 0, s = 0): Date {
  // SP is UTC-3 → UTC = SP + 3h. Build via UTC then add 3h.
  return new Date(Date.UTC(y, m - 1, d, h - TZ_OFFSET_MIN / 60, mi, s));
}

/** Date components in SP for an instant. */
function spParts(at: Date): { y: number; m: number; d: number } {
  // Shift instant by SP offset, then read UTC parts.
  const shifted = new Date(at.getTime() + TZ_OFFSET_MIN * 60_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

export function resolvePeriod(key: PeriodKey, now: Date = new Date()): PeriodRange {
  const { y, m, d } = spParts(now);

  if (key === 'today') {
    const start = spToUtc(y, m, d);
    const prevStart = spToUtc(y, m, d - 1);
    return { key, start, end: now, prevStart, prevEnd: start, label: 'Hoje' };
  }
  if (key === '7d' || key === '30d') {
    const days = key === '7d' ? 7 : 30;
    const start = new Date(now.getTime() - days * 86_400_000);
    const prevStart = new Date(start.getTime() - days * 86_400_000);
    return { key, start, end: now, prevStart, prevEnd: start, label: key === '7d' ? 'Últimos 7 dias' : 'Últimos 30 dias' };
  }
  if (key === 'month') {
    const start = spToUtc(y, m, 1);
    const prevStart = spToUtc(y, m - 1, 1);
    return { key, start, end: now, prevStart, prevEnd: start, label: 'Mês corrente' };
  }
  if (key === 'quarter') {
    const qStartMonth = m - ((m - 1) % 3); // 1,4,7,10
    const start = spToUtc(y, qStartMonth, 1);
    const prevStart = spToUtc(y, qStartMonth - 3, 1);
    return { key, start, end: now, prevStart, prevEnd: start, label: 'Trimestre atual' };
  }
  throw new Error(`unknown period key: ${key}`);
}
