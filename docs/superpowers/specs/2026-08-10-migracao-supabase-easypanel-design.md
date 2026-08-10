# Migração para conta da Lubritec — Supabase + EasyPanel

**Data:** 2026-08-10
**Status:** desenho aprovado, aguardando plano de implementação
**Objetivo:** transferir o LubriConnect da infraestrutura da Orion Digital para contas de
propriedade da Lubritec, sem perda de dados e sem expor dados de outros clientes.

---

## 1. Diagnóstico do estado atual

Levantado por inspeção direta do banco de produção em 2026-08-10.

### 1.1 O Supabase atual é multi-tenant da Orion

Projeto `PROJETO SAAS` (ref `cmighponfvaagzbhqici`, `sa-east-1`, PG 15.8), org
`imperium@agenciaimperium.com.br's Org`, plano **Free**.

| Schema | Tabelas | Tamanho | Dono |
|---|---|---|---|
| `lubritec` | 25 | 20 MB | **LubriConnect (migra)** |
| `lubritec_test` | 14 | 872 kB | legado (não migra) |
| `public` | 73 | 7,2 MB | outro app da Orion |
| `holding` | 24 | 1,7 MB | outro projeto da Orion |
| `ORIONDASH` | 0 | — | outro projeto da Orion |
| `net`, `cron` | 4 | 215 MB | logs de pg_net/pg_cron |

**Consequência:** a função *Transfer Project* nativa do Supabase está descartada. Ela move o
projeto inteiro, o que entregaria `holding`, `public` e `ORIONDASH` à Lubritec. É um problema de
confidencialidade, não de viabilidade técnica.

### 1.2 O schema `lubritec` é totalmente autocontido

Verificado:

- **Zero** foreign keys cruzando schema.
- **Zero** funções e **zero** triggers de usuário no schema.
- Defaults usam apenas `gen_random_uuid()` e `now()` — ambos nativos do PG13+, sem dependência
  de extensão. As migrations não chamam `crypt`, `digest`, `hmac`, `gen_salt` nem `pgp_*`, ou
  seja, `pgcrypto` (criado em `001_extensions.sql`) na prática não é usado.
- Nenhum índice `gin`/`trgm` — nada que exija extensão no destino.
- **Supabase Auth, RLS, Realtime e Edge Functions não são usados.** A autenticação é própria
  (argon2id + JWT, tabelas `users`/`sessions`/`auth_tokens` dentro do schema).

O Supabase aqui é, efetivamente, "um Postgres gerenciado + um bucket". O dump/restore é limpo.

### 1.3 Volume de dados (linha de base para reconciliação)

25 tabelas, ~23.400 linhas, 20 MB. Maiores: `lead_stage_transitions` (4.951), `messages`
(4.845), `notifications` (3.263), `leads` (2.822), `conversations` (2.245),
`campaign_recipients` (2.215), `enrichment_job_leads` (1.754).

### 1.4 Storage

Bucket `hsm-headers` (público): **9 objetos, 925 kB**. Os buckets `holding_avatars` e
`holding_receipts` são de outro projeto e não migram.

### 1.5 Onde há referências a caminhos e URLs

| Origem | Qtd | Formato | Efeito da migração |
|---|---|---|---|
| `messages.media_url` | 254 | relativo `/uploads/...` | imune à troca de domínio; **depende do volume** |
| `campaigns.media_url` | 3 | relativo `/uploads/...` | idem |
| `project_feedback.images` | 2 | relativo | idem |
| `messages.media_url` | 20 | `mmg.whatsapp.net` / `lookaside.fbsbx.com` | já quebradas (ver 1.6) |
| `whatsapp_hsm_templates.header_media_url` | 2 | absoluto no Supabase antigo | **exige UPDATE** |
| `notifications.action_url` | 3.229 | relativo (`/whatsapp`, `/campaigns/...`) | imune |

**Leitura:** o banco quase não guarda URL absoluta. O ativo frágil são os **259 arquivos** no
volume `/app/uploads` do EasyPanel, que não estão no Supabase e não têm backup.

### 1.6 Mídia inbound quebrada (pré-existente)

As 20 mensagens apontando para a CDN do WhatsApp são o bug já conhecido (mídia cifrada da UazAPI)
cujo backfill nunca rodou em produção. Essas URLs **não são recuperáveis após o corte** — na
prática já não são hoje. Decisão registrada em §6.4.

