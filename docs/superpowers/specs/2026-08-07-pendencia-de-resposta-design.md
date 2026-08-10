# Pendência de resposta — quem está esperando por nós

- **Data:** 2026-08-07
- **Status:** Aprovado (brainstorming)
- **Área:** Inbox (filtros + lista) → Notificações → SLA watchdog

## Contexto (estado atual)

Conversas ficam mais de uma hora sem resposta do atendimento humano depois que o
cliente mandou informação, e nada no sistema acende.

Existe muita coisa construída em volta desse problema, mas nenhuma peça cobre o
caso:

| Peça existente | O que faz | Por que não cobre |
|---|---|---|
| `slaWatchdog` (roda a cada 60s) | escalona em 5/10/30 min | filtra `assigned_to IS NULL` + `status = 'aguardando_atendimento'` — só vigia **lead novo que ninguém assumiu** |
| Chip "Expiradas 24h" na Inbox | `last_inbound_at < now() - 24h` | não exige que a última mensagem seja do cliente: lista conversa já respondida |
| Card "conversas expiradas" no Dashboard | idem + `last_message_at <= last_inbound_at` | definição **diferente** da do chip; limiar de 24h |
| `emitNotification` / sino / `NewMessageAlerts` | notificação in-app, som, pop-up do navegador | só reage a `kind = 'new_message'` |
| `notifyVendoresWhatsapp` | ping no WhatsApp dos vendedores | usado só pelo SLA de fila |

O efeito da divergência entre chip e card, medido em produção (2026-08-07):

| | Conversas |
|---|---|
| O chip "Expiradas 24h" lista | **23** |
| Realmente esperando resposta nossa há 24h | **1** |
| Esperando resposta nossa (qualquer tempo) | **16** |
| Esperando resposta nossa há mais de 1h | **9** |

São 22 falsos positivos em 23. O chip mede "o cliente sumiu", não "estamos
devendo" — por isso virou ruído e ninguém usa.

Distribuição das 16 pendências reais:

| Fila | `ai_disabled` | Esperando | Há mais de 1h |
|---|---|---|---|
| comercial | true | 6 | 5 |
| comercial | false | 5 | 5 |
| ia | false | 2 | 2 |

O watchdog atual cobre no máximo 1 delas: das que estão em Comercial, 8 já estão
`em_atendimento` e portanto fora do filtro dele.

O lado inverso — lead que não respondeu — tem volume completamente diferente:
**1.916 conversas**, quase todas disparos de campanha. Os dois casos não podem
dividir o mesmo alerta.

## Objetivo

Fazer com que uma conversa em que o cliente está esperando por nós seja visível
na Inbox e chegue ativamente a quem pode responder, com um relógio que o time
reconheça como justo.

## Decisões (do brainstorming)

1. **Uma única definição de "a bola está com a gente"**, consumida por filtro,
   contador, dashboard e watchdog. A duplicação divergente atual é a causa raiz
   do ruído.
2. **O relógio só conta horário comercial.** Mensagem das 19h começa a contar às
   8h do dia seguinte. Sem isso toda segunda-feira nasce com uma pilha de
   "esperando há 60h" e o time aprende a ignorar — que é exatamente o que
   aconteceu com o filtro de 24h.
3. **Escopo:** fila Comercial **ou** qualquer conversa com `ai_disabled`. A regra
   conceitual é "ninguém automático vai responder isso", e ela continua correta
   se as filas da IA mudarem depois.
4. **Prazos padrão: alerta em 1h, escalação em 3h** (horário comercial),
   configuráveis.
5. **Destinatário:** o dono da conversa primeiro; admin na escalação. **Conversa
   sem dono alerta todos da fila Comercial.**
6. **Canais:** destaque na Inbox + sino do sistema + notificação do navegador.
7. **O chip "Expiradas 24h" é substituído** por "Aguardando nós". A contagem cai
   de 23 para ~10, mas passa a ser verdade.

### Fora de escopo (decidido explicitamente)

- **Feriados** no relógio comercial. Exigiria calendário e manutenção contínua; o
  custo de errar é um alerta adiantado em um punhado de dias por ano.
- **WhatsApp/e-mail** para pendência de resposta. O canal existe
  (`notifyVendoresWhatsapp`) e pode ser ligado depois, mas com ~10 pendências por
  dia viraria spam e queimaria um canal que hoje funciona para o SLA de fila.
- **Reprocessar histórico.** O watchdog vale da instalação em diante; conversa
  que já está parada há dias aparece no filtro, mas não dispara notificação
  retroativa.
- **Alerta para "a IA não respondeu"** (as 2 conversas da fila `ia`). É sintoma de
  saúde do sistema, com dono e prazo diferentes. Merece tratamento próprio.

