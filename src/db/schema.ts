import { relations } from 'drizzle-orm';
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// Users table associated with Firebase Auth
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Politician Activity records
export const records = pgTable('records', {
  id: text('id').primaryKey(), // We use client-generated or server-generated unique string IDs
  sector: text('sector').notNull(), // 'educacao', 'saude', 'seguranca', etc.
  data: text('data').notNull(), // YYYY-MM-DD
  deputado: text('deputado').notNull(), // The action text
  cidade: text('cidade'), // Municipality
  projetoLei: text('projeto_lei'), // Project number & description
  emenda: text('emenda'), // Emenda info
  recursos: text('recursos'), // Stored as a decimal string to preserve values cleanly
  status: text('status'), // 'Em Tramitação', 'Aprovado', 'Vetado', 'Arquivado'
  observacoes: text('observacoes'), // Notes
  createdAt: timestamp('created_at').defaultNow(),
});

// Detailed system execution logs
export const executionLogs = pgTable('execution_logs', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  action: text('action').notNull(), // 'IMPORT_FILE', 'CLASSIFY_GEMINI', 'SYNC_RECORDS', etc.
  status: text('status').notNull(), // 'SUCCESS', 'ERROR', 'INFO'
  details: text('details'), // JSON string or text message
  userEmail: text('user_email'), // User who triggered the action
});

export const usersRelations = relations(users, ({ many }) => ({
  // Define relations if needed
}));