### 1.7 Drift de migrations

O banco tem **46** registros em `lubritec._migrations`; o repositório tem **45** arquivos. A
diferença é `027_ia_sprint_enhances.sql`, aplicado antes de o arquivo ser renomeado para
`028_ia_sprint_enhances.sql` — o runner do [migrate.ts](../../../server/scripts/migrate.ts)
indexa por nome de arquivo, então reaplicou o mesmo conteúdo sob o nome novo.

**Consequência de projeto:** criar o banco novo do zero com `npm run migrate` produziria um schema
diferente do que está no ar. O restore de dump é o único caminho que reproduz a realidade.

### 1.8 Conexão

Hoje: conexão direta `db.<ref>.supabase.co:5432`, sem pooler, sem parâmetros extras.

---

## 2. Decisões

| # | Decisão | Motivo |
|---|---|---|
| D1 | Projeto Supabase **novo** + restore de dump; **não** *Transfer Project* | §1.1 — isolamento dos outros clientes |
| D2 | **Dump/restore**, não "migrations do zero + cópia de dados" | §1.7 — drift |
| D3 | Estratégia **ensaio + corte** (duas passadas) | migram banco, host, volume e webhooks juntos |
| D4 | Contas criadas **pela Lubritec**, Fernando convidado como Owner | o cliente é dono e tem acesso; Supabase não transfere org |
| D5 | Plano **Free** no início | escolha do cliente; compensado por `pg_dump` semanal (§7) |
| D6 | `sa-east-1` no destino | mantém latência |
| D7 | `lubritec_test` **não** migra | testes usam Postgres embedado ([globalSetup.ts](../../../server/tests/globalSetup.ts)) |
| D8 | Schema antigo preservado ~14 dias pós-corte | é o rollback |

---

## 3. Arquitetura alvo

**Contas.** A Lubritec cria conta Supabase e conta EasyPanel com e-mail próprio e convida
Fernando como Owner/Administrator em ambas. Propriedade do cliente, operação da Orion.

**Supabase novo.** Org da Lubritec → projeto em `sa-east-1`, plano Free, contendo **apenas** o
schema `lubritec` e o bucket público `hsm-headers`.

**EasyPanel novo.** Serviço na conta do cliente com o mount persistente `/app/uploads` criado
**antes do primeiro deploy** — nasce já resolvendo o item 3 do
[PRODUCTION_CHECKLIST](../../../PRODUCTION_CHECKLIST.md).

**O que fica para trás.** `lubritec_test`, os 7 objetos órfãos do bucket, e o schema `lubritec`
antigo (rollback, dropado ao fim da garantia).

### 3.1 Segredos

A migração fecha o item 1 do PRODUCTION_CHECKLIST. Rotacionar no ambiente novo: senha do banco,
`JWT_SECRET` (invalida sessões — usuários relogam), `SMTP_PASS`, `GEMINI_API_KEY`,
`UAZAPI_ADMIN_TOKEN`.

> **`WHATSAPP_CREDENTIALS_KEY` NÃO pode ser rotacionada.** Os tokens de instância WhatsApp estão
> criptografados no banco com ela. Rotacionar sem re-encriptar torna todas as credenciais de
> WhatsApp indecifráveis e derruba envio e recebimento. Ela viaja **idêntica** para o ambiente
> novo.

### 3.2 String de conexão — verificar antes do corte

Projetos Supabase criados hoje resolvem `db.<ref>.supabase.co` **somente em IPv6**, e o add-on de
IPv4 não existe no plano Free. Se o container do EasyPanel novo for IPv4-only, a conexão direta
falha e é preciso usar o pooler Supavisor.

Nesse caso, **usar modo *session* (porta 5432), não *transaction* (6543)**: o
[client.ts:31](../../../server/db/client.ts:31) faz `SET search_path` no evento `connect` do pool,
e no modo transaction esse `SET` não sobrevive entre transações — as queries passariam a não achar
as tabelas.

Se só houver transaction disponível, a alternativa é fixar o search_path na própria URL:

```
?options=-c%20search_path%3Dlubritec%2Cpublic
```

