/**
 * Backfill de mídia inbound do Meta Cloud que ficou quebrada na inbox.
 *
 * Contexto: até o fix de hoje, o webhook do Meta gravava em messages.media_url a
 * URL lookaside.fbsbx.com (efêmera, ~5min, exige Bearer token) em vez de baixar
 * a mídia. Resultado: imagens/áudios/docs recebidos pelo número oficial não
 * carregam no <img>/<audio> do frontend.
 *
 * Este script reprocessa as mensagens antigas: usa o media_id (guardado no
 * raw_payload do webhook) pra re-resolver a URL na Graph API, baixa o binário
 * com o token e persiste local em uploads/inbound, igual ao fluxo novo.
 *
 * IMPORTANTE: rode NO HOST onde o volume de uploads existe (ex.: container de
 * produção / EasyPanel), porque o --apply grava arquivos em uploads/inbound. O
 * WHATSAPP_CREDENTIALS_KEY precisa estar no ambiente (pra descriptografar o
 * token). Só recupera mídias ainda dentro da janela de retenção da Meta —
 * media_id expirado falha e é contabilizado (não trava o resto).
 *
 * USO:
 *   npm run backfill-meta-inbound-media              # dry-run: só diz quantas são recuperáveis
 *   npm run backfill-meta-inbound-media -- --apply   # baixa, grava e atualiza media_url
 *
 * Idempotente: só toca em mensagens cujo media_url ainda NÃO é /uploads/inbound/.
 */

import 'dotenv/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { messages, conversations, whatsappInstance } from '../db/schema';
import { getMediaUrl, downloadMedia } from '../services/whatsapp/metaCloud/client';
import { persistInboundMedia } from '../services/whatsapp/inboundMediaStore';
import { metaCloudConfigSchema } from '../services/whatsapp/metaCloud/configSchema';
import { decryptSecret } from '../lib/crypto';

const APPLY = process.argv.includes('--apply');
const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: messages.id,
      kind: messages.kind,
      rawPayload: messages.rawPayload,
      mediaUrl: messages.mediaUrl,
      instanceId: conversations.instanceId,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(messages.provider, 'meta_cloud'),
        eq(messages.direction, 'in'),
        inArray(messages.kind, [...MEDIA_KINDS]),
        sql`${messages.mediaUrl} IS NOT NULL`,
        sql`${messages.mediaUrl} NOT LIKE '/uploads/inbound/%'`,
      ),
    );

  console.log(`${rows.length} mensagem(ns) de mídia inbound (Meta) com URL não-local.`);
  console.log(APPLY ? '>> Modo APPLY (vai baixar e gravar).' : '>> Dry-run (nada será gravado).');
  console.log('');

  // Cache do token decifrado por instância (evita re-decrypt por mensagem).
  const tokenCache = new Map<string, string | null>();
  async function tokenFor(instanceId: string): Promise<string | null> {
    if (tokenCache.has(instanceId)) return tokenCache.get(instanceId)!;
    const [inst] = await db
      .select()
      .from(whatsappInstance)
      .where(eq(whatsappInstance.id, instanceId))
      .limit(1);
    let token: string | null = null;
    if (inst && inst.provider === 'meta_cloud') {
      const cfg = metaCloudConfigSchema.parse(inst.providerConfig);
      token = decryptSecret(cfg.accessToken);
    }
    tokenCache.set(instanceId, token);
    return token;
  }

  let recovered = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of rows) {
    const payload = r.rawPayload as Record<string, unknown> | null;
    const mediaObj = payload?.[r.kind] as { id?: string; mime_type?: string } | undefined;
    const mediaId = mediaObj?.id;
    if (!mediaId) {
      console.warn(`- ${r.id} (${r.kind}): sem media id no raw_payload — pulando.`);
      skipped++;
      continue;
    }

    const token = await tokenFor(r.instanceId);
    if (!token) {
      console.warn(`- ${r.id} (${r.kind}): instância ${r.instanceId} sem token Meta — pulando.`);
      skipped++;
      continue;
    }

    try {
      const { url, mimeType } = await getMediaUrl({ mediaId, accessToken: token });
      if (!APPLY) {
        console.log(`- ${r.id} (${r.kind}): RECUPERÁVEL (media ${mediaId}).`);
        recovered++;
        continue;
      }
      const { buffer, mimeType: downloadedMime } = await downloadMedia({ url, accessToken: token });
      const resolvedMime = downloadedMime ?? mimeType ?? mediaObj?.mime_type ?? null;
      const localUrl = await persistInboundMedia(buffer, resolvedMime);
      await db
        .update(messages)
        .set({ mediaUrl: localUrl, mediaMime: mimeType ?? mediaObj?.mime_type ?? null })
        .where(eq(messages.id, r.id));
      console.log(`- ${r.id} (${r.kind}): OK -> ${localUrl}`);
      recovered++;
    } catch (err) {
      console.warn(
        `- ${r.id} (${r.kind}): FALHA (provavelmente expirou na Meta): ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }

  console.log('');
  console.log(
    `Resumo: ${recovered} ${APPLY ? 'recuperada(s)' : 'recuperável(is)'}, ${failed} falha(s) (expiradas/erro), ${skipped} pulada(s).`,
  );
  if (!APPLY && recovered > 0) {
    console.log('Rode novamente com  -- --apply  pra baixar e gravar de verdade.');
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    return pool.end().finally(() => process.exit(1));
  });
