import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";

const gFilename = typeof __filename !== "undefined"
  ? __filename
  : (typeof import.meta !== "undefined" && import.meta.url ? fileURLToPath(import.meta.url) : "");
const gDirname = typeof __dirname !== "undefined"
  ? __dirname
  : (gFilename ? path.dirname(gFilename) : process.cwd());

// Load environment variables from .env using multiple fallback paths to support different runtime CWDs (such as Hostinger Passenger cPanel)
const envPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(gDirname, "..", ".env"),
  path.resolve(gDirname, ".env"),
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

// Initialize DB pool and connection
import { db, bootstrapDb, pool, isMySQL } from "./src/db/index.ts";
import { records, executionLogs } from "./src/db/schema.ts";
import { requireAuth, AuthRequest } from "./src/middleware/auth.ts";
import { desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  fetchFirestoreRecords,
  saveFirestoreRecords,
  fetchFirestoreLogs,
  addFirestoreLog,
  runLocalDataRecovery
} from "./src/lib/firestore-service.ts";

const getAppRoot = () => {
  if (gDirname) {
    if (gDirname.endsWith("dist") || gDirname.endsWith("dist/")) {
      return path.resolve(gDirname, "..");
    }
    return gDirname;
  }
  return process.cwd();
};
const appRoot = getAppRoot();

// Local storage fallback files
const RECORDS_FILE = path.join(appRoot, "records-store.json");
const LOGS_FILE = path.join(appRoot, "logs-store.json");

// Tracks the last database source successfully written to during replaceAll
const LAST_SOURCE_FILE = path.join(appRoot, "last-source-store.json");

function getLastWrittenSource(): string {
  if (fs.existsSync(LAST_SOURCE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LAST_SOURCE_FILE, "utf-8"));
      return data.source || "";
    } catch (e) {
      return "";
    }
  }
  return "";
}

function setLastWrittenSource(source: string) {
  try {
    fs.writeFileSync(LAST_SOURCE_FILE, JSON.stringify({ source, timestamp: Date.now() }), "utf-8");
  } catch (err) {
    console.error("Failed to write last written source:", err);
  }
}

function readLocalRecords(): any[] {
  if (!fs.existsSync(RECORDS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(RECORDS_FILE, "utf-8"));
  } catch (err) {
    return [];
  }
}

function writeLocalRecords(data: any[]) {
  try {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write local records:", err);
  }
}

function readLocalLogs(): any[] {
  if (!fs.existsSync(LOGS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(LOGS_FILE, "utf-8"));
  } catch (err) {
    return [];
  }
}

function writeLocalLogs(data: any[]) {
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write local logs:", err);
  }
}

function addLocalLog(action: string, status: string, details: string, userEmail: string) {
  try {
    const logsList = readLocalLogs();
    const newLog = {
      id: Math.floor(Math.random() * 1000000),
      action,
      status,
      details,
      userEmail,
      timestamp: new Date().toISOString()
    };
    logsList.unshift(newLog); // newer first
    writeLocalLogs(logsList);
    return newLog;
  } catch (err) {
    console.error("Failed to write local log:", err);
  }
}

const app = express();

// Support both standard TCP port numbers (Google Cloud, Local dev) and Unix socket paths (Hostinger Passenger cPanel)
const PORT = process.env.PORT 
  ? (isNaN(Number(process.env.PORT)) ? process.env.PORT : parseInt(process.env.PORT, 10))
  : 3000;

// Custom CORS middleware to allow the Hostinger subdomain and other environments to integrate
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (
    origin.includes("localhost") || 
    origin.includes(".run.app") || 
    origin.includes("mastervisionmarketing.com") ||
    origin.includes("hostinger.com")
  )) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Gemini-API-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.setHeader("Access-Control-Expose-Headers", "X-Database-Source");
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Disable caching for all API routes to ensure state updates (like backup imports) are immediately visible in the dashboard
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

// Body parser with 20MB limit to handle files/extracted text
app.use(express.json({ limit: "20mb" }));

// Initialize Gemini SDK dynamically to avoid cached key issues
function getGeminiClient(req?: express.Request): GoogleGenAI {
  let key = req?.headers["x-gemini-api-key"] as string;
  
  // If the header key is missing, empty, or literally "null"/"undefined", fallback to env
  if (!key || key.trim() === "" || key === "null" || key === "undefined") {
    key = process.env.GEMINI_API_KEY || "";
  }
  
  if (key) {
    key = key.trim();
  }
  
  // If no API key is available, throw an error
  if (!key || key === "") {
    throw new Error("A variável de ambiente GEMINI_API_KEY está ausente no servidor e nenhuma chave customizada foi inserida no menu de Configurações.");
  }

  // Detect Google Cloud OAuth Access Tokens (which start with 'AQ.' or 'ya29.')
  if (key.startsWith("AQ.") || key.startsWith("ya29.")) {
    console.log(`[Gemini Client] Usando Token de Acesso OAuth temporário (começa com: ${key.slice(0, 3)}...)`);
  }
  
  console.log(`[Gemini Client] Initializing client. Key ends in: ...${key.slice(-6)}`);
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Helper to query Gemini with fast retry on transient errors (short delays to prevent proxy 504 timeouts)
async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: any,
  maxRetries = 2,
  initialDelayMs = 1500
) {
  let attempt = 1;
  let delay = initialDelayMs;
  while (true) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const errStr = String(err.message || err);
      const isQuotaError =
        errStr.includes("429") ||
        errStr.includes("ResourceExhausted") ||
        errStr.toLowerCase().includes("quota") ||
        err.status === 429;
      const isTransient =
        isQuotaError ||
        errStr.includes("503") ||
        errStr.includes("UNAVAILABLE") ||
        errStr.includes("high demand") ||
        err.status === 503;

      if (isTransient && attempt <= maxRetries) {
        console.warn(`[Gemini API] Erro temporário na API (Tentativa ${attempt}/${maxRetries}). Aguardando ${delay / 1000}s para tentar novamente... Erro:`, errStr);
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
        delay *= 1.5;
      } else {
        throw err;
      }
    }
  }
}

