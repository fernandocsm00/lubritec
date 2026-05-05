import { parse } from 'csv-parse/sync';
import { db } from '../db/client';
import { leads, type NewLead } from '../db/schema';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { ImportReport } from '@shared/types';
import { normalizeCnpj, isValidCnpjFormat } from '../lib/cnpj';
import { lookupCnpj } from './cnpjLookup';
import { tryEnrollSafe } from './continuousCampaign';

// BrasilAPI free tier is roughly 3 req/min; adding ~21s between calls keeps us
// under that ceiling. Larger imports are rejected up-front so a CSV with 1000
// rows doesn't quietly take 6 hours to process.
const BRASILAPI_THROTTLE_MS = 21_000;
const MAX_CNPJ_LOOKUPS_PER_IMPORT = 200;

const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  nome: 'name',
  empresa: 'name',
  razao_social: 'name',
  'razão_social': 'name',
  phone: 'phone',
  telefone: 'phone',
  celular: 'phone',
  contato: 'phone',
  cnpj: 'cnpj',
  email: 'email',
  notes: 'notes',
  observacoes: 'notes',
  'observações': 'notes',
};

// Phone NÃO é mais obrigatório: leads CNPJ-only são aceitos como 'incomplete'
// e vão pra fila de enriquecimento (BrasilAPI/scraping/IA).
const REQUIRED = ['name', 'cnpj'] as const;

export interface CsvRow {
  line: number;
  name: string;
  phone: string | null;
  cnpj: string;
  email: string | null;
  notes: string | null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

    rows.push({
      line,
      name,
      phone,
      cnpj,
      email,
      notes: (obj.notes ?? '').trim() || null,
    });
  }

  return { rows, rejected, missingHeaders: [] };
}

export async function importLeadsFromCsv(buf: Buffer): Promise<ImportReport> {
  const { rows, rejected, missingHeaders } = await parseLeadsCsv(buf);
  if (missingHeaders.length > 0) {
    throw new HttpError(400, `Coluna obrigatória ausente: ${missingHeaders.join(', ')}`);
  }
  if (rows.length > MAX_CNPJ_LOOKUPS_PER_IMPORT) {
    throw new HttpError(
      400,
      `Importação limitada a ${MAX_CNPJ_LOOKUPS_PER_IMPORT} linhas válidas (validação de CNPJ via BrasilAPI tem rate limit gratuito).`,
    );
  }

  // Validate each CNPJ against the Receita Federal (via BrasilAPI). Any row
  // whose CNPJ is inactive, not found, or fails the lookup is rejected with a
  // descriptive reason. We throttle between calls to stay under the free tier.
  const validRows: CsvRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) await sleep(BRASILAPI_THROTTLE_MS);
    const row = rows[i];
    const result = await lookupCnpj(row.cnpj);
    if (result.status === 'inactive') {
      rejected.push({ line: row.line, reason: `CNPJ baixado/inapto (${result.situacaoCadastral ?? 'situação desconhecida'})` });
      continue;
    }
    if (result.status === 'not_found') {
      rejected.push({ line: row.line, reason: 'CNPJ não encontrado na Receita Federal' });
      continue;
    }
    if (result.status === 'error') {
      rejected.push({ line: row.line, reason: `falha ao consultar BrasilAPI: ${result.errorMessage ?? 'erro desconhecido'}` });
      continue;
    }
    validRows.push(row);
  }

  let inserted = 0;
  let updated = 0;
  // IDs de leads que ficaram em 'complete' nessa importação — enrolam na contínua
  // depois do commit da transação (best-effort, fora do tx pra não segurar locks).
  const toEnroll: string[] = [];

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
          cnpj: row.cnpj,
          email: row.email,
          notes: row.notes,
          source: 'csv',
          status: 'frio',
          flowStage: stage,
        }).returning({ id: leads.id });
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
        }
      }

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date();
        await tx.update(leads).set(patch).where(eq(leads.id, existing.id));
      }
      updated++;
    }
  });

  // Best-effort enroll fora da transação. Cada chamada é idempotente e safe.
  for (const leadId of toEnroll) {
    await tryEnrollSafe(leadId);
  }

  return { inserted, updated, skipped: 0, rejected };
}
