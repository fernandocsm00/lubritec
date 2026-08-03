import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { db } from '../db/client';
import { leads, type NewLead } from '../db/schema';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { ImportReport, Imbp, Segment, Uf } from '@shared/types';
import { IMBP_VALUES, SEGMENT_VALUES, IMBP_TO_SEGMENT, UF_VALUES } from '@shared/types';
import { parseTaxIdLenient } from '../lib/cnpj';
import { toCanonicalBrPhone } from '../lib/phoneBR';
import { tryEnrollSafe } from './continuousCampaign';
import { recordTransition } from './stageTransitions';
import {
  startBulkEnrichment,
  appendLeadsToActiveJob,
  ENRICHMENT_TICK_MS,
} from './enrichmentJobs';

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
  // CNPJ / CPF / Documento (campo aceita ambos — service valida o tipo)
  cnpj: 'cnpj',
  cpf: 'cnpj',
  documento: 'cnpj',
  cpf_cnpj: 'cnpj',
  'cpf/cnpj': 'cnpj',
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

  uf: 'uf',
  estado: 'uf',
  unidade_federativa: 'uf',
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
  uf: Uf | null;
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

/**
 * Casa o valor do CSV com um UF_VALUES (RS/BA). Aceita a sigla direta
 * (case-insensitive) ou o nome do estado por extenso. Retorna null se nao casar
 * — UF invalida nao rejeita a linha (mesmo tratamento de IMBP/segment).
 */
function parseUfValue(raw: string): Uf | null {
  const cleaned = raw.trim().toUpperCase();
  if (!cleaned) return null;
  const bySigla = UF_VALUES.find((v) => v === cleaned);
  if (bySigla) return bySigla;
  if (cleaned.includes('RIO GRANDE DO SUL')) return 'RS';
  if (cleaned.includes('BAHIA')) return 'BA';
  return null;
}

function detectDelimiter(buf: Buffer): ',' | ';' {
  const head = buf.subarray(0, 1024).toString('utf8');
  const first = head.split(/\r?\n/)[0] ?? '';
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
}

/**
 * Escapa um valor pra CSV (RFC 4180): se contem virgula, aspas duplas ou
 * quebra de linha, embrulha em aspas e duplica as aspas internas.
 */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Converte a primeira planilha de um workbook XLSX para uma string CSV.
 * Preserva o texto formatado das celulas (cell.text) pra evitar perder
 * leading zeros (CNPJ "00.360..." vira string textual, nao numero).
 *
 * Para celulas vazias usa string vazia. Linhas totalmente vazias sao puladas.
 */
async function xlsxToCsv(buf: Buffer): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return Buffer.from('');

  const lines: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    // row.values inclui um undefined no indice 0 (ExcelJS quirk).
    const raw = row.values as Array<unknown>;
    // Determina o ultimo indice nao-vazio pra nao trailing-comma demais.
    let lastNonEmpty = 0;
    for (let i = 1; i < raw.length; i++) {
      const v = raw[i];
      if (v != null && String(v).trim() !== '') lastNonEmpty = i;
    }
    if (lastNonEmpty === 0) return; // linha vazia

    const cells: string[] = [];
    for (let i = 1; i <= lastNonEmpty; i++) {
      const cell = row.getCell(i);
      // cell.text respeita o numFmt (preserva CNPJ "00.360..." como string).
      // Fallback pra value.toString() quando text vazio mas value existe.
      let text = cell.text ?? '';
      if (!text && cell.value != null) {
        if (typeof cell.value === 'object' && 'result' in (cell.value as object)) {
          text = String((cell.value as { result: unknown }).result ?? '');
        } else {
          text = String(cell.value);
        }
      }
      cells.push(csvEscape(text));
    }
    lines.push(cells.join(','));
  });
  return Buffer.from(lines.join('\n'), 'utf-8');
}

function normalizeHeader(h: string): string | null {
  const key = h.trim().toLowerCase().replace(/\s+/g, '_');
  return HEADER_ALIASES[key] ?? null;
}

function normalizePhone(raw: string): string {
  const canonical = toCanonicalBrPhone(raw);
  if (canonical) return canonical;
  return raw.replace(/\D/g, '');
}

