# Cadastros — Design

**Sub-projeto 2 do roadmap.** CRUD de leads + importação CSV. Construído sobre a fundação de auth/RBAC já entregue.

## Objetivo

Centralizar a base de leads da Lubritec — cadastro manual + importação em massa via planilha. Sem dependência de WhatsApp ou pipeline de vendas (sub-projetos 3 e 4 consomem essa base depois).

## Decisões fixadas (brainstorming)

- **Escopo dos campos:** B (útil) — adiciona email, notes, status (frio/morno/quente), source (manual/csv/whatsapp).
- **Permissões:** A (igualitário) — admin, comercial e recepção: todos fazem CRUD.
- **Duplicatas no CSV:** C (upsert seletivo) — preenche apenas colunas `NULL`/vazias no banco, nunca sobrescreve.
- **Erros no CSV:** B (parcial) — importa o que dá, retorna relatório por linha rejeitada.
- **Listagem:** C — search livre + filtros (status, source) + ordenação clicável.
- **Paginação:** A — server-side, 50 por página.
- **Phone editável:** não. Mudar phone via UI = deletar + recriar.

## Schema

Migration `008_leads_extra.sql`:

```sql
ALTER TABLE leads
  ADD COLUMN email TEXT,
  ADD COLUMN notes TEXT,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'frio'
    CHECK (status IN ('frio', 'morno', 'quente')),
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'csv', 'whatsapp'));

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created_at ON leads(created_at);
```

`whatsapp` no enum `source` já fica preparado pro sub-projeto 4.

Drizzle schema (`server/db/schema.ts`) reflete isso. Constantes compartilhadas em `shared/types.ts`:

```ts
export const LEAD_STATUSES = ['frio', 'morno', 'quente'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ['manual', 'csv', 'whatsapp'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
```

Padrão idêntico ao `ROLES` introduzido no hardening recente.

## Endpoints

Todos atrás de `authGuard`. Sem `requireRole` — qualquer role autenticado acessa.

### `GET /api/leads`

Query params:

| Param | Tipo | Default |
|---|---|---|
| `q` | string | — (busca em `name`, `phone`, `vehicle_plate`) |
| `status` | `frio` \| `morno` \| `quente` | — |
| `source` | `manual` \| `csv` \| `whatsapp` | — |
| `sort` | `name` \| `created_at` \| `last_purchase_date` | `created_at` |
| `order` | `asc` \| `desc` | `desc` |
| `page` | int ≥ 1 | 1 |

Resposta:

```json
{
  "items": [{ /* PublicLead */ }],
  "total": 1234,
  "page": 1,
  "pageSize": 50
}
```

Page size é fixo em 50 (não configurável pelo cliente).

### `POST /api/leads`

Body:

```ts
{
  name: string;            // 2..120
  phone: string;           // dígitos (normalizado server-side), 8+
  email?: string | null;
  notes?: string | null;
  vehiclePlate?: string | null;   // ≤ 10
  vehicleModel?: string | null;   // ≤ 60
  lastPurchaseDate?: string | null; // ISO YYYY-MM-DD
  avgMileagePerDay?: number | null; // int ≥ 0
}
```

`status` defaulta `frio`, `source` defaulta `manual`. Não vêm no body.

Conflito de phone → 409 `Phone already in use`.

### `PATCH /api/leads/:id`

Aceita qualquer subconjunto dos campos do POST + `status`. **Não aceita `phone`** — retorna 400 `Phone cannot be edited`.

404 se id não existe.

### `DELETE /api/leads/:id`

Hard delete. 204 ok, 404 se não existe.

### `POST /api/leads/import`

Multipart com campo `file` (CSV).

Limites:
- Tamanho ≤ 5MB
- Mime: `text/csv` ou `application/vnd.ms-excel`

Processamento:
- UTF-8, delimitador `,` ou `;` (auto-detectado)
- Header obrigatório, case-insensitive, ordem livre
- Headers reconhecidos (aliases PT/EN):

