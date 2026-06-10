# Lenient CPF Unmasking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aceitar no import CSV/XLSX um valor de 14 dígitos que não passa como CNPJ mas cujos últimos 11 dígitos formam um CPF válido (caso comum quando Excel padroniza CPF como número de largura fixa).

**Architecture:** Nova função utilitária `parseTaxIdLenient` em `lib/cnpj.ts` que retorna `{value, type}|null` aceitando o caso 14-dig→CPF. Validadores estritos (`isValidTaxId`, `isValidCpfFormat`, `isValidCnpjFormat`) ficam intactos. `parseLeadsCsv` em `leadsImport.ts` passa a usar o lenient para o input do CSV, mantendo a mensagem de erro idêntica em caso de rejeição.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-lenient-cpf-unmasking-import-design.md`

---

## File Structure

**Modificações backend:**
- `server/lib/cnpj.ts` — adicionar `interface ParsedTaxId` + função `parseTaxIdLenient`
- `server/services/leadsImport.ts` — substituir o par `normalizeCnpj + isValidTaxId` por `parseTaxIdLenient` em `parseLeadsCsv` (linhas 292-300)

**Testes:**
- `server/tests/taxId.test.ts` — novo describe `parseTaxIdLenient` com 9 cases
- `server/tests/leads-service.test.ts` — 1 case end-to-end no describe `importLeadsFromCsv` existente

**Decomposição:** mantém a função no mesmo módulo (`lib/cnpj.ts`) — é uma adição coesa, sem necessidade de arquivo separado. O caller único é o CSV import, mas a função fica pública porque conceitualmente é uma operação genérica de "parsing leniente de tax id".

---

## Task 1: Testes vermelhos do `parseTaxIdLenient` (TDD)

**Files:**
- Modify: `server/tests/taxId.test.ts` (adicionar describe novo)

- [ ] **Step 1: Adicionar describe e imports**

Em `server/tests/taxId.test.ts`, atualizar o import (linhas 2-10) para incluir `parseTaxIdLenient` e o tipo `ParsedTaxId`:

```ts
import {
  isValidCnpjFormat,
  isValidCpfFormat,
  isValidTaxId,
  parseTaxIdLenient,
  formatCnpj,
  formatCpf,
  formatTaxId,
  detectTaxIdType,
  type ParsedTaxId,
} from '../lib/cnpj';
```

Adicionar (no fim do arquivo, depois dos describes existentes) o describe novo:

```ts
describe('parseTaxIdLenient', () => {
  it('CPF formatado válido (passo 2)', () => {
    expect(parseTaxIdLenient('111.444.777-35')).toEqual({
      value: '11144477735',
      type: 'cpf',
    } satisfies ParsedTaxId);
  });

  it('CPF só dígitos válido (passo 2)', () => {
    expect(parseTaxIdLenient(VALID_CPF_1)).toEqual({
      value: VALID_CPF_1,
      type: 'cpf',
    } satisfies ParsedTaxId);
  });

  it('CNPJ formatado válido (passo 3)', () => {
    expect(parseTaxIdLenient('11.444.777/0001-61')).toEqual({
      value: '11444777000161',
      type: 'cnpj',
    } satisfies ParsedTaxId);
  });

  it('CPF mascarado com 3 zeros (passo 4) — caso reportado', () => {
    // 01850379092 é CPF válido. 00001850379092 (14 dig) com 3 zeros leading
    // deve cair no passo 4 e ser aceito como CPF.
    expect(parseTaxIdLenient('00001850379092')).toEqual({
      value: '01850379092',
      type: 'cpf',
    } satisfies ParsedTaxId);
  });

  it('CPF mascarado com 4 zeros (passo 4)', () => {
    // 11144477735 é CPF válido. 00011144477735 (14 dig com 3 leading zeros)
    // → últimos 11 são "11144477735" → CPF válido.
    expect(parseTaxIdLenient('00011144477735')).toEqual({
      value: '11144477735',
      type: 'cpf',
    } satisfies ParsedTaxId);
  });

  it('CNPJ com 1 dígito errado e últimos 11 não-CPF → null', () => {
    // 11222333000180 NÃO é CNPJ válido (último dig 0 deveria ser 1).
    // Últimos 11 dígitos = "22333000180" → NÃO é CPF válido.
    expect(parseTaxIdLenient('11222333000180')).toBeNull();
  });

  it('all-zeros (14 dig) → null', () => {
    // 14 zeros falha CNPJ (all-same). Últimos 11 zeros falha CPF (all-same).
    expect(parseTaxIdLenient('00000000000000')).toBeNull();
  });

  it('string sem dígitos → null', () => {
    expect(parseTaxIdLenient('---')).toBeNull();
    expect(parseTaxIdLenient('')).toBeNull();
  });

  it('comprimento errado (nem CPF nem CNPJ nem mascarado) → null', () => {
    expect(parseTaxIdLenient('1234567')).toBeNull();
    expect(parseTaxIdLenient('123456789012')).toBeNull();   // 12 dig
    expect(parseTaxIdLenient('1234567890123')).toBeNull();  // 13 dig
  });
});
```

- [ ] **Step 2: Rodar pra confirmar 9 falhas**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- taxId 2>&1 | tail -25
```

