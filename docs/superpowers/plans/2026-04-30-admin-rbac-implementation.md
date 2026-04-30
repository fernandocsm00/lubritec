# Admin / RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir placeholder `/admin` por gestão funcional de usuários (listar, convidar, ativar/desativar, alterar role, reenviar convite) com revogação imediata de sessão e auto-proteção do admin.

**Architecture:** Adiciona 3 endpoints REST sob `/api/users`, ajusta `authService.refreshAccess` defensivamente, e cria `src/features/admin/` no frontend (hooks React Query + tela única com tabela e dialogs). Reaproveita seed `users` existente, schema Drizzle existente (sem migration — `is_active` e `password_hash` nullable já estão lá), e `sendInviteEmail` / `generateRawToken` já implementados.

**Tech Stack:** Express + Drizzle + Zod no backend; React 19 + React Hook Form + Zod 4 + TanStack Query + shadcn/ui (alert-dialog, badge, select, table) no frontend; Vitest + Supertest pra testes de integração.

**Spec de referência:** [docs/superpowers/specs/2026-04-30-admin-rbac-design.md](../specs/2026-04-30-admin-rbac-design.md)

---

## Estrutura de arquivos

### Backend — criar
- `server/services/usersService.ts` (modificar) — adicionar `listUsers`, `updateUser`, `resendInvite`.
- `server/controllers/usersController.ts` (modificar) — adicionar handlers `listHandler`, `updateHandler`, `resendInviteHandler`.
- `server/routes/users.ts` (modificar) — registrar 3 novas rotas.
- `server/services/authService.ts` (modificar) — `refreshAccess` revoga sessão quando user inativo.
- `server/tests/users-admin.test.ts` (criar) — 12 cases de integração.

### Backend — não criar
- Sem migration nova. `users.is_active` e `users.password_hash` já existem.
- Sem mudança em `shared/types.ts` exceto adicionar `AdminUser` que estende `PublicUser`.

### Frontend — criar
- `src/components/ui/alert-dialog.tsx` — primitive shadcn (não existe ainda).
- `src/components/ui/badge.tsx` — primitive shadcn (não existe ainda).
- `src/components/ui/select.tsx` — primitive shadcn (não existe ainda).
- `src/components/ui/table.tsx` — primitive shadcn (não existe ainda).
- `src/features/admin/api.ts` — hooks React Query.
- `src/features/admin/UsersTable.tsx` — tabela com colunas + estados (loading/empty/error).
- `src/features/admin/InviteUserDialog.tsx` — modal de convite.
- `src/features/admin/EditUserDialog.tsx` — modal de edição.
- `src/features/admin/UserActions.tsx` — dropdown ⋯ por linha.
- `src/features/admin/translateError.ts` — mapa de mensagens PT-BR.

### Frontend — modificar
- `src/pages/admin/AdminPage.tsx` — substituir `<Placeholder>` por `<AdminPage>` real.
- `src/features/auth/api.ts` — não muda (mantém `useMe`); adicionamos `useInviteUser` em `features/admin/api.ts` em vez de mover.
- `shared/types.ts` — adicionar `AdminUser` interface.

---

## Convenções importantes

1. **Revogação de sessão usa `revokedAt = now()`, não `DELETE`.** A spec diz "DELETE FROM sessions" mas o padrão existente em `resetPassword` (linha 150 de `authService.ts`) é `db.update(sessions).set({ revokedAt: new Date() })`. Mantemos consistência. O efeito é equivalente: `refreshAccess` filtra `isNull(sessions.revokedAt)`.
2. **Transações.** Drizzle usa `db.transaction(async (tx) => { ... })`. Toda operação que mexe em `users + sessions` ou `users + auth_tokens` em `updateUser` e `resendInvite` deve estar numa única transação.
3. **`has_password` é derivado.** No backend, retornar `passwordHash !== null` como boolean. Nunca expor `password_hash` na resposta.
4. **Erros via `HttpError`.** Status + mensagem em inglês. Frontend traduz em `translateError.ts`.
5. **Order by no listUsers.** `ORDER BY (role = 'admin') DESC, name ASC`. Drizzle: `orderBy(sql\`role = 'admin' DESC\`, asc(users.name))`.
6. **`refreshAccess` já filtra inativos** (linha 75 de `authService.ts`). T5 só adiciona o cleanup defensivo (`revoke session at refresh time`) e um teste de regressão fim-a-fim.
7. **shadcn primitives.** Usar `npx shadcn@latest add <name>` quando falta. Os 4 que faltam: alert-dialog, badge, select, table.

---

## Task 1: Backend — schemas Zod + scaffold de testes

**Files:**
- Modify: `server/controllers/usersController.ts` — adicionar Zod schemas no topo (sem handlers ainda).
- Create: `server/tests/users-admin.test.ts` — esqueleto com `describe` blocks vermelhos.

- [ ] **Step 1: Adicionar Zod schemas no controller**

Editar `server/controllers/usersController.ts` adicionando, logo após o `inviteSchema` existente:

