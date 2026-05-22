/**
 * One-time backfill: encrypt legacy plaintext credentials in whatsapp_instance
 * and move them into provider_config. Then drop the legacy columns.
 *
 * Idempotent: safe to re-run. Skips rows whose provider_config already has
 * encrypted credentials, and exits early if legacy columns already dropped.
 *
 * Run AFTER migration 026:   npm run migrate:encrypt-creds
 */
import 'dotenv/config';
import { pool, SCHEMA_NAME } from '../db/client';
import { encryptSecret } from '../lib/crypto';

interface LegacyRow {
  id: string;
  base_url: string | null;
  instance_id: string | null;
  instance_token: string | null;
  webhook_secret: string | null;
  webhook_url: string | null;
  webhook_synced: boolean | null;
  provider_config: Record<string, unknown> | null;
}

async function legacyColumnsExist(): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'whatsapp_instance'
        AND column_name = 'instance_token'
    ) AS exists`,
    [SCHEMA_NAME],
  );
  return rows[0]?.exists === true;
}

async function run() {
  const present = await legacyColumnsExist();
  if (!present) {
    console.log('Legacy columns already dropped — nothing to do.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<LegacyRow>(
      `SELECT id, base_url, instance_id, instance_token, webhook_secret,
              webhook_url, webhook_synced, provider_config
       FROM whatsapp_instance`,
    );

    for (const r of rows) {
      const cfg = r.provider_config ?? {};
      const alreadyMigrated =
        cfg.baseUrl !== undefined ||
        cfg.instanceToken !== undefined ||
        cfg.webhookSecret !== undefined ||
        cfg.webhookUrl !== undefined;
      if (alreadyMigrated) {
        console.log(`✓ ${r.id} (already migrated)`);
        continue;
      }

      const next = {
        baseUrl: r.base_url ?? 'https://api.uazapi.com',
        instanceId: r.instance_id,
        instanceToken: r.instance_token ? encryptSecret(r.instance_token) : null,
        webhookSecret: r.webhook_secret ? encryptSecret(r.webhook_secret) : null,
        webhookUrl: r.webhook_url,
        webhookSynced: r.webhook_synced ?? false,
      };

      await client.query(
        `UPDATE whatsapp_instance SET provider_config = $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify(next), r.id],
      );
      console.log(`→ ${r.id} (encrypted)`);
    }

    console.log('Dropping legacy plaintext columns...');
    await client.query(`
      ALTER TABLE whatsapp_instance
        DROP COLUMN IF EXISTS base_url,
        DROP COLUMN IF EXISTS instance_id,
        DROP COLUMN IF EXISTS instance_token,
        DROP COLUMN IF EXISTS webhook_secret,
        DROP COLUMN IF EXISTS webhook_url,
        DROP COLUMN IF EXISTS webhook_synced
    `);

    await client.query('COMMIT');
    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
