import * as dotenv from 'dotenv';
dotenv.config();

import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres';
import { drizzle as mysqlDrizzle } from 'drizzle-orm/mysql2';
import pkg from 'pg';
const { Pool } = pkg;
import mysql from 'mysql2/promise';
import * as schema from './schema.ts';

import * as fs from 'fs';

// Detect if we are in Google Cloud/AI Studio and there is an active PostgreSQL Cloud SQL instance socket
const cloudSqlHost = process.env.SQL_HOST;
const isGoogleCloudPostgres = !!(cloudSqlHost && (
  cloudSqlHost.startsWith('/app/cloudsql') || 
  cloudSqlHost.startsWith('/cloudsql') ||
  fs.existsSync(`${cloudSqlHost}/.s.PGSQL.5432`)
));

export const isMySQL = !isGoogleCloudPostgres && (process.env.SQL_ENGINE !== 'postgres');

// Initialize connection pools based on target DB engine
let pgPoolInstance: any = null;
let mysqlPoolInstance: any = null;

if (isMySQL) {
  console.log("[Database] Initializing MySQL/MariaDB connection pool...");
  
  // Detect if we are on Hostinger (indicated by a Unix socket or Passenger PORT)
  const isHostinger = typeof process.env.PORT === 'string' && (
    process.env.PORT.includes('passenger') || 
    process.env.PORT.startsWith('/')
  );

  let targetHost = process.env.SQL_HOST || 'localhost';
  if (isHostinger) {
    console.log(`[Database] Hostinger environment detected. Using configured host '${targetHost}'.`);
  }

  const mysqlConfig: any = {
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 2000, // 2 seconds connect timeout to prevent long Passenger blocking / 503 errors
    ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  };

  if (targetHost.startsWith('/')) {
    mysqlConfig.socketPath = targetHost;
    console.log(`[Database] Connecting via Unix socket: ${targetHost}`);
  } else {
    mysqlConfig.host = targetHost;
    mysqlConfig.port = process.env.SQL_PORT ? parseInt(process.env.SQL_PORT, 10) : 3306;
    console.log(`[Database] Connecting via TCP: ${mysqlConfig.host}:${mysqlConfig.port}`);
  }

  mysqlPoolInstance = mysql.createPool(mysqlConfig);

  // Wrap pool methods to automatically fallback to localhost on connection failure
  const originalGetConnection = mysqlPoolInstance.getConnection;
  const originalQuery = mysqlPoolInstance.query;
  const originalExecute = mysqlPoolInstance.execute;

  let activePool = mysqlPoolInstance;

  mysqlPoolInstance.getConnection = async function(...args: any[]) {
    try {
      return await originalGetConnection.apply(activePool, args);
    } catch (err: any) {
      if (mysqlConfig.host && mysqlConfig.host !== 'localhost' && mysqlConfig.host !== '127.0.0.1') {
        console.warn(`[Database] Connection to ${mysqlConfig.host} failed (${err.message || err}). Trying fallback to 'localhost'...`);
        const fallbackConfig = { ...mysqlConfig, host: 'localhost' };
        try {
          const fallbackPool = mysql.createPool(fallbackConfig);
          const conn = await fallbackPool.getConnection();
          activePool = fallbackPool;
          console.log("[Database] Fallback to 'localhost' succeeded! Replaced active pool for connections.");
          return conn;
        } catch (fallbackErr: any) {
          console.error("[Database] Fallback to 'localhost' also failed:", fallbackErr.message || fallbackErr);
          throw err;
        }
      } else {
        throw err;
      }
    }
  };

  mysqlPoolInstance.query = async function(...args: any[]) {
    try {
      return await originalQuery.apply(activePool, args);
    } catch (err: any) {
      if (mysqlConfig.host && mysqlConfig.host !== 'localhost' && mysqlConfig.host !== '127.0.0.1') {
        console.warn(`[Database] Query on ${mysqlConfig.host} failed (${err.message || err}). Trying fallback to 'localhost'...`);
        const fallbackConfig = { ...mysqlConfig, host: 'localhost' };
        try {
          const fallbackPool = mysql.createPool(fallbackConfig);
          // Test fallback pool
          const conn = await fallbackPool.getConnection();
          conn.release();
          activePool = fallbackPool;
          console.log("[Database] Fallback to 'localhost' succeeded! Replaced active pool for queries.");
          return await activePool.query(...args);
        } catch (fallbackErr: any) {
          console.error("[Database] Fallback to 'localhost' failed during query:", fallbackErr.message || fallbackErr);
          throw err;
        }
      } else {
        throw err;
      }
    }
  };

  mysqlPoolInstance.execute = async function(...args: any[]) {
    try {
      return await originalExecute.apply(activePool, args);
    } catch (err: any) {
      if (mysqlConfig.host && mysqlConfig.host !== 'localhost' && mysqlConfig.host !== '127.0.0.1') {
        console.warn(`[Database] Execute on ${mysqlConfig.host} failed (${err.message || err}). Trying fallback to 'localhost'...`);
        const fallbackConfig = { ...mysqlConfig, host: 'localhost' };
        try {
          const fallbackPool = mysql.createPool(fallbackConfig);
          const conn = await fallbackPool.getConnection();
          conn.release();
          activePool = fallbackPool;
          console.log("[Database] Fallback to 'localhost' succeeded! Replaced active pool for execute.");
          return await activePool.execute(...args);
        } catch (fallbackErr: any) {
          console.error("[Database] Fallback to 'localhost' failed during execute:", fallbackErr.message || fallbackErr);
          throw err;
        }
      } else {
        throw err;
      }
    }
  };
} else {
  console.log("[Database] Initializing PostgreSQL connection pool...");
  const pgConfig: any = {
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
    max: 10,
    keepAlive: true,
    ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : false
  };

  if (isGoogleCloudPostgres) {
    pgConfig.host = cloudSqlHost;
    // Force port to 5432 for the PostgreSQL Unix socket connection on Cloud Run
    pgConfig.port = 5432;
    console.log(`[Database] Connecting to Google Cloud PostgreSQL Unix socket: ${cloudSqlHost}`);
  } else {
    pgConfig.host = process.env.SQL_HOST || '127.0.0.1';
    pgConfig.port = process.env.SQL_PORT ? parseInt(process.env.SQL_PORT, 10) : 5432;
    console.log(`[Database] Connecting to PostgreSQL via TCP: ${pgConfig.host}:${pgConfig.port}`);
  }

  pgPoolInstance = new Pool(pgConfig);
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

      // Verify columns in existing tables and upgrade varchar columns to TEXT to avoid data too long/truncation errors
      try {
        const [columns]: any = await client.query("SHOW COLUMNS FROM records");
        const existingColumns = columns.map((c: any) => c.Field.toLowerCase());
        
        const colsToVerify = [
          { name: "cidade", type: "TEXT" },
          { name: "projeto_lei", type: "TEXT" },
          { name: "emenda", type: "TEXT" },
          { name: "recursos", type: "TEXT" },
          { name: "status", type: "TEXT" },
          { name: "observacoes", type: "TEXT" },
          { name: "created_at", type: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" }
        ];

        for (const col of colsToVerify) {
          if (!existingColumns.includes(col.name.toLowerCase())) {
            console.log(`[Database Bootstrap] Adding missing column '${col.name}' to 'records'...`);
            await client.query(`ALTER TABLE records ADD COLUMN ${col.name} ${col.type}`);
          }
        }

        // Safe upgrade of columns to TEXT to handle long values (such as multiple cities or longer status names)
        console.log("[Database Bootstrap] Upgrading records table columns to TEXT to prevent truncation...");
        await client.query("ALTER TABLE records MODIFY COLUMN sector TEXT NOT NULL");
        await client.query("ALTER TABLE records MODIFY COLUMN data TEXT NOT NULL");
        await client.query("ALTER TABLE records MODIFY COLUMN cidade TEXT");
        await client.query("ALTER TABLE records MODIFY COLUMN recursos TEXT");
        await client.query("ALTER TABLE records MODIFY COLUMN status TEXT");
      } catch (verErr: any) {
        console.warn("[Database Bootstrap] records column verification/upgrade failed:", verErr.message || verErr);
      }

      try {
        const [columns]: any = await client.query("SHOW COLUMNS FROM execution_logs");
        const existingColumns = columns.map((c: any) => c.Field.toLowerCase());
        
        const colsToVerify = [
          { name: "details", type: "TEXT" },
          { name: "user_email", type: "VARCHAR(255)" }
        ];

        for (const col of colsToVerify) {
          if (!existingColumns.includes(col.name.toLowerCase())) {
            console.log(`[Database Bootstrap] Adding missing column '${col.name}' to 'execution_logs'...`);
            await client.query(`ALTER TABLE execution_logs ADD COLUMN ${col.name} ${col.type}`);
          }
        }
      } catch (verErr: any) {
        console.warn("[Database Bootstrap] execution_logs column verification failed:", verErr.message || verErr);
      }

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

      // Verify columns in existing tables for PG
      try {
        const result = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'records'
        `);
        const existingColumns = result.rows.map((r: any) => r.column_name.toLowerCase());
        
        const colsToVerify = [
          { name: "cidade", type: "TEXT" },
          { name: "projeto_lei", type: "TEXT" },
          { name: "emenda", type: "TEXT" },
          { name: "recursos", type: "TEXT" },
          { name: "status", type: "TEXT" },
          { name: "observacoes", type: "TEXT" },
          { name: "created_at", type: "TIMESTAMP DEFAULT NOW()" }
        ];

        for (const col of colsToVerify) {
          if (!existingColumns.includes(col.name.toLowerCase())) {
            console.log(`[Database Bootstrap] Adding missing column '${col.name}' to 'records' (PG)...`);
            await client.query(`ALTER TABLE records ADD COLUMN ${col.name} ${col.type}`);
          }
        }
      } catch (verErr: any) {
        console.warn("[Database Bootstrap] PG column verification failed:", verErr.message || verErr);
      }
    }
    
    console.log("[Database Bootstrap] Tables verified/created successfully.");
  } catch (err: any) {
    console.error("[Database Bootstrap] Error bootstrapping tables:", err.message || err);
  } finally {
    client.release();
  }
}
