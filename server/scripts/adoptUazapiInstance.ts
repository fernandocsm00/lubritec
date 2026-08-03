/**
 * Finaliza a adoção de uma instância UazAPI já existente numa linha do
 * LubriConnect: (1) re-criptografa o instanceToken (se estiver em texto puro)
 * e (2) registra o webhook na UazAPI apontando pro nosso host, marcando
 * webhookSynced=true.
 *
 * Roda no SERVIDOR (precisa de WHATSAPP_CREDENTIALS_KEY e APP_URL no env).
 * Idempotente: re-criptografa só se ainda não estiver "enc:"; re-registrar o
 * webhook é seguro.
 *
 * Uso:
 *   npx tsx server/scripts/adoptUazapiInstance.ts --row-id <uuid>
 */
import 'dotenv/config';
import { pool, SCHEMA_NAME } from '../db/client';
import { encryptSecret, isEncrypted, decryptSecret } from '../lib/crypto';
import { setWebhook } from '../services/whatsapp/uazapi/instanceClient';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function buildWebhookUrl(instanceToken: string): string {
  const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${appUrl}/api/whatsapp/webhook?instanceToken=${encodeURIComponent(instanceToken)}`;
}

async function run() {
  const rowId = arg('row-id');
  if (!rowId) {
    console.error('Uso: --row-id <uuid>');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ provider_config: Record<string, unknown> }>(
      `SELECT provider_config FROM ${SCHEMA_NAME}.whatsapp_instance WHERE id = $1`,
      [rowId],
    );
    if (rows.length === 0) {
      console.error(`Linha ${rowId} não encontrada.`);
      process.exit(1);
    }
    const cfg = rows[0].provider_config as Record<string, unknown>;
    const rawToken = cfg.instanceToken as string | null;
    if (!rawToken) {
      console.error('Linha sem instanceToken — nada a fazer.');
      process.exit(1);
    }

    // Token em claro pra falar com a UazAPI (decrypt faz passthrough se já claro).
    const tokenPlain = decryptSecret(rawToken);
    const baseUrl = (cfg.baseUrl as string) ?? 'https://api.uazapi.com';
    const webhookUrl = buildWebhookUrl(tokenPlain);

    // 1. Registra o webhook na UazAPI.
    await setWebhook(
      { baseUrl, token: tokenPlain },
      { url: webhookUrl, secret: tokenPlain, events: ['message.received'] },
    );
    console.log(`→ webhook registrado: ${webhookUrl}`);

    // 2. Re-criptografa o token se ainda estiver em texto puro + marca synced.
    const nextToken = isEncrypted(rawToken) ? rawToken : encryptSecret(tokenPlain);
    const nextCfg = { ...cfg, instanceToken: nextToken, webhookUrl, webhookSynced: true };

    await client.query(
      `UPDATE ${SCHEMA_NAME}.whatsapp_instance
         SET provider_config = $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify(nextCfg), rowId],
    );
    console.log(`✓ ${rowId}: token ${isEncrypted(rawToken) ? '(já cifrado)' : 'cifrado'}, webhookSynced=true`);
  } finally {
    client.release();
  }
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