**CONFIRMADO em 2026-08-10, não é mais hipótese.** O container do EasyPanel é IPv4-only e o
projeto novo (`db.<NEW_REF>.supabase.co`) resolve só em IPv6 — a conexão direta falha com
`Network is unreachable`. O **Session pooler funciona** e foi por ele que o restore rodou.

Consequência para o corte: o `DATABASE_URL` de produção **tem** que ser a string do Session
pooler (`postgresql://postgres.<ref>:<senha>@aws-N-sa-east-1.pooler.supabase.com:5432/postgres`).
A conexão direta não é uma opção neste ambiente.

Versões confirmadas: origem PostgreSQL 15.8, destino PostgreSQL 17.6.

---

## 4. Runbook

Convenções: `OLD_REF=cmighponfvaagzbhqici`, `NEW_REF=<ref do projeto novo>`. Senhas vêm de
variável de ambiente, nunca inline no histórico do shell.

### Fase 0 — Preparação (sem downtime)

1. Lubritec cria conta + org no Supabase; convida Fernando como Owner.
2. Lubritec cria conta no EasyPanel; convida Fernando.
3. Criar projeto Supabase em `sa-east-1`. Guardar `NEW_REF`, senha do banco e a `service_role key`.
4. Criar bucket **público** `hsm-headers` no projeto novo.
5. Criar o serviço no EasyPanel novo **com o mount `/app/uploads`** antes de qualquer deploy.
6. Confirmar de dentro do container qual string de conexão funciona (§3.2).

### Fase 1 — Ensaio (produção intacta)

7. **Dump** do schema. Usar imagem Docker do Postgres para evitar divergência de versão de
   cliente (origem PG15, destino PG17):

```bash
docker run --rm -e PGPASSWORD="$OLD_DB_PASS" postgres:17 \
  pg_dump "postgresql://postgres@db.$OLD_REF.supabase.co:5432/postgres" \
  --schema=lubritec --no-owner --no-privileges --no-publications --no-subscriptions \
  --quote-all-identifiers > lubritec.sql
```

8. **Restore** no projeto novo:

```bash
docker run --rm -i -e PGPASSWORD="$NEW_DB_PASS" postgres:17 \
  psql "postgresql://postgres@db.$NEW_REF.supabase.co:5432/postgres" \
  -v ON_ERROR_STOP=1 < lubritec.sql
```

9. Copiar os 9 objetos do bucket `hsm-headers` (script dedicado — ver §5).
10. Reescrever as 2 URLs de header no banco novo:

```sql
UPDATE lubritec.whatsapp_hsm_templates
SET header_media_url = replace(header_media_url,
      'https://cmighponfvaagzbhqici.supabase.co',
      'https://NEW_REF.supabase.co')
WHERE header_media_url LIKE '%cmighponfvaagzbhqici%';
-- esperado: UPDATE 2
```

11. Copiar o volume `/app/uploads` do EasyPanel antigo para o novo:

```bash
ssh HOST_ANTIGO "docker exec CONTAINER_ANTIGO tar -C /app/uploads -cf - ." \
  | ssh HOST_NOVO "docker exec -i CONTAINER_NOVO tar -C /app/uploads -xf -"
```

12. Configurar env vars no EasyPanel novo (§3.1), com `NODE_ENV=production` e `APP_URL` novo.
13. Deploy e validação de ponta a ponta (§6.3).

> **Regra do ensaio: não conectar o WhatsApp de produção.** Duas instâncias disputando o mesmo
> número quebram o ambiente vivo. Usar instância de teste ou deixar o WhatsApp desligado.

### Fase 2 — Corte (janela ~1h, fora do horário comercial)

14. Avisar a Lubritec; congelar campanhas agendadas.
15. **Parar o serviço antigo** — impede escrita durante o dump.
16. `DROP SCHEMA lubritec CASCADE` no projeto novo e repetir os passos 7–8 com os dados finais.
17. Re-sincronizar `/app/uploads` — repetir o passo 11 (pega o delta).
18. Recopiar objetos novos do bucket e reaplicar o UPDATE — repetir os passos 9–10.
19. Subir o serviço novo; apontar o domínio.
20. **Re-registrar webhooks**: callback URL da Meta (uma por instância, roteada por `instanceId`)
    e webhook da UazAPI, para o domínio novo.
21. Revalidar §6.1, §6.2 e §6.3 contra o ambiente novo já em produção.
22. Smoke test de recebimento: mensagem de um celular real precisa aparecer na Inbox.
23. Manter o serviço antigo **parado, não deletado**.

