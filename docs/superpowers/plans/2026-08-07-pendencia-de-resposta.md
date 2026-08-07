# Pendência de resposta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar visível e alertável a conversa em que o cliente está esperando resposta nossa, com relógio que só corre em horário comercial.

**Architecture:** Um predicado SQL canônico ("a bola está com a gente") consumido por filtro, contador, dashboard e watchdog. Uma função pura calcula minutos comerciais entre dois instantes, reaproveitando a configuração de horário que já existe em `org_settings`. O `slaWatchdog` ganha uma segunda vigilância, com idempotência por ciclo de pendência.

**Tech Stack:** Express + Drizzle + Postgres, React 19 + TanStack Query, vitest (Postgres real embarcado).

**Spec:** `docs/superpowers/specs/2026-08-07-pendencia-de-resposta-design.md`

---

## Contexto que o implementador precisa saber

**Não crie configuração de horário comercial.** Ela já existe em `org_settings`:
`aiBusinessHoursStart` (int 0-23), `aiBusinessHoursEnd` (int 1-24, exclusivo),
`aiBusinessHoursDays` (CSV de ISO weekdays, `'1,2,3,4,5'`) e `dispatchTimezone`
(`'America/Sao_Paulo'`). O helper `server/lib/businessHours.ts` já as lê em
`isAiBusinessHours()`. Reaproveite as mesmas colunas.

`ai24x7` é **ignorado** de propósito: ele diz que a IA responde a qualquer hora,
não que os vendedores trabalham de madrugada.

O `slaWatchdog` existente (`server/services/slaWatchdog.ts`) vigia **outra
coisa**: lead que entrou na fila Comercial e ninguém assumiu
(`assigned_to IS NULL`). Não altere `processEscalations()` — a vigilância nova é
independente e roda no mesmo tick.

`emitNotification` (`server/services/notifications.ts`) aceita `userIds`
explícitos **ou** `toRoles`. Se `userIds` vier vazio e `toRoles` estiver
presente, ele resolve os usuários ativos daquelas roles.

**Ordem de execução:** as tasks são sequenciais. Tasks 4+ dependem dos tipos e
helpers criados em 1-3.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `server/db/migrations/043_pending_reply.sql` | **Criar** — 2 colunas de config + tabela de alertas |
| `server/db/schema.ts` | **Modificar** — colunas em `orgSettings`, tabela `conversationReplyAlerts` |
| `shared/types.ts` | **Modificar** — kind de notificação, `awaitingUsMinutes`, `awaitingUs` em counts/filtros, campos de settings |
| `server/lib/businessHours.ts` | **Modificar** — `BusinessHoursConfig`, `businessConfigFromSettings`, `businessMinutesBetween` |
| `server/lib/pendingReply.ts` | **Criar** — predicado SQL canônico, um lugar só |
| `server/services/conversationsService.ts` | **Modificar** — filtro, contador, campo no payload, ordenação |
| `server/controllers/conversationsController.ts` | **Modificar** — query param `awaitingUs` |
| `server/services/pendingReplyWatch.ts` | **Criar** — a vigilância nova |
| `server/services/slaWatchdog.ts` | **Modificar** — chama a vigilância nova no tick |
| `server/services/dashboardService.ts` | **Modificar** — os dois lugares que usam 24h |
| `server/controllers/orgSettingsController.ts` | **Modificar** — validação dos 2 limiares |
| `src/features/whatsapp/FilterBar.tsx` | **Modificar** — chip "Aguardando nós" |
| `src/pages/whatsapp/WhatsappPage.tsx` | **Modificar** — repassa o filtro |
| `src/features/whatsapp/ConversationList.tsx` | **Modificar** — badge de tempo |
| `src/features/notifications/NewMessageAlerts.tsx` | **Modificar** — aceita o kind novo |
| `src/pages/settings/…` | **Modificar** — campos dos 2 limiares |

---

### Task 1: Migration, schema e tipos

**Files:**
- Create: `server/db/migrations/043_pending_reply.sql`
- Modify: `server/db/schema.ts`
- Modify: `shared/types.ts`

- [ ] **Step 1: Escrever a migration**

Criar `server/db/migrations/043_pending_reply.sql`:

```sql
-- Migration 043: pendencia de resposta do nosso lado.
--
-- Conversa em que o cliente mandou a ultima mensagem e ninguem respondeu. O
-- slaWatchdog existente so vigia lead que ninguem ASSUMIU (assigned_to IS NULL);
-- conversa ja em atendimento passava batido.
--
-- Horario comercial NAO ganha colunas novas: ai_business_hours_start/_end/_days
-- e dispatch_timezone ja existem nesta mesma tabela e sao reaproveitados.

ALTER TABLE org_settings
  ADD COLUMN pending_reply_alert_min    integer NOT NULL DEFAULT 60,
  ADD COLUMN pending_reply_escalate_min integer NOT NULL DEFAULT 180;

-- Alertas ja disparados. A unicidade inclui pending_since (o last_inbound_at do
-- ciclo) porque estar devendo resposta e RECORRENTE: o cliente escreve, a gente
-- responde, ele escreve de novo. Sem essa coluna a conversa alertaria uma unica
-- vez na vida e o sistema pararia de avisar justamente nas conversas mais ativas.
CREATE TABLE conversation_reply_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  pending_since   timestamptz NOT NULL,
  level           integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uidx_reply_alerts_cycle
  ON conversation_reply_alerts (conversation_id, pending_since, level);
```

- [ ] **Step 2: Rodar a migration**

Run: `npm run migrate`
Expected: log com `043_pending_reply.sql` aplicada, sem erro.

- [ ] **Step 3: Declarar no schema drizzle**

Em `server/db/schema.ts`, dentro de `orgSettings`, logo depois de
`dispatchTimezone` (por volta da linha 295):

```ts
    // ── Pendência de resposta (migration 043) ──
    // Minutos COMERCIAIS sem resposta nossa. O horário vem de
    // ai_business_hours_* + dispatch_timezone (não há colunas novas de horário).
    pendingReplyAlertMin: integer('pending_reply_alert_min').notNull().default(60),
    pendingReplyEscalateMin: integer('pending_reply_escalate_min').notNull().default(180),
```

E depois do bloco `conversationSlaEvents` (por volta da linha 476):

```ts
// ── Pendência de resposta (migration 043) ────────────────────────
// Alerta já disparado para um CICLO de pendência. `pendingSince` é o
// last_inbound_at que abriu o ciclo — mensagem nova do cliente abre outro e
// volta a poder alertar.
export const conversationReplyAlerts = pgTable('conversation_reply_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  pendingSince: timestamp('pending_since', { withTimezone: true }).notNull(),
  level: integer('level').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ConversationReplyAlert = typeof conversationReplyAlerts.$inferSelect;
export type NewConversationReplyAlert = typeof conversationReplyAlerts.$inferInsert;
```

- [ ] **Step 4: Atualizar os tipos compartilhados**

Em `shared/types.ts`:

Adicionar o kind em `NOTIFICATION_KINDS` (por volta da linha 971), depois de `'sla_escalation'`:

```ts
  'pending_reply',          // cliente esperando resposta nossa além do prazo
```

Em `PublicConversation` (linha ~286), **substituir** `isExpired24h: boolean` por:

```ts
  /**
   * Minutos de horário comercial que o cliente está esperando resposta nossa.
   * null quando a bola não está conosco (respondemos, ou é conversa da IA).
   */
  awaitingUsMinutes: number | null;
```

Em `ConversationCounts` (linha ~326), adicionar:

```ts
  /** Conversas em que a última mensagem é do cliente e ninguém automático responde. */
  awaitingUs: number;
```

Em `ConversationFilters` (linha ~334), **substituir** `expired24h?: boolean` por:

```ts
  awaitingUs?: boolean;
```

Em `PublicOrgSettings` (linha ~782, antes de `updatedAt`) e em
`UpdateOrgSettingsInput` (como opcionais):

```ts
  pendingReplyAlertMin: number;
  pendingReplyEscalateMin: number;
```

```ts
  pendingReplyAlertMin?: number;
  pendingReplyEscalateMin?: number;
```

Em `DashboardWhatsappStats` (linha ~959), **renomear** `expired24h: number` para:

```ts
  awaitingUs: number;
```

- [ ] **Step 5: Verificar que o typecheck aponta os consumidores**

Run: `npx tsc --noEmit`
Expected: FALHA, listando os usos de `isExpired24h`, `expired24h` e do payload de
settings. Isso é o mapa das Tasks 4-8 — anote os arquivos. Não conserte agora.

- [ ] **Step 6: Commit**

```bash
git add server/db/migrations/043_pending_reply.sql server/db/schema.ts shared/types.ts
git commit -m "feat(inbox): schema de pendência de resposta"
```

---

### Task 2: Minutos de horário comercial (função pura)

O coração da feature. Erra em silêncio se estiver errada, então é o alvo de teste
mais denso do plano.

**Files:**
- Modify: `server/lib/businessHours.ts`
- Test: `server/tests/business-minutes.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/business-minutes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { businessMinutesBetween, type BusinessHoursConfig } from '../lib/businessHours';

// Seg-sex, 08:00-18:00, horário de Brasília. 10h úteis = 600 min por dia.
const CFG: BusinessHoursConfig = {
  startHour: 8,
  endHour: 18,
  days: [1, 2, 3, 4, 5],
  timeZone: 'America/Sao_Paulo',
};

// Brasília é UTC-3 (sem horário de verão desde 2019).
// 2026-08-05 é uma QUARTA; 2026-08-08 é um SÁBADO; 2026-08-10 é uma SEGUNDA.
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe('businessMinutesBetween', () => {
  it('conta minutos corridos dentro do expediente', () => {
    expect(businessMinutesBetween(brt('2026-08-05T09:00'), brt('2026-08-05T11:30'), CFG))
      .toBe(150);
  });

  it('ignora o tempo depois do fechamento', () => {
    // 17:30 -> 19:00 num dia útil: só valem os 30 min até as 18:00.
    expect(businessMinutesBetween(brt('2026-08-05T17:30'), brt('2026-08-05T19:00'), CFG))
      .toBe(30);
  });

  it('mensagem que chega de madrugada só começa a contar na abertura', () => {
    // Chegou 02:00, agora são 09:00 -> 1h de expediente (08:00-09:00).
    expect(businessMinutesBetween(brt('2026-08-05T02:00'), brt('2026-08-05T09:00'), CFG))
      .toBe(60);
  });

  it('atravessa a noite somando só os dois pedaços de expediente', () => {
    // Quarta 17:00 -> quinta 09:00 = 60 (17-18) + 60 (8-9).
    expect(businessMinutesBetween(brt('2026-08-05T17:00'), brt('2026-08-06T09:00'), CFG))
      .toBe(120);
  });

  it('atravessa o fim de semana sem contar sábado e domingo', () => {
    // Sexta 17:00 -> segunda 09:00 = 60 (sex 17-18) + 60 (seg 8-9). Fim de
    // semana vale ZERO — é o que impede a pilha de "esperando há 60h" toda
    // segunda de manhã.
    expect(businessMinutesBetween(brt('2026-08-07T17:00'), brt('2026-08-10T09:00'), CFG))
      .toBe(120);
  });

  it('conta o dia útil inteiro quando atravessa um dia completo', () => {
    // Quarta 08:00 -> sexta 08:00 = quarta (600) + quinta (600).
    expect(businessMinutesBetween(brt('2026-08-05T08:00'), brt('2026-08-07T08:00'), CFG))
      .toBe(1200);
  });

  it('devolve zero quando o intervalo inteiro cai fora do expediente', () => {
    // Sábado inteiro.
    expect(businessMinutesBetween(brt('2026-08-08T09:00'), brt('2026-08-08T17:00'), CFG))
      .toBe(0);
  });

  it('devolve zero quando from é posterior a to', () => {
    expect(businessMinutesBetween(brt('2026-08-05T11:00'), brt('2026-08-05T09:00'), CFG))
      .toBe(0);
  });

  it('devolve zero quando nenhum dia é útil na configuração', () => {
    // Configuração degenerada não pode fazer o relógio correr pra sempre.
    const vazio = { ...CFG, days: [] };
    expect(businessMinutesBetween(brt('2026-08-05T09:00'), brt('2026-08-05T17:00'), vazio))
      .toBe(0);
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run server/tests/business-minutes.test.ts`
Expected: FAIL — `businessMinutesBetween is not a function`.

- [ ] **Step 3: Implementar**

Em `server/lib/businessHours.ts`, adicionar no fim do arquivo:

