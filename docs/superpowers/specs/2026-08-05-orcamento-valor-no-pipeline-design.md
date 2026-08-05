# Orçamento em print → valor no card do pipeline

- **Data:** 2026-08-05
- **Status:** Aprovado (brainstorming)
- **Área:** Inbox (painel do lead) → Pipeline / Inside Sales

## Contexto (estado atual)

O time comercial monta o orçamento num **ERP externo, sem API nem acesso ao banco**, e
manda pro cliente como **print (imagem)** pela Inbox. O valor total fica só nos pixels.

`deals.proposalValue` (`numeric(12,2)`, `server/db/schema.ts:174`) já existe, mas só é
preenchido em três lugares, todos fora da conversa:

- `src/features/inside-sales/AddDealDialog.tsx` — ao criar deal manualmente;
- `src/features/inside-sales/DealDrawer.tsx` — edição manual do card no Kanban;
- `GanhoValueDialog` via `LeadSidebar.confirmGanho()` — só ao marcar **ganho**.

No painel do lead da Inbox (`src/features/whatsapp/LeadSidebar.tsx`) existe **apenas** o
seletor de etapa e o link "Abrir no pipeline →". **Não há caminho nenhum pra registrar
valor a partir da conversa** — que é exatamente onde o vendedor está quando manda o
orçamento.

Resultado medido em produção (2026-08-05):

| Etapa | Deals | Com valor |
|---|---|---|
| `lead_no_comercial` | 21 | 2 |
| `proposta_enviada` | 10 | **0** |
| `em_negociacao` | 4 | 1 |
| `perdido` | 25 | **0** |
| `ganho` | 1 | 1 |

A etapa que existe pra guardar proposta não tem valor em nenhum deal. O pipeline não tem
previsão de receita, e os 25 perdidos não registram quanto se deixou na mesa. Há **17
imagens outbound** em conversas de deals abertos — o fluxo de mandar orçamento por print
é recorrente.

Restrições técnicas relevantes:

- **`server/services/geminiClient.ts` é text-only.** `generateReplyDetailed` monta
  `contents` como `parts: [{ text }]` (linhas 64-67). Não há suporte a imagem.
- A imagem outbound é gravada em disco por `uploadMediaHandler`
  (`server/controllers/conversationsController.ts:272-285`) em
  `/uploads/conversations/<filename>` antes do envio — os bytes estão disponíveis no
  momento da detecção, então a feature **não depende** do volume persistente do
  `/app/uploads` estar resolvido.

## Objetivo

Fazer o valor do orçamento chegar ao card do pipeline com o mínimo de atrito, sem que
número lido por IA entre na previsão de receita sem revisão humana.

## Decisões (do brainstorming)

1. **Integração com o ERP está fora** — é fechado. Ler a imagem é o único caminho automático.
2. **IA sugere, vendedor confirma.** Nenhum valor é gravado automaticamente.
3. **Card fixo no painel do lead**, não toast nem faixa inline — precisa sobreviver à
   correria e não depender de o vendedor estar olhando na hora do envio.
4. **Etapa vem junto no mesmo card**, com o **valor editável antes de confirmar**. Sem a
   edição, uma leitura errada obrigaria a rejeitar valor e etapa juntos.
5. **Campo de valor manual** no painel, sempre visível, independente da IA.

### Fora de escopo (decidido explicitamente)

- Reprocessar as 17 imagens antigas — orçamento de semanas atrás provavelmente já mudou de valor.
- Detectar orçamento em **PDF**. Hoje o time manda print; se mudar, amplia depois.
- Ler imagem **inbound** (orçamento de concorrente não é nosso número).

## Arquitetura

### 1. Detecção (backend, background)

Gatilho: **toda imagem outbound persistida** numa conversa. Fire-and-forget, no mesmo
molde do `processInboundWithAi` já usado no webhook — nunca trava nem falha o envio.

Nova função em `geminiClient.ts` usando `inlineData` (o SDK `@google/genai` já suporta;
falta só a função). Retorna JSON estruturado:

```json
{ "ehOrcamento": true, "total": 3443.04, "rotulo": "Valor total" }
```

O campo `rotulo` é a defesa contra o erro mais provável — pegar o preço de um item
(R$ 1.821,87 na amostra) em vez do total. A detecção só é aceita se o rótulo normalizado
(minúsculo, sem acento) contiver `total` **e não** contiver `item`, `unit`, `negociado`
nem `parcela` — isso aceita "Valor total"/"Total geral" e rejeita a coluna "Preço Total"
da linha de produto, que é a armadilha real do layout da amostra. Se `ehOrcamento` for
`false` (foto de produto, print de conversa), **não gera card** e não deixa rastro visível.

