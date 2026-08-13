# Migração para contas da Lubritec — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transferir o LubriConnect da infraestrutura da Orion Digital para contas Supabase e
EasyPanel de propriedade da Lubritec, sem perda de dados e sem expor dados de outros clientes.

**Architecture:** Projeto Supabase novo na org do cliente recebe um `pg_dump` do schema `lubritec`
(o projeto atual é multi-tenant da Orion, o que descarta o *Transfer Project* nativo). Um script
novo copia os objetos do bucket `hsm-headers` entre projetos. O volume `/app/uploads` do EasyPanel
é copiado via `tar` sobre SSH. A execução acontece em duas passadas: um ensaio completo com a
produção intacta, depois o corte real.

**Tech Stack:** PostgreSQL 15→17 (`pg_dump`/`psql` via Docker), Supabase Storage REST API,
TypeScript + tsx, Vitest, Docker, SSH.

**Spec:** [2026-08-10-migracao-supabase-easypanel-design.md](../specs/2026-08-10-migracao-supabase-easypanel-design.md)

---

## Natureza deste plano

Este plano tem duas metades com regras diferentes, e confundi-las é o principal risco de execução:

- **Parte A (Tarefas 1–4) — código.** O script de cópia do Storage. Segue TDD estrito: teste que
  falha, implementação mínima, teste que passa, commit.
- **Parte B (Tarefas 5–12) — operação.** `pg_dump`, painéis, SSH, DNS. Não há teste automatizado
  possível; a disciplina equivalente é **comando exato + saída esperada + verificação antes de
  seguir**. Nenhum passo da Parte B pode ser marcado sem que a verificação declarada tenha sido
  observada.

A Parte B é executada **duas vezes**: Tarefas 6–10 no ensaio (Tarefa 11) e novamente no corte
(Tarefa 12).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `server/lib/storageMigration.ts` | **Criar.** Lógica pura de cópia entre dois endpoints de Supabase Storage: listagem recursiva, cópia de objeto, orquestração com dry-run. Sem `process.env`, sem `console`. |
| `server/scripts/migrateSupabaseStorage.ts` | **Criar.** Wrapper CLI fino: lê env, faz parse de `--apply`, imprime relatório. |
| `server/tests/storage-migration.test.ts` | **Criar.** Testes de `storageMigration.ts` com `fetch` mockado. |
| `package.json` | **Modificar.** Adicionar script `migrate-supabase-storage`. |

A separação lib/script existe porque a lógica só é testável se não depender de `process.env` nem
de `console` — segue o padrão de [storage.ts](../../../server/lib/storage.ts), que já isola o
acesso ao Storage numa lib.

---

# Parte A — Código

## Task 1: Listagem recursiva de objetos do bucket

A API do Supabase Storage lista **um nível de pasta por vez**. Objetos vivem em `headers/<uuid>.jpg`
(ver [storage.ts:34](../../../server/lib/storage.ts:34)), então uma listagem sem recursão devolve
zero objetos e a migração "passa" copiando nada. Entradas com `id: null` são pastas, não objetos.

**Files:**
- Create: `server/lib/storageMigration.ts`
- Test: `server/tests/storage-migration.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { listObjects, type StorageEndpoint } from '../lib/storageMigration';

const SRC: StorageEndpoint = {
  url: 'https://old.supabase.co',
  key: 'service-role-old',
  bucket: 'hsm-headers',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('listObjects', () => {
  it('desce nas pastas e devolve caminhos completos dos objetos', async () => {
    const fetchMock = vi.mocked(fetch);
    // 1ª chamada: raiz -> uma pasta (id null) e um objeto solto
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { name: 'headers', id: null },
        { name: 'solto.png', id: 'obj-1', metadata: { size: 10, mimetype: 'image/png' } },
      ]),
    );
    // 2ª chamada: dentro de headers/
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { name: 'a.jpg', id: 'obj-2', metadata: { size: 20, mimetype: 'image/jpeg' } },
      ]),
    );

    const paths = await listObjects(SRC);

    // A pasta vem primeiro na listagem e é resolvida por recursão antes de o
    // objeto solto ser empilhado — a ordem reflete a travessia, não o nome.
    expect(paths).toEqual(['headers/a.jpg', 'solto.png']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe('https://old.supabase.co/storage/v1/object/list/hsm-headers');
    expect((firstInit as RequestInit).method).toBe('POST');
    expect(JSON.parse((firstInit as RequestInit).body as string).prefix).toBe('');

    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(secondInit.body as string).prefix).toBe('headers');
  });

  it('lança erro quando a API responde não-ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'invalid key',
    } as unknown as Response);

    await expect(listObjects(SRC)).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npm test -- server/tests/storage-migration.test.ts
```

Expected: FAIL — `Failed to resolve import "../lib/storageMigration"`.

- [ ] **Step 3: Implementação mínima**

