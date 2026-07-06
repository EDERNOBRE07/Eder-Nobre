import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env using multiple fallback paths to support different runtime CWDs (such as Hostinger Passenger cPanel)
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '.env'),
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres';
import { drizzle as mysqlDrizzle } from 'drizzle-orm/mysql2';
import pkg from 'pg';
const { Pool } = pkg;
import mysql from 'mysql2/promise';
import * as schema from './schema.ts';

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

  // Wrap pool methods to automatically fallback to localhost or Unix socket on connection failure
  const originalGetConnection = mysqlPoolInstance.getConnection;
  const originalQuery = mysqlPoolInstance.query;
  const originalExecute = mysqlPoolInstance.execute;

  let activePool = mysqlPoolInstance;
  let fallbackAttempted = false;

  async function testAndGetActivePool(): Promise<any> {
    if (activePool !== mysqlPoolInstance) {
      return activePool;
    }
    
    try {
      // Test the current primary pool connection
      const conn = await originalGetConnection.apply(mysqlPoolInstance);
      conn.release();
      return mysqlPoolInstance;
    } catch (err: any) {
      if (fallbackAttempted) {
        throw err;
      }
      fallbackAttempted = true;
      console.warn(`[Database] Primary MySQL connection failed: ${err.message || err}. Initiating auto-fallback sequence...`);
      
      // Fallback 1: Try TCP localhost if primary host was configured as something else
      if (mysqlConfig.host && mysqlConfig.host !== 'localhost' && mysqlConfig.host !== '127.0.0.1') {
        console.log("[Database] Fallback Sequence 1: Trying connection via TCP on 'localhost'...");
        const fallbackConfig = { ...mysqlConfig, host: 'localhost' };
        try {
          const fallbackPool = mysql.createPool(fallbackConfig);
          const conn = await fallbackPool.getConnection();
          conn.release();
          activePool = fallbackPool;
          console.log("[Database] Fallback to 'localhost' TCP connection succeeded!");
          return activePool;
        } catch (fbErr: any) {
          console.warn("[Database] Fallback to 'localhost' TCP connection failed:", fbErr.message || fbErr);
        }
      }
      
      // Fallback 2: Try common local Unix sockets (essential for Hostinger cPanel Node/Passenger environments)
      console.log("[Database] Fallback Sequence 2: Attempting common Hostinger Unix sockets...");
      const socketPaths = [
        '/var/lib/mysql/mysql.sock',
        '/tmp/mysql.sock',
        '/var/run/mysqld/mysqld.sock'
      ];
      
      for (const socketPath of socketPaths) {
        if (fs.existsSync(socketPath)) {
          console.log(`[Database] Found Unix socket file at '${socketPath}'. Connecting...`);
          const fallbackSocketConfig = {
            user: mysqlConfig.user,
            password: mysqlConfig.password,
            database: mysqlConfig.database,
            socketPath: socketPath,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            connectTimeout: 2000
          };
          try {
            const fallbackPool = mysql.createPool(fallbackSocketConfig);
            const conn = await fallbackPool.getConnection();
            conn.release();
            activePool = fallbackPool;
            console.log(`[Database] Fallback to Unix socket at '${socketPath}' succeeded!`);
            return activePool;
          } catch (socketErr: any) {
            console.warn(`[Database] Fallback to Unix socket at '${socketPath}' failed:`, socketErr.message || socketErr);
          }
        }
      }
      
      console.error("[Database] All MySQL fallbacks exhausted. The database connection cannot be established.");
      throw err;
    }
  }

  mysqlPoolInstance.getConnection = async function(...args: any[]) {
    const poolToUse = await testAndGetActivePool();
    if (poolToUse === mysqlPoolInstance) {
      return await originalGetConnection.apply(mysqlPoolInstance, args);
    } else {
      return await poolToUse.getConnection(...args);
    }
  };

  mysqlPoolInstance.query = async function(...args: any[]) {
    const poolToUse = await testAndGetActivePool();
    if (poolToUse === mysqlPoolInstance) {
      return await originalQuery.apply(mysqlPoolInstance, args);
    } else {
      return await poolToUse.query(...args);
    }
  };

  mysqlPoolInstance.execute = async function(...args: any[]) {
    const poolToUse = await testAndGetActivePool();
    if (poolToUse === mysqlPoolInstance) {
      return await originalExecute.apply(mysqlPoolInstance, args);
    } else {
      return await poolToUse.execute(...args);
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
          sector TEXT NOT NULL,
          data TEXT NOT NULL,
          deputado TEXT NOT NULL,
          cidade TEXT,
          projeto_lei TEXT,
          emenda TEXT,
          recursos TEXT,
          status TEXT,
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
        const result: any = await client.query("SHOW COLUMNS FROM records");
        const columns = result?.rows || (Array.isArray(result) ? result : []);
        const existingColumns = columns.map((c: any) => {
          const name = c?.Field || c?.field || c?.COLUMN_NAME || c?.column_name || "";
          return name.toLowerCase();
        }).filter(Boolean);
        
        const colsToVerify = [
          { name: "deputado", type: "TEXT NOT NULL" },
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
            try {
              await client.query(`ALTER TABLE records ADD COLUMN ${col.name} ${col.type}`);
            } catch (err: any) {
              console.warn(`[Database Bootstrap] Failed to add column '${col.name}':`, err.message || err);
            }
          }
        }

        // Safe upgrade of columns to TEXT to handle long values (such as multiple cities or longer status names)
        console.log("[Database Bootstrap] Upgrading records table columns to TEXT individually to prevent truncation...");
        const upgradeColumn = async (colName: string, colDef: string) => {
          try {
            await client.query(`ALTER TABLE records MODIFY COLUMN ${colName} ${colDef}`);
          } catch (err: any) {
            console.warn(`[Database Bootstrap] Safe modify column '${colName}' failed:`, err.message || err);
          }
        };

        await upgradeColumn("sector", "TEXT NOT NULL");
        await upgradeColumn("data", "TEXT NOT NULL");
        await upgradeColumn("deputado", "TEXT NOT NULL");
        await upgradeColumn("cidade", "TEXT");
        await upgradeColumn("recursos", "TEXT");
        await upgradeColumn("status", "TEXT");
        await upgradeColumn("projeto_lei", "TEXT");
        await upgradeColumn("emenda", "TEXT");
        await upgradeColumn("observacoes", "TEXT");
      } catch (verErr: any) {
        console.warn("[Database Bootstrap] records column verification/upgrade failed:", verErr.message || verErr);
      }

      try {
        const result: any = await client.query("SHOW COLUMNS FROM execution_logs");
        const columns = result?.rows || (Array.isArray(result) ? result : []);
        const existingColumns = columns.map((c: any) => {
          const name = c?.Field || c?.field || c?.COLUMN_NAME || c?.column_name || "";
          return name.toLowerCase();
        }).filter(Boolean);
        
        const colsToVerify = [
          { name: "details", type: "TEXT" },
          { name: "user_email", type: "VARCHAR(255)" }
        ];

        for (const col of colsToVerify) {
          if (!existingColumns.includes(col.name.toLowerCase())) {
            console.log(`[Database Bootstrap] Adding missing column '${col.name}' to 'execution_logs'...`);
            try {
              await client.query(`ALTER TABLE execution_logs ADD COLUMN ${col.name} ${col.type}`);
            } catch (err: any) {
              console.warn(`[Database Bootstrap] Failed to add column '${col.name}' to execution_logs:`, err.message || err);
            }
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
