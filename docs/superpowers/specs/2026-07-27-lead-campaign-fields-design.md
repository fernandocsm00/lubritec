# Cadastro de Leads — campos de campanha (Qtd / Última / Status)

- **Data:** 2026-07-27
- **Status:** Aprovado (brainstorming)

## Objetivo

Mostrar no cadastro do lead, **derivado de `campaign_recipients`** (sem colunas novas), 3 informações que se atualizam sozinhas conforme as campanhas rodam:
- **Quantidade de campanhas** que o lead participou.
- **Última campanha** (nome + data).
- **Status da última campanha** = status do disparo pro lead **·** status da campanha.

## Decisões (brainstorming)

- **Derivar** na leitura (não armazenar). O código já prefere isso (contagens denormalizadas foram marcadas como drift-prone).
- **Escopo:** todas as participações (1 linha por campanha em `campaign_recipients`; inclui enviadas/falhas/puladas/pendentes) — necessário porque o status do disparo pode ser Falhou/Pulado.
- **Status** mostra os dois: disparo (Pendente/Enviando/Enviado/Falhou/Pulado) **·** campanha (Rascunho/Agendada/Em andamento/Pausada/Concluída/Cancelada).
- **Exibição:** modal de detalhe do lead (3 campos completos) + 1 coluna compacta "Campanhas" na tabela de Cadastros.

## Design

### Backend (derive)

`PublicLead` ganha 2 campos (o array `campaigns` atual fica intacto):
```ts
campaignCount: number;
lastCampaign: {
  id: string; name: string;
  recipientStatus: CampaignRecipientStatus;
  campaignStatus: CampaignStatus;
  participatedAt: string; // ISO de COALESCE(sent_at, created_at)
} | null;
```

Computado em `leadsService.listLeads` (fonte da tabela + do modal) e em `getLeadById` (consistência), via SQL sobre `campaign_recipients`:
- `campaignCount` = `(SELECT count(*)::int FROM campaign_recipients cr WHERE cr.lead_id = leads.id)`.
- `lastCampaign` = `json_build_object(...)` da linha mais recente (`ORDER BY COALESCE(cr.sent_at, cr.created_at) DESC LIMIT 1`) join `campaigns` (id, name, c.status como campaignStatus, cr.status como recipientStatus, participatedAt). `NULL` → `null`.

`toPublic` mapeia os dois (default `campaignCount: 0`, `lastCampaign: null` quando não computados).

### Frontend

- **Rótulos** (novo helper, ex. em `src/features/leads/campaignLabels.ts`): `RECIPIENT_STATUS_LABEL` e `CAMPAIGN_STATUS_LABEL` (PT).
- **Tabela** (`LeadsTable.tsx`): coluna **"Campanhas"** → `${campaignCount} · ${lastCampaign.name}` (truncado), ou `—` se `campaignCount === 0`. Ajustar colSpan/skeleton.
- **Modal** (`LeadDialog.tsx`): bloco "Campanhas" (read-only) com Quantidade, Última campanha (+ data), e Status `Enviado · Concluída`. Só aparece quando `campaignCount > 0`.

## Testes

- lead com 2 campanhas (uma enviada mais recente) → `campaignCount === 2`, `lastCampaign.name` correto, `recipientStatus`/`campaignStatus` corretos.
- lead sem campanha → `campaignCount === 0`, `lastCampaign === null`.
- última campanha considera a mais recente por `COALESCE(sent_at, created_at)` mesmo quando o disparo falhou/foi pulado (sent_at null).

## Fora de escopo

- Colunas persistidas / migration.
- Alterar o array `campaigns` existente.