| Coluna canônica | Aliases aceitos | Obrigatório |
|---|---|---|
| `name` | nome | sim |
| `phone` | telefone | sim |
| `email` | — | não |
| `notes` | observacoes, observações | não |
| `vehicle_plate` | placa | não |
| `vehicle_model` | modelo | não |
| `last_purchase_date` | ultima_compra, última_compra | não |
| `avg_mileage_per_day` | km_dia | não |

Colunas extras são ignoradas. Se faltar `name` ou `phone` no header → 400 antes de processar qualquer linha.

Resposta:

```json
{
  "inserted": 850,
  "updated": 120,
  "skipped": 0,
  "rejected": [
    { "line": 47, "reason": "phone vazio" },
    { "line": 102, "reason": "email inválido" }
  ]
}
```

### Por linha — regras

**Rejeitada (entra em `rejected[]`, processamento continua):**
- name vazio
- phone vazio ou sem dígitos após normalização
- email presente mas com formato inválido
- last_purchase_date com formato irreconhecível (não ISO nem `DD/MM/YYYY`)
- avg_mileage_per_day não numérico

**Aceita:**
- Phone novo → `INSERT` com `source='csv'`, `status='frio'`. Conta em `inserted`.
- Phone existente → upsert seletivo: só atualiza colunas onde o banco tem `NULL` (ou string vazia para campos texto). Conta em `updated`. **Status e source nunca mudam no upsert.**

**Fluxo do import (duas fases):**
1. **Validação** — todas as linhas são parseadas e validadas em memória. Linhas inválidas vão pra `rejected[]`. Nenhum SQL ainda.
2. **Persistência** — só linhas válidas entram numa única transação (insert ou upsert seletivo). Erro de infra (DB caiu, constraint inesperada) → rollback total dessa transação. Linhas rejeitadas na fase 1 não fazem nada na fase 2.

Essa separação evita o problema do Postgres "transação envenenada" — qualquer falha de SQL aborta tudo o que veio antes na mesma tx.

## Erros (códigos de domínio)

| Cenário | Status | `error` |
|---|---|---|
| Phone duplicado (POST) | 409 | `Phone already in use` |
| Lead não existe (PATCH/DELETE) | 404 | `Lead not found` |
| PATCH com `phone` | 400 | `Phone cannot be edited` |
| CSV sem header obrigatório | 400 | `Missing required column: <name>` |
| CSV > 5MB | 413 | `File too large` |
| Mime inválido | 400 | `Invalid file type` |

`translateError` no frontend mapeia tudo para PT-BR.

## Frontend

### Estrutura

```
src/features/leads/
  api.ts              -- TanStack Query hooks
  translateError.ts   -- mensagens PT-BR
  LeadsTable.tsx      -- tabela com sort + paginação
  LeadFilters.tsx     -- search + selects
  LeadDialog.tsx      -- create/edit (mesmo dialog em modos)
  LeadActions.tsx     -- ⋮ menu (editar / deletar)
  ImportCsvDialog.tsx -- upload + relatório pós-import
src/pages/cadastros/
  CadastrosPage.tsx   -- compõe tudo
```

### Hooks

- `useLeads(params)` — `queryKey: ['leads', params]`
- `useCreateLead()`, `useUpdateLead()`, `useDeleteLead()` — invalidam `['leads']`
- `useImportLeads()` — POST FormData, retorna relatório, invalida `['leads']`

### UX da tabela

- Colunas: Nome · Telefone · Status (badge) · Source (chip) · Última compra · Ações
- Vehicle plate/model fora da tabela no MVP — vão no dialog de edit/detalhe.
- Headers de Nome / Última compra / Created clicáveis pra ordenar (seta indica direção).
- Search com debounce 300ms (entra na queryKey já debounced — sem refetches a cada tecla).
- Filtros: 2 selects (`status`, `source`) com opção "Todos".
- Paginação: rodapé com `« 1 2 3 … » | total: 1.234 leads`.

### `LeadDialog`

