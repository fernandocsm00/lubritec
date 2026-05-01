import { parse } from 'csv-parse/sync';
import { db } from '../db/client';
import { leads, type NewLead } from '../db/schema';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { ImportReport } from '@shared/types';

const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  nome: 'name',
  phone: 'phone',
  telefone: 'phone',
  email: 'email',
  notes: 'notes',
  observacoes: 'notes',
  observações: 'notes',
  vehicle_plate: 'vehiclePlate',
  placa: 'vehiclePlate',
  vehicle_model: 'vehicleModel',
  modelo: 'vehicleModel',
  last_purchase_date: 'lastPurchaseDate',
  ultima_compra: 'lastPurchaseDate',
  última_compra: 'lastPurchaseDate',
  avg_mileage_per_day: 'avgMileagePerDay',
  km_dia: 'avgMileagePerDay',
};

const REQUIRED = ['name', 'phone'] as const;

export interface CsvRow {
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  vehiclePlate: string | null;
  vehicleModel: string | null;
  lastPurchaseDate: string | null;
  avgMileagePerDay: number | null;
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

function parseDateBR(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
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

  for (let i = 1; i < records.length; i++) {
    const line = i + 1;
    const raw = records[i] as string[];
    const obj: Record<string, string> = {};
    mapped.forEach((key, idx) => {
      if (key) obj[key] = raw[idx] ?? '';
    });

    const name = (obj.name ?? '').trim();
    if (!name) {
      rejected.push({ line, reason: 'name vazio' });
      continue;
    }

    const phoneRaw = (obj.phone ?? '').trim();
    const phone = normalizePhone(phoneRaw);
    if (!phone) {
      rejected.push({ line, reason: 'phone vazio ou inválido' });
      continue;
    }

    const email = (obj.email ?? '').trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      rejected.push({ line, reason: 'email inválido' });
      continue;
    }

    let lastPurchaseDate: string | null = null;
    const dateRaw = (obj.lastPurchaseDate ?? '').trim();
    if (dateRaw) {
      lastPurchaseDate = parseDateBR(dateRaw);
      if (!lastPurchaseDate) {
        rejected.push({ line, reason: 'data inválida' });
        continue;
      }
    }

    let avgMileagePerDay: number | null = null;
    const mileageRaw = (obj.avgMileagePerDay ?? '').trim();
    if (mileageRaw) {
      const n = Number(mileageRaw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        rejected.push({ line, reason: 'avg_mileage_per_day inválido' });
        continue;
      }
      avgMileagePerDay = n;
    }

    rows.push({
      name,
      phone,
      email,
      notes: (obj.notes ?? '').trim() || null,
      vehiclePlate: (obj.vehiclePlate ?? '').trim() || null,
      vehicleModel: (obj.vehicleModel ?? '').trim() || null,
      lastPurchaseDate,
      avgMileagePerDay,
    });
  }

  return { rows, rejected, missingHeaders: [] };
}

export async function importLeadsFromCsv(buf: Buffer): Promise<ImportReport> {
  const { rows, rejected, missingHeaders } = await parseLeadsCsv(buf);
  if (missingHeaders.length > 0) {
    throw new HttpError(400, `Missing required column: ${missingHeaders.join(', ')}`);
  }
  let inserted = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const [existing] = await tx
        .select()
        .from(leads)
        .where(eq(leads.phone, row.phone))
        .limit(1);

      if (!existing) {
        await tx.insert(leads).values({
          name: row.name,
          phone: row.phone,
          email: row.email,
          notes: row.notes,
          vehiclePlate: row.vehiclePlate,
          vehicleModel: row.vehicleModel,
          lastPurchaseDate: row.lastPurchaseDate,
          avgMileagePerDay: row.avgMileagePerDay,
          source: 'csv',
          status: 'frio',
        });
        inserted++;
        continue;
      }

      const patch: Partial<NewLead> = {};
      if (row.email != null && (existing.email == null || existing.email === '')) {
        patch.email = row.email;
      }
      if (row.notes != null && (existing.notes == null || existing.notes === '')) {
        patch.notes = row.notes;
      }
      if (row.vehiclePlate != null && (existing.vehiclePlate == null || existing.vehiclePlate === '')) {
        patch.vehiclePlate = row.vehiclePlate;
      }
      if (row.vehicleModel != null && (existing.vehicleModel == null || existing.vehicleModel === '')) {
        patch.vehicleModel = row.vehicleModel;
      }
      if (row.lastPurchaseDate && existing.lastPurchaseDate == null) {
        patch.lastPurchaseDate = row.lastPurchaseDate;
      }
      if (row.avgMileagePerDay != null && existing.avgMileagePerDay == null) {
        patch.avgMileagePerDay = row.avgMileagePerDay;
      }
      // name is intentionally NOT in the patch — never overwrite an existing name on import.
      // source is intentionally NOT in the patch — preserves manual/whatsapp source on existing rows.

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date();
        await tx.update(leads).set(patch).where(eq(leads.id, existing.id));
      }
      updated++;
    }
  });

  return { inserted, updated, skipped: 0, rejected };
}
