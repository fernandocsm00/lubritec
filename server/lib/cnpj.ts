/**
 * Tax ID utilities — normalization, check-digit validation, formatting for
 * both CPF (11 dig) and CNPJ (14 dig). API armazena so digitos; UI formata
 * pra display.
 */

export type TaxIdType = 'cpf' | 'cnpj';

export function normalizeCnpj(raw: string): string {
  // Mantemos o nome historico — usado em toda a base. Agora normaliza
  // qualquer tax id (so remove nao-digitos).
  return raw.replace(/\D/g, '');
}

export const normalizeTaxId = normalizeCnpj;

/**
 * Detecta o tipo pelo tamanho (sem validar digito verificador). Pra
 * verificar se eh valido use isValidTaxId.
 */
export function detectTaxIdType(raw: string): TaxIdType | null {
  const d = normalizeTaxId(raw);
  if (d.length === 11) return 'cpf';
  if (d.length === 14) return 'cnpj';
  return null;
}

export function isValidCnpjFormat(cnpj: string): boolean {
  const digits = normalizeCnpj(cnpj);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false; // all same digit

  const calc = (slice: string, weights: number[]) => {
    const sum = slice
      .split('')
      .reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(digits.slice(0, 12), w1);
  const d2 = calc(digits.slice(0, 13), w2);

  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}

export function isValidCpfFormat(cpf: string): boolean {
  const digits = normalizeTaxId(cpf);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // all same digit

  const calc = (slice: string, startWeight: number) => {
    const sum = slice
      .split('')
      .reduce((acc, d, i) => acc + Number(d) * (startWeight - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };

  const d1 = calc(digits.slice(0, 9), 10);
  const d2 = calc(digits.slice(0, 10), 11);

  return d1 === Number(digits[9]) && d2 === Number(digits[10]);
}

/** Aceita CPF (11 dig) ou CNPJ (14 dig) com digito verificador valido. */
export function isValidTaxId(raw: string): boolean {
  const type = detectTaxIdType(raw);
  if (type === 'cpf') return isValidCpfFormat(raw);
  if (type === 'cnpj') return isValidCnpjFormat(raw);
  return false;
}

export function formatCnpj(cnpj: string): string {
  const d = normalizeCnpj(cnpj);
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatCpf(cpf: string): string {
  const d = normalizeTaxId(cpf);
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Formata como CPF ou CNPJ dependendo do tamanho. */
export function formatTaxId(raw: string | null | undefined): string {
  if (!raw) return '';
  const type = detectTaxIdType(raw);
  if (type === 'cpf') return formatCpf(raw);
  if (type === 'cnpj') return formatCnpj(raw);
  return raw;
}

export interface ParsedTaxId {
  value: string;
  type: TaxIdType;
}

/**
 * Parsing leniente pra dados de CSV bagunçados. Diferente de isValidTaxId
 * (estrito), aceita CPFs com leading zeros que ficaram com 14 dígitos —
 * caso comum quando Excel/planilha padroniza CPF como número de largura fixa.
 *
 * Returns o canônico (CPF 11 dig, CNPJ 14 dig) com o tipo, ou null se inválido.
 *
 * Passos:
 *  1. Strip non-digits.
 *  2. 11 dig + CPF check válido → cpf.
 *  3. 14 dig + CNPJ check válido → cnpj.
 *  4. 14 dig + CNPJ check FALHOU + últimos 11 dig CPF válido → cpf (canônico 11 dig).
 *  5. Caso contrário → null.
 */
export function parseTaxIdLenient(raw: string): ParsedTaxId | null {
  const digits = normalizeTaxId(raw);

  if (digits.length === 11 && isValidCpfFormat(digits)) {
    return { value: digits, type: 'cpf' };
  }
  if (digits.length === 14 && isValidCnpjFormat(digits)) {
    return { value: digits, type: 'cnpj' };
  }
  // 14 dig que falhou como CNPJ → tenta interpretar como CPF mascarado com leading zeros
  if (digits.length === 14) {
    const last11 = digits.slice(-11);
    if (isValidCpfFormat(last11)) {
      return { value: last11, type: 'cpf' };
    }
  }
  return null;
}