- Modo create: nome*, phone*, email, vehicle_plate, vehicle_model, last_purchase_date, avg_mileage_per_day, notes.
- Modo edit: mesmos campos, **phone disabled** com texto explicativo. Adiciona seletor de status.
- Form com react-hook-form + zod resolver.

### `ImportCsvDialog`

- Drop zone + botão fallback. Aceita só `.csv`.
- Após upload: mostra `inserted: X · updated: Y · skipped: Z · rejected: W`.
- Se `rejected.length > 0`, lista as linhas em scroll (`linha N: motivo`). Botão "Baixar relatório" gera CSV no cliente com as rejeitadas.

### Confirmação de delete

`AlertDialog`: "Excluir {nome}? Essa ação não pode ser desfeita."

## Validação (Zod, backend)

`phone` é separado dos demais campos para garantir que `updateLeadSchema` nunca o aceite:

```ts
const phoneInput = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(z.string().min(8, 'Phone must have at least 8 digits'));

const leadEditableCore = {
  name: z.string().min(2).max(120),
  email: z.string().email().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  vehiclePlate: z.string().max(10).optional().nullable(),
  vehicleModel: z.string().max(60).optional().nullable(),
  lastPurchaseDate: z.string().date().optional().nullable(),
  avgMileagePerDay: z.number().int().nonnegative().optional().nullable(),
};

const createLeadSchema = z.object({ phone: phoneInput, ...leadEditableCore });

const updateLeadSchema = z
  .object({
    ...leadEditableCore,
    status: z.enum(LEAD_STATUSES).optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field required',
  });
```

`phone` literalmente não está no `updateLeadSchema`, então Zod já garante a regra com `.strict()` (configurado globalmente no app). Para mensagem clara, controller pré-checka:

```ts
if ('phone' in req.body) {
  return res.status(400).json({ error: 'Phone cannot be edited' });
}
```

A normalização de phone fica embutida no `phoneInput.transform(...)` — quando o handler recebe `parsed.phone`, já vem como dígitos, e o `.pipe(min(8))` valida o resultado pós-normalização.

## Normalização de phone

Mesma regra do `import-legacy-customers.ts`:

```ts
const normalizePhone = (raw: string) => raw.replace(/\D/g, '');
```

Aplicada em três pontos: `createLead`, `importLeads` (por linha), e nas ferramentas de seed/import futuras. **Nunca** no PATCH (phone não muda).

## Testes

**Backend, em `server/tests/`:**

`leads-service.test.ts` — unitário:
- `createLead`: phone normalizado, conflito 409, source default `manual`
- `updateLead`: 404, rejeita `phone` no patch, status edit OK, partial update preserva campos não enviados
- `deleteLead`: 204, 404
- `listLeads`: filtro `status`, filtro `source`, search por name/phone/plate, sort em cada coluna permitida, paginação (offset+limit), `total` correto
- `importLeads`: linhas válidas inseridas, dups com upsert seletivo, linhas inválidas em `rejected[]` com motivo, contadores corretos, transação preserva tudo mesmo com rejeitadas, headers PT-BR aceitos, header faltando aborta com 400

`leads-api.test.ts` — HTTP/integration:
- 401 sem token em todas as rotas (5 endpoints)
- POST/PATCH/DELETE/GET happy paths com Zod
- Import multipart: header faltando 400, mime inválido 400, file > 5MB 413
- Smoke test do import de ponta a ponta com fixture CSV pequena

**Total estimado: ~25 testes backend.**

**Frontend:** sem testes unitários no MVP (segue o padrão do admin já entregue). Tipagem + lint + smoke test manual cobrem.

## Não-objetivos

Coisas explicitamente **fora** desse sub-projeto:

- Pipeline kanban / mudança de status drag-and-drop (sub-projeto 3 — Inside Sales)
- Histórico de interações (sub-projeto 4 — WhatsApp)
- Audit trail / soft delete (escolha do brainstorming foi B, não C)
- Per-user lead assignment / ownership
- Bulk edit (selecionar várias linhas e mudar status em lote)
- Export CSV (só import, não o caminho inverso)
- Detalhe de lead em página própria — tudo fica no dialog de edit no MVP
