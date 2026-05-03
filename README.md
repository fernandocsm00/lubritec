# LubriConnect

SaaS de qualificação de leads e atendimento WhatsApp da Lubritec.

## Stack
- React 19 + Vite + Tailwind + shadcn/ui (frontend)
- Express + TypeScript (backend, mesma porta do frontend via Vite middleware)
- PostgreSQL 16 + Drizzle ORM (banco; isolamento por **schema**, não por database)
- argon2 + JWT + magic link (auth)
- TanStack Query, Zustand, React Hook Form, Zod (frontend state/forms)
- Vitest + Supertest (testes)

## Pré-requisitos
- Node 20+
- Acesso ao projeto Supabase **OU** Docker (para Postgres local de fallback)

## Setup

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env` e preencha:

- **`DATABASE_URL`** e **`TEST_DATABASE_URL`** — apontam para o **mesmo** banco. O isolamento é por schema (`DB_SCHEMA=lubritec`, `TEST_DB_SCHEMA=lubritec_test`), não por database separada.
  - Padrão (time): pegue a senha do Supabase em https://supabase.com/dashboard/project/cmighponfvaagzbhqici/settings/database e substitua `[YOUR-DB-PASSWORD]` (URL-encoded) nas duas linhas.
  - Alternativa local: use Docker (instruções em "Postgres local" abaixo).
- **`JWT_SECRET`** — gere um valor aleatório:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

- **`SMTP_*`** — em dev, use Mailtrap (https://mailtrap.io) e cole as credenciais da inbox de sandbox.

`APP_URL=http://localhost:3000` é o correto para o setup unificado (Express serve o front via Vite middleware na mesma porta). Não altere para `:5173` — links de magic-link viram quebrados.

### 3. Aplicar migrations (dev e teste)

```bash
npm run migrate
NODE_ENV=test npm run migrate
```

Cada comando cria seu schema (`lubritec` ou `lubritec_test`) caso não exista, e aplica as migrations 001–006 dentro do schema correspondente. Os dois comandos são necessários porque os testes truncam tabelas no schema de teste.

### 4. Criar admin inicial

```bash
npm run seed
```

O script pede uma senha temporária (mínimo 8 caracteres) e cria o usuário `fernando@agenciaimperium.com.br` com role `admin`. Idempotente — rodar de novo não duplica.

### 5. (Opcional) Importar customers do SQLite legado

Coloque o arquivo `lubritec.db` na raiz do projeto e rode:

```bash
npm run import:legacy
```

Se `lubritec.db` não existir, o script encerra sem erro.

### 6. Subir o servidor

```bash
npm run dev
```

Acesse **http://localhost:3000** e faça login com `fernando@agenciaimperium.com.br` + a senha definida no seed.

## Postgres local (alternativa ao Supabase)

Se preferir não usar o Supabase em dev:

```bash
npm run db:up
```

Isso sobe o container `lubritec-pg` (Postgres 16) com:
- usuário `lubritec`, senha `lubritec_dev`, database `lubritec`, porta `5432`

No `.env`, troque os dois URLs para apontar local:

```
DATABASE_URL=postgresql://lubritec:lubritec_dev@localhost:5432/lubritec
TEST_DATABASE_URL=postgresql://lubritec:lubritec_dev@localhost:5432/lubritec
```

Os dois URLs continuam iguais — schemas isolam dev de teste dentro do mesmo banco.

Para parar:

```bash
npm run db:down
```

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Sobe servidor (Express + Vite middleware) em http://localhost:3000 |
| `npm run build` | Build de produção (Vite + tsc do backend) |
| `npm run lint` | Type-check de frontend e backend |
| `npm run test` | Roda testes (vitest, schema `lubritec_test`) |
| `npm run test:watch` | Testes em modo watch |
| `npm run migrate` | Aplica migrations no schema definido por `NODE_ENV` (`lubritec` ou `lubritec_test`) |
| `npm run seed` | Cria admin inicial |
| `npm run import:legacy` | Importa `customers` do `lubritec.db` antigo para `leads` |
| `npm run db:up` | Sobe Postgres local via docker-compose (alternativa ao Supabase) |
| `npm run db:down` | Para o Postgres local |

