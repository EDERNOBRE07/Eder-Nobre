import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import * as schema from './schema.ts';

// Function to create a new connection pool.
export const createPool = () => {
  const isLocal = !process.env.SQL_HOST || process.env.SQL_HOST === 'localhost' || process.env.SQL_HOST === '127.0.0.1';
  
  return new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000, // Fecha conexões ociosas após 10 segundos para evitar conexões quebradas/zumbis
    max: 10,                 // Máximo de clientes ativos no pool
    keepAlive: true,         // Envia pacotes TCP keep-alive para evitar desconexão abrupta pelo servidor/firewall
    ssl: false
  });
};

// Create a pool instance.
const pool = createPool();

// Prevent unhandled pool-level errors from crashing the application
pool.on('error', (err) => {
  console.error('Unexpected error on idle SQL pool client:', err);
});

// Initialize Drizzle with the pool and schema.
export const db = drizzle(pool, { schema });

// Automatically bootstrap tables if they do not exist
export async function bootstrapDb() {
  const client = await pool.connect();
  try {
    console.log("[Database Bootstrap] Checking tables in database...");
    
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Create records table
    await client.query(`
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        sector TEXT NOT NULL,
        data TEXT NOT NULL,
        deputado TEXT NOT NULL,
        cidade TEXT,
        projeto_lei TEXT,
        emenda TEXT,
        recursos TEXT,
        status TEXT,
        observacoes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Create execution_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS execution_logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT NOW() NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT,
        user_email TEXT
      );
    `);
    
    console.log("[Database Bootstrap] Tables verified/created successfully.");
  } catch (err: any) {
    console.error("[Database Bootstrap] Error bootstrapping tables (using local fallback is still possible):", err.message || err);
  } finally {
    client.release();
  }
}
