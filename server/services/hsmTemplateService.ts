import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { whatsappHsmTemplates, whatsappInstance, users } from '../db/schema';
import { HttpError } from '../middleware/errorHandler';
import { decryptSecret } from '../lib/crypto';
import { metaCloudConfigSchema } from './whatsapp/metaCloud/configSchema';
import {
  createTemplate as createOnMeta,
  listTemplatesOnMeta,
  deleteTemplateOnMeta,
} from './whatsapp/metaCloud/templates';
import { MetaGraphError } from './whatsapp/metaCloud/client';
import type { HsmComponent, HsmStatus, HsmCategory } from '@shared/types';

export interface CreateLocalInput {
  instanceId: string;
  createdBy: string;
  name: string;
  language: string;
  category: HsmCategory;
  components: HsmComponent[];
  submitNow: boolean;
}

function countVariables(components: HsmComponent[]): number {
  for (const c of components) {
    if (c.type === 'BODY') {
      const matches = c.text.match(/\{\{\d+\}\}/g);
      return matches ? new Set(matches).size : 0;
    }
  }
  return 0;
}

async function loadMetaCfg(instanceId: string) {
  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.id, instanceId)).limit(1);
  if (!row) throw new HttpError(404, 'Instance not found');
  if (row.provider !== 'meta_cloud') {
    throw new HttpError(400, 'HSM templates are only supported on meta_cloud instances');
  }
  return metaCloudConfigSchema.parse(row.providerConfig);
}

export async function createTemplate(input: CreateLocalInput) {
  if (!/^[a-z0-9_]+$/.test(input.name)) {
    throw new HttpError(422, 'name must be snake_case (lowercase + digits + underscore)');
  }
  const variableCount = countVariables(input.components);

  let metaTemplateId: string | null = null;
  let status: HsmStatus = 'DRAFT';

  if (input.submitNow) {
    const cfg = await loadMetaCfg(input.instanceId);
    try {
      const res = await createOnMeta({
        wabaId: cfg.wabaId,
        accessToken: decryptSecret(cfg.accessToken),
        name: input.name,
        language: input.language,
        category: input.category,
        components: input.components,
      });
      metaTemplateId = res.metaTemplateId;
      status = 'PENDING';
    } catch (err) {
      if (err instanceof MetaGraphError) {
        throw new HttpError(422, `Meta template creation failed: ${err.message}`);
      }
      throw err;
    }
  } else {
    // DRAFT path still requires Meta-only instance check (no DRAFT for UazAPI)
    await loadMetaCfg(input.instanceId);
  }

  const [row] = await db.insert(whatsappHsmTemplates).values({
    instanceId: input.instanceId,
    createdBy: input.createdBy,
    name: input.name,
    language: input.language,
    category: input.category,
    status,
    components: input.components,
    metaTemplateId,
    variableCount,
    lastSyncedAt: metaTemplateId ? new Date() : null,
  }).returning();
  return row;
}

export async function listTemplates(instanceId: string) {
  return db.select().from(whatsappHsmTemplates)
    .where(eq(whatsappHsmTemplates.instanceId, instanceId))
    .orderBy(whatsappHsmTemplates.createdAt);
}

export async function deleteTemplate(instanceId: string, templateId: string) {
  const [row] = await db.select().from(whatsappHsmTemplates)
    .where(and(
      eq(whatsappHsmTemplates.id, templateId),
      eq(whatsappHsmTemplates.instanceId, instanceId),
    )).limit(1);
  if (!row) throw new HttpError(404, 'Template not found');

  if (row.metaTemplateId) {
    const cfg = await loadMetaCfg(instanceId);
    try {
      await deleteTemplateOnMeta({
        wabaId: cfg.wabaId,
        accessToken: decryptSecret(cfg.accessToken),
        name: row.name,
      });
    } catch (err) {
      if (!(err instanceof MetaGraphError)) throw err;
      // Best-effort: log and proceed with local delete
      console.warn('[hsm] Meta delete failed but proceeding with local delete:', err.message);
    }
  }

  await db.delete(whatsappHsmTemplates).where(eq(whatsappHsmTemplates.id, templateId));
}

export async function syncTemplates(instanceId: string): Promise<{
  synced: number;
  created: number;
  updated: number;
}> {
  const cfg = await loadMetaCfg(instanceId);
  const fetched = await listTemplatesOnMeta({
    wabaId: cfg.wabaId,
    accessToken: decryptSecret(cfg.accessToken),
  });

  // Find a sentinel admin user for templates created via Meta UI (not via SaaS)
  const [adminUser] = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .orderBy(users.createdAt)
    .limit(1);

  let created = 0, updated = 0;
  for (const t of fetched) {
    const variableCount = countVariables(t.components);
    const [existing] = await db.select().from(whatsappHsmTemplates)
      .where(and(
        eq(whatsappHsmTemplates.instanceId, instanceId),
        eq(whatsappHsmTemplates.metaTemplateId, t.id),
      )).limit(1);
    if (existing) {
      await db.update(whatsappHsmTemplates).set({
        status: t.status as HsmStatus,
        components: t.components,
        rejectionReason: t.rejected_reason ?? null,
        variableCount,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(whatsappHsmTemplates.id, existing.id));
      updated++;
    } else {
      if (!adminUser) continue;   // no admin to attribute → skip
      await db.insert(whatsappHsmTemplates).values({
        instanceId,
        createdBy: adminUser.id,
        metaTemplateId: t.id,
        name: t.name,
        language: t.language,
        category: t.category as HsmCategory,
        status: t.status as HsmStatus,
        components: t.components,
        variableCount,
        rejectionReason: t.rejected_reason ?? null,
        lastSyncedAt: new Date(),
      });
      created++;
    }
  }
  return { synced: fetched.length, created, updated };
}

/**
 * Updates status from a webhook event (message_template_status_update).
 * Used by Task 5. Exported here so the webhook handler can call it.
 */
export async function updateTemplateStatus(input: {
  instanceId: string;
  metaTemplateId: string;
  name: string;
  language: string;
  status: string;
  reason: string | null;
}): Promise<void> {
  const validStatuses: HsmStatus[] = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'];
  if (!validStatuses.includes(input.status as HsmStatus)) {
    console.warn('[hsm] Unknown webhook status event:', input.status);
    return;
  }
  // Try match by meta_template_id first, then by (name, language) as fallback
  const [byMetaId] = await db.select({ id: whatsappHsmTemplates.id })
    .from(whatsappHsmTemplates)
    .where(and(
      eq(whatsappHsmTemplates.instanceId, input.instanceId),
      eq(whatsappHsmTemplates.metaTemplateId, input.metaTemplateId),
    )).limit(1);
  const rowId = byMetaId?.id ?? (await db.select({ id: whatsappHsmTemplates.id })
    .from(whatsappHsmTemplates)
    .where(and(
      eq(whatsappHsmTemplates.instanceId, input.instanceId),
      eq(whatsappHsmTemplates.name, input.name),
      eq(whatsappHsmTemplates.language, input.language),
    )).limit(1))[0]?.id;
  if (!rowId) {
    console.warn('[hsm] Webhook for unknown template:', input.name);
    return;
  }
  await db.update(whatsappHsmTemplates).set({
    status: input.status as HsmStatus,
    rejectionReason: input.reason,
    metaTemplateId: input.metaTemplateId,   // backfill if was empty
    lastSyncedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(whatsappHsmTemplates.id, rowId));
}