## Estrutura

Veja `docs/superpowers/specs/2026-04-29-fundacao-design.md`.

## Admin / RBAC

Tela em `/admin` (visível só para `role=admin`) com:
- Lista de usuários (admin primeiro, depois alfabética).
- Convidar novo usuário (envia magic link).
- Editar nome / role; ativar/desativar.
- Reenviar convite pra usuário com cadastro pendente.

Self-protection: o admin logado não pode alterar a própria role nem se desativar (UI desabilita + backend rejeita 409).

Revogação de sessão: ao mudar `role` ou `is_active` de outro usuário, todas as sessões dele são revogadas. Próxima chamada a `/api/auth/refresh` retorna 401 e desloga o usuário.

Pegadinha conhecida: não há invariante "último admin". Admin único pode desativar o admin secundário e depois ficar trancado se desativar a si mesmo via SQL — recuperação manual via banco.

## Cadastros

Tela em `/cadastros` (qualquer usuário autenticado) com:
- Lista server-paginada (50/page) com search (nome/telefone/placa) + filtros (status, origem) + ordenação clicável.
- Criar/editar/excluir lead. Telefone é normalizado (só dígitos) e não editável após criação.
- Importação CSV com headers em PT ou EN, delimitador `,` ou `;`, máximo 5MB. Linhas válidas são inseridas/atualizadas em uma transação; inválidas voltam num relatório com motivo.
- Upsert seletivo no import: se o phone já existe, só preenche colunas vazias — nunca sobrescreve dados existentes. Status e source de leads existentes ficam intocados.

## WhatsApp Inbox

Tela em `/whatsapp` (qualquer usuário autenticado) com:

- 3 colunas: lista de conversas (filtrada por fila + chips) | thread | sidebar do lead.
- **Filas:** IA / Recepção / Comercial. Conversa nova entra em **Recepção**. Movimentação manual via "Mover ▾".
- **Status (filtros):** Aguardando / Em atendimento / Encerradas / Expiradas 24h / Sem retorno.
- **Atribuição manual:** botão "Pegar conversa" vira o operador dono. Auto-claim na primeira mensagem outbound.
- **Composer:** texto + emoji + templates de resposta + anexar mídia (via URL pública na v1).
- **Polling:** TanStack Query 5s (lista) / 2.5s (thread aberta) / 5s (contadores).

Configurar no `.env`:

```
UAZAPI_BASE_URL=https://api.uazapi.com
UAZAPI_TOKEN=...
UAZAPI_INSTANCE_ID=...
UAZAPI_WEBHOOK_SECRET=...    # gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
NO_RESPONSE_DAYS=7
```

Configure o webhook no painel do UazAPI apontando pra `https://<seu-host>/api/whatsapp/webhook` com header `X-Webhook-Token: <UAZAPI_WEBHOOK_SECRET>`.

## Inside Sales

Tela em `/inside-sales` (apenas `admin` + `comercial`) com:

- 4 colunas: **Proposta enviada** → **Em negociação** → **Ganho** / **Perdido**.
- **Drag & drop** entre colunas (`@dnd-kit`). Mover pra Perdido abre dialog com motivo (4 opções: condições comerciais, preço, sem retorno, fora do perfil). Mover pra Ganho exige valor da proposta preenchido.
- **Card de deal** mostra: avatar, nome, veículo · placa, valor (R$) ou "—", dono, tempo. Tag amarela "parado" se deal sem atividade há > 3 dias.
- **Drawer lateral** ao clicar no card: dados do lead, valor editável inline, notas, **timeline de atividades** (created, stage_changed, value_changed, won, lost, reactivated, etc.), atalhos pra `/whatsapp` e `/cadastros`.
- **Tab "Histórico"**: deals com `closed_at` há mais de 7 dias, paginado, com filtros (período, etapa, motivo, dono).
- **Auto-trigger:** quando Comercial manda **imagem** numa conversa da fila Comercial do WhatsApp Inbox, o lead **entra automaticamente** no pipeline em "Proposta enviada". Idempotente — se já existe deal ativo, no-op; se está em terminal, reativa.
- **Polling 5s** (lista) / **5s** (drawer). URL params persistem filtros pra deep-linking.

