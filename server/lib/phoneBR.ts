/**
 * Normalizacao de telefones brasileiros para forma canonica E.164 com 9.
 *
 * Brasil tem o problema do "nono digito" em celulares: o numero fisico
 * `54 99653-2189` pode aparecer como:
 *   - 11 digitos com 9:    `54996532189`
 *   - 10 digitos sem 9:    `5496532189`     <- formato pre-2012, ainda aparece em inbound WhatsApp
 *   - 13 digitos com 55+9: `5554996532189`  <- canonico
 *   - 12 digitos com 55 sem 9: `555496532189`
 *
 * Se diferentes pontos do sistema gravam em formatos diferentes, o mesmo
 * numero vira leads/conversations duplicados (caso real: campanha grava com
 * 9, inbound WhatsApp chega sem 9, nao bate, cria conversa nova).
 *
 * Politica deste projeto (2026-05-26): SEMPRE armazenar em E.164 com pais
 * 55 e o 9 do celular. Sao 13 digitos pra celular e 12 pra fixo:
 *   55 + DDD (2) + 9 + 8 digitos  -> 13 dig celular
 *   55 + DDD (2) +     8 digitos  -> 12 dig fixo
 *
 * Como saber se eh celular ou fixo? Pelo primeiro digito apos o DDD:
 *   - 6, 7, 8 ou 9 -> celular (sempre tem o 9 prefix em 2026)
 *   - 2, 3, 4 ou 5 -> fixo (nunca tem o 9 prefix)
 */

const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, // DF
  62, 64, // GO
  63, // TO
  65, 66, // MT
  67, // MS
  68, // AC
  69, // RO
  71, 73, 74, 75, 77, // BA
  79, // SE
  81, 87, // PE
  82, // AL
  83, // PB
  84, // RN
  85, 88, // CE
  86, 89, // PI
  91, 93, 94, // PA
  92, 97, // AM
  95, // RR
  96, // AP
  98, 99, // MA
]);

function isCelularPrefix(firstDigitAfterDdd: string): boolean {
  // Em 2026 todos os celulares BR comecam com 9 quando ja normalizados,
  // mas inbound as vezes vem sem o 9. Nesse caso o "primeiro digito apos DDD"
  // eh o digito real do celular original, que comeca com 6/7/8/9.
  return ['6', '7', '8', '9'].includes(firstDigitAfterDdd);
}

/**
 * Converte qualquer formato comum de telefone BR para a forma canonica
 * (13 dig celular ou 12 dig fixo, sempre com 55 na frente).
 *
 * Retorna `null` quando o input nao parece um telefone BR valido — caller
 * decide se aceita (storage como esta, lev. raw) ou rejeita.
 *
 * Casos cobertos:
 *   "5554996532189"        -> "5554996532189" (ja canonico)
 *   "555496532189"         -> "5554996532189" (sem 9, injeta)
 *   "54996532189"          -> "5554996532189" (sem 55, prepend)
 *   "5496532189"           -> "5554996532189" (sem 55 e sem 9)
 *   "+55 54 99653-2189"    -> "5554996532189"
 *   "5554996532189@s.whatsapp.net" -> "5554996532189"
 *   "55115551234"          -> "551155551234"  (fixo: 55+DDD+8dig)
 */
export function toCanonicalBrPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // Trata casos com 0 internacional (raro): "0055..." -> "55..."
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Garante o "55" do pais.
  // Casos sem 55: 10 ou 11 digitos (DDD + numero) — prepend "55"
  // Casos com 55: 12 ou 13 digitos
  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits;
  }

  // Tamanho final esperado: 12 (fixo) ou 13 (celular). Outros -> invalido.
  if (digits.length !== 12 && digits.length !== 13) return null;
  if (!digits.startsWith('55')) return null;

  const ddd = parseInt(digits.slice(2, 4), 10);
  if (!DDDS_VALIDOS.has(ddd)) return null;

  const rest = digits.slice(4); // 8 (fixo) ou 9 (celular ja com 9 prefix)

  if (rest.length === 9) {
    // Celular com 9 prefix — deve comecar com 9 (padrao pos-2012).
    // Se nao comeca com 9, eh fixo com 9 digitos? Nao existe. Provavelmente
    // um celular com codigo de operadora colado. Aceitamos se primeiro for 6-9.
    if (!isCelularPrefix(rest[0]) && rest[0] !== '9') return null;
    return digits; // ja canonico
  }

  // rest.length === 8: pode ser fixo (digito[0] in 2-5) ou celular sem o 9
  // (digito[0] in 6-9, raro mas acontece em inbound WhatsApp antigo).
  if (isCelularPrefix(rest[0])) {
    // Injeta o 9 antes do numero do celular.
    return `55${digits.slice(2, 4)}9${rest}`;
  }
  // Fixo de 8 digitos: ja canonico.
  return digits;
}

/**
 * Compara dois telefones brutos como equivalentes (mesmo numero fisico).
 * Usado em lookups defensivos pra evitar duplicacao por divergencia 9-digit.
 */
export function arePhonesEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = toCanonicalBrPhone(a);
  const cb = toCanonicalBrPhone(b);
  if (!ca || !cb) return false;
  return ca === cb;
}
