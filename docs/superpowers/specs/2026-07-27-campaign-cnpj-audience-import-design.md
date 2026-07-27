# Campanha — Audiência por CNPJ (import de Cadastros + dedup + enriquecimento)

- **Data:** 2026-07-27
- **Status:** Aprovado (brainstorming)
- **Área:** Criação de Campanha → Etapa 3 "Audiência"

## Contexto (estado atual)

A Etapa 3 do wizard de criação de campanha (`src/pages/campaigns/CampaignNewPage.tsx` →
`src/features/campaigns/AudienceStep.tsx`) sobe um CSV **só de telefones**, parseado
**no browser** (`CsvUpload.tsx`), sem endpoint e sem CNPJ. O resultado vira
`AudienceFilters.phoneCsv: string[]` (`shared/types.ts`). No backend
(`server/services/campaignsAudience.ts`):

- `materializeCsvLeads(filter)` cria leads a partir dos telefones (`name = phone`,
  `source:'csv'`, sem CNPJ, sem enriquecimento);
- `resolveAudience(filter)` casa por telefone canônico;
- `campaignsService.createCampaign` chama materialize → resolve → `filterEligibleLeads`
  (cooldown) → insere `campaign_recipients` (`onConflictDoNothing (campaignId, leadId)`).

O import da aba **Cadastros** (`server/services/leadsImport.ts`) é o parser rico:
CNPJ **obrigatório**, upsert por CNPJ, XLSX, validação de dígitos, aliases de header,
e dispara auto-enriquecimento pra leads incompletos. Endpoint `POST /leads/import`.

Enriquecimento (`server/services/enrichmentJobs.ts` + `enrichmentWorker.ts`): job
**singleton** em background (índice parcial garante 1 ativo), throttle ~3/min
(BrasilAPI free), preenche **`phone` (Telefone 1)**, escopo fixo = leads
`flowStage='incomplete'` com CNPJ de 14 dígitos. Progresso por **polling**
(`GET /leads/enrich-bulk`), UI em `BulkEnrichmentDialog.tsx`.

`campaign_recipients` (`server/db/schema.ts`) tem `leadId` → liga lead a campanhas.
"Última campanha que um CNPJ participou" = query em `campaign_recipients` join
`campaigns` por `leads.cnpj`, ordenado por `COALESCE(sent_at, created_at) DESC`.

## Objetivo

Na Etapa 3, trocar o CSV de telefones pelo **mesmo formato/campos do import de
Cadastros**, com **CNPJ como ID do cliente e obrigatório**. Além disso:

- **(a)** Detectar CNPJs "repetidos" (duplicado no próprio arquivo **e** já participante
  de campanha anterior); mostrar a relação (CNPJ, nome, última campanha) e uma **ação
  genérica**: manter todos na campanha ou excluir todos.
- **(b)** Disponibilizar um botão **"Enriquecimento de dados"** que, ao encontrar um
  número, informa na tela e preenche **sempre o Telefone 2**.

## Decisões (do brainstorming)

1. **Persistência:** o CSV da Etapa 3 vira import real de Cadastros (upsert por CNPJ).
   A audiência passa a ser esses clientes. Subir o CSV = importar (persiste na base
   mesmo que o wizard seja abandonado depois).
2. **"Repetido" = os dois casos:** duplicado dentro do arquivo **e** já participou de
   campanha anterior.
3. **Enriquecimento grava sempre no Telefone 2** (preserva o Telefone 1 do CSV).
4. **Aceito:** cliente só com CNPJ (sem Telefone 1) recebe o Tel 2 mas **continua fora
   do disparo** (campanha exige Tel 1). Sem tratamento especial.
5. **Aceito:** enriquecimento é singleton — se já houver um rodando (ex.: o de
   Cadastros), o botão da campanha fica bloqueado com aviso.

## Design

### Bloco 1 — Upload & formato (Etapa 3)

