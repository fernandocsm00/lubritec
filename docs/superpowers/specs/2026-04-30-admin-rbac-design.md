# Admin / RBAC — Design

**Status:** Aprovado em 2026-04-30 por brainstorming colaborativo.
**Sub-projeto:** 1 de 5 da roadmap pós-Fundação.
**Pré-requisito:** fase Fundação concluída (commits `4490f08..6c3a87b` em `master`).

## 1. Objetivo

Substituir o placeholder `/admin` por uma tela funcional de gestão de usuários da equipe Lubritec. Permitir ao admin: convidar novos membros, listar todos, alterar nome/role, ativar/desativar, e reenviar convite expirado — com revogação imediata de sessão quando role ou status mudam.

## 2. Escopo

### Incluído
- 3 endpoints novos: `GET /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/resend-invite`.
- Revogação imediata de sessão ao alterar `role` ou `is_active`.
- Auto-proteção do admin (não pode se desativar nem alterar a própria role).
- Invariante "convite reenviado invalida tokens anteriores".
- Bloqueio de refresh para usuário com `is_active=false`.
- Frontend: substituição do placeholder `/admin` por uma tela única com tabela, busca, filtros, modal de convite e modal de edição.
- Testes de integração backend (~12 cases).

### Não incluído (justificativa)
- **Audit trail / log de mudanças** — fora do MVP escolhido (opção B no brainstorming). Pode entrar num sub-projeto futuro de Compliance se a Lubritec exigir.
- **Hard delete** — só soft-delete via `is_active=false`. Preserva referência por id em logs/eventos futuros.
- **Last-admin invariant** — admin único pode desativar admin secundário sem checagem; só não pode se sabotar diretamente. Risco aceitável pra equipe pequena.
- **Multi-tenant** — todos os usuários compartilham o mesmo schema. Quando entrar Multi-loja Lubritec (se entrar), vira sub-projeto novo.
- **Frontend testing** — infra de RTL/jsdom não existe ainda. Defiro pra sub-projeto "frontend testing infra".
- **Reset forçado de senha pelo admin** — fora do MVP. Usuário pode usar o "esqueci minha senha" do `/login`.
- **Edição de email** — read-only. Trocar email vira "desative + convide com email novo".

## 3. Decisões de arquitetura

### 3.1 Revogação de sessão: **imediata**
Ao alterar `role` ou `is_active` de um usuário, a transação que faz o `UPDATE users` também executa `DELETE FROM sessions WHERE user_id = :id`. Próxima request do alvo (com qualquer access token velho) ainda passa até expirar (15min máx), mas qualquer chamada a `/api/auth/refresh` retorna 401.

Para garantir efeito ainda mais cedo: `authService.refreshAccess` recebe um JOIN com `users.is_active`. Se for `false`, retorna 401 e revoga a sessão (defensivo — o `DELETE` já deveria ter limpado).

### 3.2 Auto-proteção: **médio**
`PATCH /api/users/:id` rejeita com `409 Cannot modify your own role or status` se:
- `params.id === req.user.id` E o body contém `role` ou `is_active`.

Mudar o próprio `name` é permitido (sem revogação de sessão).

Não validamos "último admin" — equipe pequena, baixo risco. Documentar em README como pegadinha conhecida.

### 3.3 Reenvio de convite: **clean reset**
- Endpoint: `POST /api/users/:id/resend-invite`.
- Pré-condição: `users.password_hash IS NULL`. Caso contrário 409.
- Comportamento: numa transação, `DELETE FROM auth_tokens WHERE user_id=:id AND purpose='invite'`, gera token novo via `generateInviteToken` (já existe), envia email via `sendInviteEmail` (já existe).
- Frontend mostra o botão "Reenviar convite" na linha da tabela apenas quando `has_password === false`.

### 3.4 Soft delete only
- Sem endpoint `DELETE`. Desativação = `PATCH { is_active: false }`.
- Lista padrão mostra todos os usuários, com filtro chips para ocultar "Inativos".
- Email continua único — não dá pra reusar email de usuário desativado em novo convite (constraint UNIQUE em `users.email`). Aceito.

## 4. Contratos do backend

### 4.1 `GET /api/users`
Auth: `authGuard + requireRole('admin')`.

Resp 200:
```json
{
  "users": [
    {
      "id": "uuid",
      "email": "fulano@empresa.com",
      "name": "Fulano da Silva",
      "role": "admin",
      "is_active": true,
      "last_login_at": "2026-04-29T10:00:00Z",
      "created_at": "2026-04-15T09:00:00Z",
      "has_password": true
    }
  ]
}
```

`has_password` derivado: `password_hash IS NOT NULL`. Não expor `password_hash` em hipótese alguma.