```ts
export const updateUserSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    role: z.enum(['admin', 'comercial', 'recepcao']).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field required',
  });

export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
});
```

- [ ] **Step 2: Criar arquivo de testes vazio**

Criar `server/tests/users-admin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';
import { db } from '../db/client';
import { sessions, authTokens } from '../db/schema';
import { eq } from 'drizzle-orm';

const app = createApp();

async function loginAs(email: string, password = 'pw12345') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { accessToken: res.body.accessToken as string, cookie: res.headers['set-cookie'] };
}

describe('GET /api/users', () => {
  it.todo('admin list returns users sorted with admin first');
  it.todo('admin list omits password_hash and exposes has_password boolean');
  it.todo('non-admin gets 403');
  it.todo('unauthenticated gets 401');
});

describe('PATCH /api/users/:id', () => {
  it.todo('admin updates name only — no session revoked');
  it.todo('admin changes role — sessions of target user revoked');
  it.todo('admin deactivates user — sessions revoked');
  it.todo('admin cannot change own role — 409');
  it.todo('admin cannot deactivate self — 409');
  it.todo('returns 404 for nonexistent user');
  it.todo('returns 400 for invalid uuid');
  it.todo('returns 400 for empty body');
});

describe('POST /api/users/:id/resend-invite', () => {
  it.todo('admin resends invite — old token invalidated, new token created');
  it.todo('returns 409 if user already activated');
  it.todo('returns 404 for nonexistent user');
});

describe('refresh after deactivation', () => {
  it.todo('refresh returns 401 and revokes session when user is inactive');
});
```

- [ ] **Step 3: Rodar testes (devem passar como skipped/todo)**

Run: `npm run test -- users-admin`
Expected: 12 todos pendentes, 0 falhas, 0 sucessos.

- [ ] **Step 4: Commit**

```bash
git add server/controllers/usersController.ts server/tests/users-admin.test.ts
git commit -m "test(admin): scaffold users-admin test suite + zod schemas"
```

---

## Task 2: Backend — `GET /api/users`

**Files:**
- Modify: `server/services/usersService.ts` — adicionar `listUsers`.
- Modify: `server/controllers/usersController.ts` — adicionar `listHandler`.
- Modify: `server/routes/users.ts` — registrar `GET /`.
- Modify: `server/tests/users-admin.test.ts` — implementar 4 testes do GET.

- [ ] **Step 1: Escrever os 4 testes do GET (substituir os `it.todo`)**

Editar `server/tests/users-admin.test.ts`, substituindo o bloco `describe('GET /api/users', ...)`:

```ts
describe('GET /api/users', () => {
  it('admin list returns users sorted with admin first then by name', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin', name: 'Zed Admin' });
    await createUser({ email: 'a@b.com', password: 'pw12345', role: 'comercial', name: 'Alice' });
    await createUser({ email: 'b@b.com', password: 'pw12345', role: 'recepcao', name: 'Bob' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(3);
    expect(res.body.users[0].email).toBe('admin@b.com');
    expect(res.body.users[1].name).toBe('Alice');
    expect(res.body.users[2].name).toBe('Bob');
  });

  it('admin list omits password_hash and exposes has_password boolean', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    await createUser({ email: 'pending@b.com', name: 'Pending', role: 'comercial' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const pending = res.body.users.find((u: { email: string }) => u.email === 'pending@b.com');
    expect(pending).toBeDefined();
    expect(pending.has_password).toBe(false);
    expect('password_hash' in pending).toBe(false);
    const admin = res.body.users.find((u: { email: string }) => u.email === 'admin@b.com');
    expect(admin.has_password).toBe(true);
  });

  it('non-admin gets 403', async () => {
    await createUser({ email: 'com@b.com', password: 'pw12345', role: 'comercial' });
    const { accessToken } = await loginAs('com@b.com');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('unauthenticated gets 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falham**

Run: `npm run test -- users-admin`
Expected: 4 falhas em "GET /api/users" (rota ainda não existe, retorna 404).

- [ ] **Step 3: Implementar `listUsers` no service**

Editar `server/services/usersService.ts`, adicionando ao final:

```ts
import { sql, asc } from 'drizzle-orm';

export async function listUsers() {
  const rows = await db
    .select()
    .from(users)
    .orderBy(sql`${users.role} = 'admin' DESC`, asc(users.name));
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    is_active: u.isActive,
    last_login_at: u.lastLoginAt?.toISOString() ?? null,
    created_at: u.createdAt.toISOString(),
    has_password: u.passwordHash !== null,
  }));
}
```

Atualizar o import existente de `drizzle-orm` no topo do arquivo para incluir `sql` e `asc`. Se o arquivo já importa `eq`, fica `import { eq, sql, asc } from 'drizzle-orm';`.

- [ ] **Step 4: Implementar `listHandler` no controller**

Editar `server/controllers/usersController.ts`, adicionando ao final:

```ts
export async function listHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const list = await listUsers();
    res.json({ users: list });
  } catch (e) {
    next(e);
  }
}
```

E ajustar o import do `usersService` no topo:
```ts
import { inviteUser, listUsers } from '../services/usersService';
```

- [ ] **Step 5: Registrar rota**

Editar `server/routes/users.ts`:

```ts
import { Router } from 'express';
import {
  inviteHandler,
  listHandler,
} from '../controllers/usersController';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.get('/', authGuard, requireRole('admin'), listHandler);
router.post('/', authGuard, requireRole('admin'), inviteHandler);

