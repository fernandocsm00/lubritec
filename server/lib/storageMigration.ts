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
