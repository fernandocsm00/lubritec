# CPF mascarado como CNPJ — parsing leniente no import

**Data:** 2026-06-09
**Status:** Aprovado em brainstorming, aguardando plano

## Contexto

Caso reportado em produção (XLSX do Fernando, junho/2026): linha com nome "SUELEN TOLLER MELO" e documento `00001850379092` (14 dígitos) foi rejeitada com "CPF/CNPJ inválido (dígitos verificadores)".

Análise: o valor é o CPF `01850379092` (11 dígitos, check digit válido) padded com 3 zeros à esquerda pra ter cara de CNPJ — provavelmente formatação do Excel ou padronização manual da fonte de dados. O sistema interpreta 14 dígitos como CNPJ e rejeita pelo check digit que não bate.

Padrão acontece com qualquer CSV que tenha CPFs digitados/exportados de uma planilha que trate o campo como número de tamanho fixo.

## Comportamento

Nova função `parseTaxIdLenient(raw)` em `server/lib/cnpj.ts`. Retorna `{ value, type } | null`:

1. Strip não-dígitos do input.
2. Se 11 dígitos e check digit CPF válido → `{ value: digits, type: 'cpf' }`.
3. Se 14 dígitos e check digit CNPJ válido → `{ value: digits, type: 'cnpj' }`.
4. Se 14 dígitos E check digit CNPJ FALHOU E últimos 11 dígitos formam CPF válido → `{ value: last11, type: 'cpf' }`.
5. Caso contrário → `null`.

`value` é sempre canônico: 11 dígitos pra CPF, 14 pra CNPJ. Garante que o auto-disparo de enriquecimento (`appendLeadsToActiveJob` / `startBulkEnrichment`) continue filtrando corretamente por `length(cnpj)=14`.

## Por que é seguro

- **Pré-requisito do passo 4**: input já falhou como CNPJ. Não rouba CNPJs válidos.
- **Risco de falso positivo**: CNPJ digitado com 1 dígito errado cujos últimos 11 dígitos acidentalmente formem CPF válido. Probabilidade de colisão do check digit do CPF: ~1%. Aceitável vs. custo de continuar rejeitando CPFs mascarados (caso reportado é claramente intencional, não típo).
- **CNPJs que começam com zero**: existem, mas não filtramos por prefixo zero — confiamos no check digit failure para discriminar. Se o CNPJ é VÁLIDO (mesmo começando com zero), o passo 3 já o aceita. Se é INVÁLIDO, aí sim cai no passo 4.

## Escopo

Aplicar **apenas na importação CSV** (`parseLeadsCsv` em `server/services/leadsImport.ts`).

`isValidTaxId`, `isValidCpfFormat`, `isValidCnpjFormat` continuam estritos. Outras chamadas (API de criação/edição manual de lead, validações em controllers) não mudam — UI tem feedback imediato, usuário vê erro e corrige.

## Arquitetura

### Backend — função utilitária

Em `server/lib/cnpj.ts`, adicionar (mantendo as existentes intactas):

```ts
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
```

### Backend — uso no import

Em `server/services/leadsImport.ts` (em torno da linha 287 onde hoje está):

```ts
const cnpj = normalizeCnpj((obj.cnpj ?? '').trim());
if (!cnpj) {
  rejected.push({ line, reason: 'CNPJ vazio' });
  continue;
}
if (!isValidTaxId(cnpj)) {
  rejected.push({ line, reason: 'CPF/CNPJ inválido (dígitos verificadores)' });
  continue;
}
```

Substituir por:

```ts
const rawTaxId = (obj.cnpj ?? '').trim();
if (!rawTaxId || !rawTaxId.replace(/\D/g, '')) {
  rejected.push({ line, reason: 'CNPJ vazio' });
  continue;
}
const parsed = parseTaxIdLenient(rawTaxId);
if (!parsed) {
  rejected.push({ line, reason: 'CPF/CNPJ inválido (dígitos verificadores)' });
  continue;
}
const cnpj = parsed.value; // canônico (11 ou 14 dig)
```

