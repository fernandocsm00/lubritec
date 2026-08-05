import { describe, it, expect } from 'vitest';
import { isTotalLabel } from '../lib/budgetLabel';

describe('isTotalLabel', () => {
  it('aceita rótulos de total do orçamento', () => {
    expect(isTotalLabel('Valor total')).toBe(true);
    expect(isTotalLabel('Total')).toBe(true);
    expect(isTotalLabel('TOTAL GERAL')).toBe(true);
    expect(isTotalLabel('Valor Total (R$)')).toBe(true);
  });

  it('rejeita a coluna de total DA LINHA DE PRODUTO', () => {
    // Armadilha real do layout: a tabela de produtos tem "Preço Total (R$)"
    // por item. Ler isso dá 1821,87 em vez dos 3443,04 do orçamento.
    expect(isTotalLabel('Preço Total')).toBe(false);
    expect(isTotalLabel('Preco Total (R$)')).toBe(false);
    expect(isTotalLabel('Total do item')).toBe(false);
    expect(isTotalLabel('Valor unitário total')).toBe(false);
    expect(isTotalLabel('Total negociado')).toBe(false);
    expect(isTotalLabel('Total da parcela')).toBe(false);
  });

  it('rejeita subtotal — não é o total do orçamento', () => {
    // "Subtotal produtos" exclui frete (o orçamento da amostra é CIF), então
    // não é o número que vai pra previsão de receita.
    expect(isTotalLabel('Subtotal produtos')).toBe(false);
  });

  it('rejeita rótulo sem a palavra total', () => {
    expect(isTotalLabel('Frete')).toBe(false);
    expect(isTotalLabel('Condição de pagamento')).toBe(false);
  });

  it('rejeita vazio e nulo', () => {
    expect(isTotalLabel('')).toBe(false);
    expect(isTotalLabel(null)).toBe(false);
    expect(isTotalLabel(undefined)).toBe(false);
  });
});