Acesso pra Recepção: 403 (não vê o link na sidebar nem acessa a página).

## Conexão WhatsApp

Tela em `/settings?tab=whatsapp` (apenas `admin` + `comercial`) com:

- **Empty state** — "Pronto para conectar". Botão único **CONECTAR INSTÂNCIA**.
- **Pairing** — QR code de 256x256 com instruções (1. Abrir WhatsApp · 2. Aparelhos conectados · 3. Conectar). Polling 2s atualiza o QR automaticamente.
- **Conectado** — avatar + nome do perfil + telefone formatado + última verificação. Polling 30s detecta queda.
- **Erro** — mensagem clara quando UazAPI fora do ar; retorna automaticamente quando voltar.

Ações:
- **CONECTAR** — cria instância no UazAPI (se não existe) + registra webhook + retorna QR. Idempotente (reusa instância existente).
- **DESCONECTAR** — logout sem deletar; admin pode reconectar depois.
- **APAGAR** — `admin` apenas. Apaga instância no UazAPI + zera credenciais. Conversas históricas preservadas.

**Config no DB**, não em env vars: as variáveis `UAZAPI_*` viram seed inicial — após a primeira conexão pela UI, o DB é a fonte da verdade. `webhook_secret` é gerado automaticamente (`crypto.randomBytes(32)`).

**Indicador "● Credenciais protegidas no servidor"** — token UazAPI nunca volta no response do backend; frontend só vê estados booleanos.

Pré-requisito: variável `APP_URL` configurada (ex: `https://app.lubritec.com`). UazAPI precisa conseguir alcançar `${APP_URL}/api/whatsapp/webhook`.

## Campanhas (disparo em massa)

Tela em `/campanhas` (apenas `admin` + `comercial`) com:

- **Lista de campanhas** com status, audiência, % enviadas, criada por.
- **Wizard de criação** em 4 passos:
  1. Nome + descrição
  2. Audiência: filtros (status, source, última compra) + opt-out manual + upload CSV
  3. Mensagem: template (opcional) + edição inline + placeholders + imagem (upload nativo)
  4. Revisão + agendamento ("agora" ou data/hora) + dupla confirmação se > 50 leads

- **Placeholders** suportados: `{{nome}}`, `{{telefone}}`, `{{placa}}`, `{{modelo}}`, `{{ultima_compra}}`. Preview ao vivo na tela de mensagem.

- **Dispatcher in-process** (`setInterval` 60s no boot do server). Rate-limit padrão 20 msg/min (~1 a cada 3s, override por campanha via `ratePerMinute`). Resume natural via `WHERE status='pending'`. Pausável e cancelável mid-execução.

- **Detail page** com:
  - Progresso ao vivo (se running): barra "X/Y processadas" + breakdown enviadas/falharam/ignoradas
  - **Funil ROI**: Enviadas → Respondidas → Em negociação → Ganho/Perdido (com motivos + R$ total fechado)
  - Lista paginada de destinatários com filtro por status (polling para quando a campanha termina)

- **APAGAR** restrito a admin (mesmo padrão do Inside Sales). Conversas históricas continuam disponíveis (FK `ON DELETE SET NULL`).

Mídia: upload via multer (5MB, jpeg/png/webp) pra `/uploads/campaigns/`. Pasta servida via Express static. UazAPI baixa direto a URL pública.

Pré-requisito: variável `APP_URL` configurada (UazAPI precisa alcançar `${APP_URL}/uploads/...`). Variável opcional: `DISPATCH_RATE_PER_MINUTE` (default 20).

## Próximos sub-projetos
1. ✅ Admin/RBAC — gestão de usuários e permissões
2. ✅ Cadastros — leads completos + import CSV
3. ✅ WhatsApp Inbox — conversas com filas + composer
4. ✅ Inside Sales — pipeline kanban + drag & drop + activity log
5. ✅ Conexão WhatsApp — gestão da instância UazAPI via UI
6. ✅ Disparo em massa de campanhas — wizard + agendamento + funil ROI
7. IA de pré-qualificação
8. Dashboard de Funil — métricas e conversão