// -------------------------------------------------------------
// API ROUTES
// -------------------------------------------------------------

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// GET all records (Secured)
app.get("/api/records", requireAuth, async (req: AuthRequest, res) => {
  const dbType = isMySQL ? "MySQL" : "PostgreSQL";
  const dbSource = isMySQL ? "mysql" : "postgres";

  // If the last write went to a fallback because of SQL issues, respect that source for reads to guarantee consistency.
  const currentSource = getLastWrittenSource();
  if (currentSource === "local-json") {
    console.log("[Database Read] Serving from Local JSON because it was the last successfully written source.");
    const localRecords = readLocalRecords();
    res.setHeader("X-Database-Source", "fallback-local");
    return res.json(localRecords);
  } else if (currentSource === "firestore") {
    console.log("[Database Read] Serving from Firestore because it was the last successfully written source.");
    try {
      const fsRecords = await fetchFirestoreRecords();
      res.setHeader("X-Database-Source", "firestore");
      return res.json(fsRecords);
    } catch (fsErr: any) {
      console.warn("[Database Read] Firestore read failed, falling back to SQL...", fsErr.message || fsErr);
    }
  }

  try {
    const allRecords = await db.select().from(records);
    
    // Self-healing safety check: if SQL is connected but returns 0 records,
    // check if we have data in Firestore or local JSON store, and restore them back to SQL.
    if (allRecords.length === 0) {
      let recordsToRestore: any[] = [];
      let sourceName = "";

      try {
        const fsRecords = await fetchFirestoreRecords();
        if (fsRecords.length > 0) {
          recordsToRestore = fsRecords;
          sourceName = "Cloud Firestore";
        }
      } catch (fsErr: any) {
        // Silently continue to local check
      }

      if (recordsToRestore.length === 0) {
        const localRecords = readLocalRecords();
        if (localRecords.length > 0) {
          recordsToRestore = localRecords;
          sourceName = "Local JSON file";
        }
      }

      if (recordsToRestore.length > 0) {
        console.log(`[Database Self-Healing] SQL returned 0 records, but ${sourceName} has ${recordsToRestore.length} records. Restoring SQL database...`);
        
        // Asynchronously restore SQL database so we don't block the HTTP response
        (async () => {
          try {
            const formatted = recordsToRestore.map((r: any) => ({
              id: r.id || Math.random().toString(36).slice(2, 9),
              sector: r.sector || "educacao",
              data: r.data || new Date().toISOString().split("T")[0],
              deputado: r.deputado || "",
              cidade: r.cidade || "",
              projetoLei: r.projeto_lei || r.projetoLei || "",
              emenda: r.emenda || "",
              recursos: r.recursos ? String(r.recursos) : "0",
              status: r.status || "Em Tramitação",
              observacoes: r.observacoes || "",
              createdAt: r.createdAt ? new Date(r.createdAt) : (r.created_at ? new Date(r.created_at) : new Date()),
            }));

            const batchSize = 100;
            for (let i = 0; i < formatted.length; i += batchSize) {
              const batch = formatted.slice(i, i + batchSize);
              await db.insert(records).values(batch);
            }
            console.log(`[Database Self-Healing] Successfully restored ${formatted.length} records into the empty SQL database from ${sourceName}.`);
          } catch (healErr: any) {
            console.error("[Database Self-Healing] Failed to auto-heal empty SQL database:", healErr.message || healErr);
          }
        })();

        res.setHeader("X-Database-Source", sourceName === "Cloud Firestore" ? "firestore-fallback" : "fallback-local-sync");
        return res.json(recordsToRestore);
      }
    }

    res.setHeader("X-Database-Source", dbSource);
    res.json(allRecords);
  } catch (error: any) {
    console.warn(`[Database Fallback] ${dbType} inactive/error. Falling back to Cloud Firestore for fetching records. Reason:`, error.message || error);
    try {
      const fsRecords = await fetchFirestoreRecords();
      res.setHeader("X-Database-Source", "firestore");
      res.json(fsRecords);
    } catch (fsErr: any) {
      console.warn("[Database Fallback] Firestore fallback database not available, fetching from local JSON mirror:", fsErr.message || fsErr);
      const localRecords = readLocalRecords();
      res.setHeader("X-Database-Source", "fallback-local");
      res.json(localRecords);
    }
  }
});

