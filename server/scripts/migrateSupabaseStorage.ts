/**
 * Copia os objetos de um bucket do Supabase Storage entre dois projetos.
 *
 * Contexto: na migração para a conta da Lubritec, o bucket `hsm-headers`
 * (imagens de header dos templates HSM) precisa ir junto com o banco. As URLs
 * ficam gravadas em whatsapp_hsm_templates.header_media_url e são reescritas por
 * SQL depois desta cópia — ver docs/superpowers/plans/2026-08-10-migracao-conta-lubritec.md.
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
