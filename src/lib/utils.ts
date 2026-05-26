import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formata documento (CPF 11 dig ou CNPJ 14 dig) pra display. Mantemos o nome
 * historico `formatCnpj` porque eh usado em ~10 lugares — agora detecta o
 * tipo pelo tamanho e formata adequadamente.
 *   CPF:  000.000.000-00
 *   CNPJ: 00.000.000/0000-00
 */
export function formatCnpj(taxId: string | null | undefined): string {
  if (!taxId) return '—';
  const d = taxId.replace(/\D/g, '');
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return taxId;
}

/** Alias semantico — use em codigo novo. `formatCnpj` mantido por compat. */
export const formatTaxId = formatCnpj;

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Versão compacta pra valores grandes: R$ 42,5k, R$ 1,2M.
 * Útil em cards onde espaço é limitado.
 */
export function formatCurrencyCompact(value: number): string {
  if (value < 1000) return formatCurrency(value);
  if (value < 1_000_000) return `R$ ${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  return `R$ ${(value / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}M`;
}
