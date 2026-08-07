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

export interface BusinessHoursConfig {
  /** Hora de abertura, 0-23. */
  startHour: number;
  /** Hora de fechamento, 1-24 (exclusiva). */
  endHour: number;
  /** ISO weekdays úteis: 1=seg .. 7=dom. */
  days: number[];
  timeZone: string;
}

/**
 * Le a config de horario comercial de org_settings.
 *
 * Reaproveita as colunas da IA de proposito — sao o horario de funcionamento da
 * operacao, e um terceiro conjunto de campos so criaria mais uma definicao pra
 * divergir. `ai24x7` NAO entra: ele diz que a IA responde a qualquer hora, nao
 * que os vendedores trabalham de madrugada.
 *
 * Recebe a FORMA e nao o tipo OrgSettings: `getOrgSettings()` devolve
 * PublicOrgSettings e `loadOrgSettingsRow()` devolve a row do drizzle. Os dois
 * servem, e tipar pelo formato evita converter de um pro outro so pra ler
 * quatro campos.
 */
export function businessConfigFromSettings(s: {
  aiBusinessHoursStart: number;
  aiBusinessHoursEnd: number;
  aiBusinessHoursDays: string;
  dispatchTimezone: string;
}): BusinessHoursConfig {
  const days = s.aiBusinessHoursDays
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);

  return {
    startHour: s.aiBusinessHoursStart,
    endHour: s.aiBusinessHoursEnd,
    days,
    timeZone: s.dispatchTimezone || 'America/Sao_Paulo',
  };
}

/** Componentes da data no fuso alvo, numa unica passada de Intl. */
function partsIn(d: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) map[p.type] = p.value;
  const ISO_WEEKDAY: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Intl devolve 24 pra meia-noite com hour12:false; normaliza pra 0.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    isoWeekday: ISO_WEEKDAY[map.weekday] ?? 0,
  };
}

/** Offset do fuso, em minutos, no instante dado. */
function offsetMinutes(d: Date, timeZone: string): number {
  const p = partsIn(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - d.getTime()) / 60_000;
}

/** Instante UTC correspondente a uma hora LOCAL de um dia local. */
function localToUtc(
  year: number, month: number, day: number, hour: number, timeZone: string,
): Date {
  // `hour` pode vir como 24 (meia-noite do dia seguinte, usado pelo loop
  // abaixo pra avancar o cursor) — Date.UTC rola isso corretamente pro
  // proximo dia, entao nao precisa de tratamento especial aqui.
  const alvoUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  // Primeira estimativa com o offset do meio-dia daquele dia — meio-dia evita a
  // borda de meia-noite, onde transicoes de horario de verao acontecem.
  const noonGuess = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const estimado = new Date(alvoUtc - offsetMinutes(noonGuess, timeZone) * 60_000);
  // Segundo passe: o offset que vale e o do proprio instante estimado. Sem ele,
  // um dia de transicao de DST erra a abertura/fechamento pela delta inteira.
  return new Date(alvoUtc - offsetMinutes(estimado, timeZone) * 60_000);
}

/**
 * Minutos de HORARIO COMERCIAL decorridos entre dois instantes.
 *
 * O relogio de pendencia precisa disso, e nao do tempo corrido: mensagem que
 * chega as 19h nao pode nascer com 13h de atraso as 8h da manha seguinte. Se
 * todo alerta nascer estourado, o time para de olhar.
 *
 * Percorre DIA A DIA no fuso configurado somando a intersecao de [from, to] com
 * a janela util de cada dia. Iterar minuto a minuto seria simples, mas uma
 * pendencia de varios dias faria dezenas de milhares de chamadas de Intl por
 * conversa a cada tick do watchdog.
 */
export function businessMinutesBetween(
  from: Date, to: Date, cfg: BusinessHoursConfig,
): number {
  if (!(to > from)) return 0;
  if (!cfg.days.length) return 0;
  if (cfg.endHour <= cfg.startHour) return 0;

  let total = 0;
  // Comeca no dia local de `from` e caminha ate passar de `to`.
  let cursor = new Date(from.getTime());

  // Teto de seguranca: pendencia de mais de um ano nao existe, e um bug de
  // avanco de cursor nao pode virar loop infinito dentro do watchdog.
  for (let guard = 0; guard < 400; guard += 1) {
    const p = partsIn(cursor, cfg.timeZone);

    if (cfg.days.includes(p.isoWeekday)) {
      const opensAt = localToUtc(p.year, p.month, p.day, cfg.startHour, cfg.timeZone);
      const closesAt = localToUtc(p.year, p.month, p.day, cfg.endHour, cfg.timeZone);
      const windowStart = Math.max(opensAt.getTime(), from.getTime());
      const windowEnd = Math.min(closesAt.getTime(), to.getTime());
      if (windowEnd > windowStart) total += (windowEnd - windowStart) / 60_000;
    }

    // Proximo dia local, a partir da meia-noite seguinte.
    const nextDay = localToUtc(p.year, p.month, p.day, 24, cfg.timeZone);
    if (nextDay.getTime() >= to.getTime()) break;
    cursor = nextDay;
  }

  return Math.round(total);
}