### Fase 3 — Encerramento (~14 dias depois)

24. `DROP SCHEMA lubritec CASCADE` e `DROP SCHEMA lubritec_test CASCADE` no `PROJETO SAAS`.
25. Remover o bucket `hsm-headers` antigo.
26. Ativar o `pg_dump` semanal (§7).

---

## 5. Componente novo: script de cópia do Storage

`server/scripts/migrateSupabaseStorage.ts` — utilitário one-shot, idempotente, com `--apply`
seguindo o padrão dos scripts existentes.

- **Entrada:** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` de origem e destino, nome do bucket.
- **Faz:** lista objetos no bucket de origem (`POST /storage/v1/object/list/<bucket>`), baixa cada
  um pela URL pública, sobe no destino com `x-upsert: true` (mesmo mecanismo do
  [storage.ts](../../../server/lib/storage.ts)).
- **Saída:** relatório objeto a objeto, com contagem final para conferir contra os 9 esperados.
- **Dry-run por padrão.**

---

## 6. Verificação

### 6.1 Reconciliação do banco

Rodar nos dois projetos e comparar linha a linha:

```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables
WHERE schemaname = 'lubritec' ORDER BY relname;
```

Exigir: 25 tabelas, 46 linhas em `_migrations`, e contagens iguais às de §1.3 (mais o que entrou
entre o levantamento e o corte).

### 6.2 Checagem de URLs órfãs no banco novo

```sql
SELECT count(*) FROM lubritec.whatsapp_hsm_templates
WHERE header_media_url LIKE '%cmighponfvaagzbhqici%';
-- esperado: 0
```

### 6.3 Validação funcional (obrigatória no ensaio e no corte)

- Login com usuário real.
- Dashboard carrega estatísticas.
- **Inbox exibe mídia antiga** — abrir uma conversa com imagem entre as 254 (prova do volume).
- Envio de mensagem manual.
- Campanha de teste para número interno.
- IA responde numa conversa de teste.
- Upload de header no builder de template HSM (prova do Storage novo).

### 6.4 Decisão registrada — mídia CDN quebrada

As 20 mensagens de §1.6 seguem quebradas após a migração. Duas opções, a decidir antes da Fase 2:

- **(a) Aceitar** — 20 mensagens antigas sem preview. Custo zero.
- **(b) Rodar o backfill pendente no container de produção antes do corte** — recupera o que ainda
  estiver disponível na CDN. Depois do corte não há segunda chance.

---

## 7. Compensação do plano Free

Sem PITR, o export semanal deixa de ser opcional. `pg_dump --schema=lubritec` agendado, com
destino fora do Supabase (S3/R2/Backblaze) e retenção mínima de 4 semanas. Definir quem monitora a
falha do job — backup que ninguém verifica não é backup.

---

## 8. Rollback

Enquanto o schema antigo existir: religar o serviço antigo, reverter DNS e re-registrar os
webhooks no domínio antigo.

**Ponto de não-retorno:** a primeira mensagem inbound gravada no banco novo. A partir daí, voltar
significa perder mensagens. O smoke test do passo 22 é deliberadamente o último passo — é ele que
cruza essa linha.

---

## 9. Fora de escopo

- Migração de UazAPI, Gemini, SMTP e registrador de domínio para contas do cliente.
- Merge das branches pendentes (`feat/campaign-cnpj-audience`, `feat/uazapi-multi-instance-inbound`).
  A migração move o que está **em produção hoje**; misturar deploy de feature com troca de infra
  destrói a capacidade de diagnosticar o que quebrou.
- Itens P1 do PRODUCTION_CHECKLIST (Sentry, helmet, pino).

---

## 10. Premissas a confirmar

1. O EasyPanel novo é uma conta separada, não um projeto na mesma conta. Se for a mesma máquina, o
   passo 11 simplifica para uma cópia local de volume.
2. Existe acesso SSH aos dois hosts EasyPanel para o `tar` do passo 11. Se não houver, a
   alternativa é download/upload via UI, mais lento e mais frágil.
3. O domínio final: subdomínio do EasyPanel novo ou domínio próprio da Lubritec. Domínio próprio
   apontado **antes** do corte tornaria o passo 20 desnecessário.
