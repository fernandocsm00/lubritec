import type { Request, Response, NextFunction } from 'express';
import { unlink, rename } from 'node:fs/promises';
import path from 'node:path';

/**
 * Extensão canônica por mime REAL detectado. Usada pra corrigir a extensão do
 * arquivo em disco quando o nome original não tinha extensão (ou tinha uma
 * errada) — o multer cai em `.bin` nesses casos (ver multerConversationMedia).
 *
 * Isso é crítico pra ENTREGA: o express.static deriva o Content-Type da
 * extensão, e Meta/UazAPI ENTREGAM mídia buscando a URL (não upload de bytes).
 * Um `.bin` vira `application/octet-stream` e o provider descarta a imagem
 * silenciosamente (a API retorna id, então "parece" enviada). Anexo sem
 * extensão (comum em mobile/share-sheet) quebrava; Print funcionava porque o
 * front regenera o nome com `.png`. Normalizando aqui, os dois passam a valer.
 *
 * Containers ambíguos (zip / x-cfb = .doc|.xls|.ppt antigos) ficam de fora de
 * propósito: 1 mime → várias extensões, então mantemos a do cliente.
 */
const EXT_BY_MIME: Record<string, { canonical: string; ok: string[] }> = {
  'image/jpeg': { canonical: '.jpg', ok: ['.jpg', '.jpeg'] },
  'image/png':  { canonical: '.png', ok: ['.png'] },
  'image/webp': { canonical: '.webp', ok: ['.webp'] },
  'image/gif':  { canonical: '.gif', ok: ['.gif'] },
  'video/mp4':  { canonical: '.mp4', ok: ['.mp4'] },
  'video/webm': { canonical: '.webm', ok: ['.webm'] },
  'video/quicktime': { canonical: '.mov', ok: ['.mov'] },
  'video/3gpp': { canonical: '.3gp', ok: ['.3gp'] },
  'audio/mpeg': { canonical: '.mp3', ok: ['.mp3'] },
  'audio/mp4':  { canonical: '.m4a', ok: ['.m4a'] },
  'audio/x-m4a': { canonical: '.m4a', ok: ['.m4a'] },
  'audio/ogg':  { canonical: '.ogg', ok: ['.ogg', '.opus'] },
  'audio/opus': { canonical: '.opus', ok: ['.opus', '.ogg'] },
  'audio/wav':  { canonical: '.wav', ok: ['.wav'] },
  'audio/x-wav': { canonical: '.wav', ok: ['.wav'] },
  'audio/vnd.wave': { canonical: '.wav', ok: ['.wav'] },
  'application/pdf': { canonical: '.pdf', ok: ['.pdf'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { canonical: '.docx', ok: ['.docx'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { canonical: '.xlsx', ok: ['.xlsx'] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { canonical: '.pptx', ok: ['.pptx'] },
};

/**
 * Validação de conteúdo REAL dos uploads em disco (magic bytes via file-type).
 *
 * O fileFilter do multer só vê o mimetype declarado pelo browser — que é
 * controlado pelo cliente. Sem esta camada, um .exe renomeado e enviado como
 * "image/jpeg" passa pelo filtro, é gravado em uploads/ e servido publicamente
 * pelo express.static. Roda DEPOIS do multer: inspeciona os primeiros bytes do
 * arquivo gravado, e deleta + retorna 400 se o conteúdo não bater.
 *
 * Uploads em memoryStorage (campanha, CSV) não passam por aqui — campanha é
 * re-encodada via sharp no controller (validação mais forte) e CSV/texto não
 * tem magic bytes.
 */

// Extensões que aceitamos gravar/servir. O filename vem de extname(originalname),
// então sem allowlist um upload "nota.html" ou "app.exe" seria servido do nosso
// domínio com Content-Type perigoso (.html executa script; .svg também — por
// isso ficam de fora).
const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.mp4', '.webm', '.mov', '.3gp',
  '.mp3', '.m4a', '.ogg', '.opus', '.wav', '.weba',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.zip', '.bin',
]);

// Tipos que o file-type pode detectar e que aceitamos.
const ALLOWED_DETECTED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/opus',
  'audio/wav', 'audio/x-wav', 'audio/vnd.wave',
  'application/pdf', 'application/zip',
  // Office moderno (OOXML) e legado (CFB = .doc/.xls/.ppt antigos)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-cfb',
]);

// Declarados como texto não têm magic bytes — file-type retorna undefined e
// isso é esperado, não suspeito.
const TEXT_DECLARED_MIMES = new Set(['text/plain', 'text/csv']);

function mediaCategory(mime: string): string {
  const cat = mime.split('/')[0];
  // Containers de áudio/vídeo se confundem (ex.: .m4a declarado audio/mp4 pode
  // ser detectado como video/mp4) — trata como uma categoria só.
  return cat === 'audio' || cat === 'video' ? 'media' : cat;
}

async function discard(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(
    files
      .filter((f) => f.path)
      .map((f) => unlink(f.path).catch(() => {})),
  );
}

export async function validateUploadMagicBytes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const files: Express.Multer.File[] = [
    ...(req.file ? [req.file] : []),
    ...(Array.isArray(req.files) ? req.files : []),
  ];
  const diskFiles = files.filter((f) => f.path);
  if (diskFiles.length === 0) return next();

  try {
    for (const f of diskFiles) {
      const ext = path.extname(f.filename ?? f.path).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        await discard(diskFiles);
        res.status(400).json({ error: `Extensão de arquivo não permitida (${ext || 'sem extensão'})` });
        return;
      }

      if (TEXT_DECLARED_MIMES.has(f.mimetype)) continue;

      const { fileTypeFromFile } = await import('file-type');
      const detected = await fileTypeFromFile(f.path);
      if (!detected || !ALLOWED_DETECTED_MIMES.has(detected.mime)) {
        await discard(diskFiles);
        res.status(400).json({
          error: 'Conteúdo do arquivo não corresponde a um formato aceito',
        });
        return;
      }

      // Categoria declarada precisa bater com a detectada — bloqueia "vídeo"
      // declarado como imagem etc.
      const declaredCat = mediaCategory(f.mimetype);
      const detectedCat = mediaCategory(detected.mime);
      if ((declaredCat === 'image' || declaredCat === 'media') && declaredCat !== detectedCat) {
        await discard(diskFiles);
        res.status(400).json({
          error: `Arquivo enviado como ${f.mimetype} mas o conteúdo é ${detected.mime}`,
        });
        return;
      }

      // Normaliza a extensão em disco pra bater com o conteúdo REAL detectado.
      // Sem isso, um anexo sem extensão vira `.bin` → servido como
      // application/octet-stream → provider (Meta/UazAPI) busca a URL e descarta
      // a mídia. Corrigir aqui faz o Content-Type do express.static ficar certo.
      const spec = EXT_BY_MIME[detected.mime];
      if (spec && !spec.ok.includes(ext)) {
        const base = path.basename(f.filename ?? path.basename(f.path), ext);
        const newFilename = `${base}${spec.canonical}`;
        const newPath = path.join(path.dirname(f.path), newFilename);
        await rename(f.path, newPath);
        f.filename = newFilename;
        f.path = newPath;
      }
    }
    next();
  } catch (err) {
    await discard(diskFiles);
    next(err);
  }
}
