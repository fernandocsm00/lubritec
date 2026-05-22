import type { OrgSettings } from '../db/schema';

/**
 * Verifica se um instante `now` esta dentro do horario comercial da IA.
 *
 * Configuracao em org_settings:
 *   - ai_24x7=true → sempre dentro (IA roda 24/7)
 *   - ai_business_hours_start (int 0-23)
 *   - ai_business_hours_end (int 1-24)  // exclusivo
 *   - ai_business_hours_days = CSV de ISO weekdays (1=seg .. 7=dom)
 *
 * Timezone usado: dispatch_timezone da mesma row (single-tenant —
 * Lubritec opera em America/Sao_Paulo, mas mantemos configuravel).
 *
 * Pattern espelhado de isWithinDispatchWindow em continuousCampaign.ts pra
 * manter consistencia, mas o range eh independente (IA e disparo nao precisam
 * coincidir).
 */
export function isAiBusinessHours(now: Date, s: OrgSettings): {
  ok: boolean;
  reason?: 'weekend' | 'wrong_weekday' | 'before_start' | 'after_end';
  startHour: number;
  endHour: number;
} {
  const startHour = s.aiBusinessHoursStart;
  const endHour = s.aiBusinessHoursEnd;

  if (s.ai24x7) {
    return { ok: true, startHour, endHour };
  }

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: s.dispatchTimezone || 'America/Sao_Paulo',
    hour: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(hourStr);

  // ISO weekday: 1=mon .. 7=sun
  const ISO_WEEKDAY: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  const todayIso = ISO_WEEKDAY[weekdayStr] ?? 0;

  const allowedDays = s.aiBusinessHoursDays
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((n) => n >= 1 && n <= 7);

  if (!allowedDays.includes(todayIso)) {
    // Distingue final de semana de dia util "errado" so pra log/UX.
    const reason = todayIso === 6 || todayIso === 7 ? 'weekend' : 'wrong_weekday';
    return { ok: false, reason, startHour, endHour };
  }

  if (hour < startHour) {
    return { ok: false, reason: 'before_start', startHour, endHour };
  }
  if (hour >= endHour) {
    return { ok: false, reason: 'after_end', startHour, endHour };
  }
  return { ok: true, startHour, endHour };
}