export default router;
```

- [ ] **Step 6: Rodar testes — devem passar**

Run: `npm run test -- users-admin`
Expected: 4 testes do GET passam, demais ainda como `it.todo`.

- [ ] **Step 7: Commit**

```bash
git add server/services/usersService.ts server/controllers/usersController.ts server/routes/users.ts server/tests/users-admin.test.ts
git commit -m "feat(admin): GET /api/users with has_password derived field"
```

---

## Task 3: Backend — `PATCH /api/users/:id` com revogação e self-protection

**Files:**
- Modify: `server/services/usersService.ts` — adicionar `updateUser`.
- Modify: `server/controllers/usersController.ts` — adicionar `updateHandler`.
- Modify: `server/routes/users.ts` — registrar `PATCH /:id`.
- Modify: `server/tests/users-admin.test.ts` — implementar 8 testes do PATCH.

- [ ] **Step 1: Implementar 8 testes do PATCH**

Editar `server/tests/users-admin.test.ts`, substituindo o bloco `describe('PATCH /api/users/:id', ...)`:

```ts
describe('PATCH /api/users/:id', () => {
  it('admin updates name only — no session revoked', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const target = await createUser({ email: 't@b.com', password: 'pw12345', role: 'comercial', name: 'Old' });
    await loginAs('t@b.com'); // cria session
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    const targetSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
    expect(targetSessions.every((s) => s.revokedAt === null)).toBe(true);
  });

  it('admin changes role — sessions of target user revoked', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const target = await createUser({ email: 't@b.com', password: 'pw12345', role: 'comercial' });
    await loginAs('t@b.com');
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'recepcao' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('recepcao');
    const targetSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
    expect(targetSessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('admin deactivates user — sessions revoked', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const target = await createUser({ email: 't@b.com', password: 'pw12345', role: 'comercial' });
    await loginAs('t@b.com');
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
    const targetSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
    expect(targetSessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('admin cannot change own role — 409', async () => {
    const admin = await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'comercial' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/own role or status/i);
  });

  it('admin cannot deactivate self — 409', async () => {
    const admin = await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ is_active: false });
    expect(res.status).toBe(409);
  });

  it('admin can update own name (no role/status fields)', async () => {
    const admin = await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin', name: 'Before' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'After' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('After');
  });

  it('returns 404 for nonexistent user', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch('/api/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid uuid', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch('/api/users/not-a-uuid')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty body', async () => {
    const target = await createUser({ email: 't@b.com', role: 'comercial' });
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
```

Note: incluí 9 testes (adicionei "admin can update own name") em vez de 8. O spec menciona 8 mas esse é um caso positivo importante pra confirmar que self-protection só bloqueia role/is_active.

- [ ] **Step 2: Rodar testes — devem falhar todos os 9**

Run: `npm run test -- users-admin`
Expected: 9 falhas no PATCH.

- [ ] **Step 3: Implementar `updateUser` no service**

Editar `server/services/usersService.ts`, adicionando ao final (acima de `listUsers` ou abaixo, indiferente):

```ts
export async function updateUser(input: {
  id: string;
  actorId: string;
  name?: string;
  role?: Role;
  is_active?: boolean;
}) {
  const isSelf = input.id === input.actorId;
  const touchesProtected = input.role !== undefined || input.is_active !== undefined;
  if (isSelf && touchesProtected) {
    throw new HttpError(409, 'Cannot modify your own role or status');
  }

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.id, input.id)).limit(1);
    if (!existing) {
      throw new HttpError(404, 'User not found');
    }
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.role !== undefined) patch.role = input.role;
    if (input.is_active !== undefined) patch.isActive = input.is_active;
    const [updated] = await tx
      .update(users)
      .set(patch)
      .where(eq(users.id, input.id))
      .returning();

    const shouldRevoke =
      (input.role !== undefined && input.role !== existing.role) ||
      (input.is_active !== undefined && input.is_active !== existing.isActive);
    if (shouldRevoke) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, input.id));
    }
    return updated;
  });

  return {
    id: result.id,
    email: result.email,
    name: result.name,
    role: result.role,
    is_active: result.isActive,
    last_login_at: result.lastLoginAt?.toISOString() ?? null,
    created_at: result.createdAt.toISOString(),
    has_password: result.passwordHash !== null,
  };
}
```

Adicionar imports no topo do arquivo se faltarem: `import { sessions } from '../db/schema';` e `import type { Role } from '@shared/types';` (já existe).

- [ ] **Step 4: Implementar `updateHandler` no controller**

Editar `server/controllers/usersController.ts`, adicionando:

```ts
export async function updateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = userIdParamsSchema.parse(req.params);
    const body = updateUserSchema.parse(req.body);
    const updated = await updateUser({
      id,
      actorId: req.user!.userId,
      name: body.name,
      role: body.role,
      is_active: body.is_active,
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
}
```

Atualizar import: `import { inviteUser, listUsers, updateUser } from '../services/usersService';`.

- [ ] **Step 5: Registrar rota PATCH**

Editar `server/routes/users.ts`:

```ts
router.patch('/:id', authGuard, requireRole('admin'), updateHandler);
```

E atualizar o import: `import { inviteHandler, listHandler, updateHandler } from '../controllers/usersController';`.

- [ ] **Step 6: Rodar testes — devem passar todos os 9**

Run: `npm run test -- users-admin`
Expected: 4 (GET) + 9 (PATCH) = 13 verdes; resend e refresh ainda como `it.todo`.

- [ ] **Step 7: Commit**

```bash
git add server/services/usersService.ts server/controllers/usersController.ts server/routes/users.ts server/tests/users-admin.test.ts
git commit -m "feat(admin): PATCH /api/users/:id with session revoke + self-protection"
```

---

## Task 4: Backend — `POST /api/users/:id/resend-invite`

**Files:**
- Modify: `server/services/usersService.ts` — adicionar `resendInvite`.
- Modify: `server/controllers/usersController.ts` — adicionar `resendInviteHandler`.
- Modify: `server/routes/users.ts` — registrar `POST /:id/resend-invite`.
- Modify: `server/tests/users-admin.test.ts` — implementar 3 testes.

- [ ] **Step 1: Escrever os 3 testes**

Editar `server/tests/users-admin.test.ts`, substituindo o bloco `describe('POST /api/users/:id/resend-invite', ...)`:

```ts
describe('POST /api/users/:id/resend-invite', () => {
  it('admin resends invite — old token invalidated, new token created', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken: adminToken } = await loginAs('admin@b.com');

    const inviteRes = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    expect(inviteRes.status).toBe(201);
    const newUserId = inviteRes.body.id;
    const tokensBefore = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, newUserId));
    expect(tokensBefore).toHaveLength(1);
    const oldTokenId = tokensBefore[0].id;

    const resendRes = await request(app)
      .post(`/api/users/${newUserId}/resend-invite`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resendRes.status).toBe(200);
    expect(resendRes.body.ok).toBe(true);

    const tokensAfter = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, newUserId));
    expect(tokensAfter).toHaveLength(1);
    expect(tokensAfter[0].id).not.toBe(oldTokenId);
  });

  it('returns 409 if user already activated', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const activated = await createUser({ email: 'done@b.com', password: 'pw12345', role: 'comercial' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .post(`/api/users/${activated.id}/resend-invite`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already activated/i);
  });

  it('returns 404 for nonexistent user', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .post('/api/users/00000000-0000-0000-0000-000000000000/resend-invite')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar testes — devem falhar todos os 3**

Run: `npm run test -- users-admin`
Expected: 3 falhas no resend-invite (rota 404).

- [ ] **Step 3: Implementar `resendInvite` no service**

Editar `server/services/usersService.ts`, adicionando ao final (sem novos imports — `sendInviteEmail` é chamado pelo controller, não pelo service):

```ts
export async function resendInvite(userId: string) {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new HttpError(404, 'User not found');
    }
    if (user.passwordHash !== null) {
      throw new HttpError(409, 'User already activated');
    }
    await tx
      .delete(authTokens)
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, 'invite')));
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [t] = await tx
      .insert(authTokens)
      .values({
        userId: user.id,
        tokenHash,
        purpose: 'invite',
        expiresAt,
      })
      .returning();
    return { user, tokenId: t.id, rawToken };
  });
}
```

Atualizar imports no topo do arquivo:
```ts
import { eq, and, sql, asc } from 'drizzle-orm';
```

NB: o envio de email roda no controller fora da transação. Não queremos que falha de SMTP rollback do token novo — preferimos token criado + email talvez falho (admin pode reenviar de novo).

- [ ] **Step 4: Implementar `resendInviteHandler` no controller**

Editar `server/controllers/usersController.ts`:

```ts
export async function resendInviteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = userIdParamsSchema.parse(req.params);
    const result = await resendInvite(id);
    await sendInviteEmail(result.user.email, result.user.name, result.tokenId, result.rawToken);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
```

Atualizar import: `import { inviteUser, listUsers, updateUser, resendInvite } from '../services/usersService';`.

- [ ] **Step 5: Registrar rota**

Editar `server/routes/users.ts`:

```ts
router.post('/:id/resend-invite', authGuard, requireRole('admin'), resendInviteHandler);
```

Atualizar o import: `import { inviteHandler, listHandler, updateHandler, resendInviteHandler } from '../controllers/usersController';`.

- [ ] **Step 6: Rodar — todos verdes**

Run: `npm run test -- users-admin`
Expected: 4+9+3 = 16 testes passam; só `refresh after deactivation` ainda `it.todo`.

- [ ] **Step 7: Commit**

```bash
git add server/services/usersService.ts server/controllers/usersController.ts server/routes/users.ts server/tests/users-admin.test.ts
git commit -m "feat(admin): POST /api/users/:id/resend-invite with clean reset"
```

---

## Task 5: Backend — refreshAccess revoga sessão de usuário inativo

**Files:**
- Modify: `server/services/authService.ts:58-80` — `refreshAccess` revoga sessão se user inativo.
- Modify: `server/tests/users-admin.test.ts` — implementar teste de regressão.

**Por quê:** `refreshAccess` já retorna 401 para usuário inativo (linha 75), mas não revoga a sessão. Se um admin desativar um usuário e a transação do PATCH revogar todas as sessões — ótimo. Mas se algum estado inconsistente surgir (ex: SQL direto), o sistema deve se auto-curar no próximo refresh. Adiciono o cleanup defensivo + teste fim-a-fim do fluxo "admin desativa → comercial tenta refresh → 401 + sessão revogada".

- [ ] **Step 1: Escrever o teste de regressão**

Editar `server/tests/users-admin.test.ts`, substituindo o bloco `describe('refresh after deactivation', ...)`:

```ts
describe('refresh after deactivation', () => {
  it('refresh returns 401 and revokes session when user is inactive', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const target = await createUser({ email: 't@b.com', password: 'pw12345', role: 'comercial' });

    const targetAgent = request.agent(app);
    await targetAgent.post('/api/auth/login').send({ email: 't@b.com', password: 'pw12345' });

    const { accessToken: adminToken } = await loginAs('admin@b.com');
    await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });

    // Reativa o registro mas mantém sessão revogada — força a verificação
    // do path defensivo no refreshAccess. Simulamos um estado inconsistente:
    // session ainda válida (revokedAt=null) mas user inativo.
    await db.update(sessions).set({ revokedAt: null }).where(eq(sessions.userId, target.id));

    const res = await targetAgent.post('/api/auth/refresh');
    expect(res.status).toBe(401);

    const targetSessionsAfter = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, target.id));
    expect(targetSessionsAfter.every((s) => s.revokedAt !== null)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar (sessão não é revogada hoje)**

Run: `npm run test -- users-admin`
Expected: 1 falha (assertion sobre `revokedAt !== null` falha, porque o `refreshAccess` atual só joga 401, não revoga).

- [ ] **Step 3: Adicionar revogação defensiva no `refreshAccess`**

Editar `server/services/authService.ts`. Localizar bloco entre linhas 58-80 (função `refreshAccess`). Substituir pelo:

```ts
export async function refreshAccess(rawRefresh: string) {
  const hash = hashToken(rawRefresh);
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.refreshTokenHash, hash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) {
    throw new HttpError(401, 'Invalid refresh token');
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || !user.isActive) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, session.id));
    throw new HttpError(401, 'User no longer valid');
  }
  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  return { accessToken, user: toPublic(user) };
}
```

A diferença é o `await db.update(sessions)...` antes do `throw` quando user inválido/inativo.

- [ ] **Step 4: Rodar — deve passar**

Run: `npm run test -- users-admin`
Expected: 17 testes verdes total (4+9+3+1).

- [ ] **Step 5: Rodar suite inteira pra garantir que nada quebrou**

Run: `npm run test`
Expected: todos os testes verdes (auth.test.ts, users-admin.test.ts, users-service.test.ts, etc.).

- [ ] **Step 6: Commit**

```bash
git add server/services/authService.ts server/tests/users-admin.test.ts
git commit -m "feat(auth): refreshAccess revokes session when user is inactive"
```

---

## Task 6: Frontend — primitives shadcn faltantes + types

**Files:**
- Create: `src/components/ui/alert-dialog.tsx` (via shadcn CLI).
- Create: `src/components/ui/badge.tsx` (via shadcn CLI).
- Create: `src/components/ui/select.tsx` (via shadcn CLI).
- Create: `src/components/ui/table.tsx` (via shadcn CLI).
- Modify: `shared/types.ts` — adicionar `AdminUser`.

- [ ] **Step 1: Instalar primitives via shadcn CLI**

Run, em ordem:
```bash
npx shadcn@latest add alert-dialog
npx shadcn@latest add badge
npx shadcn@latest add select
npx shadcn@latest add table
```

Cada comando vai pedir confirmação se sobrescrever — confirme. Os arquivos `src/components/ui/<name>.tsx` aparecem.

Expected: 4 arquivos criados em `src/components/ui/`.

- [ ] **Step 2: Verificar tipos compilam**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 3: Adicionar `AdminUser` em `shared/types.ts`**

Editar `shared/types.ts`, adicionando ao final:

```ts
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  has_password: boolean;
}
```

NB: snake_case nessa interface porque é o que vem do backend (mantemos o shape como está). `PublicUser` continua camelCase (decisão antiga, fora do escopo deste sub-projeto refatorar).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/alert-dialog.tsx src/components/ui/badge.tsx src/components/ui/select.tsx src/components/ui/table.tsx shared/types.ts
git commit -m "chore(ui): add alert-dialog, badge, select, table primitives + AdminUser type"
```

