import * as dotenv from 'dotenv';
dotenv.config();

import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres';
import { drizzle as mysqlDrizzle } from 'drizzle-orm/mysql2';
import pkg from 'pg';
const { Pool } = pkg;
import mysql from 'mysql2/promise';
import * as schema from './schema.ts';

// Detect database engine from environment
export const isMySQL = process.env.SQL_ENGINE === 'mysql' || process.env.SQL_PORT === '3306';

// Initialize connection pools based on target DB engine
let pgPoolInstance: any = null;
let mysqlPoolInstance: any = null;

if (isMySQL) {
  console.log("[Database] Initializing MySQL/MariaDB connection pool...");
  mysqlPoolInstance = mysql.createPool({
    host: process.env.SQL_HOST,
    port: process.env.SQL_PORT ? parseInt(process.env.SQL_PORT, 10) : 3306,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
} else {
  console.log("[Database] Initializing PostgreSQL connection pool...");
  pgPoolInstance = new Pool({
    host: process.env.SQL_HOST,
    port: process.env.SQL_PORT ? parseInt(process.env.SQL_PORT, 10) : 5432,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
    max: 10,
    keepAlive: true,
    ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : false
  });
}

// Prevent unhandled pool-level errors from crashing the application
if (pgPoolInstance) {
  pgPoolInstance.on('error', (err: any) => {
    console.error('Unexpected error on idle SQL pool client:', err);
  });
}
if (mysqlPoolInstance) {
  mysqlPoolInstance.on('error', (err: any) => {
    console.error('Unexpected error on idle MySQL pool connection:', err);
  });
}

// Initialize Drizzle with the active pool and schema
export const db = (isMySQL 
  ? mysqlDrizzle(mysqlPoolInstance, { schema, mode: 'default' } as any) 
  : pgDrizzle(pgPoolInstance, { schema })) as any;

// Wrap pool to support connect/query signature for both engines
export const pool = {
  connect: async () => {
    if (isMySQL) {
      const connection = await mysqlPoolInstance.getConnection();
      return {
        query: async (sql: string, params?: any[]) => {
          // Map postgres style $1, $2 placeholders to MySQL style ?
          let formattedSql = sql;
          if (sql.includes('$1')) {
            formattedSql = sql.replace(/\$\d+/g, '?');
          }
          const [rows] = await connection.query(formattedSql, params);
          return { rows };
        },
        release: () => {
          connection.release();
        }
      };
    } else {
      const client = await pgPoolInstance.connect();
      return {
        query: async (sql: string, params?: any[]) => {
          return client.query(sql, params);
        },
        release: () => {
          client.release();
        }
      };
    }
  },
  on: (event: string, cb: any) => {
    if (isMySQL) {
      mysqlPoolInstance.on(event, cb);
    } else {
      pgPoolInstance.on(event, cb);
    }
  }
};

// Automatically bootstrap tables if they do not exist
export async function bootstrapDb() {
  const client = await pool.connect();
  try {
    console.log(`[Database Bootstrap] Bootstrapping tables for ${isMySQL ? "MySQL/MariaDB" : "PostgreSQL"}...`);
    
    if (isMySQL) {
      // Create MySQL tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          uid VARCHAR(255) NOT NULL UNIQUE,
          email VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS records (
          id VARCHAR(255) PRIMARY KEY,
          sector VARCHAR(255) NOT NULL,
          data VARCHAR(255) NOT NULL,
          deputado TEXT NOT NULL,
          cidade VARCHAR(255),
          projeto_lei TEXT,
          emenda TEXT,
          recursos VARCHAR(255),
          status VARCHAR(255),
          observacoes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS execution_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          action VARCHAR(255) NOT NULL,
          status VARCHAR(255) NOT NULL,
          details TEXT,
          user_email VARCHAR(255)
        );
      `);
    } else {
      // Create PostgreSQL tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          uid TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      
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
    }
    
    console.log("[Database Bootstrap] Tables verified/created successfully.");
  } catch (err: any) {
    console.error("[Database Bootstrap] Error bootstrapping tables:", err.message || err);
  } finally {
    client.release();
  }
}
