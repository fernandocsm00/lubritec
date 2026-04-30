# LubriConnect

SaaS de qualificação de leads e atendimento WhatsApp da Lubritec.

## Stack
- React 19 + Vite + Tailwind + shadcn/ui (frontend)
- Express + TypeScript (backend)
- PostgreSQL 16 + Drizzle ORM (banco)
- argon2 + JWT + magic link (auth)
- TanStack Query, Zustand, React Hook Form, Zod (frontend state/forms)
- Vitest + Supertest (testes)

## Pré-requisitos
- Node 20+
- Docker (para Postgres local)

## Setup

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite .env e gere um JWT_SECRET:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Subir Postgres local
npm run db:up

# 4. Criar database de teste (apenas na 1a vez)
docker exec -it lubritec-pg psql -U lubritec -c "CREATE DATABASE lubritec_test;"

# 5. Rodar migrations (dev e teste)
npm run migrate
NODE_ENV=test npm run migrate

# 6. Criar admin inicial (vai pedir senha temporária)
npm run seed

# 7. (Opcional) Importar customers do SQLite legado
# Coloque lubritec.db na raiz do projeto antes de rodar:
npm run import:legacy

# 8. Subir o servidor
npm run dev
```

Acesse http://localhost:3000 e faça login com `fernando@agenciaimperium.com.br` + a senha definida no seed.

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Sobe servidor (Express + Vite middleware) em http://localhost:3000 |
| `npm run build` | Build de produção |
| `npm run lint` | Type-check de frontend e backend |
| `npm run test` | Roda testes (vitest) |
| `npm run test:watch` | Testes em modo watch |
| `npm run migrate` | Aplica migrations pendentes |
| `npm run seed` | Cria admin inicial |
| `npm run import:legacy` | Importa `customers` do `lubritec.db` antigo para `leads` |
| `npm run db:up` | Sobe Postgres via docker-compose |
| `npm run db:down` | Para o Postgres |

## Estrutura

Veja `docs/superpowers/specs/2026-04-29-fundacao-design.md`.

## Próximos sub-projetos
1. Admin/RBAC — gestão de usuários e permissões
2. Cadastros — leads completos + import CSV
3. Inside Sales — pipeline kanban / CRM
4. WhatsApp + Filas — atendimento multi-fila
5. Dashboard de Funil — métricas e conversão