Mensagem de rejeição não muda (UI continua exibindo "CPF/CNPJ inválido (dígitos verificadores)" — usuário vê o mesmo motivo de hoje). O imports/exports do arquivo precisam adicionar `parseTaxIdLenient` aos imports de `../lib/cnpj`. `isValidTaxId` pode permanecer importado se outras partes do arquivo usam, ou removido se virou unused.

### Frontend

Nenhuma mudança. O display de CPF/CNPJ via `formatTaxId` (em `src/lib/utils.ts` ou similar) já detecta o tipo pelo comprimento — 11 dig vira "111.444.777-35", 14 dig vira "11.222.333/0001-81".

## Casos de teste

### Unit — `server/tests/taxId.test.ts` (arquivo já existe)

Adicionar `describe('parseTaxIdLenient', () => { ... })` com:

1. **CPF formatado válido** (`'111.444.777-35'`) → `{ value: '11144477735', type: 'cpf' }`
2. **CPF só dígitos válido** (`'52998224725'`) → `{ value: '52998224725', type: 'cpf' }`
3. **CNPJ formatado válido** (`'11.222.333/0001-81'`) → `{ value: '11222333000181', type: 'cnpj' }`
4. **CPF mascarado com 3 zeros** (`'00001850379092'`) → `{ value: '01850379092', type: 'cpf' }` ← caso reportado
5. **CPF mascarado com 4 zeros** (`'00011144477735'` se válido) → idem (canônico 11 dig)
6. **CNPJ com 1 dígito errado** (`'11222333000180'`) → `null` (check digit CNPJ falha E últimos 11 dígitos não formam CPF válido)
7. **All-zeros (14 dígitos)** (`'00000000000000'`) → `null` (CPF rejeita all-same)
8. **Vazio / string com só símbolos** (`'---'`) → `null`
9. **Comprimento errado** (`'1234567'`) → `null`

### Integration — `server/tests/leads-service.test.ts` (arquivo já existe, ver `describe('importLeadsFromCsv')`)

Adicionar 1 case:

10. **CSV com CPF padded importa com sucesso**: CSV `name,cpf\nSuelen,00001850379092\n` → `inserted: 1`, lead criado com `cnpj = '01850379092'`.

## Casos de borda

- **CPF válido com 11 dígitos exatos** (`'01850379092'`): passo 2 já aceita, nem cai no passo 4.
- **CNPJ válido começando com zero** (e.g. `'07731453000128'` se válido): passo 3 aceita normalmente, não cai no passo 4.
- **CPF padded a 14 dígitos com lixo final** (e.g. `'00001850379093'` — último dígito errado): passo 3 falha (CNPJ check inválido), passo 4 falha (CPF check inválido pra `01850379093`), retorna `null` corretamente.
- **CNPJ-format com leading zero mas inválido**: cai em null — mensagem de erro genérica é OK; usuário corrige.

## Fora de escopo

- Lenient parsing em outros endpoints (API de criação/edição manual de lead).
- Auto-correção de CPFs com check digit errado.
- Suporte a 12 ou 13 dígitos.
- Toast/aviso "interpretei como CPF mascarado" no resultado do import.
- Migrar leads CPF-padded que já estão no banco com 14 dígitos (não há — leads com CNPJ length=14 que NÃO são CNPJs reais ficaram bloqueados pelo isValidTaxId no import, então o banco está limpo).

## Arquivos afetados

**Backend:**
- `server/lib/cnpj.ts` — nova função `parseTaxIdLenient` + interface `ParsedTaxId`
- `server/services/leadsImport.ts` — substituir `normalizeCnpj` + `isValidTaxId` pelo `parseTaxIdLenient` na linha ~287

**Testes:**
- `server/tests/taxId.test.ts` — 9 cases pra `parseTaxIdLenient`
- `server/tests/leads-service.test.ts` — 1 case end-to-end no describe existente de `importLeadsFromCsv`
