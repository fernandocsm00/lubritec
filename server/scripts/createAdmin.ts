import 'dotenv/config';
import { db, pool } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/hash';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function run() {
  const email = arg('email');
  const password = arg('password');
  const name = arg('name') ?? email;
  const role = arg('role') ?? 'admin';

  if (!email || !password) {
    console.error('Uso: tsx server/scripts/createAdmin.ts --email=<x> --password=<y> [--name=<n>] [--role=admin|comercial]');
    process.exit(1);
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.log(`Usuário '${email}' já existe (id=${existing.id}). Nada a fazer.`);
    await pool.end();
    return;
  }

  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(users)
    .values({ email, name: name!, role: role as 'admin' | 'comercial', passwordHash })
    .returning({ id: users.id, email: users.email, role: users.role });

  console.log(`✓ Usuário criado: id=${created.id} email=${created.email} role=${created.role}`);
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
