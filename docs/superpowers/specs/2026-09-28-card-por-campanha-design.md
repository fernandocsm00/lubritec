# Card por campanha no Inside Sales

- **Data:** 2026-09-28
- **Status:** Aprovado (brainstorming) — aguardando revisão do documento
- **Área:** Pipeline Inside Sales → IA (qualificação) → Campanhas (vigência) → Inbox → Relatórios

## Contexto (estado atual)

A campanha **Teste Andrei III** (25/09/2026) disparou para 3 leads que já existiam
na base: Samuel Ruzzarin, Diana Trez e Alexia Tonato da Rosa. A IA qualificou os
leads, mas nenhum card novo com a campanha apareceu no Kanban. Samuel e Diana
continuaram com os cards de maio, com o selo de campanhas antigas ("Campanha
Teste", "Teste MSG").

O pedido: cada vez que um disparo acontece e a IA qualifica o lead, nasce um card
novo identificado com a campanha, mesmo que o lead já tenha card de outra campanha.
Os dois cards convivem, em etapas diferentes. Quando a campanha encerra, os cards
dela viram perdidos e saem do Kanban para o Histórico.

Por que não acontece hoje:

| Peça | O que faz hoje | Efeito |
|---|---|---|
| `uidx_deals_one_active_per_lead` (migration 036) | no máximo 1 card aberto por lead | impossível ter 2 cards abertos do mesmo lead |
| `createDeal` (`dealsService.ts`) | card aberto existe → devolve ele; IA nunca abre ciclo novo | a qualificação do Teste Andrei III caiu no card de maio |
| `deals` | não guarda campanha | card não tem como ser "da campanha X" |
| Selo do card (`originCampaignSql`) | campanha que **abriu a conversa** (`conversations.origin_campaign_id`), nunca sobrescrita em novo disparo | card nunca mostra a campanha do re-disparo |
| `campaignIdForLog` (`aiAtendimento.ts`) | registra a qualificação na campanha de origem da conversa | qualificação do Teste Andrei III contou para a "Campanha Teste" |
| `getCampaignFunnel`, `getCampaignFunnelsBatch`, `campaignReportService` | contam os cards de **todos** os leads que receberam a campanha | um card conta em todas as campanhas que o lead recebeu |
| Vigência (`campaigns.validity_end`, migration 045) | existe desde 31/08, padrão 7 dias | nada no pipeline olha para ela |

## Decisões tomadas com o Fernando

1. **Encerramento:** a campanha encerra no fim da vigência (automático) **e** por um
   botão "Encerrar campanha" (antecipa).
2. **Quais cards fecham:** **todos** os cards abertos da campanha, em qualquer etapa.
   O vendedor que ainda negocia reabre com "Reativar".
3. **Cards que já existem no deploy:** **não mexer**. A regra vale daqui pra frente;
   o Kanban é limpo usando "Encerrar" nas campanhas antigas.
4. **Aviso:** o dono de cada card fechado por encerramento recebe notificação.
5. Aceito: os números dos relatórios de campanhas passadas **mudam** (ficam corretos).

## Desenho

### 1. Modelo de dados

- `deals.campaign_id uuid NULL REFERENCES campaigns(id) ON DELETE SET NULL`.
  `NULL` = card sem campanha (orgânico, manual, ou qualificado fora da vigência).
- Índice único parcial troca de "1 aberto por lead" para **"1 aberto por lead por
  campanha"**, com o card sem campanha como um balde próprio:
  `UNIQUE (lead_id, COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'))
  WHERE stage NOT IN ('ganho','perdido')`.
- `campaigns.cards_closed_at timestamptz NULL`: quando a varredura de encerramento
  já rodou para a campanha. Garante que cada campanha seja varrida uma vez só.
- Motivo de perda novo: `campanha_encerrada` (rótulo "Campanha encerrada"). Só o
  sistema usa; não aparece na lista de motivos do fechamento manual.

### 2. Migrations

- **048** — `ALTER TYPE loss_reason ADD VALUE IF NOT EXISTS 'campanha_encerrada'`.
  Arquivo próprio: o runner envolve cada arquivo em transação, e o valor novo de
  um enum não pode ser usado na mesma transação em que foi criado.
- **049** —
  1. adiciona `deals.campaign_id` e `campaigns.cards_closed_at`;
  2. **backfill** de `deals.campaign_id` em todos os cards (abertos e fechados): a
     campanha do **último disparo ao lead com `sent_at <= deals.created_at`**. Sem
     disparo antes → `NULL`. Para Samuel e Diana dá a mesma campanha do selo atual;
     num lead re-disparado, dá a campanha que de fato gerou o card;
  3. troca o índice único (dados legados já têm ≤ 1 aberto por lead, então o
     índice novo é satisfeito);
  4. índice em `deals(campaign_id)`;
  5. **`cards_closed_at = now()` nas campanhas cuja vigência já acabou** (`validity_end < now()`) no momento
     do deploy. É o que implementa "não mexer nos atuais": a varredura automática
     não fecha nada na subida. Essas campanhas só fecham cards pelo botão.

### 3. Campanha da qualificação

Função única `resolveQualificationCampaign(leadId)`: a campanha do **último disparo
recebido pelo lead** (`campaign_recipients.sent_at` mais recente, `<= now()`), se
ela estiver **vigente**. Vigente =

- campanha comum: `validity_end >= now()` (o instante exato do fim ainda vale — a
  mesma regra do selo de vigência, `campaignValidityState`);
- campanha **contínua** (`is_continuous`): sempre vigente, porque dispara sem parar
  e não tem vigência (ver "Pontos para revisão").

Campanhas comuns antigas, sem vigência (anteriores a 31/08), **não** contam como
vigentes para cards novos. Sem campanha vigente → `NULL`.

Usada na criação do card pela IA e por imagem no Comercial.

Os registros da IA (`ai_call_logs.campaign_id`, usados na calibração, na fila
cega e em "Não qualificados") usam uma variante **sem** o filtro de vigência,
`lastDispatchedCampaign(leadId, origem)`: o último disparo recebido pelo lead; sem
disparo, a campanha que abriu a conversa (comportamento de hoje). Resposta tardia
continua contando pra campanha que a provocou. Registros antigos não são reescritos.

### 4. Criação do card (`createDeal`)

| Origem | Campanha do card | Regra |
|---|---|---|
| IA qualificou (`ai_qualified`) | `resolveQualificationCampaign` | há card aberto dessa campanha → devolve ele. Há card **fechado** dessa campanha → devolve ele, não recria (mantém a proteção contra card fantasma). Senão → card novo em `lead_no_comercial`, com o dono da conversa. |
| Imagem no Comercial (`auto_image`) | `resolveQualificationCampaign` | lead tem **qualquer** card aberto → nada. Senão, comportamento de hoje (cria, ou reativa o fechado mais recente). |
| Manual ("Adicionar ao pipeline", orçamento confirmado) | `NULL` | lead tem card aberto → devolve o mais recente. Todos fechados → card novo em `em_negociacao` (recompra), como hoje. |

"Balde" sem campanha segue a mesma regra de devolver o fechado: lead que só teve
card de campanha e agora qualifica organicamente ganha card novo sem campanha.

### 5. Encerramento da campanha

**Serviço `closeCampaignCards(campaignId, actorUserId | null)`**, numa transação:

- todos os cards **abertos** com `campaign_id = campaignId` → `perdido`,
  `loss_reason = 'campanha_encerrada'`, `closed_at = now()`, sem
  `lead_quality_feedback` (automação; a exigência de avaliação vale só no
  fechamento manual — não passa por `changeStage`);
- atividade `lost` em cada card, `actor` = quem clicou ou `null` ("Sistema"),
  `metadata { reason, via: 'campaign_closed', campaignId }`;
- `campaigns.cards_closed_at = now()`;
- depois do commit: uma notificação por dono (ver 7).

**Automático:** worker `campaignClosureWorker`, no padrão de `slaWatchdog`, a cada
15 min: campanhas comuns com `validity_end < now()` e `cards_closed_at IS NULL` →
`closeCampaignCards(id, null)`. Contínuas nunca entram.

**Botão "Encerrar campanha"** (`POST /api/campaigns/:id/end`, admin e comercial,
mesma guarda de cancelar):
- disponível para campanha comum com disparo terminado (Concluída ou Cancelada).
  Campanha ainda disparando precisa ser cancelada antes; contínua não tem o botão;
- confirmação mostra quantos cards abertos vão fechar
  (`openCardsCount` no detalhe da campanha);
- grava `validity_end = now()` (e `validity_start = now()` se o início estava no
  futuro, por causa do `CHECK` de ordem) e chama `closeCampaignCards(id, userId)`
  na hora, **mesmo que a campanha já tenha sido varrida** — é ação humana explícita.

**Uma varredura só:** card reaberto com "Reativar" depois do encerramento fica
aberto; a varredura automática não volta. Estender a vigência depois de encerrada
não reabre cards.

**Reativar:** a guarda de hoje ("lead já tem outro negócio ativo", 409) passa a
olhar só a mesma campanha: bloqueia se houver outro card aberto **da mesma
campanha** (ou do balde sem campanha).

### 6. Kanban e Histórico

- Card perdido com `campanha_encerrada` **não** aparece na coluna Perdido (que hoje
  mostra perdidos por 7 dias): vai direto pro Histórico. Perdido manual segue igual.
- Histórico já filtra por motivo; "Campanha encerrada" entra como opção.
- Selo do card: nome de `deals.campaign_id` (substitui `originCampaignSql`).
- Filtro de campanha: o grupo "Campanha de origem" vira **"Campanha do card"**
  (`deals.campaign_id`); "Recebeu disparo" continua (campanhas que dispararam pro
  lead, exceto a do card).

### 7. Notificação

Tipo novo `campaign_cards_closed`. Uma por dono de card fechado:
"N cards seus foram fechados: campanha X encerrou", com link pro Histórico
filtrado pela campanha e pelo motivo. Cards sem dono não geram notificação.

### 8. Onde um lead passa a ter mais de um card

- **Inbox (barra lateral):** mostra o card aberto mais recente (`created_at` desc).
  Com mais de um aberto, mostra "2 negócios abertos" e permite alternar; mudar
  etapa ou valor age no card selecionado. Endpoint novo lista os cards abertos do
  lead; `GET /deals/by-lead/:leadId` continua devolvendo um (o aberto mais recente,
  senão o fechado mais recente).
- **Automações sobre "o card do lead"** passam a usar o aberto mais recente:
  orçamento lido do print (`budgetDetection`), confirmação de orçamento, ficha do
  caso (`caseSheetService`), etapa na lista de Cadastros (`leadsService`).
- **Dono segue a conversa** (`syncDealOwnerWithConversation`): aplica a regra a
  **todos** os cards abertos do lead, um por um.

### 9. Relatórios e métricas

- `getCampaignFunnel`, `getCampaignFunnelsBatch` e o Excel
  (`campaignReportService`): cards contados por `deals.campaign_id = campanha`, não
  mais por "lead recebeu a campanha". Campanhas passadas mostram menos
  em negociação/ganho/perdido do que hoje.
- Relatório agregado de campanhas (`getCampaignsAggregateStats`,
  `getTopCampaigns`, `getCampaignsTimeseries`): mesma troca — card "vindo de
  campanha" é card com `campaign_id`, e cada card conta só na campanha dele. Sem
  isso, o ranking e os totais discordariam do funil de cada campanha.
- Dashboard: perdidos por campanha encerrada contam como perdidos, com motivo
  próprio. O funil por lead (`leads.flow_stage`) não muda — fechar card não mexe na
  etapa do lead.

## Pontos para revisão (decididos por mim, não discutidos)

1. **Campanha contínua** é sempre vigente para atribuição, nunca fecha sozinha e não
   tem botão Encerrar. Os cards dela fecham à mão.
2. **Botão Encerrar só depois do disparo terminado** (Concluída/Cancelada), para não
   fechar cards enquanto a campanha ainda envia.
3. **Backfill sem janela de tempo:** card criado muito depois de um disparo antigo
   ainda é atribuído a esse disparo (é o último antes da criação).

## Fora de escopo

- Fechar ou reatribuir cards existentes no deploy (decisão 3).
- Reescrever `ai_call_logs` antigos com a campanha correta.
- Escolher ou trocar a campanha de um card na mão.
- Aviso antecipado ("sua campanha encerra amanhã").

## Testes

- `createDeal`: IA com card aberto de outra campanha → segundo card; mesma campanha
  → reusa; card fechado da mesma campanha → não recria; fora da vigência → sem
  campanha; contínua → atribui; manual com card aberto → devolve o mais recente.
- Índice: 2 abertos de campanhas diferentes ok; 2 abertos da mesma campanha falha.
- `resolveQualificationCampaign`: último disparo vigente; vencida; sem vigência
  antiga; contínua.
- `closeCampaignCards`: só abertos da campanha; motivo e atividade; `cards_closed_at`;
  notificação por dono; sem dono não notifica.
- Worker: pega só vencidas não varridas; ignora contínuas; não refecha reativado.
- Botão: guarda de papel; bloqueia campanha disparando e contínua; varre de novo
  campanha já varrida; ajusta `validity_start` futuro.
- Migration 049: backfill pelo último disparo antes da criação; campanhas vencidas
  marcadas como varridas; nenhum card muda de etapa.
- Reativar: bloqueia só com outro aberto da mesma campanha.
- Kanban: perdido por campanha encerrada não aparece na coluna; aparece no Histórico.
- Relatórios: card conta só na própria campanha.
- Inbox: lista de abertos; aberto mais recente por padrão.
- Dono: sincroniza todos os abertos do lead.
