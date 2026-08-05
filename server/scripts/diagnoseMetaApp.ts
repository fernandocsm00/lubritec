import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { decryptSecret } from '../lib/crypto';
import { metaCloudConfigSchema } from '../services/whatsapp/metaCloud/configSchema';

/**
 * Descobre o App ID REAL de cada linha Meta Cloud e valida o par
 * App ID + App Secret (o app access token `{app-id}|{app-secret}`, usado no
 * Resumable Upload da imagem de header de templates HSM).
 *
 * O `appId` do providerConfig foi preenchido à mão via SQL e não tem validação
 * nenhuma — quando ele não é do mesmo app do appSecret, a Meta responde com
 * erros opacos: 400 code 100 subcode 33 ("Object with ID ... does not exist")
 * ou 401 code 190 ("Error validating application").
 *
 * A fonte da verdade é a Meta: GET /{waba-id}/subscribed_apps lista o app que
 * está inscrito nos webhooks daquela WABA — que é justamente o app dono do
 * appSecret que valida as assinaturas dos webhooks recebidos.
 *
 * Uso (no ambiente com WHATSAPP_CREDENTIALS_KEY e DATABASE_URL — ex.: container prod):
 *   tsx server/scripts/diagnoseMetaApp.ts                      # só diagnostica
 *   tsx server/scripts/diagnoseMetaApp.ts --apply              # grava o App ID descoberto
 *   tsx server/scripts/diagnoseMetaApp.ts --display-name=Lubritec_API --apply
 *
 * Nenhum segredo é impresso.
 */

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION ?? 'v20.0'}`;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function graphGet(path: string, accessToken: string): Promise<{ ok: boolean; body: unknown }> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(accessToken)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text().catch(() => '');
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, body };
}

function errMessage(body: unknown): string {
  const e = (body as { error?: { message?: string; code?: number; error_subcode?: number } })?.error;
  if (!e) return JSON.stringify(body);
  return `${e.message} (code ${e.code ?? 'n/a'}${e.error_subcode ? `, subcode ${e.error_subcode}` : ''})`;
}

/** App ID inscrito nos webhooks da WABA — a fonte da verdade. */
async function discoverAppId(wabaId: string, accessToken: string): Promise<{ id: string; name?: string }[]> {
  const { ok, body } = await graphGet(`/${wabaId}/subscribed_apps`, accessToken);
  if (!ok) {
    console.log(`  ✗ Não consegui listar os apps inscritos na WABA: ${errMessage(body)}`);
    return [];
  }
  const data = (body as { data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string } }> }).data ?? [];
  return data
    .map((d) => d.whatsapp_business_api_data)
    .filter((a): a is { id: string; name?: string } => Boolean(a?.id));
}

/** Testa o app access token {app-id}|{app-secret} lendo o próprio nó do app. */
async function testAppToken(appId: string, appSecret: string): Promise<boolean> {
  const { ok, body } = await graphGet(`/${appId}?fields=id,name`, `${appId}|${appSecret}`);
  if (ok) {
    const name = (body as { name?: string }).name;
    console.log(`  ✓ App token válido para ${appId}${name ? ` (${name})` : ''}`);
    return true;
  }
  console.log(`  ✗ App token inválido para ${appId}: ${errMessage(body)}`);
  return false;
}

async function run() {
  const apply = flag('apply');
  const displayName = arg('display-name');
  const instanceId = arg('instance-id');

  let rows = await db.select().from(whatsappInstance);
  rows = rows.filter((r) => r.provider === 'meta_cloud');
  if (instanceId) rows = rows.filter((r) => r.id === instanceId);
  if (displayName) rows = rows.filter((r) => r.displayName === displayName);
  if (rows.length === 0) {
    console.error('✗ Nenhuma linha meta_cloud encontrada com esse filtro.');
    await pool.end();
    process.exit(1);
  }

  let anyMismatch = false;

  for (const row of rows) {
    console.log(`\n── ${row.displayName} (id=${row.id})${row.isArchived ? ' [arquivada]' : ''}`);
    const cfg = metaCloudConfigSchema.parse(row.providerConfig);
    const accessToken = decryptSecret(cfg.accessToken);
    const appSecret = decryptSecret(cfg.appSecret);
    console.log(`  wabaId: ${cfg.wabaId} | phoneNumberId: ${cfg.phoneNumberId}`);
    console.log(`  appId configurado: ${cfg.appId ?? '(não configurado)'}`);

    const apps = await discoverAppId(cfg.wabaId, accessToken);
    if (apps.length === 0) {
      console.log('  → Sem app inscrito na WABA (ou token sem permissão pra listar).');
      continue;
    }
    for (const app of apps) {
      console.log(`  App inscrito na WABA: ${app.id}${app.name ? ` (${app.name})` : ''}`);
    }

    const real = apps[0].id;
    if (cfg.appId && cfg.appId !== real) {
      anyMismatch = true;
      console.log(`  ⚠ DIVERGÊNCIA: configurado ${cfg.appId} ≠ inscrito ${real}`);
    }

    const realOk = await testAppToken(real, appSecret);
    if (!realOk) {
      console.log('  → O App Secret guardado não é o secret desse app. Pegue o App Secret em');
      console.log('    developers.facebook.com/apps → Configurações → Básico e atualize a linha.');
      continue;
    }

    if (cfg.appId === real) {
      console.log('  ✓ Nada a corrigir: appId configurado já é o correto e o par valida.');
      continue;
    }

    if (!apply) {
      console.log(`  → Rode com --apply pra gravar appId=${real} nesta linha.`);
      continue;
    }

    await db.update(whatsappInstance)
      .set({ providerConfig: { ...cfg, appId: real }, updatedAt: new Date() })
      .where(eq(whatsappInstance.id, row.id));
    console.log(`  ✓ appId atualizado para ${real}.`);
  }

  if (anyMismatch && !apply) {
    console.log('\nRode de novo com --apply pra gravar os App IDs descobertos.');
  }
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
