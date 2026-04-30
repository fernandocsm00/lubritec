import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import { db, pool } from '../db/client';
import { leads } from '../db/schema';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SQLITE_PATH = path.resolve(__dirname, '../..', 'lubritec.db');

interface LegacyCustomer {
  id: number;
  name: string;
  phone: string;
  last_purchase_date: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  avg_mileage_per_day: number | null;
}

async function run() {
  if (!existsSync(SQLITE_PATH)) {
    console.log(`Nenhum arquivo SQLite em ${SQLITE_PATH} — nada a importar.`);
    await pool.end();
    return;
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const rows = sqlite.prepare('SELECT * FROM customers').all() as LegacyCustomer[];
  console.log(`Encontrados ${rows.length} customers no SQLite.`);

  let inserted = 0;
  let skipped = 0;
  let rejected = 0;

  for (const r of rows) {
    if (!r.name?.trim() || !r.phone?.trim()) {
      console.warn(`✗ Linha rejeitada (name/phone vazio): id=${r.id}`);
      rejected++;
      continue;
    }
    const phone = r.phone.replace(/\D/g, ''); // só dígitos
    if (!phone) {
      rejected++;
      continue;
    }
    const [existing] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
    if (existing) {
      skipped++;
      continue;
    }
    await db.insert(leads).values({
      name: r.name.trim(),
      phone,
      vehiclePlate: r.vehicle_plate?.trim() || null,
      vehicleModel: r.vehicle_model?.trim() || null,
      lastPurchaseDate: r.last_purchase_date || null,
      avgMileagePerDay: r.avg_mileage_per_day ?? 50,
    });
    inserted++;
  }

  console.log(`✓ Inseridos: ${inserted}, ignorados (já existiam): ${skipped}, rejeitados: ${rejected}.`);
  sqlite.close();
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
