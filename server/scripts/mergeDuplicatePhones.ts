/**
 * Reconcilia leads/conversations criados em formatos divergentes de telefone.
 *
 * Contexto: até o fix do conversationsService de hoje, o caminho "Nova conversa"
 * do UI gravava o número sem canonicalizar (só removia pontuacao). Quando o
 * cliente respondia via WhatsApp, o webhook entregava o numero com o 9 do
 * celular ja injetado, nao batia com o lead existente e criava um lead/conv
 * novo. Resultado: o mesmo contato aparece duas vezes na inbox.
 *
 * Este script:
 *  1. Agrupa leads por `toCanonicalBrPhone(phone)`.
 *  2. Para cada grupo com >1 lead, escolhe um vencedor (mais dados/CNPJ/historico)
 *     e realoca conversations/messages/campaign_recipients/deals/ai_call_logs
 *     para ele, depois apaga os perdedores.
 *  3. Para grupos com 1 lead cujo phone nao esta canonico, apenas faz UPDATE
 *     do phone do lead (e das conversations associadas) pro formato canonico.
 *
 * USO:
 *   npm run merge-duplicate-phones              # dry-run, so imprime relatorio
 *   npm run merge-duplicate-phones -- --apply   # aplica dentro de uma transacao
 *
 * Conflitos que o script NAO resolve sozinho (lista no relatorio e pula no
 * --apply, exigindo decisao manual):
 *   - Dois leads do mesmo grupo com CNPJs distintos preenchidos.
 *   - Dois leads do mesmo grupo com deal ativo cada (UNIQUE em deals.lead_id).
 */

import 'dotenv/config';
import { db, pool } from '../db/client';
import {
  leads,
  conversations,
  messages,
  campaignRecipients,
  deals,
  aiCallLogs,
  leadStageTransitions,
  auditSampleAssignments,
  conversationSlaEvents,
} from '../db/schema';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { toCanonicalBrPhone } from '../lib/phoneBR';

