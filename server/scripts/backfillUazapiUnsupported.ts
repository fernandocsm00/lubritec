/**
 * Recupera o texto das mensagens recebidas pela UazAPI que aparecem na Inbox como
 * "📎 Mensagem não suportada" (template de empresa, reação...). Até 25/09/2026 o
 * webhook descartava o texto desses tipos — caso real: convite de cotação da
 * 3p Engenharia que ninguém leu. O texto ficou guardado no raw_payload.
 *
 * Só mexe no banco (coluna messages.body) — não precisa do volume de uploads nem
 * de credencial do WhatsApp. Roda em qualquer lugar com o DATABASE_URL de
 * produção, inclusive no console do container no EasyPanel.
 *
 * USO:
 *   npm run backfill-uazapi-unsupported              # simulação: mostra o que seria recuperado
 *   npm run backfill-uazapi-unsupported -- --apply   # grava
 *
 * Idempotente: mensagem recuperada perde o rótulo e não é encontrada de novo.
 */

import 'dotenv/config';
import { pool } from '../db/client';
import { recoverUnsupportedInbound } from '../services/whatsapp/uazapi/unsupportedInboundBackfill';

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  console.log(APPLY ? '>> Modo APPLY (vai gravar).' : '>> Simulação (nada será gravado).');
  const { scanned, recovered } = await recoverUnsupportedInbound({ apply: APPLY });

  console.log(`${scanned} mensagem(ns) "Mensagem não suportada" da UazAPI encontradas.`);
  for (const r of recovered) {
    const preview = r.body.length > 100 ? `${r.body.slice(0, 100)}…` : r.body;
    console.log(`- ${r.id}: ${preview.replace(/\n/g, ' ')}`);
  }
  console.log('');
  console.log(
    `${recovered.length} com texto recuperável${APPLY ? ' — gravadas.' : '. Rode com --apply pra gravar.'}`,
  );
  console.log(`${scanned - recovered.length} seguem sem texto (continuam como "não suportada").`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
