# Production Readiness Checklist

Itens **fora do código** que precisam ser feitos antes do go-live. Os itens dentro do código já foram corrigidos nesta branch.

---

## 1. Rotacionar segredos vazados (P0)

A cópia local do `.env` contém credenciais reais que foram lidas durante a auditoria. Mesmo `.env` estando gitignored, considere todos os segredos abaixo como comprometidos e gere novos:

- [ ] **Senha do banco Supabase** — `Settings > Database > Reset database password`. Atualize `DATABASE_URL` no `.env` local e no painel EasyPanel.
- [ ] **JWT_SECRET** — gere uma string aleatória nova (mínimo 32 chars). Exemplo: `openssl rand -base64 48`. Atualizar invalida todas as sessões ativas — usuários vão precisar logar de novo.
- [ ] **SMTP_PASS (Brevo)** — gere uma API key nova em `Brevo > SMTP & API > API keys`, revogue a antiga.
- [ ] **GEMINI_API_KEY** — gere uma chave nova em `https://aistudio.google.com/app/apikey` e revogue a antiga.
- [ ] **UAZAPI_ADMIN_TOKEN** — se aplicável, regenere no painel UazAPI.

Confirme depois com `git log -p -- .env 2>/dev/null` que o arquivo nunca foi commitado (deve retornar vazio).

---

## 2. Variáveis de ambiente no EasyPanel (P0)

Em `EasyPanel > seu serviço > Environment`, confirme que **todas** estas estão setadas com valores reais (não placeholders):

| Variável | Obrigatória | Default | Notas |
|---|---|---|---|
| `DATABASE_URL` | sim | — | Senha rotacionada (item 1) |
| `JWT_SECRET` | sim | — | Senha rotacionada (item 1) |
| `APP_URL` | sim | — | `https://ia-lubriconnect.eldzmi.easypanel.host` (ou domínio custom) |
| `NODE_ENV` | sim | development | **`production`** |
| `PORT` | não | 3000 | Manter 3000 (EasyPanel mapeia) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | sim | — | Brevo |
| `GEMINI_API_KEY` | sim (IA) | — | Sem ela a IA fica desligada |
| `UAZAPI_BASE_URL` | sim | — | `https://api.uazapi.com` |
| `UAZAPI_ADMIN_TOKEN` | opcional | — | Pode configurar via UI depois |
| `INVITE_TTL_DAYS` | não | 7 | |
| `RESET_TTL_HOURS` | não | 1 | |
| `DB_SCHEMA` | não | lubritec | |
| `DISPATCH_RATE_PER_MINUTE` | não | 20 | |
| `NO_RESPONSE_DAYS` | não | 7 | |

Se alguma obrigatória faltar, o servidor sobe mas falha na primeira request (ex: `JWT_SECRET must be set`).

---

## 3. Volume persistente para uploads (P0)

O `Dockerfile` agora declara `VOLUME ["/app/uploads"]`. Sem mount, o EasyPanel ainda usa armazenamento efêmero do container — mídia some a cada redeploy.

- [ ] No EasyPanel > seu serviço > **Mounts** (ou **Volumes**), criar um mount persistente apontando para `/app/uploads`.
- [ ] Após criar, **redeploy** o serviço.
- [ ] Verificar que arquivos enviados sobrevivem a um `Restart` manual.

---

## 4. Backups do Supabase (P0)

- [ ] Confirmar no painel Supabase do projeto que o **Point-in-Time Recovery** (PITR) está ativo, ou no mínimo o backup diário automático (plano gratuito tem 1 dia de retenção; plano Pro tem 7 dias + PITR).
- [ ] Documentar internamente quem tem acesso de restauração.
- [ ] Considerar export semanal manual via `pg_dump` para um bucket S3/R2 como backup-de-backup nos primeiros meses.

---

## 5. WhatsApp Business / número oficial (P0)

- [ ] Confirmar com a Lubritec qual número estará vinculado à instância UazAPI em produção (não pode ser o mesmo de dev/staging).
- [ ] Em **Settings > WhatsApp** dentro do SaaS em produção, fazer a conexão inicial. O DB se torna fonte de verdade depois disso — variáveis de ambiente UazAPI viram só seed.
- [ ] Validar com 1-2 disparos teste para números internos antes de habilitar campanhas.

---

## Itens P1 já corrigidos no código (esta branch)

- ✅ 5 testes pré-existentes vermelhos (`leads-api`, `leads-service`, `dashboard-summary-org`).
- ✅ `Dockerfile` rodando como `USER node` (não root).
- ✅ `Dockerfile` com `HEALTHCHECK` para `/api/health`.
- ✅ `Dockerfile` declarando `VOLUME` para `/app/uploads`.
- ✅ `.env.example` sem referência ao project ref real do Supabase.

---

## Próximos itens (P1, primeira semana pós-launch)

- Instalar Sentry (server + client).
- Adicionar `helmet` middleware.
- Logger estruturado (pino) para substituir `console.*`.
- Rate limit em `/setup-password` e `/reset-password`.
- Retry/backoff em `geminiClient` e `uazapiClient`.
- Endpoint `/api/health/ready` com check de DB e UazAPI.

Cada um vira uma issue separada conforme priorização.
