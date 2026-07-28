import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';

const execFileAsync = promisify(execFile);

// Formatos de áudio que a Meta Cloud API aceita no envio. webm e wav NÃO entram
// (o navegador grava webm/opus, então precisa converter).
const META_AUDIO_MIMES = new Set([
  'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg',
]);

/** true se é áudio mas num formato que a Meta não aceita (precisa converter). */
export function needsAudioConversion(mimetype: string): boolean {
  return mimetype.startsWith('audio/') && !META_AUDIO_MIMES.has(mimetype);
}

/**
 * Converte um arquivo de áudio pra ogg/opus via ffmpeg. Reencoda com libopus
 * (rápido pra áudios curtos de voz; robusto pra qualquer container de entrada).
 * Grava o .ogg ao lado do input, remove o original e devolve o novo nome/mime.
 */
export async function convertToOgg(
  inputPath: string,
): Promise<{ filename: string; mimetype: string }> {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outFilename = `${base}.ogg`;
  const outPath = path.join(dir, outFilename);

  await execFileAsync('ffmpeg', [
    '-y',            // sobrescreve
    '-i', inputPath,
    '-vn',           // sem vídeo
    '-c:a', 'libopus',
    '-f', 'ogg',
    outPath,
  ], { timeout: 30_000 });

  // Remove o original (best-effort — não falha o fluxo se não der).
  await fs.unlink(inputPath).catch(() => {});
  return { filename: outFilename, mimetype: 'audio/ogg' };
}

/**
 * Garante que um upload de áudio esteja num formato aceito pela Meta. Se já
 * estiver (ogg/mp3/m4a/aac/amr), passa direto; senão (webm/wav), converte.
 * Para não-áudio, passa direto.
 */
export async function ensureSendableAudio(file: {
  path: string;
  filename: string;
  mimetype: string;
}): Promise<{ filename: string; mimetype: string }> {
  if (!needsAudioConversion(file.mimetype)) {
    return { filename: file.filename, mimetype: file.mimetype };
  }
  return convertToOgg(file.path);
}
