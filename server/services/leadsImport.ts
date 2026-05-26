import { parse } from 'csv-parse/sync';
import { db } from '../db/client';
import { leads, type NewLead } from '../db/schema';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { ImportReport, Imbp, Segment } from '@shared/types';
import { IMBP_VALUES, SEGMENT_VALUES, IMBP_TO_SEGMENT } from '@shared/types';
import { normalizeCnpj, isValidCnpjFormat } from '../lib/cnpj';
import { tryEnrollSafe } from './continuousCampaign';
import { recordTransition } from './stageTransitions';

// Mudanca 2026-05-22: removida a validacao SINCRONA via BrasilAPI durante o
// import. Antes: cada CNPJ era consultado na hora (21s entre calls -> 200 linhas
// levavam 70min, e BrasilAPI fora derrubava tudo). Agora: validamos so o formato
// (digitos verificadores), inserimos imediatamente, e deixamos o enrichmentWorker
// validar ativo/inativo + buscar telefone em background.
// Limite removido — qualquer tamanho de CSV agora roda em ~1s.

const HEADER_ALIASES: Record<string, string> = {
  // Nome / Nome da Conta
  name: 'name',
  nome: 'name',
  nome_da_conta: 'name',
  'nome_da_conta_': 'name',
  empresa: 'name',
  razao_social: 'name',
  'razão_social': 'name',
  // Telefone principal
  phone: 'phone',
  telefone: 'phone',
  telefone_1: 'phone',
  telefone1: 'phone',
  celular: 'phone',
  contato: 'phone',
  // Telefone secundario
  phone2: 'phone2',
  telefone_2: 'phone2',
  telefone2: 'phone2',
  celular2: 'phone2',
  celular_2: 'phone2',
  // CNPJ
  cnpj: 'cnpj',
  // Email
  email: 'email',
  // Observacoes
  notes: 'notes',
  observacoes: 'notes',
  'observações': 'notes',
  obs: 'notes',
  // Endereco
  endereco: 'address1',
  'endereço': 'address1',
  endereco_1: 'address1',
  'endereço_1': 'address1',
  endereco1: 'address1',
  'endereço1': 'address1',
  endereco_2: 'address2',
  'endereço_2': 'address2',
  endereco2: 'address2',
  'endereço2': 'address2',
  complemento: 'address2',
  // Cidade
  cidade: 'city',
  city: 'city',
  municipio: 'city',
  'município': 'city',
  // IMBP / Linha de Negocio
  imbp: 'imbp',
  linha_de_negocio: 'imbp',
  'linha_de_negócio': 'imbp',
  linha_de_negocio_do_cliente: 'imbp',
  'linha_de_negócio_do_cliente': 'imbp',
  // Segmento
  segmento: 'segment',
  segment: 'segment',
  segmento_do_cliente: 'segment',
};

// Phone NÃO é mais obrigatório: leads CNPJ-only são aceitos como 'incomplete'
// e vão pra fila de enriquecimento (BrasilAPI/scraping/IA).
const REQUIRED = ['name', 'cnpj'] as const;

export interface CsvRow {
  line: number;
  name: string;
  phone: string | null;
  phone2: string | null;
  cnpj: string;
  email: string | null;
  notes: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  imbp: Imbp | null;
  segment: Segment | null;
}

/**
 * Tenta casar o valor do CSV com um IMBP_VALUES. Aceita:
 *   - o codigo exato (ex: "000011-PVL-REVENDA")
 *   - apenas o prefixo numerico (ex: "000011")
 *   - variacoes com/sem hifen ou espaco (ex: "000011 PVL REVENDA")
 * Retorna null se nao casar.
 */
function parseImbpValue(raw: string): Imbp | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  // Match exato (case-insensitive) primeiro
  const upper = cleaned.toUpperCase();
  const exact = IMBP_VALUES.find((v) => v.toUpperCase() === upper);
  if (exact) return exact;
  // Match por prefixo numerico
  const prefix = cleaned.match(/^(\d{6})/)?.[1];
  if (prefix) {
    const byPrefix = IMBP_VALUES.find((v) => v.startsWith(prefix));
    if (byPrefix) return byPrefix;
  }
  // Match normalizando separadores (espaco/hifen viram tudo um)
  const norm = upper.replace(/[\s_-]+/g, '-');
  const byNorm = IMBP_VALUES.find((v) => v.toUpperCase() === norm);
  return byNorm ?? null;
}

