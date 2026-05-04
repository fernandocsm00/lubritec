import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { orgSettings } from '../db/schema';
import { HttpError } from '../middleware/errorHandler';
import type { PublicOrgSettings } from '../../shared/types';

function toPublic(row: { monthlySalesGoal: string | null; updatedAt: Date }): PublicOrgSettings {
  return {
    monthlySalesGoal: row.monthlySalesGoal == null ? null : Number(row.monthlySalesGoal),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrgSettings(): Promise<PublicOrgSettings> {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.singleton, true)).limit(1);
  if (!row) throw new HttpError(500, 'Org settings singleton not found (check migrations)');
  return toPublic(row);
}

export async function updateOrgSettings(opts: {
  monthlySalesGoal: number | null;
}): Promise<PublicOrgSettings> {
  if (opts.monthlySalesGoal != null && opts.monthlySalesGoal < 0) {
    throw new HttpError(400, 'Monthly sales goal must be >= 0');
  }
  const [row] = await db
    .update(orgSettings)
    .set({
      monthlySalesGoal: opts.monthlySalesGoal == null ? null : String(opts.monthlySalesGoal),
      updatedAt: new Date(),
    })
    .where(eq(orgSettings.singleton, true))
    .returning();
  if (!row) throw new HttpError(500, 'Org settings singleton not found (check migrations)');
  return toPublic(row);
}
