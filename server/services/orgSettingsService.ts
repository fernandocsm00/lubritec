import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { orgSettings } from '../db/schema';
import type { PublicOrgSettings } from '../../shared/types';

function toPublic(row: { monthlySalesGoal: string | null; updatedAt: Date }): PublicOrgSettings {
  return {
    monthlySalesGoal: row.monthlySalesGoal == null ? null : Number(row.monthlySalesGoal),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrgSettings(): Promise<PublicOrgSettings> {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.singleton, true)).limit(1);
  if (!row) throw new Error('org_settings singleton missing — run migrations');
  return toPublic(row);
}

export async function updateOrgSettings(opts: {
  monthlySalesGoal: number | null;
}): Promise<PublicOrgSettings> {
  if (opts.monthlySalesGoal != null && opts.monthlySalesGoal < 0) {
    throw new Error('monthlySalesGoal must be >= 0');
  }
  const [row] = await db
    .update(orgSettings)
    .set({
      monthlySalesGoal: opts.monthlySalesGoal == null ? null : String(opts.monthlySalesGoal),
      updatedAt: new Date(),
    })
    .where(eq(orgSettings.singleton, true))
    .returning();
  return toPublic(row);
}
