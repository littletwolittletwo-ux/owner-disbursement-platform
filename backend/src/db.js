import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const connStr = process.env.DATABASE_URL || 'postgres://owner_app:owner_app_password@localhost:5432/owner_disbursements';
export const pool = new Pool({
  connectionString: connStr,
  ssl: connStr.includes('neon.tech') ? { rejectUnauthorized: false } : undefined
});

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