// GET all execution logs (Secured)
app.get("/api/logs", requireAuth, async (req: AuthRequest, res) => {
  const dbType = isMySQL ? "MySQL" : "PostgreSQL";
  const dbSource = isMySQL ? "mysql" : "postgres";

  const currentSource = getLastWrittenSource();
  if (currentSource === "local-json") {
    console.log("[Database Read] Serving logs from Local JSON because it was the last successfully written source.");
    const localLogs = readLocalLogs();
    const sortedLogs = localLogs.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    res.setHeader("X-Database-Source", "fallback-local");
    return res.json(sortedLogs);
  } else if (currentSource === "firestore") {
    console.log("[Database Read] Serving logs from Firestore because it was the last successfully written source.");
    try {
      const fsLogs = await fetchFirestoreLogs();
      res.setHeader("X-Database-Source", "firestore");
      return res.json(fsLogs);
    } catch (fsErr: any) {
      console.warn("[Database Read] Firestore logs read failed, falling back to SQL...", fsErr.message || fsErr);
    }
  }

  try {
    const logs = await db.select().from(executionLogs).orderBy(desc(executionLogs.timestamp));
    
    // Self-healing safety check for logs
    if (logs.length === 0) {
      try {
        const fsLogs = await fetchFirestoreLogs();
        if (fsLogs.length > 0) {
          res.setHeader("X-Database-Source", "firestore-fallback");
          return res.json(fsLogs);
        }
      } catch (fsErr: any) {}
      
      const localLogs = readLocalLogs();
      if (localLogs.length > 0) {
        const sortedLogs = localLogs.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        res.setHeader("X-Database-Source", "fallback-local-sync");
        return res.json(sortedLogs);
      }
    }

    res.setHeader("X-Database-Source", dbSource);
    res.json(logs);
  } catch (error: any) {
    console.warn(`[Database Fallback] ${dbType} inactive/error. Falling back to Cloud Firestore for fetching logs. Reason:`, error.message || error);
    try {
      const fsLogs = await fetchFirestoreLogs();
      res.setHeader("X-Database-Source", "firestore");
      res.json(fsLogs);
    } catch (fsErr: any) {
      console.warn("[Database Fallback] Firestore fallback database not available, fetching logs from local JSON mirror:", fsErr.message || fsErr);
      const localLogs = readLocalLogs();
      const sortedLogs = localLogs.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      res.setHeader("X-Database-Source", "fallback-local");
      res.json(sortedLogs);
    }
  }
});

// GET database connection status and config (Secured)
app.get("/api/db-status", requireAuth, async (req: AuthRequest, res) => {
  const activePort = isMySQL ? (process.env.SQL_PORT || "3306") : "5432";
  const dbEngine = isMySQL ? "MySQL" : "PostgreSQL";
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      res.json({
        connected: true,
        engine: dbEngine,
        host: process.env.SQL_HOST || "não configurado",
        database: process.env.SQL_DB_NAME || "não configurado",
        user: process.env.SQL_USER || "não configurado",
        port: activePort,
        ssl: process.env.SQL_SSL || "false",
        error: null
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.json({
      connected: false,
      engine: dbEngine,
      host: process.env.SQL_HOST || "não configurado",
      database: process.env.SQL_DB_NAME || "não configurado",
      user: process.env.SQL_USER || "não configurado",
      port: activePort,
      ssl: process.env.SQL_SSL || "false",
      error: err.message || String(err)
    });
  }
});

// GET Gemini API key validation status (Secured)
app.get("/api/gemini-status", requireAuth, async (req: AuthRequest, res) => {
  try {
    const ai = getGeminiClient(req);
    // Execute a simple connection test call using gemini-3.5-flash
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: "Test connection. Respond only with 'OK'."
    });
    
    if (response.text) {
      const isCustom = !!(req.headers["x-gemini-api-key"] && String(req.headers["x-gemini-api-key"]).trim() !== "");
      res.json({
        valid: true,
        source: isCustom ? "Chave de API personalizada do usuário (Configurações Locais)" : "Chave de API padrão do servidor (Variável de Ambiente)",
        error: null
      });
    } else {
      res.json({
        valid: false,
        source: req.headers["x-gemini-api-key"] ? "Chave de API personalizada do usuário" : "Chave de API padrão do servidor",
        error: "Resposta vazia retornada do modelo Gemini."
      });
    }
  } catch (err: any) {
    res.json({
      valid: false,
      source: req.headers["x-gemini-api-key"] ? "Chave de API personalizada do usuário" : "Chave de API padrão do servidor",
      error: err.message || String(err)
    });
  }
});

// POST to insert a single log entry manually (Secured)
app.post("/api/logs/add", requireAuth, async (req: AuthRequest, res) => {
  const { action, status, details } = req.body;
  const actionStr = action || "MANUAL";
  const statusStr = status || "INFO";
  const detailsStr = typeof details === "object" ? JSON.stringify(details) : String(details);
  const email = req.user?.email || "anonymous";

  try {
    await db.insert(executionLogs).values({
      action: actionStr,
      status: statusStr,
      details: detailsStr,
      userEmail: email,
    });
    res.json({ success: true, database: isMySQL ? "mysql" : "postgres" });
  } catch (err: any) {
    console.warn("[Database Fallback] SQL database inactive/error. Falling back to Cloud Firestore for logging. Reason:", err.message || err);
    try {
      await addFirestoreLog(actionStr, statusStr, detailsStr, email);
      res.json({ success: true, database: "firestore" });
    } catch (fsErr: any) {
      console.warn("[Database Fallback] Firestore fallback database not available, saving log to local JSON mirror:", fsErr.message || fsErr);
      addLocalLog(actionStr, statusStr, detailsStr, email);
      res.json({ success: true, database: "local-json" });
    }
  }
});