Se embedded-postgres reclamar de diretório suja:
```bash
rm -rf "C:/Users/User/AppData/Local/Temp/lubritec-embedded-pg"
```

Esperado: testes do parseTaxIdLenient falham (função/tipo não existem), enquanto os describes existentes (`detectTaxIdType`, `isValidCpfFormat`, etc.) continuam passando.

- [ ] **Step 3: Commit dos testes vermelhos**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/tests/taxId.test.ts
git commit -m "test: add failing tests for parseTaxIdLenient"
```

---

## Task 2: Implementar `parseTaxIdLenient` em `lib/cnpj.ts`

**Files:**
- Modify: `server/lib/cnpj.ts`

- [ ] **Step 1: Adicionar a função e a interface no fim do arquivo**

Em `server/lib/cnpj.ts`, depois da função `formatTaxId` (último export do arquivo, em torno da linha 96), adicionar:

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
```

Nota: `normalizeTaxId`, `isValidCpfFormat`, `isValidCnpjFormat` e `TaxIdType` já estão definidos no mesmo arquivo (linhas 7-26 e 28-67) — reusa direto.

- [ ] **Step 2: Rodar os testes**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- taxId 2>&1 | tail -15
```

Esperado: 9/9 passes do parseTaxIdLenient + testes pré-existentes continuam passando.

- [ ] **Step 3: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run lint 2>&1 | tail -5
```

Esperado: clean.

- [ ] **Step 4: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/lib/cnpj.ts
git commit -m "feat: add parseTaxIdLenient — accepts 14-dig CPF padded with leading zeros"
```

---

## Task 3: Usar `parseTaxIdLenient` em `parseLeadsCsv`

**Files:**
- Modify: `server/services/leadsImport.ts`

- [ ] **Step 1: Atualizar import**

No topo de `server/services/leadsImport.ts`, encontrar o import de `'../lib/cnpj'` (linha 9 atual):

```ts
import { normalizeCnpj, isValidTaxId } from '../lib/cnpj';
```

Substituir por:

```ts
import { normalizeCnpj, parseTaxIdLenient } from '../lib/cnpj';
```

(`normalizeCnpj` segue importado porque é usado em outros pontos do arquivo — só `isValidTaxId` é removido.)

- [ ] **Step 2: Substituir o bloco de validação**

Localizar o bloco em torno das linhas 292-300:

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
    const cnpj = parsed.value; // canônico (11 dig CPF ou 14 dig CNPJ)
```

A mensagem de rejeição não muda — UI continua exibindo "CPF/CNPJ inválido (dígitos verificadores)".

- [ ] **Step 3: Confirmar que normalizeCnpj ainda é usado**

Buscar usos restantes de `normalizeCnpj` no arquivo:

```bash
cd C:/Saas_lubritec/lubritec-main && grep -n "normalizeCnpj" server/services/leadsImport.ts
```

Se aparecer só o import (linha 9), `normalizeCnpj` ficou unused — REMOVER do import. Se aparecer em outra(s) linha(s), MANTER no import.

- [ ] **Step 4: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run lint 2>&1 | tail -5
```

Esperado: clean (sem warnings de unused).

- [ ] **Step 5: Rodar testes existentes do import — sem regressão**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- leads-service 2>&1 | tail -10
```

Esperado: todos os testes existentes continuam passando.

Se embedded-postgres reclamar, limpar e retry:
```bash
rm -rf "C:/Users/User/AppData/Local/Temp/lubritec-embedded-pg"
```

