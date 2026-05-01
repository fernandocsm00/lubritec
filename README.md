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

## Próximos sub-projetos
1. ✅ Admin/RBAC — gestão de usuários e permissões
2. ✅ Cadastros — leads completos + import CSV
3. Inside Sales — pipeline kanban / CRM
4. ✅ WhatsApp Inbox — conversas com filas + composer
5. Disparo em massa de campanhas
6. IA de pré-qualificação
7. Dashboard de Funil — métricas e conversão