// POST to replace all records atomically in a single transaction (Secured)
app.post("/api/records/replaceAll", requireAuth, async (req: AuthRequest, res) => {
  try {
    const newRecordsList = req.body; // Expecting an array of records
    if (!Array.isArray(newRecordsList)) {
      return res.status(400).json({ error: "Invalid data format. Expected an array of records." });
    }

    const email = req.user?.email || "anonymous";

    const safeDate = (d: any): Date => {
      if (!d) return new Date();
      const date = new Date(d);
      return isNaN(date.getTime()) ? new Date() : date;
    };

    // 1. Format and strictly sanitize fields for DB inserts to prevent NOT NULL and type errors
    const formattedRecords = newRecordsList.map((r: any) => ({
      id: r.id ? String(r.id).trim() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      sector: r.sector ? String(r.sector).trim() : "educacao",
      data: r.data ? String(r.data).trim() : new Date().toISOString().split("T")[0],
      deputado: r.deputado ? String(r.deputado).trim() : "",
      cidade: r.cidade ? String(r.cidade).trim() : "",
      projetoLei: r.projetoLei ? String(r.projetoLei).trim() : (r.projeto_lei ? String(r.projeto_lei).trim() : ""),
      emenda: r.emenda ? String(r.emenda).trim() : "",
      recursos: r.recursos ? String(r.recursos).trim() : "0",
      status: r.status ? String(r.status).trim() : "Em Tramitação",
      observacoes: r.observacoes ? String(r.observacoes).trim() : "",
      createdAt: safeDate(r.createdAt || r.created_at),
    }));

    // 2. Deduplicate/re-key to prevent primary key collisions but retain distinct records
    const uniqueFormattedRecords: any[] = [];
    const seenIds = new Set<string>();
    const seenContentSignatures = new Set<string>();

    for (const r of formattedRecords) {
      // Content signature to detect identical duplicates
      const signature = [
        r.sector,
        r.data,
        r.deputado,
        r.cidade,
        r.projetoLei,
        r.emenda,
        r.recursos,
        r.status,
        r.observacoes
      ].map(v => String(v || "").trim().toLowerCase()).join("||");

      if (seenContentSignatures.has(signature)) {
        // Skip identical duplicate
        continue;
      }
      seenContentSignatures.add(signature);

      // Resolve ID collision: assign a new ID if it already exists
      let finalId = r.id;
      if (seenIds.has(finalId)) {
        finalId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        while (seenIds.has(finalId)) {
          finalId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        }
        r.id = finalId;
      }
      seenIds.add(finalId);
      uniqueFormattedRecords.push(r);
    }

    // 3. Always save to local JSON file first so that local-json is kept completely synchronized
    writeLocalRecords(uniqueFormattedRecords);

    // 4. Always save to Cloud Firestore as the dual-write backup database to prevent database drift and state reversion
    try {
      await saveFirestoreRecords(uniqueFormattedRecords);
      console.log(`[Database Sync] Successfully mirrored ${uniqueFormattedRecords.length} records to Cloud Firestore.`);
    } catch (fsErr: any) {
      console.warn(`[Database Sync] Cloud Firestore mirroring skipped (mirror DB offline or IAM roles pending):`, fsErr.message || fsErr);
    }

    const activeDbEngine = isMySQL ? "mysql" : "postgres";
    const dbType = isMySQL ? "MySQL/MariaDB" : "PostgreSQL";

    try {
      // Tier 1: Try transactional batch execution
      await db.transaction(async (tx) => {
        // 1. Delete existing records safely using isNotNull to bypass SQL_SAFE_UPDATES
        await tx.delete(records).where(isNotNull(records.id));

        // 2. Insert new records if any in batches
        if (uniqueFormattedRecords.length > 0) {
          const batchSize = 100;
          for (let i = 0; i < uniqueFormattedRecords.length; i += batchSize) {
            const batch = uniqueFormattedRecords.slice(i, i + batchSize);
            await tx.insert(records).values(batch);
          }
        }

        // 3. Create execution log
        await tx.insert(executionLogs).values({
          action: "SYNC_RECORDS",
          status: "SUCCESS",
          details: `Substituição atômica de todos os registros. Total de registros salvos: ${uniqueFormattedRecords.length}`,
          userEmail: email,
        });
      });

      setLastWrittenSource(activeDbEngine);
      res.json({ success: true, count: uniqueFormattedRecords.length, database: activeDbEngine });
    } catch (dbError: any) {
      console.warn(`[Database Fallback] SQL transaction failed on ${dbType}. Trying direct non-transactional batch execution instead. Reason:`, dbError.message || dbError);
      
      try {
        // Tier 2: Safe direct non-transactional batch replacement (ultra-fast, safe from SQL_SAFE_UPDATES)
        console.log(`[Database Fallback] Running Tier 2 safe direct batch sync on ${dbType}...`);
        
        // 1. Delete all existing records safely using isNotNull to bypass SQL_SAFE_UPDATES
        await db.delete(records).where(isNotNull(records.id));
        
        // 2. Insert new records if any in batches
        if (uniqueFormattedRecords.length > 0) {
          const batchSize = 100;
          for (let i = 0; i < uniqueFormattedRecords.length; i += batchSize) {
            const batch = uniqueFormattedRecords.slice(i, i + batchSize);
            await db.insert(records).values(batch);
          }
        }
        
        await db.insert(executionLogs).values({
          action: "SYNC_RECORDS",
          status: "SUCCESS",
          details: `Substituição direta em lote não-transacional. Total ativo salvo: ${uniqueFormattedRecords.length}`,
          userEmail: email,
        });

        setLastWrittenSource(activeDbEngine);
        res.json({ success: true, count: uniqueFormattedRecords.length, database: activeDbEngine });
      } catch (directError: any) {
        console.warn(`[Database Fallback] SQL direct safe sync failed. Trying highly-robust individual record insert fallback on ${dbType}... Reason:`, directError.message || directError);
        
        try {
          // Tier 3: Row-by-Row resilient differential sync (every query is try-catched to isolate failures)
          console.log(`[Database Fallback] Running Tier 3 row-by-row resilient sync on ${dbType}...`);
          
          let currentIds: string[] = [];
          try {
            const currentRecords = await db.select({ id: records.id }).from(records);
            currentIds = currentRecords.map((r: any) => r.id);
          } catch (selectErr: any) {
            console.error("[Database Fallback] Failed to fetch current IDs, assuming empty for safe inserts:", selectErr.message || selectErr);
          }

          const newIds = new Set(uniqueFormattedRecords.map((r: any) => r.id));
          const idsToDelete = currentIds.filter((id: any) => !newIds.has(id));

          // 1. Safely delete obsolete records individually with try-catch
          let deletedCount = 0;
          for (const id of idsToDelete) {
            try {
              await db.delete(records).where(eq(records.id, id));
              deletedCount++;
            } catch (delErr: any) {
              console.error(`[Database Fallback] Failed to delete obsolete record with ID ${id}:`, delErr.message || delErr);
            }
          }

          // 2. Safely upsert records individually with try-catch
          let insertedCount = 0;
          let updatedCount = 0;
          let failedCount = 0;
          let sampleError = "";

          for (const recordItem of uniqueFormattedRecords) {
            try {
              let exists = false;
              try {
                const existing = await db.select({ id: records.id }).from(records).where(eq(records.id, recordItem.id)).limit(1);
                exists = existing.length > 0;
              } catch (existErr) {
                // If the check itself fails, assume false and try to insert
              }

              if (exists) {
                await db.update(records).set(recordItem).where(eq(records.id, recordItem.id));
                updatedCount++;
              } else {
                await db.insert(records).values(recordItem);
                insertedCount++;
              }
            } catch (indError: any) {
              failedCount++;
              sampleError = indError.message || String(indError);
              console.error(`[Database Fallback] Failed to upsert individual record with ID ${recordItem.id}:`, sampleError);
            }
          }

          const totalSaved = insertedCount + updatedCount;
          
          // Check if at least some records were successfully written (or if input list was empty)
          if (uniqueFormattedRecords.length > 0 && totalSaved === 0) {
            throw new Error(`All individual safe upserts failed on ${dbType}. Sample error: ${sampleError || "Unknown"}`);
          }

          console.log(`[Database Fallback] Highly-resilient row-by-row sync completed. Saved ${totalSaved}/${uniqueFormattedRecords.length} records to SQL database. (Failed: ${failedCount}, Deleted obsolete: ${deletedCount})`);
          
          await db.insert(executionLogs).values({
            action: "SYNC_RECORDS",
            status: failedCount > 0 ? "INFO" : "SUCCESS",
            details: `Substituição via upsert resiliente individual no ${dbType}. Salvos: ${totalSaved}/${uniqueFormattedRecords.length} registros (Inseridos: ${insertedCount}, Atualizados: ${updatedCount}, Deletados: ${deletedCount}). Erros ignorados: ${failedCount}.`,
            userEmail: email,
          }).catch(() => {});

          setLastWrittenSource(activeDbEngine);
          res.json({ 
            success: true, 
            count: totalSaved, 
            database: activeDbEngine,
            warning: failedCount > 0 ? `Alguns registros (${failedCount}) continham erros e foram ignorados, mas ${totalSaved} foram gravados com sucesso na sua base de dados.` : undefined
          });
        } catch (individualError: any) {
          console.error(`[Database Fallback] Highly-robust individual fallback also failed on ${dbType}. Saving to Cloud Firestore instead. Reason:`, individualError.message || individualError);
          
          try {
            await saveFirestoreRecords(uniqueFormattedRecords);
            await addFirestoreLog(
              "SYNC_RECORDS",
              "SUCCESS",
              `Substituição atômica de registros concluída com sucesso no Cloud Firestore. Total: ${uniqueFormattedRecords.length}`,
              email
            );
            setLastWrittenSource("firestore");
            res.json({ success: true, count: uniqueFormattedRecords.length, database: "firestore" });
          } catch (fsErr: any) {
            console.warn("[Database Fallback] Cloud Firestore write unavailable, saving to local JSON as ultimate fallback:", fsErr.message || fsErr);
            
            // Save SQL and Firestore failures as ERROR log
            addLocalLog(
              "SYNC_RECORDS",
              "ERROR",
              `Falha ao salvar no SQL: ${directError.message || String(directError)}. Falha no Firestore: ${fsErr.message || String(fsErr)}`,
              email
            );
            
            addLocalLog(
              "SYNC_RECORDS",
              "INFO",
              `[Fallback Local] Substituição de registros em arquivo local bem sucedida. Total salvos: ${uniqueFormattedRecords.length}`,
              email
            );

            setLastWrittenSource("local-json");
            res.json({ 
              success: true, 
              count: uniqueFormattedRecords.length, 
              database: "local-json", 
              local: true,
              error: directError.message || String(directError)
            });
          }
        }
      }
    }
  } catch (error: any) {
    console.error("Error updating database records:", error);
    const email = req.user?.email || "anonymous";
    try {
      await addFirestoreLog(
        "SYNC_RECORDS",
        "ERROR",
        `Falha na sincronização dos registros: ${error.message}`,
        email
      ).catch(() => {});
      addLocalLog(
        "SYNC_RECORDS",
        "ERROR",
        `Falha na sincronização dos registros: ${error.message}`,
        email
      );
    } catch (e) {
      console.error("Failed to log failure:", e);
    }
    res.status(500).json({ error: "Database transaction failed: " + error.message });
  }
});