- Novo endpoint **`POST /campaigns/audience/import`** (admin/comercial, multipart `file`,
  `multerCsv`). Reusa `parseLeadsCsv` + `importLeadsFromCsv` (upsert por CNPJ na base de
  Cadastros; XLSX suportado; CNPJ obrigatório — arquivo sem coluna CNPJ ou linhas sem
  CNPJ são rejeitados pelo próprio parser).
- Resposta: `CampaignAudienceImportResult`:
  ```ts
  {
    report: ImportReport;                 // inseridos/atualizados/rejeitados (reuso)
    importedLeadIds: string[];            // leadIds dos CNPJs do arquivo (novos + existentes)
    duplicatesInFileCount: number;        // linhas com CNPJ repetido no arquivo (consolidadas)
    previouslyParticipated: Array<{       // já participaram de campanha anterior
      leadId: string; cnpj: string; name: string;
      lastCampaign: { id: string; name: string; participatedAt: string } | null;
    }>;
  }
  ```
- `importLeadsFromCsv` já retorna `inserted/updated/rejected`; será estendido (ou
  encapsulado por um novo service `campaignAudienceImport`) para também devolver os
  `leadId`s dos CNPJs do arquivo (hoje não os expõe).
- Frontend: `CsvUpload.tsx` na campanha é substituído por um componente de upload
  server-side (drag/drop, `.csv,.xlsx`), que chama o endpoint e renderiza o relatório
  (tiles inseridos/atualizados/rejeitados + download de rejeitados, como o
  `ImportCsvDialog`).

### Bloco 2 — Duplicados (item a)