## Arquitetura

### 1. A definição canônica

Um único predicado, em `server/lib/pendingReply.ts`, reaproveitado por todos os
consumidores:

```
status <> 'encerrada'
AND last_inbound_at IS NOT NULL
AND last_message_at <= last_inbound_at
AND (queue = 'comercial' OR ai_disabled = true)
```

`last_message_at <= last_inbound_at` é o que expressa "a última mensagem é do
cliente": qualquer outbound posterior empurra `last_message_at` para frente. A
igualdade é o caso normal (a inbound atualiza as duas colunas); o `<=` cobre isso
sem depender de ordem de escrita.

O marco temporal da pendência é `last_inbound_at` — é ele que identifica o ciclo
atual (ver §4).

### 2. Relógio comercial

**O horário comercial já existe e é reaproveitado.** `org_settings` já tem
`ai_business_hours_start` / `_end` / `_days` (CSV de ISO weekdays) e
`dispatch_timezone`, e `server/lib/businessHours.ts` já os lê em
`isAiBusinessHours()`. Criar um terceiro conjunto de campos de horário repetiria
exatamente o erro que esta feature existe para corrigir — duas definições da
mesma coisa divergindo em silêncio.

Uma ressalva deliberada: **`ai_24x7` é ignorado** no relógio de pendência. Aquele
campo diz "a IA responde a qualquer hora", não "os vendedores trabalham a
qualquer hora". Ligá-lo não pode fazer o relógio humano correr de madrugada.

`org_settings` ganha só os dois limiares (migration **043**, a mesma que cria a
tabela do §4):

| coluna | tipo | default |
|---|---|---|
| `pending_reply_alert_min` | `int` | `60` |
| `pending_reply_escalate_min` | `int` | `180` |

O cálculo vive em `server/lib/businessHours.ts`, ao lado do helper existente,
como **função pura**:

```ts
businessMinutesBetween(from: Date, to: Date, cfg: BusinessHoursConfig): number
```

`BusinessHoursConfig` é `{ startHour, endHour, days, timeZone }`, derivada das
configurações por `businessConfigFromSettings()`. Essa função é tipada pela
**forma** dos quatro campos que lê, não por `OrgSettings`: o projeto tem
`getOrgSettings()` devolvendo `PublicOrgSettings` e `loadOrgSettingsRow()`
devolvendo a row do Drizzle, e ambas precisam servir. A função de cálculo em si
não conhece nenhuma das duas — é o que a mantém testável sem banco.

É o coração da feature e onde os erros são silenciosos, então é o alvo de teste
mais denso: mensagem dentro do expediente, mensagem depois do fechamento,
pendência atravessando a noite, atravessando o fim de semana, dia inteiro fora
dos dias úteis, `from` posterior a `to`.

### 3. Na Inbox

- O chip **"Expiradas 24h" é removido**; entra **"Aguardando nós"** com contador
  ao vivo (`GET /api/conversations/counts` ganha `awaitingUs`).
- `PublicConversation` troca `isExpired24h` por `awaitingUsMinutes: number | null`
  — minutos comerciais de espera, `null` quando a bola não está conosco. A lista
  mostra o tempo ("1h20 esperando") com cor por severidade (normal → alerta →
  escalado).
- Com o filtro ativo, a ordenação passa a ser **mais antigo primeiro** — a fila
  de trabalho é por quem espera há mais tempo.
- O chip **"Sem retorno" permanece** e continua sendo o lugar do caso inverso
  (lead que não respondeu). Os dois nunca se misturam.

O parâmetro de API `expired24h` **deixa de existir** — o que o substitui é
`awaitingUs=true`. Ele hoje tem dois consumidores, e os dois mudam junto:

- o chip da Inbox (removido, §3 acima);
- o item `conv_expired` do Dashboard (`attention`), cujo `filter` de navegação
  aponta para `{ expired24h: true }`.

No Dashboard, `expired24h` aparece em **dois lugares diferentes** e ambos passam a
usar o predicado canônico:

| Lugar | Hoje | Depois |
|---|---|---|
| `attention` → item `conv_expired` | 24h + predicado correto | vira `pending_reply`, limiar da config, navega para `awaitingUs=true` |
| `DashboardWhatsappStats.expired24h` | contador solto de 24h | vira `awaitingUs`, mesmo predicado |

O número que o card mostra e a lista para a qual ele navega passam a ser a mesma
coisa — hoje não são.

### 4. Watchdog: segunda vigilância

`slaWatchdog` ganha `processPendingReplies()`, rodando no mesmo tick de 60s,
independente de `processEscalations()` (uma falha não pode derrubar a outra).