// Helper to split text into smaller chunks to prevent hitting Gemini API token-per-minute (TPM) limits on Free Tier
function chunkText(text: string, maxLength = 120000): string[] {
  const chunks: string[] = [];
  let currentIndex = 0;
  
  while (currentIndex < text.length) {
    if (text.length - currentIndex <= maxLength) {
      chunks.push(text.slice(currentIndex));
      break;
    }
    
    let chunkEnd = currentIndex + maxLength;
    // Try to find the last newline character before the maximum length limit
    const lastNewline = text.lastIndexOf("\n", chunkEnd);
    if (lastNewline > currentIndex + maxLength * 0.5) {
      chunkEnd = lastNewline;
    } else {
      // If no suitable newline, try to split at a period/sentence boundary
      const lastPeriod = text.lastIndexOf(". ", chunkEnd);
      if (lastPeriod > currentIndex + maxLength * 0.5) {
        chunkEnd = lastPeriod + 1;
      }
    }
    
    chunks.push(text.slice(currentIndex, chunkEnd));
    currentIndex = chunkEnd;
  }
  
  return chunks;
}

// POST to classify content using Gemini (Secured)
app.post("/api/records/classify", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { text, filename, fileBase64, mimeType } = req.body;
    if (!text && !fileBase64) {
      return res.status(400).json({ error: "Missing required text or fileBase64 payload to classify" });
    }

    const email = req.user?.email || "anonymous";

    // Initialize Gemini and query Structured Output
    const ai = getGeminiClient(req);

    let extractedRecords: any[] = [];

    // Common Schema Configuration
    const schemaConfig = {
      type: Type.ARRAY,
      description: "Lista de ações políticas extraídas e classificadas estruturadamente",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Gere um ID único de 10 caracteres alfanuméricos" },
          sector: { 
            type: Type.STRING, 
            description: "Classifique estritamente em um dos seguintes setores: 'educacao' (Educação), 'saude' (Saúde), 'seguranca' (Segurança), 'infra' (Infraestrutura/Obras), 'cultura' (Cultura/Esporte/Lazer), 'meio' (Meio Ambiente/Saneamento), 'social' (Assistência/Causa Social), 'agro' (Agricultura/Pesca), 'fiscal' (Administração Pública, Gestão de Projetos, Gestão do Estado, Orçamento, Economia, Finanças), 'comercio' (Comércio/Indústria/Turismo), 'tecnologia' (Tecnologia/Inovação), 'cidadao' (Títulos de Cidadão Honorário, homenagens, medalhas, comendas e sessões solenes). ATENÇÃO: Atuação em Secretarias de Estado (como Administração), gestão de projetos públicos gerais e relatórios governamentais pertencem a 'fiscal' ou 'infra', NUNCA a 'cidadao'!" 
          },
          data: { type: Type.STRING, description: "A data da ocorrência da ação no formato YYYY-MM-DD. Se ausente, deduza com base no texto ou use a data atual" },
          deputado: { type: Type.STRING, description: "Resumo claro e completo da ação legislativa do deputado" },
          cidade: { type: Type.STRING, description: "Cidade catarinense beneficiada ou local onde ocorreu. Se geral para todo o estado, coloque 'Santa Catarina'" },
          projetoLei: { type: Type.STRING, description: "Nº do projeto de lei ou ementa simplificada, se houver" },
          emenda: { type: Type.STRING, description: "Dados sobre emenda parlamentar, se houver" },
          recursos: { type: Type.STRING, description: "Valor financeiro investido ou destinado em R$, apenas os números/decimais separados por ponto (ex: '2500000.00'). Se não houver recurso, deixe em branco ou '0'" },
          status: { 
            type: Type.STRING, 
            description: "Status atual da ação parlamentar. Classifique estritamente entre: 'Em Tramitação', 'Aprovado', 'Vetado', 'Arquivado'" 
          },
          observacoes: { type: Type.STRING, description: "Observações ou comentários adicionais inteligentes feitos pela IA" }
        },
        required: ["id", "sector", "data", "deputado", "status"]
      }
    };

    if (fileBase64 && mimeType) {
      // File payload (e.g., PDF) - Process in a single request as we can't easily chunk binary on the server
      const response = await generateContentWithRetry(ai, {
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: fileBase64
              }
            },
            {
              text: `Você é uma inteligência artificial especialista na análise, estruturação e classificação de diários oficiais, notícias, emendas e relatórios de atividades políticas de deputados do estado de Santa Catarina (SC).

Analise o documento anexo (proveniente do arquivo ${filename || "enviado pelo usuário"}) e extraia TODAS as ações parlamentares individuais/atividades que encontrar.

REGRAS OBRIGATÓRIAS PARA ARQUIVOS CSV, PLANILHAS (XLS/XLSX) E TABELAS:
- Cada linha de dados da planilha/CSV (que não seja a linha de cabeçalho) é um INPUT/REGISTRO NOVO E INDIVIDUAL.
- Você DEVE extrair exatamente 1 registro/ação para CADA linha válida de dados da tabela/planilha.
- NUNCA agrupe, consolide, resuma ou pule linhas da planilha. Se a planilha possui 30 linhas de dados, você deve retornar exatamente 30 registros individuais.
- Mapeie as colunas (Data, Ação/Descrição, Deputado, Cidade, Setor, Projeto de Lei, Emenda, Recursos/Valor, Status, Observações) diretamente para os atributos do objeto JSON.

Extraia as ações e classifique cada uma de forma inteligente seguindo este esquema estrito.`
            }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: schemaConfig
        }
      });

      const aiResponseText = response.text;
      if (!aiResponseText) {
        throw new Error("Gemini returned an empty response.");
      }
      extractedRecords = JSON.parse(aiResponseText);
    } else {
      // Text payload - Process directly in a single call (client already handles small ~3KB chunks)
      console.log(`[Gemini API] Processing text payload (${text.length} characters) for ${filename || "unnamed file"}...`);
      const response = await generateContentWithRetry(ai, {
        model: "gemini-2.5-flash",
        contents: `
Você é uma inteligência artificial especialista na análise, estruturação e classificação de diários oficiais, notícias, emendas e relatórios de atividades políticas de deputados do estado de Santa Catarina (SC).

Analise o seguinte fragmento de texto (proveniente do arquivo ${filename || "enviado pelo usuário"}) e extraia TODAS as ações parlamentares individuais/atividades encontradas especificamente neste trecho.

REGRAS OBRIGATÓRIAS PARA ARQUIVOS CSV, PLANILHAS (XLS/XLSX) E TABELAS:
- Cada linha de dados da planilha/CSV (que não seja a linha de cabeçalho) é um INPUT/REGISTRO NOVO E INDIVIDUAL.
- Você DEVE extrair exatamente 1 registro/ação para CADA linha válida de dados da tabela/planilha.
- NUNCA agrupe, consolide, resuma ou pule linhas da planilha. Se o trecho possui 20 linhas de dados, você deve retornar exatamente 20 registros individuais.
- Mapeie as colunas (Data, Ação/Descrição, Deputado, Cidade, Setor, Projeto de Lei, Emenda, Recursos/Valor, Status, Observações) diretamente para os atributos do objeto JSON.

Texto para análise:
"""
${text}
"""

Extraia as ações e classifique cada uma de forma inteligente seguindo este esquema estrito.
        `,
        config: {
          responseMimeType: "application/json",
          responseSchema: schemaConfig
        }
      });

      const aiResponseText = response.text;
      if (aiResponseText) {
        try {
          const parsed = JSON.parse(aiResponseText);
          if (Array.isArray(parsed)) {
            extractedRecords.push(...parsed);
            console.log(`[Gemini API] Single text payload processed successfully, found ${parsed.length} actions.`);
          }
        } catch (parseError: any) {
          console.error(`[Gemini API] Failed to parse JSON:`, parseError);
          throw new Error(`Falha ao decodificar resultado da inteligência artificial: ${parseError.message}`);
        }
      }
    }

    // Save successful execution log
    try {
      await db.insert(executionLogs).values({
        action: "IMPORT_FILE",
        status: "SUCCESS",
        details: `Processamento IA concluído para o arquivo '${filename || "Texto Colado"}'. Extraídos ${extractedRecords.length} registros com sucesso usando o Gemini 3.5/2.5 Flash de forma fragmentada.`,
        userEmail: email,
      });
    } catch (logErr: any) {
      console.warn("[Database Fallback] Logging successful import in Firestore/local fallback:", logErr.message || logErr);
      try {
        await addFirestoreLog(
          "IMPORT_FILE",
          "SUCCESS",
          `Processamento IA concluído para o arquivo '${filename || "Texto Colado"}'. Extraídos ${extractedRecords.length} registros com sucesso usando o Gemini 3.5/2.5 Flash de forma fragmentada.`,
          email
        );
      } catch (fsErr: any) {
        addLocalLog(
          "IMPORT_FILE",
          "SUCCESS",
          `Processamento IA concluído para o arquivo '${filename || "Texto Colado"}'. Extraídos ${extractedRecords.length} registros com sucesso usando o Gemini 3.5/2.5 Flash de forma fragmentada.`,
          email
        );
      }
    }

    res.json({
      success: true,
      records: extractedRecords
    });

  } catch (error: any) {
    console.error("Gemini classification failed:", error);
    
    const errStr = String(error.message || error);
    const isPrepaymentDepleted = 
      errStr.toLowerCase().includes("prepayment") || 
      errStr.toLowerCase().includes("depleted") || 
      errStr.toLowerCase().includes("credits");

    const isQuotaError = 
      errStr.includes("429") || 
      errStr.toLowerCase().includes("quota") || 
      errStr.toLowerCase().includes("limit") || 
      errStr.includes("RESOURCE_EXHAUSTED");
      
    const isAuthError =
      errStr.includes("401") ||
      errStr.toLowerCase().includes("unauthenticated") ||
      errStr.toLowerCase().includes("invalid authentication") ||
      errStr.toLowerCase().includes("credentials") ||
      errStr.toLowerCase().includes("auth");

    const friendlyErrorMessage = isPrepaymentDepleted
      ? "Créditos Pré-Pagos Esgotados (Prepayment Credits Depleted): A conta associada a esta chave do Gemini está sem saldo. Para utilizar o MODO GRATUITO (Free Tier) sem custos ou consumo de créditos, basta acessar o Google AI Studio (https://aistudio.google.com/), criar uma chave de API em um NOVO PROJETO (garantindo que este novo projeto não tenha faturamento ou cartão vinculado) e adicioná-la no menu Secrets/Configurações da plataforma."
      : isQuotaError 
        ? "Limite de Cota Excedido (Quota Exceeded). O texto/arquivo enviado ultrapassou a capacidade por minuto da chave de API gratuita do Gemini. Aguarde 1 minuto para o limite resetar antes de tentar novamente, ou divida o texto em pedaços menores."
        : isAuthError
          ? "Erro de Autenticação (401 - UNAUTHENTICATED): A chave de API do Gemini (GEMINI_API_KEY) configurada na plataforma está inválida ou expirou. Por favor, acesse o painel de Configurações/Secrets no Google AI Studio e adicione uma GEMINI_API_KEY válida para restabelecer a integração."
          : error.message;

    // Save error execution log
    try {
      await db.insert(executionLogs).values({
        action: "IMPORT_FILE",
        status: "ERROR",
        details: `Falha no processamento de classificação via Gemini: ${friendlyErrorMessage} (Detalhes técnicos: ${error.message})`,
        userEmail: req.user?.email || "anonymous",
      });
    } catch (e: any) {
      console.warn("[Database Fallback] Logging failed import in Firestore/local fallback:", e.message || e);
      try {
        await addFirestoreLog(
          "IMPORT_FILE",
          "ERROR",
          `Falha no processamento de classificação via Gemini: ${friendlyErrorMessage} (Detalhes técnicos: ${error.message})`,
          req.user?.email || "anonymous"
        );
      } catch (fsErr: any) {
        addLocalLog(
          "IMPORT_FILE",
          "ERROR",
          `Falha no processamento de classificação via Gemini: ${friendlyErrorMessage} (Detalhes técnicos: ${error.message})`,
          req.user?.email || "anonymous"
        );
      }
    }

    const statusCode = isAuthError ? 401 : isQuotaError ? 429 : 500;
    res.status(statusCode).json({ error: friendlyErrorMessage });
  }
});


