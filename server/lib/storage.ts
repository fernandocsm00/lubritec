import { HttpError } from '../middleware/errorHandler';

// Upload de objetos públicos no Supabase Storage via REST API (sem depender do
// supabase-js). Usado para hospedar a imagem de header dos templates HSM num
// lugar persistente (o /uploads local some no redeploy sem volume persistente).
//
// Configuração necessária no ambiente do servidor:
//   SUPABASE_URL               ex.: https://cmighponfvaagzbhqici.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role key (secreta — só no servidor)
//   SUPABASE_STORAGE_BUCKET    opcional (default 'hsm-headers'); bucket público

const DEFAULT_BUCKET = 'hsm-headers';

function storageConfig(): { url: string; key: string; bucket: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new HttpError(
      500,
      'Supabase Storage não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente do servidor.',
    );
  }
  return {
    url: url.replace(/\/$/, ''),
    key,
    bucket: process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET,
  };
}

export interface UploadPublicInput {
  /** Caminho dentro do bucket, ex.: 'headers/<uuid>.jpg'. Sem barra inicial. */
  path: string;
  buffer: Buffer;
  contentType: string;
}

/**
 * Sobe um objeto e retorna a URL pública persistente. Faz upsert (sobrescreve
 * se o path já existir). Lança HttpError se o Storage não estiver configurado ou
 * se a API do Supabase falhar.
 */
export async function uploadPublicObject(input: UploadPublicInput): Promise<string> {
  const { url, key, bucket } = storageConfig();
  const objectPath = input.path.replace(/^\/+/, '');

  const res = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': input.contentType,
      'x-upsert': 'true',
    },
    body: new Uint8Array(input.buffer),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new HttpError(502, `Falha ao subir imagem no Supabase Storage (${res.status}): ${detail}`);
  }

  // URL pública (o bucket precisa ser público).
  return `${url}/storage/v1/object/public/${bucket}/${objectPath}`;
}
