import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Mídia inbound baixada de providers que entregam URL autenticada/efêmera
// (ex.: Meta Cloud — lookaside.fbsbx.com exige Bearer e expira). Gravamos no
// disco e servimos via express.static('/uploads'), no mesmo domínio — assim o
// <img> do frontend carrega sem precisar de token (igual ao fluxo de outbound).
const INBOUND_DIR = path.join(process.cwd(), 'uploads', 'inbound');

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'video/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
};

function extFor(mime: string | null | undefined): string {
  if (!mime) return '.bin';
  const base = mime.split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? '.bin';
}

/**
 * Grava o binário em uploads/inbound e retorna a URL RELATIVA
 * (/uploads/inbound/<file>). Nome aleatório (128 bits) — não-enumerável, mesmo
 * modelo de capability URL do upload de outbound.
 */
export async function persistInboundMedia(
  buffer: Buffer,
  mime: string | null | undefined,
): Promise<string> {
  await mkdir(INBOUND_DIR, { recursive: true });
  const filename = `${crypto.randomBytes(16).toString('hex')}${extFor(mime)}`;
  await writeFile(path.join(INBOUND_DIR, filename), buffer);
  return `/uploads/inbound/${filename}`;
}
