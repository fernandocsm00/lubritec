/**
 * Conversao datetime-local <-> ISO UTC fixada em America/Sao_Paulo (BRT).
 *
 * Single-tenant Lubritec opera sempre em horario de Brasilia. Brasil aboliu o
 * horario de verao em 2019, entao o offset BRT e fixo em -03:00 ano inteiro.
 *
 * Por que nao usar `new Date(localString).toISOString()`?
 *   Quando a string nao tem TZ ("2026-05-27T08:30"), o JS interpreta no TZ do
 *   NAVEGADOR. Se o usuario abre o sistema de uma maquina configurada em UTC
 *   (VPN, container, perfil novo), "08:30" vira 08:30 UTC = 05:30 BRT no
 *   disparo. Bug real observado em 2026-05-27 (Campanha Andrei).
 *
 * Usa offset literal -03:00 em vez de Intl/Temporal pra evitar surpresas de
 * politica de TZ. Se Brasil voltar a ter DST no futuro, esse modulo precisa
 * ser atualizado.
 */

const BRT_OFFSET = '-03:00';

/**
 * Converte string de <input type="datetime-local"> em ISO UTC.
 *
 * @param localInput "YYYY-MM-DDTHH:mm" interpretado como horario de Brasilia
 * @returns ISO UTC ex "2026-05-27T11:30:00.000Z" (08:30 BRT → 11:30 UTC)
 */
// Formato exato esperado pelo <input type="datetime-local">: "YYYY-MM-DDTHH:mm".
// Date() do JS e leniente e parseia coisas absurdas (ex: "nao-e-data" vira 2000)
// — validamos com regex antes de confiar.
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function brtInputToUtcIso(localInput: string): string {
  if (!localInput || !DATETIME_LOCAL_RE.test(localInput)) return '';
  // Anexa segundos e offset BRT explicito antes de parsear — garante que a
  // hora digitada e tratada como BRT independente do TZ do navegador.
  const withTz = `${localInput}:00${BRT_OFFSET}`;
  const d = new Date(withTz);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

/**
 * Converte ISO UTC em string formato `<input type="datetime-local">`
 * exibindo no horario de Brasilia.
 *
 * @param utcIso ex "2026-05-27T11:30:00.000Z"
 * @returns "YYYY-MM-DDTHH:mm" em BRT ex "2026-05-27T08:30"
 */
export function utcIsoToBrtInput(utcIso: string): string {
  if (!utcIso) return '';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return '';
  // sv-SE produz "YYYY-MM-DD HH:mm:ss" — formato proximo do ISO sem TZ.
  // Trocamos espaco por T e cortamos os segundos.
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