Ordenação: `role = 'admin' DESC, name ASC`. Sem paginação (escala esperada: 5–20 usuários).

### 4.2 `PATCH /api/users/:id`
Auth: `authGuard + requireRole('admin')`.

Body schema (Zod):
```ts
z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.enum(['admin', 'comercial', 'recepcao']).optional(),
  is_active: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field required' },
);
```

Validações sequenciais:
1. Param `id` é UUID válido → senão 400.
2. Usuário existe → senão 404 `User not found`.
3. Se `params.id === req.user.id` e (`role` ou `is_active` no body) → 409 `Cannot modify your own role or status`.
4. Aplica UPDATE numa transação.
5. Se mudou `role` ou `is_active`: `DELETE FROM sessions WHERE user_id = :id` na mesma transação.
6. Retorna o usuário atualizado (mesmo shape do GET, sem `password_hash`).

### 4.3 `POST /api/users/:id/resend-invite`
Auth: `authGuard + requireRole('admin')`.

Body: vazio.

Validações:
1. UUID válido → 400.
2. Usuário existe → 404 `User not found`.
3. `password_hash IS NOT NULL` → 409 `User already activated`.
4. Numa transação:
   - `DELETE FROM auth_tokens WHERE user_id = :id AND purpose = 'invite'`
   - Gera novo token (reusa `generateInviteToken` existente)
   - Envia email via `sendInviteEmail` (já existe)
5. Resp 200: `{ ok: true }`.

### 4.4 Ajuste no `authService.refreshAccess`
Hoje: valida sessão + gera novo access token.
Novo: ao buscar a sessão, faz JOIN com `users` e filtra `users.is_active = true`. Se a sessão existe mas o usuário está inativo, retorna 401 `Inactive account` E `DELETE FROM sessions WHERE id = :session_id` (limpa).

Isto é defensivo — em condições normais o `PATCH` já limpou tudo. Mas se algum admin mudou `is_active` via SQL direto, o sistema se recupera no próximo refresh.

## 5. Frontend

### 5.1 Estrutura de arquivos
```
src/pages/admin/AdminPage.tsx              (substitui o placeholder)
src/features/admin/
  ├── api.ts                                (hooks React Query)
  ├── UsersTable.tsx
  ├── InviteUserDialog.tsx
  ├── EditUserDialog.tsx
  └── UserActions.tsx                       (dropdown por linha)
```

### 5.2 Hooks (`api.ts`)
```ts
useUsers()                  // GET /api/users  → User[]
useInviteUser()             // POST /api/users  (move de auth/api)
useUpdateUser()             // PATCH /api/users/:id
useResendInvite()           // POST /api/users/:id/resend-invite
```

Cada mutation invalida `['users']` no `onSuccess`. Sem updates otimistas.

### 5.3 AdminPage
Layout:
- Header: título "Usuários" (h1) + botão "Convidar usuário" (variant primary, ícone UserPlus).
- Filtros: input de busca (debounce 200ms, filtra `name` e `email`) + 4 chips: Todos / Ativos / Convite pendente / Inativos.
- UsersTable abaixo.

Estados:
- Loading inicial → 4 linhas de Skeleton.
- Empty (0 usuários) → card centralizado "Nenhum usuário ainda. Convide o primeiro." + CTA.
- Error → toast + botão "Tentar novamente".

### 5.4 UsersTable
Colunas:
1. **Nome** — Avatar (initials, mesmo helper do Topbar) + name + email (em texto secundário).
2. **Role** — Badge colorido. Admin=primary, comercial=secondary, recepcao=outline.
3. **Status** — Pill: "Ativo" (verde), "Convite pendente" (amarelo, se `has_password=false && is_active=true`), "Inativo" (cinza).
4. **Último login** — relativo via Intl.RelativeTimeFormat ("há 2 dias"). Mostra "Nunca" se null.
5. **Ações** — dropdown ⋯ com itens contextuais (ver UserActions).

### 5.5 UserActions (dropdown ⋯)
Itens:
- **Editar** — sempre presente, abre EditUserDialog.
- **Desativar** / **Reativar** — toggle baseado em `is_active`. Linha da própria conta: disabled com tooltip "Você não pode modificar sua própria conta."
- **Reenviar convite** — visível apenas se `has_password === false`.

Confirmação:
- Desativar: shadcn `AlertDialog` "Desativar [nome]? Todas as sessões dele serão encerradas." Cancel / Desativar (variant destructive).
- Reativar: confirmação simples sim/não.
- Reenviar convite: sem confirmação, apenas toast.

### 5.6 EditUserDialog
Form com react-hook-form + zod (mesmo padrão das auth pages).

