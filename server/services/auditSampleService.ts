import { db } from '../db/client';
import { auditSampleAssignments, leads, users, campaigns } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicAuditSample, LeadQualityFeedback } from '@shared/types';

export const AUDIT_SAMPLE_RATE = 0.10;

/**
 * Inscreve um lead na fila cega de auditoria com probabilidade AUDIT_SAMPLE_RATE.
 * Chamado pelo pipeline da IA quando lead é marcado "não qualificado".
 * Idempotente — duplicatas no leadId são silenciosamente ignoradas (unique idx).
 *
 * forceSample: bypass do random pra testes.
 */
export async function enrollIfSampled(input: {
  leadId: string;
  campaignId: string | null;
  aiCallLogId: string | null;
  forceSample?: boolean;
}): Promise<void> {
  const sampled = input.forceSample ?? (Math.random() < AUDIT_SAMPLE_RATE);
  // Log estruturado pra auditar "por que esse lead foi/nao foi pra fila".
  // Sem isso, debugar reclamacao do tipo "lead X deveria ter sido amostrado"
  // exige consulta direta no DB.
  console.log(
    `[audit-sample] leadId=${input.leadId} aiCallLogId=${input.aiCallLogId ?? 'null'} ` +
    `campaignId=${input.campaignId ?? 'null'} sampled=${sampled}` +
    (input.forceSample !== undefined ? ' (forced)' : ''),
  );
  if (!sampled) return;

  try {
    await db.insert(auditSampleAssignments).values({
      leadId: input.leadId,
      campaignId: input.campaignId,
      aiCallLogId: input.aiCallLogId,
      status: 'pending',
    });
  } catch (e) {
    // Unique violation no leadId → já está na fila, no-op.
    // Drizzle wraps pg errors in DrizzleQueryError; the original pg error is in .cause
    // with code='23505' (unique_violation).
    const pgCode = (e as { cause?: { code?: string } })?.cause?.code
      ?? (e as { code?: string })?.code;
    if (pgCode === '23505') return;
    if (e instanceof Error && e.message.includes('duplicate key')) return;
    throw e;
  }
}

function toPublic(row: typeof auditSampleAssignments.$inferSelect & {
  leadName: string; leadPhone: string | null; leadCnpj: string | null;
  campaignName: string | null; assignedName: string | null;
}): PublicAuditSample {
  return {
    id: row.id,
    leadId: row.leadId,
    leadName: row.leadName,
    leadPhone: row.leadPhone,
    leadCnpj: row.leadCnpj,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    sampledAt: row.sampledAt.toISOString(),
    status: row.status as PublicAuditSample['status'],
    assignedTo: row.assignedTo && row.assignedName
      ? { id: row.assignedTo, name: row.assignedName } : null,
    assignedAt: row.assignedAt?.toISOString() ?? null,
    contactedAt: row.contactedAt?.toISOString() ?? null,
    outcome: row.outcome as LeadQualityFeedback | null,
    outcomeAt: row.outcomeAt?.toISOString() ?? null,
    outcomeNotes: row.outcomeNotes,
  };
}

/**
 * Lista a fila cega de auditoria. Filtra por campaignId se passado.
 * Importante: NÃO retorna decisão da IA nem motivo da rejeição — visualização cega.
 */
export async function listSamples(input: {
  campaignId?: string;
  status?: PublicAuditSample['status'];
  assignedToMe?: string;     // userId — se passado, filtra só os meus
}): Promise<PublicAuditSample[]> {
  const conds = [];
  if (input.campaignId) conds.push(eq(auditSampleAssignments.campaignId, input.campaignId));
  if (input.status) conds.push(eq(auditSampleAssignments.status, input.status));
  if (input.assignedToMe) conds.push(eq(auditSampleAssignments.assignedTo, input.assignedToMe));

  const rows = await db.select({
    a: auditSampleAssignments,
    leadName: leads.name,
    leadPhone: leads.phone,
    leadCnpj: leads.cnpj,
    campaignName: campaigns.name,
    assignedName: users.name,
  })
    .from(auditSampleAssignments)
    .innerJoin(leads, eq(auditSampleAssignments.leadId, leads.id))
    .leftJoin(campaigns, eq(auditSampleAssignments.campaignId, campaigns.id))
    .leftJoin(users, eq(auditSampleAssignments.assignedTo, users.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(auditSampleAssignments.sampledAt);

  return rows.map((r) => toPublic({ ...r.a,
    leadName: r.leadName, leadPhone: r.leadPhone, leadCnpj: r.leadCnpj,
    campaignName: r.campaignName, assignedName: r.assignedName,
  }));
}

/**
 * Pega o próximo sample pendente da fila e atribui ao usuário.
 * Returns null se a fila está vazia.
 *
 * SELECT FOR UPDATE SKIP LOCKED: garante que 2 vendedores chamando ao mesmo
 * tempo NAO peguem o mesmo sample. O primeiro adquire row-lock; o segundo
 * pula essa linha e tenta a proxima. Sem isso, ambos passariam pelo SELECT
 * e o UPDATE do segundo sobrescreveria silenciosamente o assignment do
 * primeiro — bug grave numa equipe de 5 vendedores em hora de pico.
 *
 * Envolvemos em transacao explicita pra que o lock dure ate o UPDATE.
 */
export async function claimNextSample(input: {
  userId: string;
  campaignId?: string;
}): Promise<PublicAuditSample | null> {
  const claimedId = await db.transaction(async (tx) => {
    const conds = [eq(auditSampleAssignments.status, 'pending')];
    if (input.campaignId) conds.push(eq(auditSampleAssignments.campaignId, input.campaignId));

    const [row] = await tx.select().from(auditSampleAssignments)
      .where(and(...conds))
      .orderBy(auditSampleAssignments.sampledAt)
      .limit(1)
      .for('update', { skipLocked: true });
    if (!row) return null;

    await tx.update(auditSampleAssignments).set({
      assignedTo: input.userId,
      assignedAt: new Date(),
      status: 'assigned',
    }).where(eq(auditSampleAssignments.id, row.id));
    return row.id;
  });
  if (!claimedId) return null;

  const list = await listSamples({ assignedToMe: input.userId });
  return list.find((s) => s.id === claimedId) ?? null;
}

/**
 * Registra outcome de uma amostra contatada.
 * outcome='good' = falso negativo da IA (lead era bom mas IA descartou)
 * outcome='bad'  = verdadeiro negativo confirmado
 */
export async function recordOutcome(input: {
  id: string;
  userId: string;
  outcome: LeadQualityFeedback;
  notes?: string;
}): Promise<PublicAuditSample> {
  const [current] = await db.select().from(auditSampleAssignments)
    .where(eq(auditSampleAssignments.id, input.id)).limit(1);
  if (!current) throw new HttpError(404, 'Audit sample not found');
  if (current.assignedTo !== input.userId) {
    throw new HttpError(403, 'Only the assignee can record outcome');
  }

  await db.update(auditSampleAssignments).set({
    contactedAt: new Date(),
    outcome: input.outcome,
    outcomeAt: new Date(),
    outcomeNotes: input.notes ?? null,
    status: 'contacted',
  }).where(eq(auditSampleAssignments.id, input.id));

  const list = await listSamples({ assignedToMe: input.userId });
  const found = list.find((s) => s.id === input.id);
  if (!found) throw new HttpError(500, 'Sample disappeared after update');
  return found;
}