function parseSegmentValue(raw: string): Segment | null {
  const cleaned = raw.trim().toUpperCase();
  if (!cleaned) return null;
  // Pega o prefixo de 3 letras (ex: "PVL - Veiculos" → "PVL")
  const code = cleaned.split(/[\s-]/)[0] as Segment;
  return (SEGMENT_VALUES as readonly string[]).includes(code) ? code : null;
}

function detectDelimiter(buf: Buffer): ',' | ';' {
  const head = buf.subarray(0, 1024).toString('utf8');
  const first = head.split(/\r?\n/)[0] ?? '';
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
}

function normalizeHeader(h: string): string | null {
  const key = h.trim().toLowerCase().replace(/\s+/g, '_');
  return HEADER_ALIASES[key] ?? null;
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export async function parseLeadsCsv(buf: Buffer): Promise<{
  rows: CsvRow[];
  rejected: { line: number; reason: string }[];
  missingHeaders: string[];
}> {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
  }
  const delimiter = detectDelimiter(buf);
  const records = parse(buf, { delimiter, columns: false, skip_empty_lines: true, trim: true });
  if (records.length === 0) return { rows: [], rejected: [], missingHeaders: [...REQUIRED] };

  const headerRow = records[0] as string[];
  const mapped = headerRow.map(normalizeHeader);
  const missingHeaders = REQUIRED.filter((req) => !mapped.includes(req));
  if (missingHeaders.length > 0) return { rows: [], rejected: [], missingHeaders };

  const rows: CsvRow[] = [];
  const rejected: { line: number; reason: string }[] = [];
  const cnpjsSeen = new Set<string>();

  for (let i = 1; i < records.length; i++) {
    const line = i + 1;
    const raw = records[i] as string[];
    const obj: Record<string, string> = {};
    mapped.forEach((key, idx) => {
      if (key) obj[key] = raw[idx] ?? '';
    });

    const name = (obj.name ?? '').trim();
    if (!name) {
      rejected.push({ line, reason: 'nome vazio' });
      continue;
    }

    // Telefone agora é OPCIONAL. Linhas sem telefone viram leads 'incomplete'
    // e vão pra enriquecimento. Inválido (com lixo mas <8 dígitos) ainda rejeita.
    const phoneRaw = (obj.phone ?? '').trim();
    let phone: string | null = null;
    if (phoneRaw) {
      const cleaned = normalizePhone(phoneRaw);
      if (cleaned.length < 8) {
        rejected.push({ line, reason: 'telefone inválido (precisa ter ao menos 8 dígitos)' });
        continue;
      }
      phone = cleaned;
    }

    // Telefone 2: opcional. Se vier mas invalido, ignora silenciosamente (nao
    // rejeita a linha inteira por isso — Telefone 2 eh apenas fallback).
    const phone2Raw = (obj.phone2 ?? '').trim();
    let phone2: string | null = null;
    if (phone2Raw) {
      const cleaned2 = normalizePhone(phone2Raw);
      if (cleaned2.length >= 8) phone2 = cleaned2;
    }

    const cnpj = normalizeCnpj((obj.cnpj ?? '').trim());
    if (!cnpj) {
      rejected.push({ line, reason: 'CNPJ vazio' });
      continue;
    }
    if (!isValidCnpjFormat(cnpj)) {
      rejected.push({ line, reason: 'CNPJ inválido (dígitos verificadores)' });
      continue;
    }
    if (cnpjsSeen.has(cnpj)) {
      rejected.push({ line, reason: 'CNPJ duplicado no arquivo' });
      continue;
    }
    cnpjsSeen.add(cnpj);

    const email = (obj.email ?? '').trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      rejected.push({ line, reason: 'email inválido' });
      continue;
    }

    // Taxonomia: IMBP define segmento. Se vier so segmento, usa. Valores
    // invalidos sao silenciosamente ignorados (nao queremos rejeitar a linha
    // inteira por um IMBP digitado errado).
    const imbp = parseImbpValue(obj.imbp ?? '');
    const segmentInput = parseSegmentValue(obj.segment ?? '');
    const segment: Segment | null = imbp ? IMBP_TO_SEGMENT[imbp] : segmentInput;

    rows.push({
      line,
      name,
      phone,
      phone2,
      cnpj,
      email,
      notes: (obj.notes ?? '').trim() || null,
      address1: (obj.address1 ?? '').trim() || null,
      address2: (obj.address2 ?? '').trim() || null,
      city: (obj.city ?? '').trim() || null,
      imbp,
      segment,
    });
  }

  return { rows, rejected, missingHeaders: [] };
}

