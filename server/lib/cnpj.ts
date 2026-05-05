/**
 * CNPJ utilities — format normalization and check-digit validation.
 * Public API: only digits, no formatting. UI may format for display.
 */

export function normalizeCnpj(raw: string): string {
  return raw.replace(/\D/g, '');
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

export function formatCnpj(cnpj: string): string {
  const d = normalizeCnpj(cnpj);
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
