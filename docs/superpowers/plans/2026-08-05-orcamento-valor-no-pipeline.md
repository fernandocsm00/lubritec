# Orçamento em print → valor no card do pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ler o valor total do print de orçamento que o vendedor manda pelo WhatsApp e sugerir valor + etapa num card no painel do lead, que o vendedor edita e confirma.

**Architecture:** Toda imagem outbound dispara, em background, uma leitura da imagem pelo Gemini (novo suporte a `inlineData`). O total lido vira uma linha `pending` em `budget_detections`. O painel do lead mostra um card com o valor editável e, quando o deal ainda está atrás de `proposta_enviada`, também a sugestão de etapa. Confirmar grava em `deals.proposalValue` e move a etapa. Nada é gravado sem ação humana. Em paralelo, um campo de valor sempre visível no painel resolve o caso sem IA.

**Tech Stack:** Express + Drizzle + Postgres, `@google/genai` (Gemini 2.5 Flash), React 19 + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-08-05-orcamento-valor-no-pipeline-design.md`

---

## Contexto que o implementador precisa saber

O fluxo de envio de imagem **já existe e já mexe no pipeline**. Em
`server/services/conversationsService.ts`, logo depois de persistir a mensagem outbound,
há um bloco best-effort que chama `maybeAddDealFromConversation`
(`server/services/pipelineIntegration.ts`). Hoje ele: se a conversa está na fila
`comercial` e a mensagem é `image`, cria um deal (`source:'auto_image'`) quando o lead não
tem nenhum, ou reativa um deal terminal.

Detalhe que motiva a sugestão de etapa: `createDeal` coloca o **primeiro** deal do lead em
`lead_no_comercial`, não em `proposta_enviada`. Por isso hoje existem 21 deals parados em
`lead_no_comercial` (19 sem valor) — mandar o orçamento cria o card mas ninguém o move nem
preenche valor.

A imagem está em disco em `/uploads/conversations/<arquivo>` (gravada por
`uploadMediaHandler`) no momento do envio, então a leitura não depende do volume
persistente estar resolvido.

`server/services/geminiClient.ts` é **text-only** — monta `contents` como
`parts: [{ text }]`. Suporte a imagem não existe e é a Task 3.

**Ordem de execução:** as tasks são sequenciais. Task N+1 depende de tipos criados em Task N.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `server/db/migrations/042_budget_detections.sql` | **Criar** — tabela nova |
| `server/db/schema.ts` | **Modificar** — tabela drizzle `budgetDetections` |
| `shared/types.ts` | **Modificar** — `BUDGET_DETECTION_STATUS`, `PublicBudgetDetection` |
| `server/lib/budgetLabel.ts` | **Criar** — função pura: o rótulo lido é de total? |
| `server/services/geminiClient.ts` | **Modificar** — `extractBudgetFromImage()` |
| `server/services/budgetDetection.ts` | **Criar** — orquestra: lê arquivo → Gemini → grava linha |
| `server/services/conversationsService.ts` | **Modificar** — dispara a detecção no bloco pós-envio |
| `server/controllers/budgetDetectionsController.ts` | **Criar** — GET pendente, POST resolver |
| `server/routes/budgetDetections.ts` | **Criar** — rotas com RBAC de deals |
| `server/app.ts` | **Modificar** — registra a rota |
| `src/features/inside-sales/api.ts` | **Modificar** — hooks de detecção |
| `src/features/whatsapp/BudgetDetectionCard.tsx` | **Criar** — o card |
| `src/features/whatsapp/DealValueField.tsx` | **Criar** — campo de valor manual |
| `src/features/whatsapp/LeadSidebar.tsx` | **Modificar** — monta os dois no painel |

---

### Task 1: Tabela `budget_detections`

**Files:**
- Create: `server/db/migrations/042_budget_detections.sql`
- Modify: `server/db/schema.ts`
- Modify: `shared/types.ts`

- [ ] **Step 1: Escrever a migration**

Criar `server/db/migrations/042_budget_detections.sql`:

```sql
-- Migration 042: valor de orçamento lido de print, aguardando confirmação humana.
--
-- O time monta orçamento num ERP fechado (sem API) e manda print pro cliente. O
-- valor total fica só nos pixels, e hoje NENHUM deal em 'proposta_enviada' tem
-- proposal_value preenchido — o pipeline não tem previsão de receita.
--
-- Guardamos por MENSAGEM, não em deals, por dois motivos: a detecção pode
-- acontecer antes de o deal existir, e assim fica o rastro de qual imagem gerou
-- qual valor (necessário pra responder "por que esse card está R$ 3.443?").

CREATE TABLE budget_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  detected_value NUMERIC(12,2) NOT NULL,
  detected_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  confirmed_value NUMERIC(12,2),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma detecção por mensagem — o reprocessamento do mesmo envio não duplica card.