Campos:
- **Email** — read-only, com texto auxiliar "Email não pode ser alterado".
- **Nome** — text input.
- **Role** — select (admin / comercial / recepcao). Disabled se for a própria conta + tooltip.

Validação:
- name: min 2, max 100.
- role: enum.

Submit: chama `useUpdateUser` com diff (só os campos que mudaram). Toast de sucesso, fecha modal, invalida lista.

### 5.7 InviteUserDialog
Form com react-hook-form + zod.

Campos:
- **Nome** — required, min 2.
- **Email** — required, formato email.
- **Role** — select required, default = "comercial".

Submit: chama `useInviteUser`. Toast "Convite enviado para [email]". Fecha modal, invalida lista. Backend já dispara o email via Mailtrap.

### 5.8 Tradução de erros
Map no client (em `api.ts` ou helper):
- `Cannot modify your own role or status` → "Você não pode modificar sua própria conta."
- `User already activated` → "Esse usuário já completou o cadastro."
- `Email already exists` (do POST existente) → "Já existe um usuário com esse email."

## 6. Estratégia de testes

### 6.1 Backend (`server/tests/users.test.ts`)
- Setup: cria 2 admins + 1 comercial via factories já existentes em `auth.test.ts`.
- Roda contra schema `lubritec_test` (já isolado).
- Cobre: 5 felizes + 6 erros + 1 de revogação no refresh = ~12 cases.

Detalhe importante: o teste de revogação no refresh tem 4 passos:
1. Login como comercial → recebe access + refresh cookie.
2. Admin desativa o comercial.
3. Comercial chama `/api/auth/refresh` com o cookie velho.
4. Espera 401 + sessão sumiu.

### 6.2 Frontend
Sem cobertura nesse sub-projeto. Validação manual no checklist de critério de pronto.

## 7. Critério de pronto

- [ ] `npm run lint` verde.
- [ ] `npm run test` verde (incluindo `users.test.ts` novo).
- [ ] Login como admin → vai pra `/admin/users`, vê lista com pelo menos o seed.
- [ ] Convidar usuário → email chega no Mailtrap → link abre `/auth/setup` → setup conclui → novo usuário aparece como "Ativo" na lista.
- [ ] Reenviar convite num usuário pendente → novo email chega, link velho retorna erro.
- [ ] Editar role do comercial pra recepcao → comercial é redirecionado pro login na próxima ação (sessão revogada).
- [ ] Desativar comercial → sessão dele cai imediatamente; tentativa de refresh retorna 401.
- [ ] Admin tenta editar a própria role → modal mostra disabled + tooltip; backend rejeita 409 caso tentativa via curl.
- [ ] Admin tenta desativar a si mesmo → 409.
- [ ] Filtros de status funcionam, busca por nome/email funciona.
- [ ] Sidebar "Admin" continua visível só para admins.

## 8. Riscos

1. **`is_active=false` deixa email travado.** Não dá pra criar novo usuário com email de alguém desativado (UNIQUE constraint). Mitigação: documentar; adicionar opção "Editar email" no futuro se virar dor real.
2. **Race no resend-invite.** Dois admins reenviam ao mesmo tempo → 2 tokens válidos por um instante (DELETE+INSERT não é atômico cross-request). Mitigação: a transação garante atomicidade dentro de cada request; em prática 2 admins reenviando junto é raro e o último ganha. Aceito.
3. **Last-admin lockout.** Admin único desativa o admin secundário, depois desativa a si mesmo via SQL ou bug → trancado. Mitigação: documentar como ponto cego conhecido. Recuperação: SQL direto.
4. **Frontend não revoga UI ao mudar role do logado.** O admin logado modifica a si mesmo (só name) → cache local fica desatualizado se backend mudou outras coisas. Mitigação: `invalidateQueries(['me'])` junto com `['users']` no useUpdateUser.

## 9. Plano de execução (8 tasks, ~2.5 dias)

Ver `docs/superpowers/plans/2026-04-30-admin-rbac-implementation.md` (a ser escrito).

1. **T1** — Backend: Zod schemas + testes vermelhos (TDD).
2. **T2** — Backend: `GET /api/users`.
3. **T3** — Backend: `PATCH /api/users/:id` com revogação + self-protection.
4. **T4** — Backend: `POST /api/users/:id/resend-invite`.
5. **T5** — Backend: ajuste em `authService.refreshAccess`.
6. **T6** — Frontend: `src/features/admin/api.ts` (hooks React Query).
7. **T7** — Frontend: `AdminPage` + `UsersTable` + filtros/busca.
8. **T8** — Frontend: dialogs (Invite/Edit) + UserActions + critério de pronto.

Cada task termina em commit. Execução via subagent-driven development, com revisão de spec compliance + code quality entre tasks.