---

## Task 7: Frontend — `src/features/admin/api.ts` (hooks React Query)

**Files:**
- Create: `src/features/admin/api.ts`.
- Create: `src/features/admin/translateError.ts`.

- [ ] **Step 1: Criar `translateError.ts`**

```ts
const MAP: Record<string, string> = {
  'Cannot modify your own role or status': 'Você não pode modificar sua própria conta.',
  'User already activated': 'Esse usuário já completou o cadastro.',
  'Email already in use': 'Já existe um usuário com esse email.',
  'User not found': 'Usuário não encontrado.',
};

export function translateError(message: string): string {
  return MAP[message] ?? message;
}
```

- [ ] **Step 2: Criar `api.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { AdminUser, Role } from '@shared/types';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: AdminUser[] }>('/users').then((r) => r.users),
    staleTime: 30_000,
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; name: string; role: Role }) =>
      api<{ id: string; email: string; name: string; role: Role }>('/users', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      role?: Role;
      is_active?: boolean;
    }) => {
      const { id, ...body } = input;
      return api<AdminUser>(`/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: true }>(`/users/${id}/resend-invite`, { method: 'POST' }),
  });
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
git add src/features/admin/api.ts src/features/admin/translateError.ts
git commit -m "feat(admin): React Query hooks + error translation map"
```

---

## Task 8: Frontend — `AdminPage` + `UsersTable` + filtros/busca

**Files:**
- Create: `src/features/admin/UsersTable.tsx`.
- Modify: `src/pages/admin/AdminPage.tsx` — substituir Placeholder.

- [ ] **Step 1: Criar `UsersTable.tsx`**

```tsx
import type { AdminUser } from '@shared/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { UserActions } from './UserActions';