- [ ] **Step 6: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/services/leadsImport.ts
git commit -m "feat: use parseTaxIdLenient in CSV import to accept padded CPFs"
```

---

## Task 4: Teste end-to-end no `importLeadsFromCsv`

**Files:**
- Modify: `server/tests/leads-service.test.ts`

- [ ] **Step 1: Adicionar caso de teste**

Em `server/tests/leads-service.test.ts`, localizar o describe existente `describe('importLeadsFromCsv', () => { ... })` (em torno da linha 227). Dentro desse describe, adicionar o novo teste depois dos demais (antes do `})` final do describe):

```ts
it('aceita CPF mascarado como CNPJ (14 dig com leading zeros)', async () => {
  // 00001850379092 = 4 zeros + 01850379092 (CPF válido). Caso real reportado
  // por Fernando — Excel/planilha pad CPF a 14 dígitos pra ficar como CNPJ.
  const csv = `name,cnpj\nSuelen Toller Melo,00001850379092\n`;
  const report = await importLeadsFromCsv(Buffer.from(csv));
  expect(report.inserted).toBe(1);
  expect(report.rejected).toEqual([]);
  const list = await listLeads({ q: '01850379092' });
  expect(list.items).toHaveLength(1);
  expect(list.items[0].cnpj).toBe('01850379092'); // canônico (11 dig CPF)
});
```

Confirmar que `listLeads` já está importado no topo do arquivo (deveria estar — outros testes no mesmo describe usam). Se não estiver, adicionar ao import existente de `'../services/leadsService'`.

- [ ] **Step 2: Rodar**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- leads-service 2>&1 | tail -15
```

Esperado: novo teste passa + todos os pré-existentes continuam verdes.

Se embedded-postgres reclamar:
```bash
rm -rf "C:/Users/User/AppData/Local/Temp/lubritec-embedded-pg"
```

- [ ] **Step 3: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/tests/leads-service.test.ts
git commit -m "test: cover CSV import with 14-dig padded CPF (real-world case)"
```

---

## Task 5: Verificação final

- [ ] **Step 1: Suite focada**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- taxId leads-service leads-api 2>&1 | tail -15
```

Esperado: tudo verde.

Se embedded-postgres reclamar:
```bash
rm -rf "C:/Users/User/AppData/Local/Temp/lubritec-embedded-pg"
```

- [ ] **Step 2: Typecheck completo**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run lint 2>&1 | tail -5
```

Esperado: clean.

- [ ] **Step 3: Conferir git log**

```bash
cd C:/Saas_lubritec/lubritec-main && git log --oneline -6
```

Esperado: 4 commits da feature (Tasks 1-4) na ordem.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|--------------|------|
| `parseTaxIdLenient` retorna canônico ou null nos 5 passos da lógica | Task 2 + testes Task 1 (9 cases) |
| CPF 11 dig válido (passo 2) | Task 1 cases 1 e 2 |
| CNPJ 14 dig válido (passo 3) | Task 1 case 3 |
| CPF mascarado 14 dig (passo 4) | Task 1 cases 4 e 5 + Task 4 end-to-end |
| CNPJ inválido + últimos 11 não-CPF → null | Task 1 case 6 |
| all-zeros → null | Task 1 case 7 |
| Vazio/comprimento errado → null | Task 1 cases 8 e 9 |
| Apenas import muda; outros validadores intactos | Task 3 (substitui só no parseLeadsCsv); `isValidTaxId` segue exportado |
| Mensagem de erro idêntica em caso de rejeição | Task 3 (mantém "CPF/CNPJ inválido (dígitos verificadores)") |
| Imports não usados removidos | Task 3 Step 3 |
| Frontend sem mudanças | n/a — `formatTaxId` já cobre 11 ou 14 dig |

**Placeholder scan:** zero TBDs/TODOs vagos. Cada step tem código completo ou comando exato.

**Type consistency:**
- `ParsedTaxId { value: string; type: TaxIdType }` em Task 2 ⇄ usada em Task 1 (com `satisfies ParsedTaxId`).
- `parseTaxIdLenient(raw: string): ParsedTaxId | null` consistent em Task 1 (importação) e Task 2 (assinatura).
- `last11 = digits.slice(-11)` — Task 2 produz string de 11 chars passada pra `isValidCpfFormat` que aceita 11-dig.
- Casos 4 e 5 dos testes asseguram que o `value` retornado é o canônico 11-dig (não o original de 14 dig).