### 2. Persistência

Migration **042**, tabela nova `budget_detections`:

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `message_id` | uuid FK → messages | qual imagem originou |
| `lead_id` | uuid FK → leads | |
| `detected_value` | numeric(12,2) | o que a IA leu |
| `status` | text enum | `pending` / `confirmed` / `dismissed` |
| `confirmed_value` | numeric(12,2) null | o que o vendedor confirmou (pode diferir) |
| `resolved_by` / `resolved_at` | uuid FK users / timestamptz | auditoria |
| `created_at` | timestamptz | |

**Por que tabela e não colunas em `deals`:** a detecção pode acontecer antes de o deal
existir, e guardar por mensagem dá o rastro de qual imagem gerou qual valor — necessário
pra responder "por que esse card está R$ 3.443?".

Índice parcial por `lead_id` onde `status = 'pending'` pra a consulta do painel ser barata.

### 3. UI — card no painel do lead

Em `LeadSidebar.tsx`, abaixo do seletor de etapa, quando houver detecção `pending`:

```
Orçamento detectado
Valor:  [ R$ 3.443,04 ]   ← input editável
Etapa:  Proposta enviada
[ Confirmar ]  ·  Dispensar
```

- **Confirmar** grava `proposalValue` (o valor do input, não necessariamente o detectado)
  e move a etapa. Se o lead não tem deal **ativo**, **cria** — mesmo comportamento que
  `handleSelect()` já tem hoje. Atenção: lead com deal só em `ganho`/`perdido` conta como
  sem deal ativo (índice parcial `uidx_deals_one_active_per_lead`), então cai no caminho
  de criação — que é o comportamento certo pra recompra.
- **Dispensar** marca `status='dismissed'` e o card some.
- Só a detecção **mais recente** pendente por lead é exibida. Detecção nova substitui a
  anterior (marca a antiga como `dismissed`) — orçamento revisado é o que vale.

**A sugestão de etapa não anda pra trás.** A linha "Etapa" só aparece quando o deal está
antes de `proposta_enviada` (ou não existe). Deal já em `em_negociacao` recebe card só com
valor — mandar um orçamento revisado durante a negociação não pode rebaixar o funil.

### 4. UI — campo manual

Campo de valor editável fixo no painel, sempre visível, no mesmo padrão de save do
`DealDrawer` (salva no blur/botão quando difere do atual). Reaproveita a mutation
`patch` que o `LeadSidebar` já importa. Resolve o buraco atual mesmo sem IA e cobre o
caso de orçamento mandado por fora do sistema.

### 5. Permissão

Reaproveita o RBAC de deals existente. Quem não pode editar deal não vê o card nem o
campo.

## Fluxo de dados

```
vendedor manda print
  → uploadMediaHandler grava /uploads/conversations/x.jpg
  → mensagem outbound persistida
  → [background] lê bytes → geminiClient.extractBudget(image)
       ├─ ehOrcamento=false ou rótulo suspeito → descarta, fim
       └─ ok → insert budget_detections (status=pending)
  → painel do lead mostra card
  → vendedor Confirmar → deals.proposalValue + stage  (cria deal se não existir)
              Dispensar → status=dismissed
```

## Erros e degradação

- Falha do Gemini (rate limit, key, safety): loga e segue. Sem card. **Nunca** afeta o
  envio da mensagem, que já aconteceu.
- Imagem ilegível / valor não encontrado: sem card, silencioso.
- Rótulo não reconhecido como total: descarta — prefere não sugerir a sugerir errado.
- Arquivo sumiu do disco antes da leitura: loga e segue.

## Testes

- `geminiClient.extractBudget`: mock do SDK — JSON válido, JSON malformado, `ehOrcamento=false`.
- Validação de rótulo: aceita "Valor total"/"Total"; rejeita "Preço Total" de linha de item.
- Detecção: imagem outbound gera linha `pending`; imagem **inbound** não gera; falha do
  Gemini não quebra o fluxo nem deixa linha órfã.
- Confirmar: grava valor e etapa; **cria deal** quando o lead não tem deal ativo
  (inclusive quando só existe deal `perdido` — recompra); usa o valor **editado** quando
  difere do detectado.
- Deal já em `em_negociacao`: card vem sem linha de etapa e confirmar não rebaixa o funil.
- Dispensar: card some, nada grava em `deals`.
- Detecção nova dispensa a pendente anterior.
- RBAC: usuário sem permissão de deal não recebe o card na resposta da API.