Criar `server/lib/storageMigration.ts`:

```typescript
// Cópia de objetos entre dois projetos Supabase Storage. Usado uma única vez na
// migração para a conta da Lubritec, mas escrito para ser re-executável: a cópia
// é idempotente (upsert no destino).
//
// A lib não lê process.env nem escreve em console — quem faz isso é
// server/scripts/migrateSupabaseStorage.ts.

export interface StorageEndpoint {
  /** Ex.: https://<ref>.supabase.co (sem barra final) */
  url: string;
  /** service_role key — bypassa RLS, só no servidor */
  key: string;
  bucket: string;
}

interface ListEntry {
  name: string;
  /** null identifica pasta; objetos reais têm id */
  id: string | null;
  metadata?: { size?: number; mimetype?: string } | null;
}

const LIST_LIMIT = 100;

async function listLevel(ep: StorageEndpoint, prefix: string): Promise<ListEntry[]> {
  const res = await fetch(`${ep.url}/storage/v1/object/list/${ep.bucket}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ep.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prefix,
      limit: LIST_LIMIT,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Falha ao listar bucket ${ep.bucket} (${res.status}): ${detail}`);
  }

  return (await res.json()) as ListEntry[];
}

/**
 * Lista todos os objetos do bucket, descendo recursivamente nas pastas.
 * Retorna caminhos completos relativos à raiz do bucket.
 */
export async function listObjects(ep: StorageEndpoint, prefix = ''): Promise<string[]> {
  const entries = await listLevel(ep, prefix);
  const paths: string[] = [];

  for (const entry of entries) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      paths.push(...(await listObjects(ep, full)));
    } else {
      paths.push(full);
    }
  }

  return paths;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npm test -- server/tests/storage-migration.test.ts
```

Expected: PASS — 2 testes.

- [ ] **Step 5: Commit**

```bash
git add server/lib/storageMigration.ts server/tests/storage-migration.test.ts
git commit -m "feat(storage): listagem recursiva de objetos para migração de bucket"
```

---

## Task 2: Cópia de um objeto entre endpoints

Download **autenticado** (não pela URL pública), para que o script funcione mesmo se o bucket de
origem ou destino não estiver marcado como público — evita um modo de falha silencioso no dia do
corte.

**Files:**
- Modify: `server/lib/storageMigration.ts`
- Test: `server/tests/storage-migration.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `server/tests/storage-migration.test.ts`:

```typescript
import { copyObject } from '../lib/storageMigration';

const DST: StorageEndpoint = {
  url: 'https://new.supabase.co',
  key: 'service-role-new',
  bucket: 'hsm-headers',
};

describe('copyObject', () => {
  it('baixa autenticado da origem e sobe no destino com upsert', async () => {
    const fetchMock = vi.mocked(fetch);
    const bytes = new Uint8Array([1, 2, 3, 4]);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response);

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    const result = await copyObject(SRC, DST, 'headers/a.jpg');

    expect(result).toEqual({ path: 'headers/a.jpg', bytes: 4 });

    const [downloadUrl, downloadInit] = fetchMock.mock.calls[0];
    expect(downloadUrl).toBe('https://old.supabase.co/storage/v1/object/hsm-headers/headers/a.jpg');
    expect((downloadInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer service-role-old',
    });

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1];
    expect(uploadUrl).toBe('https://new.supabase.co/storage/v1/object/hsm-headers/headers/a.jpg');
    expect((uploadInit as RequestInit).method).toBe('POST');
    expect((uploadInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer service-role-new',
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    });
  });

  it('usa application/octet-stream quando a origem não informa content-type', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({}),
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    await copyObject(SRC, DST, 'x.bin');

    const uploadInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(uploadInit.headers).toMatchObject({ 'Content-Type': 'application/octet-stream' });
  });

  it('propaga erro de download sem tentar subir', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'not found',
    } as unknown as Response);

    await expect(copyObject(SRC, DST, 'sumiu.jpg')).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npm test -- server/tests/storage-migration.test.ts
```

Expected: FAIL — `copyObject is not a function` (ou erro de import).

- [ ] **Step 3: Implementação mínima**

Adicionar ao final de `server/lib/storageMigration.ts`:

```typescript
export interface CopyResult {
  path: string;
  bytes: number;
}

/**
 * Copia um objeto da origem para o destino. Download autenticado (funciona em
 * bucket privado); upload com x-upsert, então repetir a cópia é seguro.
 */