| Nível | Prazo (comercial) | Destinatário |
|---|---|---|
| 1 | `pending_reply_alert_min` (60) | dono da conversa; **sem dono → todos da fila Comercial** |
| 2 | `pending_reply_escalate_min` (180) | admin |

`emitNotification` já aceita `userIds` explícitos, então notificar o dono não
exige mudança na infra. Novo `NOTIFICATION_KINDS`: `'pending_reply'`.

**Idempotência — o ponto crítico do design.** O SLA de fila usa
`conversation_sla_events` com unicidade `(conversation_id, level)`, e isso
funciona lá porque "entrar na fila" acontece uma vez por conversa.

Estar devendo resposta é **recorrente**: o cliente escreve, respondemos, ele
escreve de novo. Reusar aquela tabela faria a conversa alertar na primeira vez e
**nunca mais** — um sistema que parece funcionar enquanto silenciosamente para de
avisar justamente nas conversas mais ativas.

Migration **043**, tabela `conversation_reply_alerts`:

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `conversation_id` | uuid FK → conversations | |
| `pending_since` | timestamptz | o `last_inbound_at` do ciclo |
| `level` | int | 1 ou 2 |
| `created_at` | timestamptz | |

Unicidade em `(conversation_id, pending_since, level)`. Mensagem nova do cliente
move `last_inbound_at` → novo ciclo → pode alertar de novo. O índice do SLA de
fila não é tocado.

### 5. Notificação do navegador

`NewMessageAlerts` hoje filtra `n.kind === 'new_message'`. Passa a aceitar também
`'pending_reply'`. Som, toast, pop-up nativo quando a aba não está em foco e
pedido de permissão já existem e não mudam.

## Fluxo

```
cliente manda mensagem
  → webhook grava inbound, atualiza last_inbound_at
  → [a bola vira nossa: last_message_at <= last_inbound_at]
  → Inbox mostra a conversa no chip "Aguardando nós" com o tempo correndo
  → watchdog (60s) calcula minutos COMERCIAIS desde last_inbound_at
       ├─ < 60 min       → nada
       ├─ >= 60 min      → nível 1: notifica dono (ou fila) — sino + navegador
       └─ >= 180 min     → nível 2: escala pro admin
  → vendedor responde
       → last_message_at > last_inbound_at → sai do filtro, relógio zera
  → cliente escreve de novo → novo last_inbound_at → ciclo novo, pode alertar de novo
```

## Erros e degradação

- **Watchdog falha num tick:** loga e segue; o próximo tick reavalia do zero (o
  estado vive no banco, não em memória).
- **`emitNotification` falha:** já é best-effort e não propaga. O evento fica
  gravado em `conversation_reply_alerts`, então **não haverá retentativa** — a
  alternativa (gravar depois de notificar) troca "alerta perdido" por "alerta
  repetido em loop", que é pior.
- **Configuração de horário ausente ou inválida** (fim antes do início, nenhum dia
  útil): cai no default seg–sex 08:00–18:00 e loga. Nunca deixa o watchdog sem
  relógio.
- **Conversa sem dono e sem nenhum usuário Comercial ativo:** `emitNotification`
  já sai silenciosamente com lista vazia de destinatários.
- **Múltiplas instâncias do processo:** o watchdog assume instância única, como o
  SLA de fila já assume. A unicidade da tabela protege contra alerta duplicado
  mesmo se dois processos rodarem o mesmo tick.

## Testes

**`businessTime` (função pura, densidade alta):**
- dentro do expediente; após o fechamento; antes da abertura
- pendência atravessando uma noite; um fim de semana; vários dias
- dia não útil inteiro; `from > to`; configuração degenerada

**Predicado de pendência:**
- última mensagem inbound → pendente; outbound depois → não pendente
- conversa encerrada → nunca pendente
- fila `ia` com IA ligada → fora; mesma conversa com `ai_disabled` → dentro
- conversa sem nenhum inbound (disparo de campanha) → fora

**Watchdog:**
- cruza 60 min comerciais → nível 1 para o dono
- sem dono → todos da fila Comercial
- cruza 180 min → nível 2 para admin, sem repetir o nível 1
- dois ticks seguidos não duplicam alerta
- **cliente manda mensagem nova depois de respondida → novo ciclo alerta de novo**
  (o caso que a tabela nova existe para cobrir)
- resposta do vendedor antes do prazo → nenhum alerta

**API:**
- `counts` devolve `awaitingUs` coerente com a lista filtrada
- filtro `awaitingUs=true` retorna exatamente as conversas do predicado
- `awaitingUsMinutes` é `null` quando a bola está com o lead
- ordenação mais-antigo-primeiro com o filtro ativo