type LeadRow = {
  id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  cnpj: string | null;
  email: string | null;
  notes: string | null;
  imbp: string | null;
  segment: string | null;
  address1: string | null;
  city: string | null;
  status: string;
  createdAt: Date;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const APPLY = process.argv.includes('--apply');

function richnessScore(l: LeadRow): number {
  let s = 0;
  if (l.cnpj) s += 10;
  if (l.email) s += 2;
  if (l.notes) s += 1;
  if (l.imbp) s += 1;
  if (l.segment) s += 1;
  if (l.address1) s += 1;
  if (l.city) s += 1;
  if (l.phone2) s += 1;
  return s;
}

function pickWinner(group: LeadRow[]): LeadRow {
  // Ordena: maior riqueza → phone ja canonico → mais antigo (preserva historico).
  const canonicalOf = (l: LeadRow) => toCanonicalBrPhone(l.phone);
  return [...group].sort((a, b) => {
    const ra = richnessScore(a);
    const rb = richnessScore(b);
    if (ra !== rb) return rb - ra;
    const aIsCanon = a.phone === canonicalOf(a) ? 1 : 0;
    const bIsCanon = b.phone === canonicalOf(b) ? 1 : 0;
    if (aIsCanon !== bIsCanon) return bIsCanon - aIsCanon;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

async function fetchAllLeads(): Promise<LeadRow[]> {
  return db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      phone2: leads.phone2,
      cnpj: leads.cnpj,
      email: leads.email,
      notes: leads.notes,
      imbp: leads.imbp,
      segment: leads.segment,
      address1: leads.address1,
      city: leads.city,
      status: leads.status,
      createdAt: leads.createdAt,
    })
    .from(leads);
}

type Plan = {
  canonical: string;
  winner: LeadRow;
  losers: LeadRow[];
  needsLeadRename: boolean;       // winner.phone != canonical
  cnpjConflict: boolean;
  dealConflict: boolean;
  reason: string;
};

async function buildPlan(): Promise<{ plans: Plan[]; orphans: LeadRow[] }> {
  const all = await fetchAllLeads();
  const byCanon = new Map<string, LeadRow[]>();
  const skipped: LeadRow[] = [];

  for (const l of all) {
    const canon = toCanonicalBrPhone(l.phone);
    if (!canon) {
      skipped.push(l);
      continue;
    }
    const arr = byCanon.get(canon) ?? [];
    arr.push(l);
    byCanon.set(canon, arr);
  }

  const plans: Plan[] = [];
  const orphans: LeadRow[] = [];

  // IDs com deal — pra detectar conflito (UNIQUE em deals.lead_id).
  const leadIdsWithDeal = new Set<string>(
    (await db.select({ leadId: deals.leadId }).from(deals)).map((r) => r.leadId),
  );

  for (const [canon, group] of byCanon.entries()) {
    if (group.length === 1) {
      const lead = group[0];
      if (lead.phone !== canon || (lead.phone2 && toCanonicalBrPhone(lead.phone2) !== lead.phone2)) {
        orphans.push(lead);
      }
      continue;
    }
    const winner = pickWinner(group);
    const losers = group.filter((l) => l.id !== winner.id);
    const cnpjs = group.map((l) => l.cnpj).filter((c): c is string => !!c);
    const distinctCnpjs = new Set(cnpjs);
    const cnpjConflict = distinctCnpjs.size > 1;
    const dealsInGroup = group.filter((l) => leadIdsWithDeal.has(l.id));
    const dealConflict = dealsInGroup.length > 1;

    plans.push({
      canonical: canon,
      winner,
      losers,
      needsLeadRename: winner.phone !== canon,
      cnpjConflict,
      dealConflict,
      reason: cnpjConflict
        ? 'CNPJs distintos no grupo — provavelmente leads diferentes; revisao manual'
        : dealConflict
        ? 'Dois leads com deal ativo — UNIQUE constraint impede merge automatico'
        : 'ok',
    });
  }

  return { plans, orphans };
}

function printPlan(plans: Plan[], orphans: LeadRow[]): void {
  console.log('\n=== Plano de merge ===');
  if (!plans.length && !orphans.length) {
    console.log('Nenhuma duplicata nem lead com phone nao-canonico encontrado.');
    return;
  }
  const ok = plans.filter((p) => p.reason === 'ok');
  const blocked = plans.filter((p) => p.reason !== 'ok');
  console.log(`Grupos com duplicatas: ${plans.length} (mergeaveis: ${ok.length}, bloqueados: ${blocked.length})`);
  console.log(`Leads orfaos (sem duplicata mas com phone fora do canonico): ${orphans.length}`);

  for (const p of plans) {
    console.log(`\n[${p.reason === 'ok' ? 'MERGE' : 'BLOCK'}] canonical=${p.canonical}`);
    console.log(`  winner: ${p.winner.id}  name="${p.winner.name}"  phone=${p.winner.phone}  cnpj=${p.winner.cnpj ?? '-'}  rich=${richnessScore(p.winner)}`);
    for (const l of p.losers) {
      console.log(`  loser : ${l.id}  name="${l.name}"  phone=${l.phone}  cnpj=${l.cnpj ?? '-'}  rich=${richnessScore(l)}`);
    }
    if (p.reason !== 'ok') console.log(`  >> motivo: ${p.reason}`);
  }
  if (orphans.length) {
    console.log('\n[ORFAOS] (apenas UPDATE phone para canonico, sem merge)');
    for (const o of orphans) {
      console.log(`  ${o.id}  name="${o.name}"  phone=${o.phone} -> ${toCanonicalBrPhone(o.phone)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Execucao
// ---------------------------------------------------------------------------

async function mergeAux(loserId: string, winnerId: string, tx: Tx, winnerHasDeal: boolean, winnerHasAudit: boolean): Promise<void> {
  // Tabelas com FK simples pra leads — basta repointar.
  await tx.update(leadStageTransitions).set({ leadId: winnerId }).where(eq(leadStageTransitions.leadId, loserId));
  await tx.update(aiCallLogs).set({ leadId: winnerId }).where(eq(aiCallLogs.leadId, loserId));
  await tx.update(campaignRecipients).set({ leadId: winnerId }).where(eq(campaignRecipients.leadId, loserId));

  // audit_sample_assignments tem UNIQUE em lead_id — se winner ja tem, deleta o do loser.
  if (winnerHasAudit) {
    await tx.delete(auditSampleAssignments).where(eq(auditSampleAssignments.leadId, loserId));
  } else {
    await tx.update(auditSampleAssignments).set({ leadId: winnerId }).where(eq(auditSampleAssignments.leadId, loserId));
  }

  // deals tem UNIQUE em lead_id. So repointa se winner nao tiver deal.
  if (!winnerHasDeal) {
    await tx.update(deals).set({ leadId: winnerId }).where(eq(deals.leadId, loserId));
  }
  // Se winnerHasDeal, o caller ja verificou dealConflict (e bloqueou se ambos
  // tinham deal). Se so o loser tinha deal, o branch acima ja repointou. Aqui
  // chegamos quando winner tem deal e loser nao — nada a fazer.
}

async function mergeConversationsOfLoser(loserId: string, winnerId: string, tx: Tx): Promise<void> {
  const loserConvs = await tx
    .select({ id: conversations.id, instanceId: conversations.instanceId, phone: conversations.phone })
    .from(conversations)
    .where(eq(conversations.leadId, loserId));

  for (const lc of loserConvs) {
    // Procura conversation do winner na MESMA instancia (em qualquer phone, vamos
    // canonicalizar depois). Se houver, consolida; senao apenas repointa lead_id.
    const [winnerConv] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.leadId, winnerId), eq(conversations.instanceId, lc.instanceId)))
      .limit(1);

    if (winnerConv) {
      // Move tudo que aponta pra lc → winnerConv, depois apaga lc.
      await tx.update(messages).set({ conversationId: winnerConv.id }).where(eq(messages.conversationId, lc.id));
      await tx.update(campaignRecipients).set({ conversationId: winnerConv.id }).where(eq(campaignRecipients.conversationId, lc.id));
      await tx.update(aiCallLogs).set({ conversationId: winnerConv.id }).where(eq(aiCallLogs.conversationId, lc.id));
      await tx.delete(conversationSlaEvents).where(eq(conversationSlaEvents.conversationId, lc.id));
      await tx.delete(conversations).where(eq(conversations.id, lc.id));
    } else {
      // Sem conflito de instancia — basta apontar a conv pro winner.
      // Mas pode haver conflito de (instance_id, phone) se winner tinha conv em
      // OUTRA instancia com mesmo phone — nao deveria, instancia diferente.
      // Conflito real so se duas convs do loser ficarem com mesma instance, mas
      // a UNIQUE atual ja impede isso.
      await tx.update(conversations).set({ leadId: winnerId }).where(eq(conversations.id, lc.id));
    }
  }
}

async function canonicalizeLeadAndConvs(leadId: string, canonicalPhone: string, canonicalPhone2: string | null, tx: Tx): Promise<void> {
  // Consolida possiveis conversations duplicadas dentro do mesmo lead/instance
  // (caso raro: lead com duas convs na mesma instance, uma canonica e uma sem 9,
  // o que escapou da UNIQUE atual; ao canonicalizar viraria conflito).
  const convs = await tx
    .select({ id: conversations.id, instanceId: conversations.instanceId, phone: conversations.phone })
    .from(conversations)
    .where(eq(conversations.leadId, leadId));

  const byInstance = new Map<string, typeof convs>();
  for (const c of convs) {
    const arr = byInstance.get(c.instanceId) ?? [];
    arr.push(c);
    byInstance.set(c.instanceId, arr);
  }

  for (const [, sameInstance] of byInstance.entries()) {
    if (sameInstance.length <= 1) continue;
    // Mantem a primeira (criada primeiro vence — vamos ordenar por id desc pra ter algo
    // estavel; arbitrario mas reproduzivel) e merge as outras nela.
    const [keeper, ...dups] = [...sameInstance].sort((a, b) => a.id.localeCompare(b.id));
    for (const d of dups) {
      await tx.update(messages).set({ conversationId: keeper.id }).where(eq(messages.conversationId, d.id));
      await tx.update(campaignRecipients).set({ conversationId: keeper.id }).where(eq(campaignRecipients.conversationId, d.id));
      await tx.update(aiCallLogs).set({ conversationId: keeper.id }).where(eq(aiCallLogs.conversationId, d.id));
      await tx.delete(conversationSlaEvents).where(eq(conversationSlaEvents.conversationId, d.id));
      await tx.delete(conversations).where(eq(conversations.id, d.id));
    }
  }

  await tx.update(conversations).set({ phone: canonicalPhone }).where(eq(conversations.leadId, leadId));
  await tx.update(leads).set({ phone: canonicalPhone, phone2: canonicalPhone2 }).where(eq(leads.id, leadId));
}

async function applyPlan(plans: Plan[], orphans: LeadRow[]): Promise<void> {
  const executable = plans.filter((p) => p.reason === 'ok');
  console.log(`\n=== Aplicando ${executable.length} merges e ${orphans.length} renames ===`);

  await db.transaction(async (tx) => {
    const allLeadIdsWithDeal = new Set(
      (await tx.select({ leadId: deals.leadId }).from(deals)).map((r) => r.leadId),
    );
    const allLeadIdsWithAudit = new Set(
      (await tx.select({ leadId: auditSampleAssignments.leadId }).from(auditSampleAssignments)).map((r) => r.leadId),
    );

    for (const p of executable) {
      console.log(`merge: canonical=${p.canonical}  winner=${p.winner.id}  losers=[${p.losers.map((l) => l.id).join(', ')}]`);
      const winnerHasDeal = allLeadIdsWithDeal.has(p.winner.id);
      const winnerHasAudit = allLeadIdsWithAudit.has(p.winner.id);

      for (const loser of p.losers) {
        await mergeConversationsOfLoser(loser.id, p.winner.id, tx);
        await mergeAux(loser.id, p.winner.id, tx, winnerHasDeal, winnerHasAudit);
        // Apos repointar tudo, deal/audit do loser ainda podem existir se foram
        // movidos. Caso (loser tinha deal, winner nao) — agora winner tem.
        if (!winnerHasDeal) allLeadIdsWithDeal.add(p.winner.id);
        if (!winnerHasAudit) allLeadIdsWithAudit.add(p.winner.id);
        await tx.delete(leads).where(eq(leads.id, loser.id));
      }

      const canonPhone2 = toCanonicalBrPhone(p.winner.phone2) ?? p.winner.phone2;
      await canonicalizeLeadAndConvs(p.winner.id, p.canonical, canonPhone2, tx);
    }

    for (const o of orphans) {
      const canon = toCanonicalBrPhone(o.phone);
      if (!canon) continue;
      const canonPhone2 = toCanonicalBrPhone(o.phone2) ?? o.phone2;
      console.log(`rename: ${o.id}  ${o.phone} -> ${canon}`);
      await canonicalizeLeadAndConvs(o.id, canon, canonPhone2, tx);
    }
  });

  console.log('OK. Reconciliacao aplicada.');
}

async function main(): Promise<void> {
  console.log(`Modo: ${APPLY ? 'APPLY (escreve no banco)' : 'DRY-RUN (sem alteracoes)'}`);
  const { plans, orphans } = await buildPlan();
  printPlan(plans, orphans);

  if (!APPLY) {
    console.log('\nDry-run completo. Para aplicar: npm run merge-duplicate-phones -- --apply');
    return;
  }

  await applyPlan(plans, orphans);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
