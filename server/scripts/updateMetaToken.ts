import 'dotenv/config';
import { sql, eq } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { encryptSecret, decryptSecret, isEncrypted } from '../lib/crypto';
import { metaCloudConfigSchema } from '../services/whatsapp/metaCloud/configSchema';
import { getPhoneNumberInfo, sendText, MetaGraphError } from '../services/whatsapp/metaCloud/client';

/**
 * Troca o access token de uma linha Meta Cloud (não há UI pra isso).
 *
 * Uso:
 *   tsx server/scripts/updateMetaToken.ts --access-token=<NOVO_TOKEN> \
 *     (--instance-id=<uuid> | --phone-number-id=<id> | --display-name=<nome>)
 *     [--dry-run] [--send-test=<telefoneE164>]
 *
 * O token é validado contra a Graph API (GET no phoneNumberId) ANTES de salvar.
 * Com --send-test=<num> envia uma mensagem real, confirmando a permissão
 * whatsapp_business_messaging (que é o que faltava). Roda no ambiente onde
 * WHATSAPP_CREDENTIALS_KEY e DATABASE_URL estão setados (ex.: container prod).
 */

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function mask(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}…(${s.length} chars)` : `(${s.length} chars)`;
}

async function findInstance() {
  const instanceId = arg('instance-id');
  const phoneNumberId = arg('phone-number-id');
  const displayName = arg('display-name');

  if (instanceId) {
    const [row] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.id, instanceId)).limit(1);
    return row ?? null;
  }
  if (phoneNumberId) {
    const [row] = await db.select().from(whatsappInstance)
      .where(sql`${whatsappInstance.providerConfig} ->> 'phoneNumberId' = ${phoneNumberId}`)
      .limit(1);
    return row ?? null;
  }
  if (displayName) {
    const [row] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.displayName, displayName)).limit(1);
    return row ?? null;
  }
  return undefined; // nenhum seletor informado
}

async function run() {
  const newToken = arg('access-token');
  const dryRun = flag('dry-run');
  const sendTestTo = arg('send-test');

  if (!newToken) {
    console.error(
      'Uso: tsx server/scripts/updateMetaToken.ts --access-token=<TOKEN> ' +
      '(--instance-id=<uuid> | --phone-number-id=<id> | --display-name=<nome>) ' +
      '[--dry-run] [--send-test=<telefoneE164>]',
    );
    process.exit(1);
  }
  if (isEncrypted(newToken)) {
    console.error('✗ O --access-token parece já estar criptografado (enc:). Passe o token em texto puro da Meta.');
    process.exit(1);
  }

  const row = await findInstance();
  if (row === undefined) {
    console.error('✗ Informe um seletor: --instance-id, --phone-number-id ou --display-name.');
    process.exit(1);
  }
  if (!row) {
    console.error('✗ Instância não encontrada com o seletor informado.');
    process.exit(1);
  }
  if (row.provider !== 'meta_cloud') {
    console.error(`✗ Instância '${row.displayName}' não é meta_cloud (provider=${row.provider}).`);
    process.exit(1);
  }

  const cfg = metaCloudConfigSchema.parse(row.providerConfig);
  console.log(`Linha: ${row.displayName} (id=${row.id})`);
  console.log(`  phoneNumberId: ${cfg.phoneNumberId} | wabaId: ${cfg.wabaId}`);
  console.log(`  token atual:   ${mask(decryptSecret(cfg.accessToken))}`);
  console.log(`  token novo:    ${mask(newToken)}`);

  // 1. Valida o token novo lendo o número (falha rápido se for inválido/errado).
  try {
    const info = await getPhoneNumberInfo({ phoneNumberId: cfg.phoneNumberId, accessToken: newToken });
    console.log(`✓ Token lê o número: ${info.display_phone_number} (${info.verified_name})`);
  } catch (err) {
    const msg = err instanceof MetaGraphError ? err.message : String(err);
    console.error(`✗ Token NÃO consegue ler o phoneNumberId ${cfg.phoneNumberId}: ${msg}`);
    console.error('  Verifique se é o token do App/WABA certo e se a WABA está atribuída ao System User.');
    await pool.end();
    process.exit(1);
  }

  if (dryRun) {
    console.log('— dry-run: nada foi gravado. Rode sem --dry-run pra aplicar.');
    await pool.end();
    return;
  }

  // 2. Grava o token novo (criptografado), preservando os demais campos.
  const nextCfg = { ...cfg, accessToken: encryptSecret(newToken) };
  await db.update(whatsappInstance)
    .set({ providerConfig: nextCfg, lastStatus: 'connected', lastStatusAt: new Date(), updatedAt: new Date() })
    .where(eq(whatsappInstance.id, row.id));
  console.log('✓ Token atualizado e linha marcada como connected.');

  // 3. (Opcional) envia mensagem real pra confirmar whatsapp_business_messaging.
  if (sendTestTo) {
    try {
      const res = await sendText({
        phoneNumberId: cfg.phoneNumberId,
        accessToken: newToken,
        to: sendTestTo,
        text: 'LubriConnect: teste de envio (token atualizado).',
      });
      console.log(`✓ Envio de teste OK para ${sendTestTo} — messageId=${res.messageId}`);
    } catch (err) {
      const msg = err instanceof MetaGraphError ? err.message : String(err);
      console.error(`✗ Envio de teste falhou: ${msg}`);
      console.error('  O token foi salvo, mas o envio ainda falha — provável falta de permissão whatsapp_business_messaging ou janela de 24h/necessidade de template.');
    }
  }

  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