// Mantemos a assinatura `opts` por backwards-compat com chamadores e testes,
// mas o parametro `throttleMs` nao tem mais efeito (nao ha mais throttle).
export async function importLeadsFromCsv(
  buf: Buffer,
  _opts: { throttleMs?: number } = {},
): Promise<ImportReport> {
  const { rows, rejected, missingHeaders } = await parseLeadsCsv(buf);
  if (missingHeaders.length > 0) {
    throw new HttpError(400, `Coluna obrigatória ausente: ${missingHeaders.join(', ')}`);
  }

  // Sem mais validacao SINCRONA de CNPJ — todas linhas com formato valido
  // (validado em parseLeadsCsv) sao inseridas. O enrichmentWorker em background
  // valida ativo/inativo + busca telefone faltante via BrasilAPI respeitando
  // o rate limit, sem segurar o request do usuario.
  const validRows: CsvRow[] = rows;

  let inserted = 0;
  let updated = 0;
  // IDs de leads que ficaram em 'complete' nessa importação — enrolam na contínua
  // depois do commit da transação (best-effort, fora do tx pra não segurar locks).
  const toEnroll: string[] = [];
  // Audit trail: registra transições fora do tx (best-effort).
  const newLeads: Array<{ id: string; stage: 'complete' | 'incomplete' }> = [];
  const promoted: string[] = []; // ids de leads que foram de incomplete → complete

  await db.transaction(async (tx) => {
    for (const row of validRows) {
      const [existing] = await tx
        .select()
        .from(leads)
        .where(eq(leads.cnpj, row.cnpj))
        .limit(1);

      if (!existing) {
        const stage = row.phone ? 'complete' : 'incomplete';
        const [created] = await tx.insert(leads).values({
          name: row.name,
          phone: row.phone,
          phone2: row.phone2,
          cnpj: row.cnpj,
          email: row.email,
          notes: row.notes,
          address1: row.address1,
          address2: row.address2,
          city: row.city,
          imbp: row.imbp,
          segment: row.segment,
          source: 'csv',
          status: 'frio',
          flowStage: stage,
        }).returning({ id: leads.id });
        newLeads.push({ id: created.id, stage });
        if (stage === 'complete') toEnroll.push(created.id);
        inserted++;
        continue;
      }

      // Existing lead with this CNPJ: backfill empty fields only. Never
      // overwrite name, source already set by previous interactions.
      // Phone PODE ser preenchido se está vazio (ex: lead criado sem phone no CSV
      // anterior, agora veio com phone num re-import) — promove stage também.
      const patch: Partial<NewLead> = {};
      if (row.email != null && (existing.email == null || existing.email === '')) {
        patch.email = row.email;
      }
      if (row.notes != null && (existing.notes == null || existing.notes === '')) {
        patch.notes = row.notes;
      }
      if (row.phone && (existing.phone == null || existing.phone === '')) {
        patch.phone = row.phone;
        if (existing.flowStage === 'incomplete') {
          patch.flowStage = 'complete';
          toEnroll.push(existing.id);
          promoted.push(existing.id);
        }
      }
      // Backfill dos novos campos: so sobrescreve se atualmente vazio.
      if (row.phone2 && !existing.phone2) patch.phone2 = row.phone2;
      if (row.address1 && !existing.address1) patch.address1 = row.address1;
      if (row.address2 && !existing.address2) patch.address2 = row.address2;
      if (row.city && !existing.city) patch.city = row.city;
      if (row.imbp && !existing.imbp) {
        patch.imbp = row.imbp;
        patch.segment = row.segment; // ja derivado no parser
      } else if (row.segment && !existing.segment) {
        patch.segment = row.segment;
      }

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date();
        await tx.update(leads).set(patch).where(eq(leads.id, existing.id));
      }
      updated++;
    }
  });

  // Audit trail (best-effort, fora do tx).
  for (const nl of newLeads) {
    await recordTransition({
      leadId: nl.id,
      fromStage: null,
      toStage: nl.stage,
      source: 'csv_import',
    });
  }
  for (const leadId of promoted) {
    await recordTransition({
      leadId,
      fromStage: 'incomplete',
      toStage: 'complete',
      source: 'csv_import',
    });
  }

  // Best-effort enroll fora da transação. Cada chamada é idempotente e safe.
  for (const leadId of toEnroll) {
    await tryEnrollSafe(leadId);
  }

  return { inserted, updated, skipped: 0, rejected };
}
