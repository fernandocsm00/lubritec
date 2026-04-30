import 'dotenv/config';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const { Pool } = pg;

const isTest = process.env.NODE_ENV === 'test';
const connectionString = isTest
  ? process.env.TEST_DATABASE_URL
  : process.env.DATABASE_URL;
const dbSchema = isTest
  ? (process.env.TEST_DB_SCHEMA ?? 'lubritec_test')
  : (process.env.DB_SCHEMA ?? 'lubritec');

if (!connectionString) {
  throw new Error('DATABASE_URL not set');
}

if (!/^[a-z_][a-z0-9_]*$/.test(dbSchema)) {
  throw new Error(`Invalid schema name: ${dbSchema}`);
}

export const SCHEMA_NAME = dbSchema;

export const pool = new Pool({ connectionString });

// Set search_path on every new connection so unqualified table names resolve to our schema.
pool.on('connect', (client) => {
  client.query(`SET search_path TO ${dbSchema}, public`).catch((err) => {
    console.error('Failed to set search_path:', err);
  });
});

export const db = drizzle(pool, { schema });