const ROLE_LABEL: Record<AdminUser['role'], string> = {
  admin: 'Admin',
  comercial: 'Comercial',
  recepcao: 'Recepção',
};

const ROLE_VARIANT: Record<AdminUser['role'], 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  comercial: 'secondary',
  recepcao: 'outline',
};

function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Nunca';
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.round(days / 30);
  return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
}

export function UsersTable({
  users,
  isLoading,
  currentUserId,
}: {
  users: AdminUser[];
  isLoading: boolean;
  currentUserId: string;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Último login</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => {
          const status = !u.is_active
            ? { label: 'Inativo', className: 'bg-muted text-muted-foreground' }
            : !u.has_password
              ? { label: 'Convite pendente', className: 'bg-yellow-100 text-yellow-900' }
              : { label: 'Ativo', className: 'bg-green-100 text-green-900' };
          return (
            <TableRow key={u.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {initials(u.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-sm font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={ROLE_VARIANT[u.role]}>{ROLE_LABEL[u.role]}</Badge>
              </TableCell>
              <TableCell>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${status.className}`}>
                  {status.label}
                </span>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatRelative(u.last_login_at)}
              </TableCell>
              <TableCell>
                <UserActions user={u} isSelf={u.id === currentUserId} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Substituir `AdminPage.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useUsers } from '@/features/admin/api';
import { UsersTable } from '@/features/admin/UsersTable';
import { InviteUserDialog } from '@/features/admin/InviteUserDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserPlus } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store';
import type { AdminUser } from '@shared/types';

type Filter = 'all' | 'active' | 'pending' | 'inactive';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'pending', label: 'Convite pendente' },
  { value: 'inactive', label: 'Inativos' },
];

function matchesFilter(u: AdminUser, f: Filter) {
  if (f === 'all') return true;
  if (f === 'active') return u.is_active && u.has_password;
  if (f === 'pending') return u.is_active && !u.has_password;
  return !u.is_active;
}

export default function AdminPage() {
  const { data: users, isLoading, isError, refetch } = useUsers();
  const me = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [inviteOpen, setInviteOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => matchesFilter(u, filter))
      .filter(
        (u) =>
          q === '' ||
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      );
  }, [users, search, filter]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuários</h1>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Convidar usuário
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar por nome ou email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={filter === f.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <div className="flex flex-col items-center gap-3 rounded-md border bg-card p-12">
          <p className="text-sm text-muted-foreground">Erro ao carregar usuários.</p>
          <Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : !isLoading && filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border bg-card p-12">
          <p className="text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
          {users?.length === 0 && (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Convidar o primeiro
            </Button>
          )}
        </div>
      ) : (
        <UsersTable
          users={filtered}
          isLoading={isLoading}
          currentUserId={me?.id ?? ''}
        />
      )}

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
```

NB: `UserActions` e `InviteUserDialog` são criados na Task 9 — esse arquivo não compila ainda. Tudo bem porque commitamos só na T9, mas precisamos que o lint passe. Adiantamos os componentes mínimos como stubs nesta task (passo 3).

- [ ] **Step 3: Criar stubs mínimos pra compilar**

Criar `src/features/admin/UserActions.tsx`:

```tsx
import type { AdminUser } from '@shared/types';

export function UserActions({ user: _u, isSelf: _s }: { user: AdminUser; isSelf: boolean }) {
  return null;
}
```

Criar `src/features/admin/InviteUserDialog.tsx`:

```tsx
export function InviteUserDialog({
  open: _o,
  onOpenChange: _f,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return null;
}
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 5: Smoke manual — login como admin, abrir /admin**

Run: `npm run dev`
Login como admin (fernando@agenciaimperium.com.br). Abrir `/admin`.
Expected: aparece header "Usuários", botão "Convidar usuário", input de busca, 4 chips de filtro, tabela com pelo menos 1 linha (o admin do seed). Dropdown ⋯ aparece vazio (UserActions stub retorna null).

- [ ] **Step 6: Commit**

```bash
git add src/features/admin/UsersTable.tsx src/features/admin/UserActions.tsx src/features/admin/InviteUserDialog.tsx src/pages/admin/AdminPage.tsx
git commit -m "feat(admin): AdminPage with UsersTable, search and status filters"
```

---

## Task 9: Frontend — `InviteUserDialog`, `EditUserDialog`, `UserActions`

**Files:**
- Modify: `src/features/admin/InviteUserDialog.tsx` — substituir stub.
- Modify: `src/features/admin/UserActions.tsx` — substituir stub.
- Create: `src/features/admin/EditUserDialog.tsx`.

- [ ] **Step 1: `InviteUserDialog.tsx` — formulário completo**

Substituir o conteúdo:

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInviteUser } from './api';
import { translateError } from './translateError';

const schema = z.object({
  name: z.string().min(2, 'Nome muito curto'),
  email: z.string().email('Email inválido'),
  role: z.enum(['admin', 'comercial', 'recepcao']),
});

type FormData = z.infer<typeof schema>;

export function InviteUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invite = useInviteUser();
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', role: 'comercial' },
  });

  async function onSubmit(values: FormData) {
    try {
      await invite.mutateAsync(values);
      toast.success(`Convite enviado para ${values.email}`);
      form.reset();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao convidar.';
      toast.error(msg);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar usuário</DialogTitle>
          <DialogDescription>
            Um email com o link de cadastro será enviado.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input {...field} type="email" autoComplete="email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="comercial">Comercial</SelectItem>
                      <SelectItem value="recepcao">Recepção</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={invite.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? 'Enviando…' : 'Enviar convite'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: `EditUserDialog.tsx`**

Criar:

```tsx
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateUser } from './api';
import { translateError } from './translateError';
import type { AdminUser } from '@shared/types';

const schema = z.object({
  name: z.string().min(2, 'Nome muito curto'),
  role: z.enum(['admin', 'comercial', 'recepcao']),
});

type FormData = z.infer<typeof schema>;

export function EditUserDialog({
  user,
  isSelf,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  isSelf: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateUser();
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: user.name, role: user.role },
  });

  useEffect(() => {
    if (open) form.reset({ name: user.name, role: user.role });
  }, [open, user.name, user.role, form]);

  async function onSubmit(values: FormData) {
    const diff: { name?: string; role?: typeof user.role } = {};
    if (values.name !== user.name) diff.name = values.name;
    if (!isSelf && values.role !== user.role) diff.role = values.role;
    if (Object.keys(diff).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await update.mutateAsync({ id: user.id, ...diff });
      toast.success('Usuário atualizado.');
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao atualizar.';
      toast.error(msg);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormItem>
              <FormLabel>Email</FormLabel>
              <Input value={user.email} disabled />
              <p className="text-xs text-muted-foreground">Email não pode ser alterado.</p>
            </FormItem>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isSelf}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="comercial">Comercial</SelectItem>
                      <SelectItem value="recepcao">Recepção</SelectItem>
                    </SelectContent>
                  </Select>
                  {isSelf && (
                    <p className="text-xs text-muted-foreground">
                      Você não pode alterar sua própria role.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={update.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: `UserActions.tsx` — dropdown completo**

Substituir:

```tsx
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { EditUserDialog } from './EditUserDialog';
import { useUpdateUser, useResendInvite } from './api';
import { translateError } from './translateError';
import type { AdminUser } from '@shared/types';

export function UserActions({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const update = useUpdateUser();
  const resend = useResendInvite();

  async function toggleActive() {
    try {
      await update.mutateAsync({ id: user.id, is_active: !user.is_active });
      toast.success(user.is_active ? 'Usuário desativado.' : 'Usuário reativado.');
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao alterar status.';
      toast.error(msg);
    }
  }

  async function onResend() {
    try {
      await resend.mutateAsync(user.id);
      toast.success(`Convite reenviado para ${user.email}.`);
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao reenviar convite.';
      toast.error(msg);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Ações para ${user.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Editar</DropdownMenuItem>
          {user.is_active ? (
            <DropdownMenuItem
              disabled={isSelf}
              onSelect={() => !isSelf && setDeactivateOpen(true)}
            >
              {isSelf ? 'Desativar (você não pode)' : 'Desativar'}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={isSelf} onSelect={() => !isSelf && toggleActive()}>
              Reativar
            </DropdownMenuItem>
          )}
          {!user.has_password && (
            <DropdownMenuItem onSelect={onResend} disabled={resend.isPending}>
              Reenviar convite
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditUserDialog
        user={user}
        isSelf={isSelf}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar {user.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as sessões dele serão encerradas imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={toggleActive}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 5: Smoke manual — fluxo completo**

Run: `npm run dev` (se não estiver rodando).

Validar:
- Login como admin (fernando@agenciaimperium.com.br) → `/admin` mostra a lista.
- Clicar "Convidar usuário" → modal abre → preencher (nome="Teste", email="teste@b.com", role="comercial") → enviar → toast "Convite enviado..." → linha nova aparece com badge "Convite pendente" amarelo.
- Abrir Mailtrap, copiar link do email, abrir em janela anônima → setup-password → loga automaticamente como o novo usuário.
- Voltar pro admin no admin → linha do "teste@b.com" agora "Ativo" verde.
- Em janela anônima (logado como teste), abrir `/whatsapp`. No admin, dropdown ⋯ no teste → Editar → mudar role pra recepcao → salvar. Voltar na anônima, fazer qualquer ação que dispare `/api/auth/refresh` (ex: F5 forçando após 15min ou tentar acessar `/api/users` via fetch console) → 401, redireciona pra login.
- Tentar dropdown ⋯ no próprio admin → "Desativar (você não pode)" disabled. Editar → modal abre → role select disabled com texto "Você não pode alterar sua própria role".
- Reenviar convite num pendente → toast → email novo no Mailtrap; link velho retorna erro 400 ao abrir (token usado/deletado).
- Filtrar "Inativos" → só desativados. Buscar por "teste" → filtra por nome/email.
- Sidebar como comercial: item "Admin" não aparece. Acessar `/admin` direto na URL → bloqueado por `AdminRoute` (vai pra `/dashboard`).

- [ ] **Step 6: Rodar suite completa**

Run: `npm run test`
Expected: tudo verde. Lint: `npm run lint` verde.

- [ ] **Step 7: Commit**

```bash
git add src/features/admin/InviteUserDialog.tsx src/features/admin/EditUserDialog.tsx src/features/admin/UserActions.tsx
git commit -m "feat(admin): invite/edit dialogs + per-row actions with confirmations"
```

---

## Task 10: Documentação — README e critério de pronto

**Files:**
- Modify: `README.md` — adicionar seção "Admin/RBAC" no fim, marcar item 1 da roadmap como concluído.

- [ ] **Step 1: Atualizar README**

Editar `README.md`. No bloco "Próximos sub-projetos", marcar o primeiro item:

Encontrar:
```
1. Admin/RBAC — gestão de usuários e permissões
```

Substituir por:
```
1. ✅ Admin/RBAC — gestão de usuários e permissões
```

E adicionar antes desse bloco, depois da seção "Estrutura":

```markdown
## Admin / RBAC

Tela em `/admin` (visível só para `role=admin`) com:
- Lista de usuários (admin primeiro, depois alfabética).
- Convidar novo usuário (envia magic link).
- Editar nome / role; ativar/desativar.
- Reenviar convite pra usuário com cadastro pendente.

Self-protection: o admin logado não pode alterar a própria role nem se desativar (UI desabilita + backend rejeita 409).

Revogação de sessão: ao mudar `role` ou `is_active` de outro usuário, todas as sessões dele são revogadas. Próxima chamada a `/api/auth/refresh` retorna 401 e desloga o usuário.

Pegadinha conhecida: não há invariante "último admin". Admin único pode desativar o admin secundário e depois ficar trancado se desativar a si mesmo via SQL — recuperação manual via banco.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: mark Admin/RBAC sub-project complete and document gotchas"
```

---

## Critério de pronto (checklist final)

Antes de considerar o sub-projeto fechado:

- [ ] `npm run lint` verde.
- [ ] `npm run test` verde (incluindo `users-admin.test.ts` com 17 testes).
- [ ] Login como admin → `/admin` mostra lista com pelo menos o seed.
- [ ] Convidar → email no Mailtrap → setup conclui → novo usuário "Ativo" na lista.
- [ ] Reenviar convite → novo email; link velho dá erro.
- [ ] Editar role do comercial → comercial é deslogado no próximo refresh.
- [ ] Desativar comercial → sessão revogada; tentativa de refresh retorna 401.
- [ ] Admin tenta editar a própria role → modal bloqueia + backend rejeita 409.
- [ ] Admin tenta desativar a si mesmo → 409 (testado via UI: dropdown disabled).
- [ ] Filtros "Todos / Ativos / Convite pendente / Inativos" funcionam.
- [ ] Busca por nome/email funciona.
- [ ] Sidebar "Admin" só aparece para admins.

Todos os itens acima já são exercitados nos testes ou no smoke manual da Task 9 step 5.
