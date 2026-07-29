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
    aiBusinessHoursStart: row.aiBusinessHoursStart,
    aiBusinessHoursEnd: row.aiBusinessHoursEnd,
    aiBusinessHoursDays: row.aiBusinessHoursDays,
    ai24x7: row.ai24x7,
    aiAutoReplyWindowSeconds: row.aiAutoReplyWindowSeconds,
    dispatchStartHour: row.dispatchStartHour,
    dispatchEndHour: row.dispatchEndHour,
    dispatchSkipWeekends: row.dispatchSkipWeekends,
    dispatchTimezone: row.dispatchTimezone,
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

  if (input.dispatchStartHour !== undefined) {
    if (input.dispatchStartHour < 0 || input.dispatchStartHour > 23) {
      throw new HttpError(400, 'dispatchStartHour deve estar entre 0 e 23');
    }
    patch.dispatchStartHour = input.dispatchStartHour;
  }
  if (input.dispatchEndHour !== undefined) {
    if (input.dispatchEndHour < 0 || input.dispatchEndHour > 24) {
      throw new HttpError(400, 'dispatchEndHour deve estar entre 0 e 24');
    }
    patch.dispatchEndHour = input.dispatchEndHour;
  }
  if (input.dispatchSkipWeekends !== undefined) patch.dispatchSkipWeekends = input.dispatchSkipWeekends;
  if (input.dispatchTimezone !== undefined) patch.dispatchTimezone = input.dispatchTimezone;
  if (input.aiBusinessHoursStart !== undefined) patch.aiBusinessHoursStart = input.aiBusinessHoursStart;
  if (input.aiBusinessHoursEnd !== undefined) patch.aiBusinessHoursEnd = input.aiBusinessHoursEnd;
  if (input.aiBusinessHoursDays !== undefined) patch.aiBusinessHoursDays = input.aiBusinessHoursDays;
  if (input.ai24x7 !== undefined) patch.ai24x7 = input.ai24x7;
  if (input.aiAutoReplyWindowSeconds !== undefined) {
    if (input.aiAutoReplyWindowSeconds < 0 || input.aiAutoReplyWindowSeconds > 300) {
      throw new HttpError(400, 'aiAutoReplyWindowSeconds deve estar entre 0 e 300');
    }
    patch.aiAutoReplyWindowSeconds = input.aiAutoReplyWindowSeconds;
  }

  const [row] = await db
    .update(orgSettings)
    .set(patch)
    .where(eq(orgSettings.singleton, true))
    .returning();
  if (!row) throw new HttpError(500, 'Org settings singleton not found (check migrations)');
  return toPublic(row);
}