```ts
export interface BusinessHoursConfig {
  /** Hora de abertura, 0-23. */
  startHour: number;
  /** Hora de fechamento, 1-24 (exclusiva). */
  endHour: number;
  /** ISO weekdays úteis: 1=seg .. 7=dom. */
  days: number[];
  timeZone: string;
}

/**
 * Le a config de horario comercial de org_settings.
 *
 * Reaproveita as colunas da IA de proposito — sao o horario de funcionamento da
 * operacao, e um terceiro conjunto de campos so criaria mais uma definicao pra
 * divergir. `ai24x7` NAO entra: ele diz que a IA responde a qualquer hora, nao
 * que os vendedores trabalham de madrugada.
 *
 * Recebe a FORMA e nao o tipo OrgSettings: `getOrgSettings()` devolve
 * PublicOrgSettings e `loadOrgSettingsRow()` devolve a row do drizzle. Os dois
 * servem, e tipar pelo formato evita converter de um pro outro so pra ler
 * quatro campos.
 */
export function businessConfigFromSettings(s: {
  aiBusinessHoursStart: number;
  aiBusinessHoursEnd: number;
  aiBusinessHoursDays: string;
  dispatchTimezone: string;
}): BusinessHoursConfig {
  const days = s.aiBusinessHoursDays
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);

  return {
    startHour: s.aiBusinessHoursStart,
    endHour: s.aiBusinessHoursEnd,
    days,
    timeZone: s.dispatchTimezone || 'America/Sao_Paulo',
  };
}

/** Componentes da data no fuso alvo, numa unica passada de Intl. */
function partsIn(d: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) map[p.type] = p.value;
  const ISO_WEEKDAY: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Intl devolve 24 pra meia-noite com hour12:false; normaliza pra 0.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    isoWeekday: ISO_WEEKDAY[map.weekday] ?? 0,
  };
}

/** Offset do fuso, em minutos, no instante dado. */
function offsetMinutes(d: Date, timeZone: string): number {
  const p = partsIn(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - d.getTime()) / 60_000;
}

/** Instante UTC correspondente a uma hora LOCAL de um dia local. */
function localToUtc(
  year: number, month: number, day: number, hour: number, timeZone: string,
): Date {
  // Primeira estimativa com o offset do meio-dia daquele dia (evita a borda de
  // meia-noite), depois corrige com o offset do proprio instante estimado.
  const noonGuess = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const off = offsetMinutes(noonGuess, timeZone);
  return new Date(Date.UTC(year, month - 1, day, hour, 0, 0) - off * 60_000);
}

/**
 * Minutos de HORARIO COMERCIAL decorridos entre dois instantes.
 *
 * O relogio de pendencia precisa disso, e nao do tempo corrido: mensagem que
 * chega as 19h nao pode nascer com 13h de atraso as 8h da manha seguinte. Se
 * todo alerta nascer estourado, o time para de olhar.
 *
 * Percorre DIA A DIA no fuso configurado somando a intersecao de [from, to] com
 * a janela util de cada dia. Iterar minuto a minuto seria simples, mas uma
 * pendencia de varios dias faria dezenas de milhares de chamadas de Intl por
 * conversa a cada tick do watchdog.
 */
export function businessMinutesBetween(
  from: Date, to: Date, cfg: BusinessHoursConfig,
): number {
  if (!(to > from)) return 0;
  if (!cfg.days.length) return 0;
  if (cfg.endHour <= cfg.startHour) return 0;

  let total = 0;
  // Comeca no dia local de `from` e caminha ate passar de `to`.
  let cursor = new Date(from.getTime());

  // Teto de seguranca: pendencia de mais de um ano nao existe, e um bug de
  // avanco de cursor nao pode virar loop infinito dentro do watchdog.
  for (let guard = 0; guard < 400; guard += 1) {
    const p = partsIn(cursor, cfg.timeZone);

    if (cfg.days.includes(p.isoWeekday)) {
      const abre = localToUtc(p.year, p.month, p.day, cfg.startHour, cfg.timeZone);
      const fecha = localToUtc(p.year, p.month, p.day, cfg.endHour, cfg.timeZone);
      const ini = Math.max(abre.getTime(), from.getTime());
      const fim = Math.min(fecha.getTime(), to.getTime());
      if (fim > ini) total += (fim - ini) / 60_000;
    }

    // Proximo dia local, a partir da meia-noite seguinte.
    const proximo = localToUtc(p.year, p.month, p.day, 24, cfg.timeZone);
    if (proximo.getTime() >= to.getTime()) break;
    cursor = proximo;
  }

  return Math.round(total);
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run server/tests/business-minutes.test.ts`
Expected: PASS — 9 testes.

- [ ] **Step 5: Commit**

```bash
git add server/lib/businessHours.ts server/tests/business-minutes.test.ts
git commit -m "feat(inbox): minutos de horário comercial entre dois instantes"
```

---

### Task 3: O predicado canônico

**Files:**
- Create: `server/lib/pendingReply.ts`
- Test: `server/tests/pending-reply-predicate.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/pending-reply-predicate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { conversations } from '../db/schema';
import { awaitingUsSql } from '../lib/pendingReply';
import { createLead, createConversation } from './helpers';

async function matches(convId: string): Promise<boolean> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, convId), awaitingUsSql()));
  return rows.length === 1;
}

let seq = 0;
async function conv(opts: {
  queue?: 'ia' | 'recepcao' | 'comercial';
  status?: 'aguardando_atendimento' | 'em_atendimento' | 'encerrada';
  aiDisabled?: boolean;
  lastInboundAt?: Date | null;
  lastMessageAt?: Date;
}) {
  seq += 1;
  const phone = `5511940${String(100000 + seq).slice(-6)}`;
  const lead = await createLead({ phone });
  return createConversation({
    phone,
    leadId: lead.id,
    queue: opts.queue ?? 'comercial',
    status: opts.status ?? 'em_atendimento',
    aiDisabled: opts.aiDisabled ?? false,
    lastInboundAt: opts.lastInboundAt === undefined ? new Date('2026-08-05T12:00:00Z') : opts.lastInboundAt,
    lastMessageAt: opts.lastMessageAt ?? new Date('2026-08-05T12:00:00Z'),
  });
}

describe('awaitingUsSql', () => {
  it('pega conversa cuja última mensagem é do cliente', async () => {
    const c = await conv({});
    expect(await matches(c.id)).toBe(true);
  });

  it('ignora conversa que já respondemos', async () => {
    const c = await conv({ lastMessageAt: new Date('2026-08-05T12:05:00Z') });
    expect(await matches(c.id)).toBe(false);
  });

  it('ignora conversa encerrada', async () => {
    const c = await conv({ status: 'encerrada' });
    expect(await matches(c.id)).toBe(false);
  });

  it('ignora conversa da fila IA com a IA ligada', async () => {
    // A IA vai responder — não é pendência humana.
    const c = await conv({ queue: 'ia', aiDisabled: false });
    expect(await matches(c.id)).toBe(false);
  });

  it('pega conversa da recepção quando um humano assumiu (IA desligada)', async () => {
    const c = await conv({ queue: 'recepcao', aiDisabled: true });
    expect(await matches(c.id)).toBe(true);
  });

  it('ignora disparo de campanha que nunca recebeu resposta', async () => {
    // Sem inbound nenhum a bola nunca esteve conosco.
    const c = await conv({ lastInboundAt: null });
    expect(await matches(c.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run server/tests/pending-reply-predicate.test.ts`
Expected: FAIL — `Cannot find module '../lib/pendingReply'`.

- [ ] **Step 3: Implementar**

Criar `server/lib/pendingReply.ts`:

```ts
import { sql, type SQL } from 'drizzle-orm';
import { conversations } from '../db/schema';

/**
 * "A bola esta com a gente": o cliente mandou a ultima mensagem e ninguem
 * automatico vai responder.
 *
 * Esta funcao existe pra ser o UNICO lugar onde a regra mora. Antes dela a
 * mesma ideia estava escrita em dois lugares com definicoes diferentes — o
 * filtro da Inbox nao exigia que a ultima mensagem fosse do cliente, e por isso
 * listava 23 conversas quando so 1 estava mesmo esperando. Se precisar mudar a
 * regra, mude aqui e em nenhum outro lugar.
 *
 * `last_message_at <= last_inbound_at` e o que expressa "a ultima e do cliente":
 * qualquer outbound posterior empurra last_message_at pra frente. A igualdade e
 * o caso normal, ja que a inbound atualiza as duas colunas.
 */
export function awaitingUsSql(): SQL {
  return sql`(
    ${conversations.status} <> 'encerrada'
    AND ${conversations.lastInboundAt} IS NOT NULL
    AND ${conversations.lastMessageAt} <= ${conversations.lastInboundAt}
    AND (${conversations.queue} = 'comercial' OR ${conversations.aiDisabled} = true)
  )`;
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run server/tests/pending-reply-predicate.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 5: Commit**

```bash
git add server/lib/pendingReply.ts server/tests/pending-reply-predicate.test.ts
git commit -m "feat(inbox): predicado canônico de pendência de resposta"
```

---

### Task 4: API — filtro, contador e tempo no payload

**Files:**
- Modify: `server/services/conversationsService.ts`
- Modify: `server/controllers/conversationsController.ts`
- Test: `server/tests/conversations-awaiting-us.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/conversations-awaiting-us.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createConversation } from './helpers';