// -------------------------------------------------------------
// VITE OR STATIC FILE MIDDLEWARE
// -------------------------------------------------------------

async function startServer() {
  const dbType = isMySQL ? "MySQL/MariaDB" : "PostgreSQL";

  // 1. Mount Vite middleware or production static file handler first (synchronous / high speed)
  if (process.env.NODE_ENV !== "production") {
    // Mount Vite in middleware mode during development
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files from the compiled 'dist' directory in production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // 2. Start listening on the port immediately to respond to load balancers, orchestrators, and Passenger, preventing 503 timeouts
  if (typeof PORT === "string") {
    app.listen(PORT, () => {
      console.log(`Server running on Unix socket: ${PORT}`);
    });
  } else {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  }

  // 3. Perform database connection testing, table bootstrapping, and data recovery asynchronously in the background
  (async () => {
    let isDbActive = false;
    try {
      console.log(`[Database] Asynchronously testing connection to ${dbType} on host:`, process.env.SQL_HOST);
      await bootstrapDb();
      // Standard fast query to verify database and table availability
      await db.select().from(records).limit(1);
      console.log(`[Database] Successfully connected to ${dbType} and tables verified!`);
      isDbActive = true;
    } catch (err: any) {
      console.error(`[Database] Failed to connect or bootstrap ${dbType}. Fallback Cloud Firestore and JSON files will be used. Error details:`, err.message || err);
    }

    // Run automatic data recovery routine to migrate local JSON stores to Cloud Firestore & database
    try {
      await runLocalDataRecovery(isDbActive ? db : null, records, executionLogs);
    } catch (recErr: any) {
      console.error("[Recovery System] Failed to complete data recovery routine:", recErr.message || recErr);
    }
  })();
}

startServer();
