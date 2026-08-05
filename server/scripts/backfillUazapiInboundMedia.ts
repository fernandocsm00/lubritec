/**
 * Backfill de mídia inbound da UazAPI que ficou quebrada na inbox.
 *
 * Contexto: até o fix, o webhook da UazAPI gravava em messages.media_url a URL
 * crua da CDN do WhatsApp (mmg.whatsapp.net), cujo conteúdo é cifrado com o
 * mediaKey da mensagem. O <img>/<audio> do frontend nunca conseguiu renderizar
 * isso — TODA mídia recebida pela linha UazAPI aparecia quebrada.
 *
 * Este script reprocessa as mensagens antigas: chama POST /message/download na
 * UazAPI (que baixa e decifra), pega o binário e persiste local em
 * uploads/inbound, igual ao fluxo novo.
 *
 * IMPORTANTE: rode NO HOST onde o volume de uploads existe (ex.: container de
 * produção / EasyPanel), porque o --apply grava arquivos em uploads/inbound. O
 * WHATSAPP_CREDENTIALS_KEY precisa estar no ambiente (pra descriptografar o
 * token da linha). Mídia antiga pode já ter saído do alcance da UazAPI — nesse
 * caso a mensagem é contabilizada como falha e o resto segue.
 *
 * USO:
 *   npm run backfill-uazapi-inbound-media              # dry-run: só diz quantas dá pra recuperar
 *   npm run backfill-uazapi-inbound-media -- --apply   # baixa, grava e atualiza media_url
 *
 * Idempotente: só toca em mensagens cujo media_url ainda NÃO é /uploads/inbound/.
 */

import 'dotenv/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { messages, conversations } from '../db/schema';
import { downloadUazapiMedia } from '../services/whatsapp/uazapi/client';
import { persistInboundMedia } from '../services/whatsapp/inboundMediaStore';
import { loadSendConfig } from '../services/whatsappInstanceService';

const APPLY = process.argv.includes('--apply');
const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: messages.id,
      kind: messages.kind,
      providerMsgId: messages.providerMsgId,
      mediaMime: messages.mediaMime,
      instanceId: conversations.instanceId,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(messages.provider, 'uazapi'),
        eq(messages.direction, 'in'),
        inArray(messages.kind, [...MEDIA_KINDS]),
        sql`${messages.mediaUrl} IS NOT NULL`,
        sql`${messages.mediaUrl} NOT LIKE '/uploads/inbound/%'`,
      ),
    );

  console.log(`${rows.length} mensagem(ns) de mídia inbound (UazAPI) com URL não-local.`);
  console.log(APPLY ? '>> Modo APPLY (vai baixar e gravar).' : '>> Dry-run (nada será gravado).');
  console.log('');

  // Cache da config por instância (evita re-decrypt do token por mensagem).
  const cfgCache = new Map<string, { baseUrl: string; token: string } | null>();
  async function cfgFor(instanceId: string) {
    if (cfgCache.has(instanceId)) return cfgCache.get(instanceId)!;
    let cfg: { baseUrl: string; token: string } | null = null;
    try {
      const loaded = await loadSendConfig(instanceId);
      cfg = { baseUrl: loaded.baseUrl, token: loaded.token };
    } catch {
      cfg = null;
    }
    cfgCache.set(instanceId, cfg);
    return cfg;
  }

  let recovered = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of rows) {
    if (!r.providerMsgId) {
      console.warn(`- ${r.id} (${r.kind}): sem provider_msg_id — pulando.`);
      skipped++;
      continue;
    }

    const cfg = await cfgFor(r.instanceId);
    if (!cfg) {
      console.warn(`- ${r.id} (${r.kind}): instância ${r.instanceId} sem config UazAPI — pulando.`);
      skipped++;
      continue;
    }

    try {
      const { buffer, mime } = await downloadUazapiMedia(r.providerMsgId, cfg);
      if (!APPLY) {
        console.log(`- ${r.id} (${r.kind}): RECUPERÁVEL (${buffer.length} bytes).`);
        recovered++;
        continue;
      }
      const resolvedMime = mime ?? r.mediaMime;
      const localUrl = await persistInboundMedia(buffer, resolvedMime);
      await db
        .update(messages)
        .set({ mediaUrl: localUrl, mediaMime: resolvedMime })
        .where(eq(messages.id, r.id));
      console.log(`- ${r.id} (${r.kind}): OK -> ${localUrl}`);
      recovered++;
    } catch (err) {
      console.warn(
        `- ${r.id} (${r.kind}): FALHA (provavelmente fora do alcance da UazAPI): ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }

  console.log('');
  console.log(
    `Resumo: ${recovered} ${APPLY ? 'recuperada(s)' : 'recuperável(is)'}, ${failed} falha(s), ${skipped} pulada(s).`,
  );
  if (!APPLY && recovered > 0) {
    console.log('Rode novamente com  -- --apply  pra baixar e gravar de verdade.');
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
