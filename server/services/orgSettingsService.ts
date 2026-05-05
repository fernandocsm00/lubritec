import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { orgSettings, type OrgSettings } from '../db/schema';
import { HttpError } from '../middleware/errorHandler';
import type { PublicOrgSettings, UpdateOrgSettingsInput } from '../../shared/types';

function toPublic(row: OrgSettings): PublicOrgSettings {
  return {
    monthlySalesGoal: row.monthlySalesGoal == null ? null : Number(row.monthlySalesGoal),
    aiEnabled: row.aiEnabled,
    aiAgentName: row.aiAgentName,
    aiBusinessName: row.aiBusinessName,
    aiBusinessDesc: row.aiBusinessDesc,
    aiProducts: row.aiProducts,
    aiTargetAudience: row.aiTargetAudience,
    aiTone: row.aiTone,
    aiObjective: row.aiObjective,
    aiDontTalk: row.aiDontTalk,
    aiAlwaysAsk: row.aiAlwaysAsk,
    aiQualifyWhen: row.aiQualifyWhen,
    aiBusinessHours: row.aiBusinessHours,
    aiAfterHoursMsg: row.aiAfterHoursMsg,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrgSettings(): Promise<PublicOrgSettings> {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.singleton, true)).limit(1);
  if (!row) throw new HttpError(500, 'Org settings singleton not found (check migrations)');
  return toPublic(row);
}

/**
 * Carrega os campos brutos da row (necessário pra IA orchestrator que monta system prompt).
 * Não exposto via API — uso interno.
 */
export async function loadOrgSettingsRow(): Promise<OrgSettings | null> {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.singleton, true)).limit(1);
  return row ?? null;
}

export async function updateOrgSettings(
  input: UpdateOrgSettingsInput,
): Promise<PublicOrgSettings> {
  if (input.monthlySalesGoal != null && input.monthlySalesGoal < 0) {
    throw new HttpError(400, 'Monthly sales goal must be >= 0');
  }

  const patch: Partial<typeof orgSettings.$inferInsert> = { updatedAt: new Date() };
  if (input.monthlySalesGoal !== undefined) {
    patch.monthlySalesGoal = input.monthlySalesGoal == null ? null : String(input.monthlySalesGoal);
  }
  if (input.aiEnabled !== undefined) patch.aiEnabled = input.aiEnabled;
  if (input.aiAgentName !== undefined) patch.aiAgentName = input.aiAgentName;
  if (input.aiBusinessName !== undefined) patch.aiBusinessName = input.aiBusinessName;
  if (input.aiBusinessDesc !== undefined) patch.aiBusinessDesc = input.aiBusinessDesc;
  if (input.aiProducts !== undefined) patch.aiProducts = input.aiProducts;
  if (input.aiTargetAudience !== undefined) patch.aiTargetAudience = input.aiTargetAudience;
  if (input.aiTone !== undefined) patch.aiTone = input.aiTone;
  if (input.aiObjective !== undefined) patch.aiObjective = input.aiObjective;
  if (input.aiDontTalk !== undefined) patch.aiDontTalk = input.aiDontTalk;
  if (input.aiAlwaysAsk !== undefined) patch.aiAlwaysAsk = input.aiAlwaysAsk;
  if (input.aiQualifyWhen !== undefined) patch.aiQualifyWhen = input.aiQualifyWhen;
  if (input.aiBusinessHours !== undefined) patch.aiBusinessHours = input.aiBusinessHours;
  if (input.aiAfterHoursMsg !== undefined) patch.aiAfterHoursMsg = input.aiAfterHoursMsg;

  const [row] = await db
    .update(orgSettings)
    .set(patch)
    .where(eq(orgSettings.singleton, true))
    .returning();
  if (!row) throw new HttpError(500, 'Org settings singleton not found (check migrations)');
  return toPublic(row);
}
