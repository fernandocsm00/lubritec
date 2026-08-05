/**
 * O rotulo lido pela IA e do TOTAL DO ORCAMENTO (e nao de uma linha de produto)?
 *
 * O layout do ERP tem "Valor total" no cabecalho E "Preco Total (R$)" como coluna
 * por item. Ler a coluna errada troca R$ 3.443,04 por R$ 1.821,87 — e o numero
 * entraria na previsao de receita sem ninguem notar. Por isso: precisa conter
 * "total" E NAO conter nenhum termo que indique granularidade de item/parcela.
 */
const EXCLUSOES = ['item', 'unit', 'negociado', 'parcela', 'preco', 'produto'];

export function isTotalLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  const norm = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (!norm.includes('total')) return false;
  return !EXCLUSOES.some((termo) => norm.includes(termo));
}