const app = createApp();

async function loginAs(email = 'c@x.com', password = 'pw12345') {
  await createUser({ email, password, role: 'comercial' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

let seq = 0;
async function conv(opts: { lastInboundAt: Date; lastMessageAt: Date; queue?: 'comercial' | 'ia' }) {
  seq += 1;
  const phone = `5511950${String(100000 + seq).slice(-6)}`;
  const lead = await createLead({ phone });
  return createConversation({
    phone,
    leadId: lead.id,
    queue: opts.queue ?? 'comercial',
    status: 'em_atendimento',
    lastInboundAt: opts.lastInboundAt,
    lastMessageAt: opts.lastMessageAt,
  });
}

describe('GET /api/conversations?awaitingUs=true', () => {
  it('retorna só as conversas em que devemos resposta', async () => {
    const token = await loginAs();
    const esperando = await conv({
      lastInboundAt: new Date('2026-08-05T12:00:00Z'),
      lastMessageAt: new Date('2026-08-05T12:00:00Z'),
    });
    await conv({
      lastInboundAt: new Date('2026-08-05T12:00:00Z'),
      lastMessageAt: new Date('2026-08-05T12:30:00Z'), // já respondida
    });

    const res = await request(app)
      .get('/api/conversations?awaitingUs=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([esperando.id]);
  });

  it('awaitingUsMinutes é null quando a bola está com o lead', async () => {
    const token = await loginAs('c2@x.com');
    const respondida = await conv({
      lastInboundAt: new Date('2026-08-05T12:00:00Z'),
      lastMessageAt: new Date('2026-08-05T12:30:00Z'),
    });

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${token}`);

    const item = res.body.items.find((c: { id: string }) => c.id === respondida.id);
    expect(item.awaitingUsMinutes).toBeNull();
  });

  it('awaitingUsMinutes conta minutos comerciais, não corridos', async () => {
    const token = await loginAs('c3@x.com');
    // 2026-08-05 é quarta. Inbound às 02:00 BRT (05:00Z), madrugada: o relógio
    // só começa às 08:00 BRT. Com o default 08-18 o valor tem que ser MENOR que
    // o tempo corrido desde as 02:00.
    const madrugada = await conv({
      lastInboundAt: new Date('2026-08-05T05:00:00Z'),
      lastMessageAt: new Date('2026-08-05T05:00:00Z'),
    });

    const res = await request(app)
      .get('/api/conversations?awaitingUs=true')
      .set('Authorization', `Bearer ${token}`);

    const item = res.body.items.find((c: { id: string }) => c.id === madrugada.id);
    const corridoMin = (Date.now() - Date.parse('2026-08-05T05:00:00Z')) / 60_000;
    expect(item.awaitingUsMinutes).toBeGreaterThan(0);
    expect(item.awaitingUsMinutes).toBeLessThan(corridoMin);
  });

  it('com o filtro ativo, ordena do que espera há mais tempo pro mais recente', async () => {
    const token = await loginAs('c5@x.com');
    const recente = await conv({
      lastInboundAt: new Date('2026-08-05T16:00:00Z'),
      lastMessageAt: new Date('2026-08-05T16:00:00Z'),
    });
    const antiga = await conv({
      lastInboundAt: new Date('2026-08-05T09:00:00Z'),
      lastMessageAt: new Date('2026-08-05T09:00:00Z'),
    });

    const res = await request(app)
      .get('/api/conversations?awaitingUs=true')
      .set('Authorization', `Bearer ${token}`);

    const ids = res.body.items.map((c: { id: string }) => c.id);
    expect(ids.indexOf(antiga.id)).toBeLessThan(ids.indexOf(recente.id));
  });

  it('counts devolve awaitingUs coerente com a lista', async () => {
    const token = await loginAs('c4@x.com');
    await conv({
      lastInboundAt: new Date('2026-08-05T12:00:00Z'),
      lastMessageAt: new Date('2026-08-05T12:00:00Z'),
    });

    const lista = await request(app)
      .get('/api/conversations?awaitingUs=true')
      .set('Authorization', `Bearer ${token}`);
    const counts = await request(app)
      .get('/api/conversations/counts')
      .set('Authorization', `Bearer ${token}`);

    expect(counts.body.awaitingUs).toBe(lista.body.total);
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run server/tests/conversations-awaiting-us.test.ts`
Expected: FAIL — o filtro não existe, `awaitingUsMinutes` é `undefined`.

- [ ] **Step 3: Trocar o filtro no service**

Em `server/services/conversationsService.ts`:

Adicionar os imports no topo:

```ts
import { awaitingUsSql } from '../lib/pendingReply';
import { businessConfigFromSettings, businessMinutesBetween } from '../lib/businessHours';
import { getOrgSettings } from './orgSettingsService';
```

**Remover** a função `isExpired24h` (linhas ~63-66) inteira.

**Substituir** o bloco `if (input.expired24h) { … }` (linhas ~83-87) por:

```ts
  if (input.awaitingUs) conds.push(awaitingUsSql());
```

- [ ] **Step 4: Calcular o tempo no payload**

Ainda em `listConversations`, antes do `.map()` que monta `items`, carregar a
config uma vez (não uma por linha):

```ts
  const settings = await getOrgSettings();
  const businessCfg = businessConfigFromSettings(settings);
  const agora = new Date();
```

No objeto de cada item, **substituir** a linha `isExpired24h: …` por:

```ts
      awaitingUsMinutes: awaitingUsMinutesFor(r.conv, businessCfg, agora),
```

E adicionar o helper logo abaixo de `previewFromMessage` (onde estava
`isExpired24h`):

```ts
/**
 * Minutos comerciais que o cliente esta esperando por nos, ou null se a bola
 * nao esta conosco. Espelha awaitingUsSql em memoria — as duas precisam
 * concordar, entao qualquer mudanca na regra passa pelos dois.
 */
function awaitingUsMinutesFor(
  conv: { status: string; lastInboundAt: Date | null; lastMessageAt: Date; queue: string; aiDisabled: boolean },
  cfg: BusinessHoursConfig,
  now: Date,
): number | null {
  if (conv.status === 'encerrada') return null;
  if (!conv.lastInboundAt) return null;
  if (conv.lastMessageAt > conv.lastInboundAt) return null;
  if (conv.queue !== 'comercial' && !conv.aiDisabled) return null;
  return businessMinutesBetween(conv.lastInboundAt, now, cfg);
}
```

Adicionar `BusinessHoursConfig` ao import de `../lib/businessHours`.

- [ ] **Step 5: Ordenação mais-antigo-primeiro com o filtro ativo**

No `.orderBy(...)` de `listConversations`, trocar a expressão atual por:

```ts
    .orderBy(
      input.awaitingUs
        // Fila de trabalho: quem espera há mais tempo vem primeiro.
        ? sql`${conversations.lastInboundAt} ASC`
        : input.queue === 'comercial'
          ? sql`${conversations.enteredQueueAt} ASC NULLS LAST`
          : desc(conversations.lastMessageAt),
    )
```

- [ ] **Step 6: Contador**

Em `getConversationCounts`, antes do `return counts`, adicionar:

```ts
  const [{ awaiting }] = await db
    .select({ awaiting: sql<number>`count(*)::int` })
    .from(conversations)
    .where(sql`${awaitingUsSql()} ${lineFilter}`);
```

E incluir no objeto retornado:

```ts
  const counts: ConversationCounts = {
    ia: 0, recepcao: 0, comercial: 0, unread: unread ?? 0, awaitingUs: awaiting ?? 0,
  };
```

- [ ] **Step 7: Query param no controller**

Em `server/controllers/conversationsController.ts`, no schema de query da
listagem, **substituir** `expired24h` por:

```ts
  awaitingUs: z.coerce.boolean().optional(),
```

e repassar `awaitingUs` para `listConversations` no lugar de `expired24h`.

- [ ] **Step 8: Rodar pra confirmar que passa**

`server/tests/conversations-list.test.ts:97` tem o caso `filtra por expired24h`,
que chama `?expired24h=true` na linha 113. **Reescreva o caso inteiro** para a
semântica nova — não basta renomear o parâmetro, porque a regra mudou: agora a
conversa só entra se a última mensagem for do cliente. Garanta que o cenário
tenha `lastMessageAt` igual a `lastInboundAt` na conversa que deve aparecer, e
uma segunda conversa com `lastMessageAt` posterior que **não** deve aparecer.

Run: `npx vitest run server/tests/conversations-awaiting-us.test.ts server/tests/conversations-list.test.ts`
Expected: PASS nos dois.

- [ ] **Step 9: Commit**

```bash
git add server/services/conversationsService.ts server/controllers/conversationsController.ts server/tests/conversations-awaiting-us.test.ts server/tests/conversations-list.test.ts
git commit -m "feat(inbox): filtro, contador e tempo de espera por resposta"
```

---

### Task 5: A vigilância no watchdog

**Files:**
- Create: `server/services/pendingReplyWatch.ts`
- Modify: `server/services/slaWatchdog.ts`
- Test: `server/tests/pending-reply-watch.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/pending-reply-watch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('../services/notifications', () => ({
  emitNotification: vi.fn(async () => {}),
}));

import { emitNotification } from '../services/notifications';
import { processPendingReplies } from '../services/pendingReplyWatch';
import { db } from '../db/client';
import { conversationReplyAlerts, conversations } from '../db/schema';
import { createUser, createLead, createConversation } from './helpers';

beforeEach(() => {
  vi.mocked(emitNotification).mockClear();
});

let seq = 0;

/**
 * Cria conversa com a bola do nosso lado há `minutosAtras` de tempo CORRIDO.
 * Os testes usam horários dentro do expediente pra que corrido == comercial.
 */
async function pendente(opts: { minutosAtras: number; comDono?: boolean }) {
  seq += 1;
  const phone = `5511960${String(100000 + seq).slice(-6)}`;
  const dono = opts.comDono === false ? null : await createUser({ email: `dono-${seq}@x.com`, role: 'comercial' });
  const lead = await createLead({ phone });
  const ts = new Date(Date.now() - opts.minutosAtras * 60_000);
  const conv = await createConversation({
    phone,
    leadId: lead.id,
    queue: 'comercial',
    status: 'em_atendimento',
    assignedTo: dono?.id ?? null,
    lastInboundAt: ts,
    lastMessageAt: ts,
  });
  return { conv, dono };
}

async function alertas(convId: string) {
  return db.select().from(conversationReplyAlerts)
    .where(eq(conversationReplyAlerts.conversationId, convId));
}

describe('processPendingReplies', () => {
  it('não alerta antes do prazo', async () => {
    const { conv } = await pendente({ minutosAtras: 10 });
    await processPendingReplies();
    expect(await alertas(conv.id)).toHaveLength(0);
  });

  it('alerta o DONO da conversa ao cruzar o prazo', async () => {
    const { conv, dono } = await pendente({ minutosAtras: 90 });

    await processPendingReplies();

    const rows = await alertas(conv.id);
    expect(rows.map((r) => r.level)).toContain(1);
    const chamada = vi.mocked(emitNotification).mock.calls
      .map((c) => c[0])
      .find((a) => a.kind === 'pending_reply');
    expect(chamada?.userIds).toEqual([dono!.id]);
  });

  it('conversa sem dono alerta todos da fila Comercial', async () => {
    const { conv } = await pendente({ minutosAtras: 90, comDono: false });

    await processPendingReplies();

    const chamada = vi.mocked(emitNotification).mock.calls
      .map((c) => c[0])
      .find((a) => a.metadata?.conversationId === conv.id);
    expect(chamada?.toRoles).toEqual(['comercial']);
    expect(chamada?.userIds ?? []).toEqual([]);
  });

  it('escala pro admin no segundo prazo, sem repetir o nível 1', async () => {
    const { conv } = await pendente({ minutosAtras: 240 });

    await processPendingReplies();

    const rows = await alertas(conv.id);
    expect(rows.map((r) => r.level).sort()).toEqual([1, 2]);
    const escalada = vi.mocked(emitNotification).mock.calls
      .map((c) => c[0])
      .find((a) => a.metadata?.level === 2);
    expect(escalada?.toRoles).toEqual(['admin']);
  });

  it('dois ticks seguidos não duplicam alerta', async () => {
    const { conv } = await pendente({ minutosAtras: 90 });

    await processPendingReplies();
    const depoisDoPrimeiro = vi.mocked(emitNotification).mock.calls.length;
    await processPendingReplies();

    expect(vi.mocked(emitNotification).mock.calls.length).toBe(depoisDoPrimeiro);
    expect(await alertas(conv.id)).toHaveLength(1);
  });

  it('mensagem NOVA do cliente abre um ciclo e volta a alertar', async () => {
    // O caso que a coluna pending_since existe pra cobrir. Sem ela a conversa
    // alertaria uma vez na vida e o sistema pararia de avisar justamente nas
    // conversas mais ativas.
    const { conv } = await pendente({ minutosAtras: 90 });
    await processPendingReplies();

    // Respondemos e o cliente escreveu de novo, 90 min atrás.
    const novoInbound = new Date(Date.now() - 90 * 60_000);
    await db.update(conversations)
      .set({ lastInboundAt: novoInbound, lastMessageAt: novoInbound })
      .where(eq(conversations.id, conv.id));

    await processPendingReplies();

    const rows = await alertas(conv.id);
    expect(rows.filter((r) => r.level === 1)).toHaveLength(2);
  });

  it('não alerta conversa que já respondemos', async () => {
    const { conv } = await pendente({ minutosAtras: 90 });
    await db.update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, conv.id));

    await processPendingReplies();

    expect(await alertas(conv.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run server/tests/pending-reply-watch.test.ts`
Expected: FAIL — `Cannot find module '../services/pendingReplyWatch'`.

- [ ] **Step 3: Implementar**

Criar `server/services/pendingReplyWatch.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { conversationReplyAlerts, conversations, leads } from '../db/schema';
import { awaitingUsSql } from '../lib/pendingReply';
import { businessConfigFromSettings, businessMinutesBetween } from '../lib/businessHours';
import { getOrgSettings } from './orgSettingsService';
import { emitNotification } from './notifications';

/**
 * Vigia conversa em que o cliente esta esperando resposta NOSSA.
 *
 * Diferente do processEscalations do slaWatchdog, que so olha lead que ninguem
 * ASSUMIU: aqui a conversa ja tem dono e ja esta em atendimento — era o buraco
 * por onde passavam quase todas as pendencias reais.
 *
 * Idempotencia por CICLO: a chave e (conversa, last_inbound_at, nivel). Estar
 * devendo resposta e recorrente, entao amarrar o alerta so a (conversa, nivel)
 * faria cada conversa avisar uma unica vez na vida.
 */
export async function processPendingReplies(): Promise<{ l1: number; l2: number }> {
  const settings = await getOrgSettings();
  const cfg = businessConfigFromSettings(settings);
  const alertMin = settings.pendingReplyAlertMin;
  const escalateMin = settings.pendingReplyEscalateMin;
  const agora = new Date();

  const candidatas = await db
    .select({
      id: conversations.id,
      leadId: conversations.leadId,
      phone: conversations.phone,
      assignedTo: conversations.assignedTo,
      lastInboundAt: conversations.lastInboundAt,
      leadName: leads.name,
    })
    .from(conversations)
    .leftJoin(leads, eq(conversations.leadId, leads.id))
    .where(awaitingUsSql());

  let l1 = 0;
  let l2 = 0;

  for (const c of candidatas) {
    if (!c.lastInboundAt) continue;
    const esperaMin = businessMinutesBetween(c.lastInboundAt, agora, cfg);

    const jaDisparados = await db
      .select({ level: conversationReplyAlerts.level })
      .from(conversationReplyAlerts)
      .where(and(
        eq(conversationReplyAlerts.conversationId, c.id),
        eq(conversationReplyAlerts.pendingSince, c.lastInboundAt),
      ));
    const niveis = new Set(jaDisparados.map((r) => r.level));

    const meta = {
      nome: c.leadName ?? c.phone,
      conversationId: c.id,
      leadId: c.leadId,
      esperaMin,
    };

    if (esperaMin >= escalateMin && !niveis.has(2)) {
      if (await registrar(c.id, c.lastInboundAt, 2)) {
        await notificar(2, meta);
        l2 += 1;
      }
    }
    if (esperaMin >= alertMin && !niveis.has(1)) {
      if (await registrar(c.id, c.lastInboundAt, 1)) {
        await notificar(1, meta, c.assignedTo);
        l1 += 1;
      }
    }
  }

  return { l1, l2 };
}

/** Grava o alerta do ciclo. false = ja existia (outro tick ganhou a corrida). */
async function registrar(
  conversationId: string, pendingSince: Date, level: number,
): Promise<boolean> {
  try {
    const inserted = await db
      .insert(conversationReplyAlerts)
      .values({ conversationId, pendingSince, level })
      .onConflictDoNothing({
        target: [
          conversationReplyAlerts.conversationId,
          conversationReplyAlerts.pendingSince,
          conversationReplyAlerts.level,
        ],
      })
      .returning({ id: conversationReplyAlerts.id });
    return inserted.length > 0;
  } catch (err) {
    console.warn(`[pending-reply] falhou ao registrar nivel ${level}:`, err);
    return false;
  }
}

interface Meta {
  nome: string;
  conversationId: string;
  leadId: string;
  esperaMin: number;
}

function inboxUrlFor(leadId: string): string {
  return `/whatsapp?queue=comercial&statusChips=aguardando,em_atendimento&assignment=all&origin=organic,campaign&lead=${leadId}`;
}

function formatarEspera(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

async function notificar(level: 1 | 2, m: Meta, assignedTo?: string | null): Promise<void> {
  const espera = formatarEspera(m.esperaMin);

  if (level === 1) {
    // Dono primeiro. Sem dono, a fila inteira — decisao do brainstorming: e
    // melhor todo mundo ver do que a pendencia ficar orfa.
    const destino = assignedTo
      ? { userIds: [assignedTo] }
      : { toRoles: ['comercial' as const] };
    await emitNotification({
      ...destino,
      kind: 'pending_reply',
      title: `Cliente esperando há ${espera}`,
      body: `${m.nome} mandou mensagem e ainda não teve resposta.`,
      actionUrl: inboxUrlFor(m.leadId),
      metadata: { conversationId: m.conversationId, level: 1, esperaMin: m.esperaMin },
    });
    return;
  }

  await emitNotification({
    toRoles: ['admin'],
    kind: 'pending_reply',
    title: `⚠️ ${m.nome} sem resposta há ${espera}`,
    body: 'Pendência de resposta passou do prazo de escalação.',
    actionUrl: inboxUrlFor(m.leadId),
    metadata: { conversationId: m.conversationId, level: 2, esperaMin: m.esperaMin },
  });
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run server/tests/pending-reply-watch.test.ts`
Expected: PASS — 7 testes.

- [ ] **Step 5: Ligar no tick do watchdog**

Em `server/services/slaWatchdog.ts`, dentro de `tick()`, **depois** do bloco que
chama `processEscalations()`, adicionar um segundo bloco protegido:

```ts
    // Vigilancia independente: conversa JA assumida sem resposta nossa. Try
    // separado de proposito — uma falha aqui nao pode derrubar o escalonamento
    // de fila, e vice-versa.
    try {
      const { processPendingReplies } = await import('./pendingReplyWatch');
      const p = await processPendingReplies();
      if (p.l1 + p.l2 > 0) {
        console.log(`[pending-reply] tick: l1=${p.l1} l2=${p.l2}`);
      }
    } catch (err) {
      console.error('[pending-reply] tick failed:', err instanceof Error ? err.message : err);
    }
```

Atenção: o `try` existente envolve `processEscalations()` e tem `finally` que
solta `isProcessing`. Coloque o bloco novo **dentro** do mesmo `try/finally`
externo, após o `if (r.fired > 0) {...}`, para que `isProcessing` continue sendo
liberado corretamente.

- [ ] **Step 6: Rodar o teste da vigilância nova**

Run: `npx vitest run server/tests/pending-reply-watch.test.ts`
Expected: PASS — 7 testes.

Não existe suíte para o `slaWatchdog` no projeto (`processEscalations` nunca foi
coberto). Por isso o passo anterior é explícito em não tocar naquela função: sem
teste, qualquer alteração ali passaria despercebida.

- [ ] **Step 7: Commit**

```bash
git add server/services/pendingReplyWatch.ts server/services/slaWatchdog.ts server/tests/pending-reply-watch.test.ts
git commit -m "feat(inbox): watchdog alerta conversa sem resposta nossa"
```

---

### Task 6: Dashboard alinhado ao predicado

**Files:**
- Modify: `server/services/dashboardService.ts`
- Test: `server/tests/dashboard-attention.test.ts`

- [ ] **Step 1: Ajustar o teste existente**

Em `server/tests/dashboard-attention.test.ts`, localizar o caso que cobre
`conv_expired` e reescrevê-lo para o comportamento novo:

```ts
  it('conta conversa aguardando resposta nossa, não conversa antiga já respondida', async () => {
    // A regra virou "a bola está com a gente". Conversa cujo último inbound é
    // velho MAS que já respondemos não é problema de ninguém.
    const lead = await createLead({ phone: '5511970000001' });
    await createConversation({
      phone: '5511970000001', leadId: lead.id, queue: 'comercial',
      status: 'em_atendimento',
      lastInboundAt: new Date('2026-08-01T12:00:00Z'),
      lastMessageAt: new Date('2026-08-01T13:00:00Z'),   // respondida
    });
    const lead2 = await createLead({ phone: '5511970000002' });
    await createConversation({
      phone: '5511970000002', leadId: lead2.id, queue: 'comercial',
      status: 'em_atendimento',
      lastInboundAt: new Date('2026-08-01T12:00:00Z'),
      lastMessageAt: new Date('2026-08-01T12:00:00Z'),   // esperando
    });

    const res = await attention({ view: 'org' });
    const item = res.items.find((i) => i.kind === 'pending_reply');

    expect(item?.count).toBe(1);
  });
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run server/tests/dashboard-attention.test.ts`
Expected: FAIL — não existe item `pending_reply`.

- [ ] **Step 3: Implementar**

Em `server/services/dashboardService.ts`:

Adicionar o import:

```ts
import { awaitingUsSql } from '../lib/pendingReply';
```

**Substituir** a função `countConvExpired` inteira por:

```ts
/**
 * Conversas em que a bola esta com a gente. Usa o MESMO predicado do filtro da
 * Inbox — antes o card e o chip tinham definicoes diferentes e mostravam
 * numeros que nao batiam (23 no chip, 1 real).
 */
async function countAwaitingUs(ownerUserId: string | null): Promise<number> {
  const base = awaitingUsSql();
  const where = ownerUserId ? and(base, eq(conversations.assignedTo, ownerUserId)) : base;
  const [r] = await db.select({ cnt: sql<number>`count(*)::int` }).from(conversations).where(where);
  return r.cnt;
}
```

Em `attention()`, trocar a chamada e o item correspondente:

```ts
  const [proposalOld, dealStale, awaitingUs, queuePending] = await Promise.all([
    countProposalOld(owner),
    countDealStale(owner),
    countAwaitingUs(owner),
    countQueuePending(owner),
  ]);
```

```ts
    { severity: 'critical' as const, kind: 'pending_reply', count: awaitingUs, route: '/whatsapp', filter: { ...meFilter, awaitingUs: true } },
```

Em `whatsappStats()`, localizar o cálculo que alimenta `expired24h` e substituir
por uma chamada a `countAwaitingUs(null)`, renomeando a chave do objeto
retornado:

```ts
  const awaitingUs = await countAwaitingUs(null);
```

```ts
    awaitingUs,     // era: expired24h
```

Em `shared/types.ts`, na união `DashboardAttentionKind` (linha ~941),
**substituir** `'conv_expired'` por `'pending_reply'`:

```ts
export type DashboardAttentionKind =
  | 'proposal_old'
  | 'pending_reply'
  | 'deal_stale'
  | 'queue_pending';
```

- [ ] **Step 3b: Ajustar o teste de whatsappStats**

`server/tests/dashboard-whatsapp.test.ts:25` tem o caso
`expired24h matches attention.conv_expired logic` e checa `r.expired24h` na
linha 34. Renomear o caso e a asserção para `awaitingUs`. O cenário do teste já
usa a lógica correta (sem outbound depois do inbound), então **só o nome do
campo muda** — mas confirme que o limiar de 24h não está embutido no setup; se
estiver, remova-o, porque a regra nova não tem limiar de tempo.

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run server/tests/dashboard-attention.test.ts server/tests/dashboard-whatsapp.test.ts server/tests/dashboard-summary-org.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/dashboardService.ts shared/types.ts server/tests/dashboard-attention.test.ts server/tests/dashboard-whatsapp.test.ts
git commit -m "feat(dashboard): card usa o mesmo predicado do filtro da Inbox"
```

---

### Task 7: Configuração dos limiares

**Files:**
- Modify: `server/controllers/orgSettingsController.ts`
- Modify: `server/services/orgSettingsService.ts`
- Modify: `src/pages/settings/AiTab.tsx`
- Test: `server/tests/org-settings.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Em `server/tests/org-settings.test.ts`, adicionar:

```ts
  it('aceita e persiste os limiares de pendência de resposta', async () => {
    const token = await loginAdmin();

    const res = await request(app)
      .put('/api/org-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ pendingReplyAlertMin: 45, pendingReplyEscalateMin: 120 });

    expect(res.status).toBe(200);
    expect(res.body.pendingReplyAlertMin).toBe(45);
    expect(res.body.pendingReplyEscalateMin).toBe(120);
  });

  it('rejeita limiar não positivo', async () => {
    const token = await loginAdmin();

    const res = await request(app)
      .put('/api/org-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ pendingReplyAlertMin: 0 });

    expect(res.status).toBe(400);
  });
```

(Se `loginAdmin` não existir nesse arquivo, copiar o helper de login já usado
pelos outros casos do mesmo arquivo.)

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run server/tests/org-settings.test.ts`
Expected: FAIL — campos não reconhecidos / não persistidos.

- [ ] **Step 3: Implementar**

Em `server/controllers/orgSettingsController.ts`, adicionar ao schema Zod:

```ts
  pendingReplyAlertMin: z.number().int().positive().max(1440).optional(),
  pendingReplyEscalateMin: z.number().int().positive().max(1440).optional(),
```

Em `server/services/orgSettingsService.ts`, incluir os dois campos no `patch` de
`updateOrgSettings` e no objeto devolvido por `getOrgSettings`/`toPublic`,
seguindo exatamente o padrão de `aiAutoReplyWindowSeconds`.

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run server/tests/org-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Expor na tela de Configurações**

Em `src/pages/settings/AiTab.tsx`, na mesma seção onde
`aiAutoReplyWindowSeconds` é editado, adicionar dois inputs numéricos:

- "Alertar quando o cliente esperar (minutos)" → `pendingReplyAlertMin`
- "Escalar para o gestor após (minutos)" → `pendingReplyEscalateMin`

Com o texto de apoio: *"Conta apenas horário comercial, configurado acima."*

- [ ] **Step 6: Commit**

```bash
git add server/controllers/orgSettingsController.ts server/services/orgSettingsService.ts server/tests/org-settings.test.ts src/
git commit -m "feat(settings): limiares de pendência de resposta"
```

---

### Task 8: UI — chip, badge e alerta

**Files:**
- Modify: `src/features/whatsapp/api.ts:24` — query string do filtro
- Modify: `src/features/whatsapp/FilterBar.tsx`
- Modify: `src/pages/whatsapp/WhatsappPage.tsx`
- Modify: `src/features/whatsapp/ConversationList.tsx`
- Modify: `src/features/notifications/NewMessageAlerts.tsx`
- Modify: `src/pages/dashboard/components/StatusRibbon.tsx:245` — tradução do filtro
- Modify: `src/pages/dashboard/components/OperationsHero.tsx:170,205`
- Modify: `src/pages/dashboard/components/WhatsappStats.tsx:48`

- [ ] **Step 0: Trocar o parâmetro na query string**

Em `src/features/whatsapp/api.ts`, linha 24, **substituir**:

```ts
  if (filters.expired24h) u.set('expired24h', 'true');
```

por:

```ts
  if (filters.awaitingUs) u.set('awaitingUs', 'true');
```

- [ ] **Step 1: Trocar o chip**

Em `src/features/whatsapp/FilterBar.tsx`:

Em `STATUS_OPTIONS`, **substituir** a entrada `expirada` por:

```ts
  { key: 'aguardando_nos', label: 'Aguardando nós' },
```

Em `statusChipsToFilters`, **substituir** a linha do `expired24h`:

```ts
  if (keys.includes('aguardando_nos')) result.awaitingUs = true;
```

E atualizar a assinatura de retorno da função, trocando `expired24h?: boolean`
por `awaitingUs?: boolean` nos dois lugares (tipo declarado e objeto `result`).

- [ ] **Step 2: Mostrar o contador no chip**

Em `FilterBar.tsx`, adicionar à interface `Props`:

```ts
  awaitingUsCount?: number;
```

E no `map` de `STATUS_OPTIONS`, renderizar o número quando houver:

```tsx
          <Chip
            key={s.key}
            active={props.statusKeys.includes(s.key)}
            onClick={() => props.onStatusToggle(s.key)}
          >
            {s.key === 'aguardando_nos' && props.awaitingUsCount
              ? `${s.label} (${props.awaitingUsCount})`
              : s.label}
          </Chip>
```

Em `src/pages/whatsapp/WhatsappPage.tsx`, passar o contador (o hook
`useConversationCounts` já é usado no `Sidebar`; importe-o aqui do mesmo módulo):

```tsx
        awaitingUsCount={counts?.awaitingUs}
```

- [ ] **Step 3: Badge de tempo na lista**

Em `src/features/whatsapp/ConversationList.tsx`, no bloco de cada conversa,
adicionar o indicador quando `awaitingUsMinutes` não for nulo:

```tsx
{c.awaitingUsMinutes != null && (
  <span
    className={
      c.awaitingUsMinutes >= 180
        ? 'text-[10px] font-medium text-destructive'
        : c.awaitingUsMinutes >= 60
          ? 'text-[10px] font-medium text-amber-600'
          : 'text-[10px] text-muted-foreground'
    }
  >
    {c.awaitingUsMinutes < 60
      ? `${c.awaitingUsMinutes} min esperando`
      : `${Math.floor(c.awaitingUsMinutes / 60)}h${String(c.awaitingUsMinutes % 60).padStart(2, '0')} esperando`}
  </span>
)}
```

Se o arquivo ainda referenciar `isExpired24h`, remover essa referência — o campo
não existe mais.

- [ ] **Step 4: Aceitar o kind novo no alerta**

Em `src/features/notifications/NewMessageAlerts.tsx`, na linha que filtra:

```ts
    const msgs = (data?.items ?? []).filter((n) => n.kind === 'new_message');
```

**substituir** por:

```ts
    // 'pending_reply' entra aqui pra reaproveitar som + toast + pop-up nativo
    // do navegador, que já existem e já pedem permissão.
    const msgs = (data?.items ?? []).filter(
      (n) => n.kind === 'new_message' || n.kind === 'pending_reply',
    );
```

- [ ] **Step 4b: Corrigir os três consumidores do Dashboard**

Estes quebram no typecheck porque `DashboardWhatsappStats.expired24h` virou
`awaitingUs` e o kind mudou. São mudanças pequenas mas fáceis de esquecer:

Em `src/pages/dashboard/components/StatusRibbon.tsx`, linha ~245, a função que
traduz o `filter` vindo do backend em chips da Inbox:

```ts
    if (k === 'awaitingUs' && v) statusChips.push('aguardando_nos');
```

E atualizar o comentário de documentação logo acima (linhas ~219-224), que cita
`expired24h` → `expirada`.

Em `src/pages/dashboard/components/OperationsHero.tsx`, linha ~170:

```ts
  const awaitingUs = whatsapp?.awaitingUs ?? 0;
```

e nas linhas ~205-206, trocar `value={expired24h}` por `value={awaitingUs}` e a
condição de `tone` por `awaitingUs === 0 ? 'muted' : 'destructive'`. Ajustar o
rótulo do cartão para "Aguardando nós".

Em `src/pages/dashboard/components/WhatsappStats.tsx`, linha ~48:

```tsx
        <Stat label="Aguardando nós" value={String(data.awaitingUs)} />
```

- [ ] **Step 5: Verificar compilação e suíte**

Run: `npx tsc --noEmit`
Expected: sem saída. Se sobrar erro de `expired24h`/`isExpired24h`, é consumidor
esquecido — corrigir.

Run: `npx vitest run`
Expected: toda a suíte verde.

Run: `npm run build`
Expected: build conclui.

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "feat(inbox): chip 'Aguardando nós', tempo de espera e alerta"
```

---

## Verificação final

- [ ] `npx vitest run` — suíte inteira verde
- [ ] `npx tsc --noEmit` — sem erros
- [ ] `npm run build` — sem erros
- [ ] Conferir manualmente: abrir a Inbox, marcar "Aguardando nós", confirmar que
      a lista traz apenas conversas cuja última mensagem é do cliente, ordenadas
      da mais antiga para a mais recente, com o tempo de espera visível.
- [ ] Conferir que o número do chip bate com o número do card no Dashboard.
- [ ] Mudar `pendingReplyAlertMin` para 1 em Configurações, esperar o tick do
      watchdog (60s) e confirmar que a notificação chega ao dono da conversa.
      **Devolver o valor para 60 depois do teste.**

## Notas de deploy

- Migration 043 roda com `npm run migrate`.
- Nenhuma variável de ambiente nova.
- O watchdog começa a valer da subida em diante: conversas já paradas aparecem no
  filtro imediatamente, mas só geram notificação quando cruzarem um limiar
  **depois** do deploy — para as que já estão estouradas, o primeiro tick dispara
  o alerta de uma vez. Se isso for indesejado no dia da subida, subir com
  `pendingReplyAlertMin` alto e baixar depois.