CREATE UNIQUE INDEX uidx_budget_detections_message ON budget_detections (message_id);

-- O painel consulta "tem pendente pra esse lead?" a cada render da conversa.
CREATE INDEX idx_budget_detections_pending
  ON budget_detections (lead_id, created_at DESC)
  WHERE status = 'pending';
```

- [ ] **Step 2: Rodar a migration**

Run: `npm run migrate`
Expected: log com `042_budget_detections.sql` aplicada, sem erro.

- [ ] **Step 3: Adicionar a tabela no schema drizzle**

Em `server/db/schema.ts`, depois do bloco `dealActivities` (que termina por volta da
linha 199), adicionar:

```ts
export const budgetDetections = pgTable('budget_detections', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  detectedValue: numeric('detected_value', { precision: 12, scale: 2 }).notNull(),
  detectedLabel: text('detected_label'),
  status: text('status', { enum: BUDGET_DETECTION_STATUS }).notNull().default('pending'),
  confirmedValue: numeric('confirmed_value', { precision: 12, scale: 2 }),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Adicionar `BUDGET_DETECTION_STATUS` ao import de `@shared/types` que já existe no topo do arquivo.

- [ ] **Step 4: Adicionar os tipos compartilhados**

Em `shared/types.ts`, junto dos outros arrays de enum:

```ts
export const BUDGET_DETECTION_STATUS = ['pending', 'confirmed', 'dismissed'] as const;
export type BudgetDetectionStatus = (typeof BUDGET_DETECTION_STATUS)[number];

export interface PublicBudgetDetection {
  id: string;
  messageId: string;
  leadId: string;
  detectedValue: number;
  createdAt: string;
}
```

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem saída (sucesso).

- [ ] **Step 6: Commit**

```bash
git add server/db/migrations/042_budget_detections.sql server/db/schema.ts shared/types.ts
git commit -m "feat(pipeline): tabela budget_detections"
```

---

### Task 2: Validação do rótulo (função pura)

Esta é a defesa contra o erro mais provável do OCR: pegar a coluna "Preço Total" de uma
linha de produto (R$ 1.821,87 na amostra real) em vez do "Valor total" do orçamento
(R$ 3.443,04). As duas contêm a palavra "total" — por isso a regra precisa de exclusões.

**Files:**
- Create: `server/lib/budgetLabel.ts`
- Test: `server/tests/budget-label.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/budget-label.test.ts`:

```ts
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

  it('rejeita rótulo sem a palavra total', () => {
    expect(isTotalLabel('Subtotal produtos')).toBe(true); // contém "total"
    expect(isTotalLabel('Frete')).toBe(false);
    expect(isTotalLabel('Condição de pagamento')).toBe(false);
  });

  it('rejeita vazio e nulo', () => {
    expect(isTotalLabel('')).toBe(false);
    expect(isTotalLabel(null)).toBe(false);
    expect(isTotalLabel(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run server/tests/budget-label.test.ts`
Expected: FAIL — `Cannot find module '../lib/budgetLabel'`.

- [ ] **Step 3: Implementar**

Criar `server/lib/budgetLabel.ts`:

```ts
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
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run server/tests/budget-label.test.ts`
Expected: PASS — 4 testes.

- [ ] **Step 5: Commit**

```bash
git add server/lib/budgetLabel.ts server/tests/budget-label.test.ts
git commit -m "feat(pipeline): valida rótulo de total do orçamento"
```

---

### Task 3: Leitura da imagem pelo Gemini

**Files:**
- Modify: `server/services/geminiClient.ts`
- Test: `server/tests/gemini-budget.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/gemini-budget.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateContentMock = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

import { extractBudgetFromImage } from '../services/geminiClient';

function mockGeminiJson(obj: unknown) {
  generateContentMock.mockResolvedValueOnce({
    text: JSON.stringify(obj),
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  generateContentMock.mockReset();
});

describe('extractBudgetFromImage', () => {
  it('extrai o total quando a imagem é um orçamento', async () => {
    mockGeminiJson({ ehOrcamento: true, total: 3443.04, rotulo: 'Valor total' });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toEqual({ total: 3443.04, rotulo: 'Valor total' });
  });

  it('devolve null quando não é orçamento (foto de produto, print de conversa)', async () => {
    mockGeminiJson({ ehOrcamento: false, total: null, rotulo: null });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toBeNull();
  });

  it('devolve null quando o rótulo é de linha de produto', async () => {
    // Defesa da Task 2 aplicada aqui: prefere não sugerir a sugerir errado.
    mockGeminiJson({ ehOrcamento: true, total: 1821.87, rotulo: 'Preço Total' });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toBeNull();
  });

  it('devolve null quando o JSON vem malformado', async () => {
    generateContentMock.mockResolvedValueOnce({ text: 'desculpe, não consegui ler' });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toBeNull();
  });

  it('devolve null quando o total não é número positivo', async () => {
    mockGeminiJson({ ehOrcamento: true, total: 0, rotulo: 'Valor total' });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toBeNull();
  });

  it('manda a imagem como inlineData em base64', async () => {
    mockGeminiJson({ ehOrcamento: true, total: 100, rotulo: 'Total' });

    await extractBudgetFromImage(Buffer.from('abc'), 'image/png');

    const call = generateContentMock.mock.calls[0][0];
    const parts = call.contents[0].parts;
    expect(parts.some((p: Record<string, unknown>) => p.inlineData)).toBe(true);
    const img = parts.find((p: Record<string, unknown>) => p.inlineData).inlineData;
    expect(img.mimeType).toBe('image/png');
    expect(img.data).toBe(Buffer.from('abc').toString('base64'));
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run server/tests/gemini-budget.test.ts`
Expected: FAIL — `extractBudgetFromImage is not a function`.

- [ ] **Step 3: Implementar**

Em `server/services/geminiClient.ts`, adicionar no topo o import:

```ts
import { isTotalLabel } from '../lib/budgetLabel';
```

E no fim do arquivo:

```ts
export interface BudgetExtraction {
  total: number;
  rotulo: string;
}

const BUDGET_PROMPT = `Você recebe a imagem de um documento enviado por um vendedor.

Responda APENAS com JSON, sem cercas de código, no formato:
{"ehOrcamento": boolean, "total": number|null, "rotulo": string|null}

- ehOrcamento: true somente se a imagem for um ORÇAMENTO/PROPOSTA comercial com valor.
  Foto de produto, print de conversa, comprovante ou nota fiscal => false.
- total: o valor TOTAL DO ORÇAMENTO INTEIRO, como número (ponto decimal, sem
  separador de milhar, sem "R$"). NÃO use o preço de um item da tabela de produtos.
- rotulo: o texto do rótulo exatamente como aparece ao lado do valor que você usou
  (ex: "Valor total"). É o que nos permite verificar que você não pegou a coluna errada.

Se não tiver certeza do total, responda ehOrcamento false.`;

/**
 * Le o valor total de um print de orcamento. Retorna null sempre que houver
 * qualquer duvida — este numero alimenta previsao de receita, entao "nao sugerir"
 * e sempre melhor que "sugerir errado".
 *
 * Nao lanca: quem chama esta num caminho best-effort pos-envio.
 */
export async function extractBudgetFromImage(
  image: Buffer,
  mimeType: string,
): Promise<BudgetExtraction | null> {
  let raw: string;
  try {
    const client = getClient();
    const response = await client.models.generateContent({
      model: MODEL,
      contents: [{
        role: 'user',
        parts: [
          { text: BUDGET_PROMPT },
          { inlineData: { mimeType, data: image.toString('base64') } },
        ],
      }],
      config: { temperature: 0, maxOutputTokens: 200 },
    });
    raw = response.text ?? '';
  } catch (err) {
    console.warn('[budget] Gemini falhou:', err instanceof Error ? err.message : err);
    return null;
  }

  // O modelo as vezes embrulha em ```json apesar da instrucao.
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  let parsed: { ehOrcamento?: unknown; total?: unknown; rotulo?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (parsed.ehOrcamento !== true) return null;
  const total = typeof parsed.total === 'number' ? parsed.total : null;
  if (total === null || !Number.isFinite(total) || total <= 0) return null;
  const rotulo = typeof parsed.rotulo === 'string' ? parsed.rotulo : null;
  if (!isTotalLabel(rotulo)) return null;

  return { total, rotulo: rotulo as string };
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run server/tests/gemini-budget.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 5: Commit**

```bash
git add server/services/geminiClient.ts server/tests/gemini-budget.test.ts
git commit -m "feat(pipeline): Gemini lê o total do print de orçamento"
```

---

### Task 4: Serviço de detecção + gatilho no envio

**Files:**
- Create: `server/services/budgetDetection.ts`
- Modify: `server/services/conversationsService.ts` (bloco pós-envio, ~linha 682)
- Test: `server/tests/budget-detection.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/budget-detection.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('../services/geminiClient', () => ({
  extractBudgetFromImage: vi.fn(),
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(async () => Buffer.from('fake-image-bytes')),
}));

import { readFile } from 'node:fs/promises';
import { extractBudgetFromImage } from '../services/geminiClient';
import { detectBudgetFromMessage } from '../services/budgetDetection';
import { db } from '../db/client';
import { budgetDetections } from '../db/schema';
import { createLead, createConversation, createMessage } from './helpers';

beforeEach(() => {
  vi.mocked(extractBudgetFromImage).mockReset();
  vi.mocked(readFile).mockClear();
  vi.mocked(readFile).mockResolvedValue(Buffer.from('fake-image-bytes'));
});

async function imageMessage(mediaUrl: string | null = '/uploads/conversations/x.jpg') {
  const lead = await createLead({ phone: '5511900000900' });
  const conv = await createConversation({ phone: '5511900000900', leadId: lead.id, queue: 'comercial' });
  const msg = await createMessage({
    conversationId: conv.id,
    direction: 'out',
    kind: 'image',
    mediaUrl,
    mediaMime: 'image/jpeg',
  });
  return { lead, conv, msg };
}

describe('detectBudgetFromMessage', () => {
  it('grava detecção pendente quando a IA lê um total', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 3443.04, rotulo: 'Valor total' });
    const { lead, msg } = await imageMessage();

    await detectBudgetFromMessage(msg.id);

    const rows = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, lead.id));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].detectedValue)).toBe(3443.04);
    expect(rows[0].status).toBe('pending');
  });

  it('não grava nada quando a IA não reconhece orçamento', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue(null);
    const { lead } = await imageMessage();
    const { msg } = await imageMessage();

    await detectBudgetFromMessage(msg.id);

    const rows = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, lead.id));
    expect(rows).toHaveLength(0);
  });

  it('detecção nova dispensa a pendente anterior do mesmo lead', async () => {
    // Orçamento revisado: o valor que vale é o do print mais recente.
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 1000, rotulo: 'Total' });
    const lead = await createLead({ phone: '5511900000901' });
    const conv = await createConversation({ phone: '5511900000901', leadId: lead.id, queue: 'comercial' });
    const m1 = await createMessage({
      conversationId: conv.id, direction: 'out', kind: 'image',
      mediaUrl: '/uploads/conversations/a.jpg', mediaMime: 'image/jpeg',
    });
    await detectBudgetFromMessage(m1.id);

    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 2000, rotulo: 'Total' });
    const m2 = await createMessage({
      conversationId: conv.id, direction: 'out', kind: 'image',
      mediaUrl: '/uploads/conversations/b.jpg', mediaMime: 'image/jpeg',
    });
    await detectBudgetFromMessage(m2.id);

    const rows = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, lead.id));
    const pending = rows.filter((r) => r.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(Number(pending[0].detectedValue)).toBe(2000);
  });

  it('ignora mensagem inbound (orçamento de concorrente não é nosso número)', async () => {
    const lead = await createLead({ phone: '5511900000902' });
    const conv = await createConversation({ phone: '5511900000902', leadId: lead.id, queue: 'comercial' });
    const msg = await createMessage({
      conversationId: conv.id, direction: 'in', kind: 'image',
      mediaUrl: '/uploads/inbound/x.jpg', mediaMime: 'image/jpeg',
    });

    await detectBudgetFromMessage(msg.id);

    expect(extractBudgetFromImage).not.toHaveBeenCalled();
    const rows = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, lead.id));
    expect(rows).toHaveLength(0);
  });

  it('ignora mensagem sem mediaUrl local', async () => {
    const { msg } = await imageMessage(null);

    await detectBudgetFromMessage(msg.id);

    expect(extractBudgetFromImage).not.toHaveBeenCalled();
  });

  it('arquivo sumiu do disco não quebra', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    const { lead, msg } = await imageMessage();

    await expect(detectBudgetFromMessage(msg.id)).resolves.toBeUndefined();

    const rows = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, lead.id));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run server/tests/budget-detection.test.ts`
Expected: FAIL — `Cannot find module '../services/budgetDetection'`.

- [ ] **Step 3: Implementar o serviço**

Criar `server/services/budgetDetection.ts`:

```ts
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { budgetDetections, conversations, messages } from '../db/schema';
import { extractBudgetFromImage } from './geminiClient';

/**
 * Le o print de orcamento que o vendedor acabou de mandar e, se encontrar um
 * total confiavel, grava uma sugestao PENDENTE pro painel do lead.
 *
 * Nunca lanca e nunca grava em deals: quem decide o numero que entra na previsao
 * de receita e o vendedor, confirmando o card. Ver
 * docs/superpowers/specs/2026-08-05-orcamento-valor-no-pipeline-design.md
 */
export async function detectBudgetFromMessage(messageId: string): Promise<void> {
  const [row] = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      kind: messages.kind,
      mediaUrl: messages.mediaUrl,
      mediaMime: messages.mediaMime,
      leadId: conversations.leadId,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!row) return;
  // So imagem NOSSA. Imagem do cliente pode ser orcamento de concorrente.
  if (row.direction !== 'out' || row.kind !== 'image') return;
  if (!row.mediaUrl || !row.mediaUrl.startsWith('/uploads/')) return;

  let buffer: Buffer;
  try {
    // mediaUrl e /uploads/... ; o diretorio real e <cwd>/uploads/...
    const rel = row.mediaUrl.replace(/^\/uploads\//, '');
    buffer = await readFile(path.join(process.cwd(), 'uploads', rel));
  } catch (err) {
    console.warn('[budget] não consegui ler a imagem:', err instanceof Error ? err.message : err);
    return;
  }

  const found = await extractBudgetFromImage(buffer, row.mediaMime ?? 'image/jpeg');
  if (!found) return;

  await db.transaction(async (tx) => {
    // Orcamento revisado manda: a sugestao anterior deixa de valer.
    await tx
      .update(budgetDetections)
      .set({ status: 'dismissed', resolvedAt: new Date() })
      .where(and(
        eq(budgetDetections.leadId, row.leadId),
        eq(budgetDetections.status, 'pending'),
      ));

    await tx
      .insert(budgetDetections)
      .values({
        messageId: row.id,
        leadId: row.leadId,
        detectedValue: String(found.total),
        detectedLabel: found.rotulo,
      })
      .onConflictDoNothing();
  });
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run server/tests/budget-detection.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 5: Ligar no envio**

Em `server/services/conversationsService.ts`, no bloco best-effort que já existe depois da
transação (o que chama `maybeAddDealFromConversation`, por volta da linha 682), adicionar
logo **depois** dele:

```ts
  // Lê o print de orçamento e sugere valor+etapa no painel do lead. Roda DEPOIS
  // do maybeAddDealFromConversation, que é quem garante que o deal existe.
  // Fire-and-forget: a mensagem já foi enviada, nada aqui pode afetar isso.
  if (input.kind === 'image') {
    import('./budgetDetection')
      .then(({ detectBudgetFromMessage }) => detectBudgetFromMessage(msg.id))
      .catch((err) => console.warn('[budget] detecção falhou:', err));
  }
```

- [ ] **Step 6: Rodar a suíte de conversas pra garantir que o envio não regrediu**

Run: `npx vitest run server/tests/conversations-send.test.ts server/tests/conversations-upload-media.test.ts`
Expected: PASS, sem mudança de contagem.

- [ ] **Step 7: Commit**

```bash
git add server/services/budgetDetection.ts server/services/conversationsService.ts server/tests/budget-detection.test.ts
git commit -m "feat(pipeline): detecta orçamento em print no envio de imagem"
```

---

### Task 5: API — consultar e resolver a detecção

**Files:**
- Create: `server/controllers/budgetDetectionsController.ts`
- Create: `server/routes/budgetDetections.ts`
- Modify: `server/app.ts`
- Test: `server/tests/budget-detections-api.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/budget-detections-api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { budgetDetections, deals } from '../db/schema';
import { createLead, createConversation, createMessage, createUser } from './helpers';

const app = createApp();

// Padrão dos testes de API do projeto: helper local, auth via Bearer.
async function loginAs(email = 'c@x.com', password = 'pw12345', role: 'comercial' | 'admin' | 'recepcao' = 'comercial') {
  const u = await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

async function seedPending(value = '3443.04') {
  const lead = await createLead({ phone: '5511900000910' });
  const conv = await createConversation({ phone: '5511900000910', leadId: lead.id, queue: 'comercial' });
  const msg = await createMessage({
    conversationId: conv.id, direction: 'out', kind: 'image',
    mediaUrl: '/uploads/conversations/x.jpg', mediaMime: 'image/jpeg',
  });
  const [det] = await db.insert(budgetDetections).values({
    messageId: msg.id, leadId: lead.id, detectedValue: value, detectedLabel: 'Valor total',
  }).returning();
  return { lead, det };
}

describe('GET /api/budget-detections/pending/:leadId', () => {
  it('devolve a detecção pendente do lead', async () => {
    const { token } = await loginAs();
    const { lead } = await seedPending();

    const res = await request(app)
      .get(`/api/budget-detections/pending/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.detectedValue).toBe(3443.04);
  });

  it('devolve null quando não há pendente', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '5511900000911' });

    const res = await request(app)
      .get(`/api/budget-detections/pending/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('401 sem token', async () => {
    const { lead } = await seedPending();
    const res = await request(app).get(`/api/budget-detections/pending/${lead.id}`);
    expect(res.status).toBe(401);
  });

  it('403 pra recepcao (mesmo RBAC do pipeline)', async () => {
    const { token } = await loginAs('r@x.com', 'pw12345', 'recepcao');
    const { lead } = await seedPending();

    const res = await request(app)
      .get(`/api/budget-detections/pending/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/budget-detections/:id/confirm', () => {
  it('grava o valor no deal e move a etapa', async () => {
    const { token } = await loginAs();
    const { lead, det } = await seedPending();

    const res = await request(app)
      .post(`/api/budget-detections/${det.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 3443.04, stage: 'proposta_enviada' });

    expect(res.status).toBe(200);
    const [deal] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(Number(deal.proposalValue)).toBe(3443.04);
    expect(deal.stage).toBe('proposta_enviada');
    const [row] = await db.select().from(budgetDetections).where(eq(budgetDetections.id, det.id));
    expect(row.status).toBe('confirmed');
  });

  it('usa o valor EDITADO pelo vendedor, não o detectado', async () => {
    const { token } = await loginAs();
    const { lead, det } = await seedPending();

    await request(app)
      .post(`/api/budget-detections/${det.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 5000 });

    const [deal] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(Number(deal.proposalValue)).toBe(5000);
    const [row] = await db.select().from(budgetDetections).where(eq(budgetDetections.id, det.id));
    expect(Number(row.confirmedValue)).toBe(5000);
  });

  it('confirma sem stage: grava valor e não mexe na etapa', async () => {
    const { token } = await loginAs();
    const { lead, det } = await seedPending();

    await request(app)
      .post(`/api/budget-detections/${det.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 3443.04 });

    const [deal] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(deal.stage).toBe('lead_no_comercial');
    expect(Number(deal.proposalValue)).toBe(3443.04);
  });

  it('409 ao confirmar duas vezes', async () => {
    const { token } = await loginAs();
    const { det } = await seedPending();
    const auth = `Bearer ${token}`;

    await request(app).post(`/api/budget-detections/${det.id}/confirm`)
      .set('Authorization', auth).send({ value: 100 });
    const res = await request(app).post(`/api/budget-detections/${det.id}/confirm`)
      .set('Authorization', auth).send({ value: 200 });

    expect(res.status).toBe(409);
  });
});

describe('POST /api/budget-detections/:id/dismiss', () => {
  it('marca dispensada e não toca em deals', async () => {
    const { token } = await loginAs();
    const { lead, det } = await seedPending();

    const res = await request(app)
      .post(`/api/budget-detections/${det.id}/dismiss`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const [row] = await db.select().from(budgetDetections).where(eq(budgetDetections.id, det.id));
    expect(row.status).toBe('dismissed');
    const dealRows = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(dealRows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run server/tests/budget-detections-api.test.ts`
Expected: FAIL — 404 nas rotas.

- [ ] **Step 3: Implementar o controller**

Criar `server/controllers/budgetDetectionsController.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { budgetDetections } from '../db/schema';
import { DEAL_STAGES } from '../../shared/types';
import { createDeal, changeStage, getDealByLeadId } from '../services/dealsService';
import { HttpError } from '../middleware/errorHandler';

const leadParams = z.object({ leadId: z.string().uuid() });
const idParams = z.object({ id: z.string().uuid() });
const confirmBody = z.object({
  value: z.number().positive(),
  stage: z.enum(DEAL_STAGES).optional(),
});

export async function pendingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { leadId } = leadParams.parse(req.params);
    const [row] = await db
      .select()
      .from(budgetDetections)
      .where(and(
        eq(budgetDetections.leadId, leadId),
        eq(budgetDetections.status, 'pending'),
      ))
      .orderBy(desc(budgetDetections.createdAt))
      .limit(1);

    if (!row) return res.json(null);
    return res.json({
      id: row.id,
      messageId: row.messageId,
      leadId: row.leadId,
      detectedValue: Number(row.detectedValue),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (e) {
    next(e);
  }
}

export async function confirmHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { value, stage } = confirmBody.parse(req.body);
    const userId = req.user!.id;

    const [det] = await db.select().from(budgetDetections).where(eq(budgetDetections.id, id)).limit(1);
    if (!det) throw new HttpError(404, 'Detecção não encontrada');
    if (det.status !== 'pending') throw new HttpError(409, 'Detecção já resolvida');

    // createDeal é idempotente no ativo: devolve o card aberto se já existir.
    const deal = await createDeal({
      leadId: det.leadId,
      ownerUserId: userId,
      proposalValue: value,
      source: 'manual',
    });

    // O deal pode já existir sem valor — createDeal só aplica proposalValue ao
    // CRIAR. Garante a escrita com um patch explícito.
    await db
      .update(deals)
      .set({ proposalValue: String(value), updatedAt: new Date() })
      .where(eq(deals.id, deal.id));

    if (stage && stage !== deal.stage) {
      await changeStage({ id: deal.id, stage, actorUserId: userId });
    }

    await db
      .update(budgetDetections)
      .set({
        status: 'confirmed',
        confirmedValue: String(value),
        resolvedBy: userId,
        resolvedAt: new Date(),
      })
      .where(eq(budgetDetections.id, id));

    return res.json(await getDealByLeadId(det.leadId));
  } catch (e) {
    next(e);
  }
}

export async function dismissHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await db
      .update(budgetDetections)
      .set({ status: 'dismissed', resolvedBy: req.user!.id, resolvedAt: new Date() })
      .where(and(eq(budgetDetections.id, id), eq(budgetDetections.status, 'pending')));
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
```

Adicionar `deals` ao import de `../db/schema`.

Assinaturas já verificadas contra o código atual:
`changeStage({ id, actorUserId, stage })` → `PublicDeal` (`dealsService.ts:616`),
`getDealByLeadId(leadId)` → `PublicDeal | null` (`dealsService.ts:429`),
`HttpError` mora em `server/middleware/errorHandler.ts`.

- [ ] **Step 4: Criar a rota**

Criar `server/routes/budgetDetections.ts`:

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  pendingHandler,
  confirmHandler,
  dismissHandler,
} from '../controllers/budgetDetectionsController';

const router = Router();

// Mesmo RBAC do pipeline: quem não pode mexer em deal não vê nem resolve sugestão.
const guard = [authGuard, requireRole('admin', 'comercial')];

router.get('/pending/:leadId', ...guard, pendingHandler);
router.post('/:id/confirm', ...guard, confirmHandler);
router.post('/:id/dismiss', ...guard, dismissHandler);

export default router;
```

- [ ] **Step 5: Registrar no app**

Em `server/app.ts`, junto dos outros `app.use('/api/...')`, seguindo o padrão do
`deals`:

```ts
app.use('/api/budget-detections', budgetDetectionsRouter);
```

com o import correspondente no topo.

- [ ] **Step 6: Rodar pra confirmar que passa**

Run: `npx vitest run server/tests/budget-detections-api.test.ts`
Expected: PASS — 9 testes.

- [ ] **Step 7: Commit**

```bash
git add server/controllers/budgetDetectionsController.ts server/routes/budgetDetections.ts server/app.ts server/tests/budget-detections-api.test.ts
git commit -m "feat(pipeline): API de sugestão de valor de orçamento"
```

---

### Task 6: UI — card de sugestão + campo de valor manual

**Files:**
- Modify: `src/features/inside-sales/api.ts`
- Create: `src/features/whatsapp/BudgetDetectionCard.tsx`
- Create: `src/features/whatsapp/DealValueField.tsx`
- Modify: `src/features/whatsapp/LeadSidebar.tsx`

- [ ] **Step 1: Adicionar os hooks de API**

Em `src/features/inside-sales/api.ts`, no fim do arquivo:

```ts
export interface PendingBudgetDetection {
  id: string;
  messageId: string;
  leadId: string;
  detectedValue: number;
  createdAt: string;
}

export function usePendingBudgetDetection(leadId: string | null) {
  return useQuery({
    queryKey: ['budget-detection', leadId],
    queryFn: () => api<PendingBudgetDetection | null>(`/budget-detections/pending/${leadId}`),
    enabled: !!leadId,
  });
}

export function useConfirmBudgetDetection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; value: number; stage?: DealStage }) => {
      const { id, ...body } = input;
      return api(`/budget-detections/${id}/confirm`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: ['budget-detection'] });
    },
  });
}

export function useDismissBudgetDetection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/budget-detections/${id}/dismiss`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-detection'] }),
  });
}
```

Garantir que `DealStage` está importado de `@shared/types` no topo do arquivo.

- [ ] **Step 2: Criar o card**

Criar `src/features/whatsapp/BudgetDetectionCard.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  usePendingBudgetDetection,
  useConfirmBudgetDetection,
  useDismissBudgetDetection,
} from '@/features/inside-sales/api';
import { STAGE_LABELS } from '@/features/inside-sales/helpers';
import type { DealStage } from '@shared/types';

// Etapas anteriores a "proposta enviada". Só nelas faz sentido sugerir o avanço:
// mandar orçamento revisado durante a negociação não pode rebaixar o funil.
const STAGES_ANTES_DA_PROPOSTA: DealStage[] = ['lead_no_comercial'];
const STAGE_SUGERIDA: DealStage = 'proposta_enviada';

export function BudgetDetectionCard({
  leadId,
  currentStage,
}: {
  leadId: string;
  currentStage: DealStage | null;
}) {
  const { data: detection } = usePendingBudgetDetection(leadId);
  const confirm = useConfirmBudgetDetection();
  const dismiss = useDismissBudgetDetection();
  const [draft, setDraft] = useState<string>('');

  if (!detection) return null;

  // Só inicializa o rascunho quando o card aparece pela primeira vez.
  const value = draft === '' ? String(detection.detectedValue) : draft;
  const parsed = Number(value.replace(',', '.'));
  const valido = Number.isFinite(parsed) && parsed > 0;

  const sugereEtapa = currentStage === null || STAGES_ANTES_DA_PROPOSTA.includes(currentStage);

  async function handleConfirm() {
    if (!valido) {
      toast.error('Valor inválido.');
      return;
    }
    try {
      await confirm.mutateAsync({
        id: detection!.id,
        value: parsed,
        stage: sugereEtapa ? STAGE_SUGERIDA : undefined,
      });
      toast.success('Valor registrado no card.');
    } catch {
      toast.error('Falha ao confirmar.');
    }
  }

  async function handleDismiss() {
    try {
      await dismiss.mutateAsync(detection!.id);
    } catch {
      toast.error('Falha ao dispensar.');
    }
  }

  const busy = confirm.isPending || dismiss.isPending;

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-2">
      <p className="text-xs font-medium">Orçamento detectado</p>

      <label className="block text-[11px] text-muted-foreground">
        Valor
        <Input
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          inputMode="decimal"
          className="mt-0.5 h-8 text-sm"
        />
      </label>

      {sugereEtapa && (
        <p className="text-[11px] text-muted-foreground">
          Etapa: <span className="font-medium">{STAGE_LABELS[STAGE_SUGERIDA]}</span>
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={handleConfirm} disabled={busy || !valido}>
          Confirmar
        </Button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={busy}
          className="text-[11px] text-muted-foreground hover:underline"
        >
          Dispensar
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Criar o campo de valor manual**

Criar `src/features/whatsapp/DealValueField.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePatchDeal } from '@/features/inside-sales/api';

/**
 * Valor do card, editavel direto da conversa. Existe independente da deteccao
 * por IA: cobre orcamento mandado por fora do sistema e e o que resolve os deals
 * sem valor hoje.
 */
export function DealValueField({
  dealId,
  proposalValue,
}: {
  dealId: string;
  proposalValue: number | null;
}) {
  const patch = usePatchDeal();
  const [draft, setDraft] = useState(proposalValue == null ? '' : String(proposalValue));

  useEffect(() => {
    setDraft(proposalValue == null ? '' : String(proposalValue));
  }, [dealId, proposalValue]);

  const parsed = draft.trim() === '' ? null : Number(draft.replace(',', '.'));
  const valido = parsed === null || (Number.isFinite(parsed) && parsed > 0);
  const mudou = parsed !== proposalValue;

  async function handleSave() {
    if (!valido) {
      toast.error('Valor inválido.');
      return;
    }
    try {
      await patch.mutateAsync({ id: dealId, proposalValue: parsed });
      toast.success('Valor atualizado.');
    } catch {
      toast.error('Falha ao salvar valor.');
    }
  }

  return (
    <div className="space-y-1">
      <label className="block text-[11px] text-muted-foreground">Valor da proposta</label>
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="—"
          inputMode="decimal"
          disabled={patch.isPending}
          className="h-8 text-sm"
        />
        {mudou && (
          <Button
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={handleSave}
            disabled={patch.isPending || !valido}
          >
            Salvar
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Montar no painel**

Em `src/features/whatsapp/LeadSidebar.tsx`, no bloco de retorno da seção de pipeline
(logo depois do `<Select>` de etapa e antes do link "Abrir no pipeline →"), adicionar:

```tsx
      <BudgetDetectionCard leadId={leadId} currentStage={deal?.stage ?? null} />

      {deal && (
        <DealValueField
          dealId={deal.id}
          proposalValue={deal.proposalValue}
        />
      )}
```

com os imports:

```ts
import { BudgetDetectionCard } from './BudgetDetectionCard';
import { DealValueField } from './DealValueField';
```

- [ ] **Step 5: Verificar que compila e a suíte segue verde**

Run: `npx tsc --noEmit`
Expected: sem saída.

Run: `npx vitest run`
Expected: todos os arquivos passando, contagem = anterior + os testes novos das Tasks 2-5.

- [ ] **Step 6: Commit**

```bash
git add src/features/inside-sales/api.ts src/features/whatsapp/BudgetDetectionCard.tsx src/features/whatsapp/DealValueField.tsx src/features/whatsapp/LeadSidebar.tsx
git commit -m "feat(pipeline): card de orçamento detectado + valor editável na conversa"
```

---

## Verificação final

- [ ] `npx vitest run` — suíte inteira verde
- [ ] `npx tsc --noEmit` — sem erros
- [ ] Conferir manualmente no app: mandar um print de orçamento numa conversa da fila
      Comercial → card aparece no painel → editar o valor → Confirmar → card do pipeline
      com valor e etapa "Proposta enviada".

## Notas de deploy

- A migration 042 roda com `npm run migrate`.
- `GEMINI_API_KEY` já existe no ambiente (a IA de atendimento usa a mesma).
- Custo: uma chamada de visão por imagem outbound. Volume histórico é ~17 imagens em deals
  abertos — desprezível no Flash.
