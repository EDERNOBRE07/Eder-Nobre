import * as dotenv from 'dotenv';
dotenv.config();

import { relations } from 'drizzle-orm';
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { mysqlTable, int, varchar, text as mysqlText, timestamp as mysqlTimestamp } from 'drizzle-orm/mysql-core';

// Detect database engine from environment
const isMySQL = process.env.SQL_ENGINE === 'mysql' || process.env.SQL_PORT === '3306';

// Users table associated with Firebase Auth
export const users = (isMySQL
  ? mysqlTable('users', {
      id: int('id').primaryKey().autoincrement(),
      uid: varchar('uid', { length: 255 }).notNull().unique(), // Firebase Auth UID
      email: varchar('email', { length: 255 }).notNull(),
      createdAt: mysqlTimestamp('created_at').defaultNow(),
    })
  : pgTable('users', {
      id: serial('id').primaryKey(),
      uid: text('uid').notNull().unique(), // Firebase Auth UID
      email: text('email').notNull(),
      createdAt: timestamp('created_at').defaultNow(),
    })) as any;

// Politician Activity records
export const records = (isMySQL
  ? mysqlTable('records', {
      id: varchar('id', { length: 255 }).primaryKey(), // Unique string IDs
      sector: varchar('sector', { length: 255 }).notNull(), // 'educacao', 'saude', 'seguranca', etc.
      data: varchar('data', { length: 255 }).notNull(), // YYYY-MM-DD
      deputado: mysqlText('deputado').notNull(), // The action text
      cidade: varchar('cidade', { length: 255 }), // Municipality
      projetoLei: mysqlText('projeto_lei'), // Project number & description
      emenda: mysqlText('emenda'), // Emenda info
      recursos: varchar('recursos', { length: 255 }), // Stored as a decimal string to preserve values cleanly
      status: varchar('status', { length: 255 }), // 'Em Tramitação', 'Aprovado', 'Vetado', 'Arquivado'
      observacoes: mysqlText('observacoes'), // Notes
      createdAt: mysqlTimestamp('created_at').defaultNow(),
    })
  : pgTable('records', {
      id: text('id').primaryKey(),
      sector: text('sector').notNull(),
      data: text('data').notNull(),
      deputado: text('deputado').notNull(),
      cidade: text('cidade'),
      projetoLei: text('projeto_lei'),
      emenda: text('emenda'),
      recursos: text('recursos'),
      status: text('status'),
      observacoes: text('observacoes'),
      createdAt: timestamp('created_at').defaultNow(),
    })) as any;

// Detailed system execution logs
export const executionLogs = (isMySQL
  ? mysqlTable('execution_logs', {
      id: int('id').primaryKey().autoincrement(),
      timestamp: mysqlTimestamp('timestamp').defaultNow().notNull(),
      action: varchar('action', { length: 255 }).notNull(), // 'IMPORT_FILE', 'CLASSIFY_GEMINI', 'SYNC_RECORDS', etc.
      status: varchar('status', { length: 255 }).notNull(), // 'SUCCESS', 'ERROR', 'INFO'
      details: mysqlText('details'), // JSON string or text message
      userEmail: varchar('user_email', { length: 255 }), // User who triggered the action
    })
  : pgTable('execution_logs', {
      id: serial('id').primaryKey(),
      timestamp: timestamp('timestamp').defaultNow().notNull(),
      action: text('action').notNull(),
      status: text('status').notNull(),
      details: text('details'),
      userEmail: text('user_email'),
    })) as any;

export const usersRelations = relations(users, ({ many }) => ({
  // Define relations if needed
}));