export async function copyObject(
  src: StorageEndpoint,
  dst: StorageEndpoint,
  path: string,
): Promise<CopyResult> {
  const downloadRes = await fetch(`${src.url}/storage/v1/object/${src.bucket}/${path}`, {
    headers: { Authorization: `Bearer ${src.key}` },
    signal: AbortSignal.timeout(60_000),
  });

  if (!downloadRes.ok) {
    const detail = await downloadRes.text().catch(() => '');
    throw new Error(`Falha ao baixar ${path} (${downloadRes.status}): ${detail}`);
  }

  const contentType = downloadRes.headers.get('content-type') || 'application/octet-stream';
  const body = new Uint8Array(await downloadRes.arrayBuffer());

  const uploadRes = await fetch(`${dst.url}/storage/v1/object/${dst.bucket}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${dst.key}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });

  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => '');
    throw new Error(`Falha ao subir ${path} (${uploadRes.status}): ${detail}`);
  }

  return { path, bytes: body.length };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npm test -- server/tests/storage-migration.test.ts
```

Expected: PASS — 5 testes.

- [ ] **Step 5: Commit**

```bash
git add server/lib/storageMigration.ts server/tests/storage-migration.test.ts
git commit -m "feat(storage): cópia autenticada de objeto entre projetos Supabase"
```

---

## Task 3: Orquestração com dry-run

Dry-run é o default em todos os scripts do repo. Aqui ele precisa **listar sem copiar** — um
dry-run que já escreve no destino invalidaria o ensaio.

**Files:**
- Modify: `server/lib/storageMigration.ts`
- Test: `server/tests/storage-migration.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `server/tests/storage-migration.test.ts`:

```typescript
import { migrateBucket } from '../lib/storageMigration';

describe('migrateBucket', () => {
  it('em dry-run lista mas não copia nada', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { name: 'a.jpg', id: 'obj-1', metadata: { size: 10, mimetype: 'image/jpeg' } },
        { name: 'b.jpg', id: 'obj-2', metadata: { size: 20, mimetype: 'image/jpeg' } },
      ]),
    );

    const report = await migrateBucket(SRC, DST, { apply: false });

    expect(report).toEqual({
      total: 2,
      copied: 0,
      failed: 0,
      bytes: 0,
      failures: [],
      paths: ['a.jpg', 'b.jpg'],
    });
    // só a listagem — nenhum download, nenhum upload
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('com apply copia todos e soma bytes', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ name: 'a.jpg', id: 'obj-1', metadata: { size: 4, mimetype: 'image/jpeg' } }]),
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    const report = await migrateBucket(SRC, DST, { apply: true });

    expect(report.total).toBe(1);
    expect(report.copied).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.bytes).toBe(4);
    expect(report.failures).toEqual([]);
  });

  it('registra a falha de um objeto e segue com os demais', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { name: 'ruim.jpg', id: 'obj-1', metadata: { size: 1, mimetype: 'image/jpeg' } },
        { name: 'bom.jpg', id: 'obj-2', metadata: { size: 4, mimetype: 'image/jpeg' } },
      ]),
    );
    // ruim.jpg: download falha
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as unknown as Response);
    // bom.jpg: download + upload ok
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    const report = await migrateBucket(SRC, DST, { apply: true });

    expect(report.copied).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].path).toBe('ruim.jpg');
    expect(report.failures[0].error).toMatch(/500/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npm test -- server/tests/storage-migration.test.ts
```

Expected: FAIL — `migrateBucket is not a function`.

- [ ] **Step 3: Implementação mínima**

Adicionar ao final de `server/lib/storageMigration.ts`:

```typescript
export interface MigrateReport {
  total: number;
  copied: number;
  failed: number;
  bytes: number;
  failures: Array<{ path: string; error: string }>;
  paths: string[];
}

/**
 * Copia todos os objetos do bucket de origem para o de destino.
 * Sem `apply`, apenas lista — nada é lido nem escrito no destino.
 * Uma falha isolada não aborta a migração: é registrada e o resto segue.
 */
export async function migrateBucket(
  src: StorageEndpoint,
  dst: StorageEndpoint,
  opts: { apply: boolean },
): Promise<MigrateReport> {
  const paths = await listObjects(src);
  const report: MigrateReport = {
    total: paths.length,
    copied: 0,
    failed: 0,
    bytes: 0,
    failures: [],
    paths,
  };

  if (!opts.apply) return report;

  for (const path of paths) {
    try {
      const { bytes } = await copyObject(src, dst, path);
      report.copied++;
      report.bytes += bytes;
    } catch (err) {
      report.failed++;
      report.failures.push({
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npm test -- server/tests/storage-migration.test.ts
```

Expected: PASS — 8 testes.

- [ ] **Step 5: Commit**

```bash
git add server/lib/storageMigration.ts server/tests/storage-migration.test.ts
git commit -m "feat(storage): orquestração da migração de bucket com dry-run"
```

---

## Task 4: Wrapper CLI e script npm

**Files:**
- Create: `server/scripts/migrateSupabaseStorage.ts`
- Modify: `package.json`

- [ ] **Step 1: Criar o script**

```typescript
/**
 * Copia os objetos de um bucket do Supabase Storage entre dois projetos.
 *
 * Contexto: na migração para a conta da Lubritec, o bucket `hsm-headers`
 * (imagens de header dos templates HSM) precisa ir junto com o banco. As URLs
 * ficam gravadas em whatsapp_hsm_templates.header_media_url e são reescritas por
 * SQL depois desta cópia — ver o plano da migração.
 *
 * USO:
 *   npm run migrate-supabase-storage             # dry-run: só lista o que copiaria
 *   npm run migrate-supabase-storage -- --apply  # copia de verdade (upsert)
 *
 * Env necessárias:
 *   SRC_SUPABASE_URL, SRC_SUPABASE_SERVICE_ROLE_KEY
 *   DST_SUPABASE_URL, DST_SUPABASE_SERVICE_ROLE_KEY
 *   MIGRATION_BUCKET  (opcional, default 'hsm-headers')
 *
 * Idempotente: o upload usa x-upsert, então repetir a execução é seguro.
 */

import 'dotenv/config';
import { migrateBucket, type StorageEndpoint } from '../lib/storageMigration';

const APPLY = process.argv.includes('--apply');
const BUCKET = process.env.MIGRATION_BUCKET || 'hsm-headers';

function endpoint(prefix: 'SRC' | 'DST'): StorageEndpoint {
  const url = process.env[`${prefix}_SUPABASE_URL`];
  const key = process.env[`${prefix}_SUPABASE_SERVICE_ROLE_KEY`];
  if (!url || !key) {
    throw new Error(
      `Faltam ${prefix}_SUPABASE_URL e/ou ${prefix}_SUPABASE_SERVICE_ROLE_KEY no ambiente.`,
    );
  }
  return { url: url.replace(/\/$/, ''), key, bucket: BUCKET };
}

async function main(): Promise<void> {
  const src = endpoint('SRC');
  const dst = endpoint('DST');

  console.log(`Bucket: ${BUCKET}`);
  console.log(`Origem:  ${src.url}`);
  console.log(`Destino: ${dst.url}`);
  console.log(APPLY ? '>> Modo APPLY (vai copiar).' : '>> Dry-run (nada será copiado).');
  console.log('');

  const report = await migrateBucket(src, dst, { apply: APPLY });

  for (const path of report.paths) {
    console.log(`- ${path}`);
  }
  console.log('');

  for (const f of report.failures) {
    console.warn(`FALHA ${f.path}: ${f.error}`);
  }

  console.log(
    `Resumo: ${report.total} objeto(s) na origem, ${report.copied} copiado(s), ` +
      `${report.failed} falha(s), ${report.bytes} bytes.`,
  );

  if (!APPLY && report.total > 0) {
    console.log('Rode novamente com  -- --apply  pra copiar de verdade.');
  }

  if (report.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Adicionar o script npm**

Em `package.json`, após a linha `"update-meta-token"`, adicionar:

```json
    "migrate-supabase-storage": "tsx server/scripts/migrateSupabaseStorage.ts",
```

- [ ] **Step 3: Verificar que compila e que a suíte segue verde**

```bash
npm run lint
```

Expected: sem erros de TypeScript.

```bash
npm test
```

Expected: toda a suíte passa, incluindo os 8 testes novos de `storage-migration`.

- [ ] **Step 4: Verificar a checagem de env do script**

```bash
npm run migrate-supabase-storage
```

Expected: falha com `Faltam SRC_SUPABASE_URL e/ou SRC_SUPABASE_SERVICE_ROLE_KEY no ambiente.`
(Confirma que o script não roda por acidente sem configuração.)

- [ ] **Step 5: Commit**

```bash
git add server/scripts/migrateSupabaseStorage.ts package.json
git commit -m "feat(scripts): CLI de migração de bucket entre projetos Supabase"
```

---

# Parte B — Operação

> A partir daqui não há teste automatizado. Cada passo declara a **verificação** que precisa ser
> observada antes de seguir. Um passo sem verificação confirmada não pode ser marcado.

## Task 5: Provisionamento das contas (Fase 0 da spec)

Nada se move nesta tarefa. Ela existe para que o ambiente destino esteja completo antes de
qualquer dado sair da origem.

- [ ] **Step 1: Lubritec cria as contas**

A Lubritec cria conta Supabase e conta EasyPanel com e-mail próprio e convida Fernando como
Owner/Administrator em ambas.

Verificação: Fernando consegue logar nas duas e enxerga a org/projeto sem pedir credencial a
ninguém.

- [ ] **Step 2: Criar o projeto Supabase**

Org da Lubritec → novo projeto, região `sa-east-1`, plano Free.

Anotar em local seguro (gerenciador de senhas, não no repo): `NEW_REF`, senha do banco,
`service_role key`.

Verificação: `Project Settings > General` mostra region `South America (São Paulo)`.

- [ ] **Step 3: Criar o bucket**

`Storage > New bucket` → nome `hsm-headers`, marcado como **público**.

Verificação: o bucket aparece na listagem com o rótulo `Public`.

- [ ] **Step 4: Criar o serviço no EasyPanel COM o volume**

Criar o serviço e, **antes do primeiro deploy**, adicionar em `Mounts` um volume persistente
apontando para `/app/uploads`.

Verificação: a aba `Mounts` lista `/app/uploads` antes de qualquer deploy ter rodado.

> Fazer isso depois do primeiro deploy significa copiar 259 arquivos para um diretório efêmero
> que o próximo redeploy apaga.

- [ ] **Step 5: Descobrir a string de conexão que funciona**

Do terminal do container do serviço novo (EasyPanel > Terminal), testar a conexão direta:

```bash
apt-get update -qq && apt-get install -y -qq postgresql-client >/dev/null 2>&1
psql "postgresql://postgres:SENHA@db.NEW_REF.supabase.co:5432/postgres" -c "select 1"
```

Expected (caso funcione): `?column? | 1`.

Se falhar com `Network is unreachable` ou timeout, o container é IPv4-only. Usar então o pooler
Supavisor em **modo session** (porta 5432), copiado de `Project Settings > Database > Connection
pooling`:

```bash
psql "postgresql://postgres.NEW_REF:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" -c "select 1"
```

Se apenas o modo transaction (6543) estiver disponível, anexar à URL:

```
?options=-c%20search_path%3Dlubritec%2Cpublic
```

> Isso é obrigatório no modo transaction: o `SET search_path` do
> [client.ts:31](../../../server/db/client.ts:31) roda no evento `connect` do pool e não sobrevive
> entre transações quando o pooler multiplexa conexões. Sem o parâmetro, toda query falha com
> `relation "..." does not exist`.

Verificação: `select 1` retorna com sucesso. Anotar a URL vencedora como `DATABASE_URL` do
ambiente novo.

---

## Task 6: Dump e restore do schema

Executada no ensaio (Tarefa 11) e de novo no corte (Tarefa 12).

- [ ] **Step 1: Exportar as variáveis da sessão**

```bash
export OLD_REF=cmighponfvaagzbhqici
export NEW_REF=<ref do projeto novo>
read -rs OLD_DB_PASS && export OLD_DB_PASS
read -rs NEW_DB_PASS && export NEW_DB_PASS
```

> `read -rs` evita que as senhas fiquem no histórico do shell.

- [ ] **Step 2: Dump do schema `lubritec`**

Imagem Docker do Postgres 17 para evitar divergência de versão de cliente (origem é PG 15.8):

```bash
docker run --rm -e PGPASSWORD="$OLD_DB_PASS" postgres:17 \
  pg_dump "postgresql://postgres@db.$OLD_REF.supabase.co:5432/postgres" \
  --schema=lubritec --no-owner --no-privileges --no-publications --no-subscriptions \
  --quote-all-identifiers > lubritec.sql
```

Verificação:

```bash
grep -c "CREATE TABLE" lubritec.sql
```

Expected: `25`.

```bash
grep -c "cmighponfvaagzbhqici" lubritec.sql
```

Expected: `2` — as duas URLs de header HSM, reescritas na Task 8.

- [ ] **Step 3: (Só na repetição do corte) limpar o destino**

```bash
docker run --rm -e PGPASSWORD="$NEW_DB_PASS" postgres:17 \
  psql "postgresql://postgres@db.$NEW_REF.supabase.co:5432/postgres" \
  -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS lubritec CASCADE"
```

Expected: `DROP SCHEMA`.

> No ensaio (primeira passada) o schema ainda não existe e este passo é pulado.

- [ ] **Step 4: Restore no projeto novo**

```bash
docker run --rm -i -e PGPASSWORD="$NEW_DB_PASS" postgres:17 \
  psql "postgresql://postgres@db.$NEW_REF.supabase.co:5432/postgres" \
  -v ON_ERROR_STOP=1 < lubritec.sql
```

Expected: sequência de `CREATE TABLE` / `COPY` / `ALTER TABLE` sem nenhum `ERROR`. Como
`ON_ERROR_STOP=1` está ligado, qualquer erro aborta — saída com código 0 é a verificação.

- [ ] **Step 5: Reconciliar contagens**

Rodar nos **dois** projetos e comparar:

```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables
WHERE schemaname = 'lubritec' ORDER BY relname;
```

Expected: 25 tabelas, valores iguais nos dois lados (a origem pode ter crescido desde o
levantamento; o que não pode é o destino ter **menos**).

```sql
SELECT count(*) FROM lubritec._migrations;
```

Expected: `46`.

---

## Task 7: Cópia do bucket `hsm-headers`

- [ ] **Step 1: Dry-run**

```bash
SRC_SUPABASE_URL="https://$OLD_REF.supabase.co" \
SRC_SUPABASE_SERVICE_ROLE_KEY="<service_role antiga>" \
DST_SUPABASE_URL="https://$NEW_REF.supabase.co" \
DST_SUPABASE_SERVICE_ROLE_KEY="<service_role nova>" \
npm run migrate-supabase-storage
```

Expected: lista os objetos e termina com `Resumo: 9 objeto(s) na origem, 0 copiado(s), 0 falha(s), 0 bytes.`

> Se o total vier `0`, a listagem recursiva não encontrou nada — investigar antes de seguir, não
> prosseguir assumindo bucket vazio.

- [ ] **Step 2: Aplicar**

```bash
SRC_SUPABASE_URL="https://$OLD_REF.supabase.co" \
SRC_SUPABASE_SERVICE_ROLE_KEY="<service_role antiga>" \
DST_SUPABASE_URL="https://$NEW_REF.supabase.co" \
DST_SUPABASE_SERVICE_ROLE_KEY="<service_role nova>" \
npm run migrate-supabase-storage -- --apply
```

Expected: `Resumo: 9 objeto(s) na origem, 9 copiado(s), 0 falha(s), ~947200 bytes.`

- [ ] **Step 3: Conferir no destino**

No SQL Editor do projeto **novo**:

```sql
SELECT count(*) FROM storage.objects WHERE bucket_id = 'hsm-headers';
```

Expected: `9`.

---

## Task 8: Reescrita das URLs de header

- [ ] **Step 1: Rodar o UPDATE no banco novo**

```sql
UPDATE lubritec.whatsapp_hsm_templates
SET header_media_url = replace(header_media_url,
      'https://cmighponfvaagzbhqici.supabase.co',
      'https://NEW_REF.supabase.co')
WHERE header_media_url LIKE '%cmighponfvaagzbhqici%';
```

Expected: `UPDATE 2`.

> Substituir `NEW_REF` pelo ref real antes de executar.

- [ ] **Step 2: Verificar que não sobrou referência ao projeto antigo**

```sql
SELECT count(*) FROM lubritec.whatsapp_hsm_templates
WHERE header_media_url LIKE '%cmighponfvaagzbhqici%';
```

Expected: `0`.

- [ ] **Step 3: Verificar que a URL nova responde**

Pegar uma das duas URLs reescritas:

```bash
URL=$(docker run --rm -e PGPASSWORD="$NEW_DB_PASS" postgres:17 \
  psql "postgresql://postgres@db.$NEW_REF.supabase.co:5432/postgres" -tAc \
  "SELECT header_media_url FROM lubritec.whatsapp_hsm_templates WHERE header_media_url IS NOT NULL LIMIT 1")
echo "$URL"
```

Expected: uma URL começando com `https://<NEW_REF>.supabase.co/storage/v1/object/public/hsm-headers/`.

```bash
curl -sI "$URL" | head -1
```

Expected: `HTTP/2 200`. Um `400` ou `404` aqui significa que o bucket novo não está público ou que
o objeto não foi copiado — voltar à Task 7.

---

## Task 9: Cópia do volume `/app/uploads`

É o passo de maior risco do plano inteiro.

**Medido em 2026-08-13: 332 arquivos, 454,6 MB** (212 em `conversations` = 424 MB, 117 em
`inbound` = 30 MB, 3 em `campaigns`). Cresce continuamente — eram 259 arquivos em 2026-08-10.
O volume é majoritariamente vídeo e áudio de WhatsApp, não imagem.

Existe um backup dos arquivos **referenciados pelo banco** em `C:\Saas_lubritec\backup-uploads`,
baixado pelo domínio público (o app serve `/uploads` sem auth — ver
[app.ts:146](../../../server/app.ts:146)). Ele é rede de segurança, **não** substitui o `tar`:
não inclui arquivos órfãos no volume e é um retrato de 2026-08-13.

> 454 MB via `tar` sobre SSH não é instantâneo. Cronometre no ensaio: esse número entra
> direto na janela de downtime do corte.

- [ ] **Step 1: Contar os arquivos na origem**

```bash
ssh HOST_ANTIGO "docker exec CONTAINER_ANTIGO sh -c 'find /app/uploads -type f | wc -l'"
```

Anotar o número. Expected: ≥ 259.

- [ ] **Step 2: Transferir**

```bash
ssh HOST_ANTIGO "docker exec CONTAINER_ANTIGO tar -C /app/uploads -cf - ." \
  | ssh HOST_NOVO "docker exec -i CONTAINER_NOVO tar -C /app/uploads -xf -"
```

- [ ] **Step 3: Conferir a contagem no destino**

```bash
ssh HOST_NOVO "docker exec CONTAINER_NOVO sh -c 'find /app/uploads -type f | wc -l'"
```

Expected: **exatamente** o número do Step 1. Divergência aqui é bloqueio — não seguir.

- [ ] **Step 4: Conferir que os arquivos referenciados pelo banco existem**

```bash
ssh HOST_NOVO "docker exec CONTAINER_NOVO sh -c 'ls /app/uploads/conversations | head -3; ls /app/uploads/inbound | head -3'"
```

Expected: nomes de arquivo listados nos dois diretórios (não `No such file or directory`).

---

## Task 10: Variáveis de ambiente e deploy

- [ ] **Step 1: Configurar as env vars no EasyPanel novo**

Preencher em `Environment`, usando a tabela do
[PRODUCTION_CHECKLIST](../../../PRODUCTION_CHECKLIST.md) como referência de obrigatoriedade.

**Rotacionar** (gerar valores novos): senha do banco, `JWT_SECRET`, `SMTP_PASS`,
`GEMINI_API_KEY`, `UAZAPI_ADMIN_TOKEN`.

**Copiar idêntico do ambiente antigo:** `WHATSAPP_CREDENTIALS_KEY`.

**Novos/ajustados:** `DATABASE_URL` (a URL vencedora da Task 5 Step 5), `SUPABASE_URL`
(`https://NEW_REF.supabase.co`), `SUPABASE_SERVICE_ROLE_KEY` (a nova), `APP_URL` (domínio novo),
`NODE_ENV=production`, `DB_SCHEMA=lubritec`.

> **`WHATSAPP_CREDENTIALS_KEY` não pode ser rotacionada.** Os tokens de instância WhatsApp no
> banco estão cifrados com ela. Rotacionar sem re-encriptar derruba envio e recebimento, e o erro
> só aparece na primeira tentativa de disparo — bem depois do corte.

Verificação: comparar a lista de chaves setadas contra o `.env.example`; nenhuma obrigatória
faltando.

- [ ] **Step 2: Deploy**

Disparar o deploy no EasyPanel novo.

Verificação:

```bash
curl -sf https://DOMINIO_NOVO/api/health
```

Expected: resposta 200.

- [ ] **Step 3: Confirmar que o volume sobreviveu ao deploy**

```bash
ssh HOST_NOVO "docker exec CONTAINER_NOVO sh -c 'find /app/uploads -type f | wc -l'"
```

Expected: o mesmo número da Task 9. Se zerou, o mount não está ativo — voltar à Task 5 Step 4.

---

## Task 11: Ensaio completo

Produção segue no ar e intacta durante toda esta tarefa.

- [ ] **Step 1: Executar as Tasks 6 a 10 contra o ambiente novo**

- [ ] **Step 2: Neutralizar os workers automáticos no banco novo**

> **Correção de 2026-08-13.** Este passo dizia "não conectar o WhatsApp de produção", o que estava
> errado sobre o mecanismo. Não existe etapa manual de conexão a pular: as credenciais de
> instância vêm **dentro do dump**, então o app novo nasce conectado. Pior, o
> [index.ts:40](../../../server/index.ts:40) sobe quatro workers **sem nenhuma guarda de
> ambiente**, e o `campaignsDispatcher` dá o primeiro tick **5 segundos após o boot**. Sem
> neutralizar antes, ensaio e produção disparam WhatsApp para os mesmos clientes.

O banco novo é descartável (será dropado e restaurado no corte), então neutralizar ali não custa
nada e não toca produção. Antes de subir o serviço novo, rodar **no destino**:

```sql
-- corta o aiPendingWorker
UPDATE lubritec.conversations SET pending_ai_response = false WHERE pending_ai_response IS TRUE;
-- corta o campaignsDispatcher (scheduled vira running sozinha quando a hora chega)
UPDATE lubritec.campaigns SET status = 'paused' WHERE status IN ('running', 'scheduled');
```

Verificação — ambas as consultas abaixo devem devolver `0`:

```sql
SELECT count(*) FROM lubritec.conversations WHERE pending_ai_response IS TRUE;
SELECT count(*) FROM lubritec.campaigns WHERE status IN ('running', 'scheduled');
```

> Envio **manual** para número interno continua válido como teste — o que se corta aqui é o envio
> automático e desacompanhado. E como o dump do corte traz o estado real de volta, essas pausas
> não vazam para produção.

> No corte (Task 12) este passo **não** se aplica: lá o serviço antigo está parado e o novo deve
> mesmo assumir os workers.

- [ ] **Step 3: Validação funcional**

Percorrer, marcando cada um:

- [ ] Login com usuário real
- [ ] Dashboard carrega estatísticas
- [ ] **Inbox exibe mídia antiga** — abrir uma conversa com imagem (prova do volume)
- [ ] Envio de mensagem manual
- [ ] Campanha de teste para número interno
- [ ] IA responde numa conversa de teste
- [ ] Upload de header no builder de template HSM (prova do Storage novo)

- [ ] **Step 4: Decidir sobre a mídia CDN quebrada**

As 20 mensagens com URL de `mmg.whatsapp.net`/`lookaside.fbsbx.com` seguem quebradas. Decidir
entre:

- **(a) Aceitar** — 20 mensagens antigas sem preview, custo zero.
- **(b) Rodar o backfill antes do corte** — no container de **produção** (onde o volume atual
  existe):

```bash
npm run backfill-uazapi-inbound-media
npm run backfill-uazapi-inbound-media -- --apply
```

> Depois do corte não há segunda chance: a CDN do WhatsApp expira o conteúdo. Se a opção for (b),
> rodar **antes** da Task 12, para que os arquivos recuperados entrem na cópia do volume.

Verificação: decisão registrada por escrito e, se (b), o dry-run rodado antes do `--apply`.

- [ ] **Step 5: Registrar os aprendizados**

Anotar no documento da spec (§10) o que foi descoberto: string de conexão vencedora, nomes reais
de host/container, tempo de cada passo. O corte deve ser execução, não descoberta.

---

## Task 12: Corte

Janela combinada, fora do horário comercial.

- [ ] **Step 1: Avisar e congelar**

Comunicar a Lubritec. Em `Campanhas`, pausar campanhas agendadas.

Verificação: nenhuma campanha com status agendado/em execução.

- [ ] **Step 2: Parar o serviço antigo**

Parar o serviço no EasyPanel antigo — impede escrita durante o dump.

Verificação: `curl` no domínio antigo não responde 200.

- [ ] **Step 3: Repetir Task 6** (incluindo o Step 3 de `DROP SCHEMA`, agora obrigatório)

- [ ] **Step 4: Repetir Task 9** (pega o delta de arquivos)

- [ ] **Step 5: Repetir Tasks 7 e 8**

- [ ] **Step 6: Subir o serviço novo e apontar o domínio**

Verificação: `curl -sf https://DOMINIO_NOVO/api/health` responde 200.

- [ ] **Step 7: Re-registrar os webhooks**

Atualizar para o domínio novo:
- Meta: a callback URL **de cada instância** (o roteamento inbound usa o `instanceId` na URL).
- UazAPI: o webhook da conta.

Verificação: em `Settings > WhatsApp`, cada linha mostra `webhookSubscribed` verdadeiro.

> "Conectado" não implica webhook assinado. Uma linha pode aparecer conectada e nunca receber
> mensagem.

- [ ] **Step 8: Revalidar**

Repetir a validação funcional da Task 11 Step 3 contra o ambiente novo já em produção.

- [ ] **Step 9: Smoke test de recebimento**

Enviar uma mensagem de um celular real para o número de produção.

Expected: a mensagem aparece na Inbox em segundos.

> **Este é o ponto de não-retorno.** A partir da primeira mensagem inbound gravada no banco novo,
> voltar significa perder mensagens. Por isso é o último passo.

- [ ] **Step 10: Manter o antigo parado, não deletado**

Verificação: o serviço antigo está parado e o schema `lubritec` antigo continua existindo.

---

## Task 13: Encerramento (~14 dias após o corte)

- [ ] **Step 1: Confirmar que não houve rollback e que o cliente validou a operação**

- [ ] **Step 2: Dropar os schemas antigos**

No projeto `PROJETO SAAS` (o da Orion):

```sql
DROP SCHEMA lubritec CASCADE;
DROP SCHEMA lubritec_test CASCADE;
```

> Conferir duas vezes que a conexão é com `cmighponfvaagzbhqici` e **não** com o projeto novo.

- [ ] **Step 3: Remover o bucket antigo**

`Storage > hsm-headers > Delete bucket` no projeto da Orion.

- [ ] **Step 4: Ativar o backup semanal**

Sem PITR no plano Free, agendar `pg_dump --schema=lubritec` semanal com destino fora do Supabase
(S3/R2/Backblaze) e retenção de 4 semanas.

Verificação: um backup gerado e **restaurado** num banco descartável. Backup não testado não é
backup.

- [ ] **Step 5: Definir quem monitora a falha do job**

Registrar o responsável por escrito. Verificação: nome anotado na spec.

---

## Rollback

Enquanto o schema antigo existir: religar o serviço antigo, reverter DNS e re-registrar os
webhooks no domínio antigo.

Depois do Task 12 Step 9, o rollback custa as mensagens recebidas no intervalo.

---

## Fora de escopo

- Migração de UazAPI, Gemini, SMTP e registrador de domínio para contas do cliente.
- Merge das branches pendentes (`feat/campaign-cnpj-audience`, `feat/uazapi-multi-instance-inbound`).
  Misturar deploy de feature com troca de infra destrói a capacidade de diagnosticar o que quebrou.
- Itens P1 do PRODUCTION_CHECKLIST (Sentry, helmet, pino).