- **Duplicado no arquivo:** `parseLeadsCsv` já rejeita/consolida ("CPF/CNPJ duplicado no
  arquivo"). A UI mostra `duplicatesInFileCount` como informação ("X linhas com CNPJ
  repetido no arquivo foram consolidadas em 1").
- **Já participou de campanha anterior:** novo service
  `findPreviousParticipation(leadIds)` → para cada leadId com recipient anterior,
  retorna a última campanha (nome + data). A UI mostra a **lista** (CNPJ, nome, última
  campanha, data) e uma **ação genérica única**:
  - **Manter todos na campanha** (default) — nada muda.
  - **Excluir todos da campanha** — os `leadId`s vão para `excludeLeadIds`.
- Não há escolha por linha (a ação é do conjunto). A lista é só pra transparência.

### Bloco 3 — Enriquecimento (item b)

- Botão **"Enriquecimento de dados"** na Etapa 3, habilitado após o import.
- Extensão do job de enriquecimento para suportar:
  - **`target`** (`'phone' | 'phone2'`) — coluna nova em `enrichment_jobs`; o worker
    (`processNextEnrichment`) grava em `phone` ou `phone2` conforme o target.
  - **escopo explícito por lead-id** — em vez do snapshot fixo (incomplete + 14 díg.),
    o job da campanha é criado sobre `importedLeadIds` (com CNPJ de 14 dígitos; CPFs
    pulados silenciosamente — BrasilAPI é só CNPJ).
  - Regra de escrita `phone2`: preenche **só se `phone2` estiver vazio** (não sobrescreve);
    o número encontrado que já for igual ao `phone1` é ignorado (evita duplicar).
- Start: `POST /campaigns/audience/enrich` `{ leadIds }` → cria o job (target=phone2).
  **409** se já houver enriquecimento ativo (singleton). **Não-bloqueante**: a campanha
  pode ser criada enquanto roda.
- Progresso: reusa o polling de `getCurrentJob` (`GET /leads/enrich-bulk`) para
  status/contadores/barra. Para "informe na tela" o número encontrado, o endpoint de
  status passa a incluir uma lista `recentlyFound: Array<{ name, cnpj, phone2 }>`
  (os ~20 leads mais recentes do job com `resultStatus='phone_found'`, join em `leads`,
  ordem desc por processamento). A UI mostra essa lista ao vivo ("novo Tel 2:
  `<cliente>` → `<número>`").

### Bloco 4 — Audiência & criação da campanha

- `AudienceFilters` ganha **`importedLeadIds?: string[]`** (novo caminho). Quando
  presente, a audiência = esses leadIds (menos `excludeLeadIds`), ignorando
  status/source/daysSinceCreated e `phoneCsv` (mesma semântica de "CSV manda").
- `resolveAudience`/`dryRun`: quando há `importedLeadIds`, seleciona esses leads com
  `isNotNull(leads.phone)` (Tel 1) e aplica `filterEligibleLeads` (cooldown) como hoje.
  Não precisa mais de `materializeCsvLeads` nesse caminho (os leads já foram criados no
  import).
- `phoneCsv` é mantido no tipo por compatibilidade, mas o wizard passa a usar
  `importedLeadIds`. (Sem migração de dados; campanhas antigas não têm o campo novo.)
- `createCampaign` e `dryRun` passam a aceitar o novo caminho; o resto (recipients,
  cooldown, disparo) fica igual.

### Modelo de dados / API (resumo)

- **Migration:** `enrichment_jobs` ganha `target text not null default 'phone'`.
  (`enrichment_job_leads` já guarda `resultStatus` — reutilizado pro `recentlyFound`.)
- **Endpoints novos:**
  - `POST /campaigns/audience/import` (multipart) → `CampaignAudienceImportResult`.
  - `POST /campaigns/audience/enrich` `{ leadIds }` → job (409 se singleton ocupado).
  - `GET /leads/enrich-bulk` estendido: inclui `recentlyFound`.
- **Tipos compartilhados:** `CampaignAudienceImportResult`; `AudienceFilters.importedLeadIds`;
  `PublicEnrichmentJob.recentlyFound?`; `enrichment target`.

### Frontend (resumo)

- `AudienceStep.tsx`: troca o bloco CSV por: uploader server-side → relatório do import →
  painel de duplicados (lista + ação genérica manter/excluir) → botão "Enriquecimento de
  dados" com progresso (barra + lista de números encontrados).
- Estado do wizard passa a guardar `importedLeadIds` e `excludeLeadIds` (em vez de
  `phoneCsv`). O `dryRun`/contador de impacto e o `AudiencePreviewTable` continuam
  funcionando sobre o novo caminho.

## Pontos de atenção (aceitos)

1. Cliente só com CNPJ (sem Tel 1) recebe Tel 2 no enriquecimento, mas **não entra no
   disparo** (campanha exige Tel 1). Sem tratamento especial nesta entrega.
2. Enriquecimento é **singleton** no sistema: só 1 por vez. Botão da campanha bloqueia
   (com aviso) se já houver um enriquecimento ativo.

## Testes

- **parse/import:** CSV da campanha sem coluna CNPJ → rejeitado; linhas sem CNPJ →
  rejeitadas; upsert por CNPJ (novo cria, existente atualiza campos vazios);
  `importedLeadIds` retornado cobre novos + existentes.
- **duplicados:** duplicado no arquivo consolidado (contagem); lead que já foi recipient
  de campanha anterior aparece em `previouslyParticipated` com a última campanha correta;
  "excluir todos" joga os leadIds em `excludeLeadIds` e eles somem da audiência (dryRun).
- **enriquecimento:** job com `target='phone2'` grava em `phone2` (não em `phone`), só se
  vazio; pula CPF; 409 quando já há job ativo; `recentlyFound` lista os encontrados.
- **audiência:** `importedLeadIds` define a audiência (ignora status/source), respeita
  `excludeLeadIds`, exige Tel 1, aplica cooldown.

## Fora de escopo

- Reescrever o dispatcher ou o modelo de recipients.
- Enriquecimento em tempo real (websocket) — mantém polling.
- Tratamento especial de CNPJ-only sem Tel 1 (ponto de atenção 1).
- Migração de campanhas antigas (`phoneCsv` legado permanece válido).
