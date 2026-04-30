import 'dotenv/config';
import readline from 'readline';
import { db, pool } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/hash';

const ADMIN_EMAIL = 'fernando@agenciaimperium.com.br';
const ADMIN_NAME = 'Fernando (Admin)';

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => { rl.close(); resolve(a); }));
}

async function run() {
  const [existing] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  if (existing) {
    console.log(`Admin '${ADMIN_EMAIL}' já existe. Nada a fazer.`);
    await pool.end();
    return;
  }

  const password = (await ask(`Defina senha temporária para o admin '${ADMIN_EMAIL}': `)).trim();
  if (password.length < 8) {
    console.error('Senha precisa ter ao menos 8 caracteres.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await db.insert(users).values({
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    role: 'admin',
    passwordHash,
  });
  console.log(`✓ Admin criado. Faça login em ${process.env.APP_URL}/login`);
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