export async function parseLeadsCsv(buf: Buffer): Promise<{
  rows: CsvRow[];
  rejected: { line: number; reason: string }[];
  missingHeaders: string[];
}> {
  // XLSX moderno: ZIP container, magic bytes "PK\x03\x04". Convertemos a
  // primeira planilha pra CSV em memoria antes de seguir o fluxo normal.
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    try {
      buf = await xlsxToCsv(buf);
    } catch (err) {
      throw new HttpError(400, `Erro ao ler arquivo XLSX: ${err instanceof Error ? err.message : 'formato inválido'}`);
    }
  }

  // XLS legado (BIFF, pre-2007): nao suportado pelo exceljs. Pedimos pro
  // usuario salvar como XLSX ou CSV.
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    throw new HttpError(
      400,
      'Formato XLS (Excel pré-2007) não é suportado. Salve como XLSX ou CSV no Excel e tente novamente.',
    );
  }

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
  }
  const delimiter = detectDelimiter(buf);
  // CSV exportado do Excel costuma vir "sujo": aspas soltas no meio de um campo
  // (ex: 25" ou nome com "), colunas irregulares por linha, etc. Sem tolerância
  // o csv-parse LANÇA e o erro vira 500 genérico. relax_quotes + relax_column_count
  // absorvem esses casos; qualquer outra falha vira 400 acionável (aponta a linha).
  let records: string[][];
  try {
    records = parse(buf, {
      delimiter,
      columns: false,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    }) as string[][];
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'formato inválido';
    throw new HttpError(
      400,
      `Não consegui ler o CSV (${detail}). Reabra a planilha no Excel e salve como ` +
      `"CSV UTF-8 (delimitado por vírgula)" ou como XLSX, e tente de novo.`,
    );
  }
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

    const rawTaxId = (obj.cnpj ?? '').trim();
    if (!rawTaxId || !rawTaxId.replace(/\D/g, '')) {
      rejected.push({ line, reason: 'CNPJ vazio' });
      continue;
    }
    const parsed = parseTaxIdLenient(rawTaxId);
    if (!parsed) {
      rejected.push({ line, reason: 'CPF/CNPJ inválido (dígitos verificadores)' });
      continue;
    }
    const cnpj = parsed.value; // canônico (11 dig CPF ou 14 dig CNPJ)
    if (cnpjsSeen.has(cnpj)) {
      rejected.push({ line, reason: 'CPF/CNPJ duplicado no arquivo' });
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
      uf: parseUfValue(obj.uf ?? ''),
      imbp,
      segment,
    });
  }

  return { rows, rejected, missingHeaders: [] };
}

/**
 * Dispara enriquecimento BrasilAPI pra leads recém-criados em flow_stage='incomplete'.
 *
 * Estratégia:
 *  - Se há job ativo (pending/running/paused), anexa os novos IDs via
 *    appendLeadsToActiveJob (dedupe nativo).
 *  - Caso contrário, cria novo job via startBulkEnrichment, que snapshota TODOS
 *    os incompletes (cobre backlog antigo de graça).
 *
 * Try/catch envolvendo tudo: erro nunca falha o import. Retorna null em qualquer
 * falha (incluindo HttpError 400 "Nenhum lead incompleto…" do startBulkEnrichment).
 */
async function triggerAutoEnrichment(
  newLeadIds: string[],
  userId: string,
): Promise<NonNullable<ImportReport['enrichmentTriggered']> | null> {
  try {
    const appended = await appendLeadsToActiveJob(newLeadIds);
    if (appended) {
      const minutes = Math.ceil((appended.appended * ENRICHMENT_TICK_MS) / 60_000);
      return {
        jobId: appended.jobId,
        mode: 'appended',
        newLeadsQueued: appended.appended,
        estimatedMinutes: minutes,
      };
    }
    // Sem job ativo — cria um novo.
    const job = await startBulkEnrichment(userId);
    const minutes = Math.ceil((job.totalLeads * ENRICHMENT_TICK_MS) / 60_000);
    return {
      jobId: job.id,
      mode: 'started',
      newLeadsQueued: job.totalLeads,
      estimatedMinutes: minutes,
    };
  } catch (err) {
    console.error('[auto-enrichment] trigger failed:', err);
    return null;
  }
}

// Mantemos a assinatura `opts` por backwards-compat com chamadores e testes,
// mas o parametro `throttleMs` nao tem mais efeito (nao ha mais throttle).
export async function importLeadsFromCsv(
  buf: Buffer,
  opts: { throttleMs?: number; userId?: string } = {},
): Promise<ImportReport> {
  const { report } = await importLeadsFromCsvWithIds(buf, opts);
  return report;
}

/**
 * Igual ao importLeadsFromCsv, mas também devolve os `leadId`s dos CNPJs do
 * arquivo (novos + existentes) — usado pelo import de audiência de campanha,
 * que precisa dos leads pra montar a audiência e enriquecer.
 */
export async function importLeadsFromCsvWithIds(
  buf: Buffer,
  opts: { throttleMs?: number; userId?: string } = {},
): Promise<{ report: ImportReport; leadIds: string[] }> {
  const { rows, rejected, missingHeaders } = await parseLeadsCsv(buf);
  if (missingHeaders.length > 0) {
    throw new HttpError(400, `Coluna obrigatória ausente: ${missingHeaders.join(', ')}`);
  }

  // leadIds dos CNPJs do arquivo (novos + existentes), na ordem das linhas.
  const leadIds: string[] = [];

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
          uf: row.uf,
          imbp: row.imbp,
          segment: row.segment,
          source: 'csv',
          status: 'frio',
          flowStage: stage,
        }).returning({ id: leads.id });
        newLeads.push({ id: created.id, stage });
        leadIds.push(created.id);
        if (stage === 'complete') toEnroll.push(created.id);
        inserted++;
        continue;
      }
      leadIds.push(existing.id);

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
      if (row.uf && !existing.uf) patch.uf = row.uf;
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

  // Auto-disparo de enriquecimento — best-effort. Pega os leads novos que
  // ficaram em 'incomplete' e os anexa ao job ativo (ou cria um novo).
  let enrichmentTriggered: ImportReport['enrichmentTriggered'] = null;
  const newIncompleteIds = newLeads
    .filter((l) => l.stage === 'incomplete')
    .map((l) => l.id);
  if (opts.userId && newIncompleteIds.length > 0) {
    enrichmentTriggered = await triggerAutoEnrichment(newIncompleteIds, opts.userId);
  }

  const report: ImportReport = { inserted, updated, skipped: 0, rejected, enrichmentTriggered };
  return { report, leadIds };
}
