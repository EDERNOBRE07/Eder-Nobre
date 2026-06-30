import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";

// Load environment variables from .env
dotenv.config();

// Initialize DB pool and connection
import { db, bootstrapDb } from "./src/db/index.ts";
import { records, executionLogs } from "./src/db/schema.ts";
import { requireAuth, AuthRequest } from "./src/middleware/auth.ts";
import { desc } from "drizzle-orm";
import {
  fetchFirestoreRecords,
  saveFirestoreRecords,
  fetchFirestoreLogs,
  addFirestoreLog,
  runLocalDataRecovery
} from "./src/lib/firestore-service.ts";

// Local storage fallback files
const RECORDS_FILE = path.join(process.cwd(), "records-store.json");
const LOGS_FILE = path.join(process.cwd(), "logs-store.json");

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
const PORT = 3000;

// Body parser with 20MB limit to handle files/extracted text
app.use(express.json({ limit: "20mb" }));

// Initialize Gemini SDK dynamically to avoid cached key issues
function getGeminiClient(): GoogleGenAI {
  let key = process.env.GEMINI_API_KEY;
  if (key) {
    key = key.trim();
  }
  // If no environment API key is configured, throw an error
  if (!key || key === "") {
    throw new Error("GEMINI_API_KEY environment variable is missing. Please set your API key in the application settings.");
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

// Helper to query Gemini with retry on transient errors (e.g. 503 UNAVAILABLE, 429 Rate Limit)
async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: any,
  maxRetries = 3,
  initialDelayMs = 2000
) {
  let attempt = 1;
  let delay = initialDelayMs;
  while (true) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const errStr = String(err.message || err);
      const isTransient =
        errStr.includes("503") ||
        errStr.includes("UNAVAILABLE") ||
        errStr.includes("high demand") ||
        errStr.includes("429") ||
        errStr.includes("ResourceExhausted") ||
        err.status === 503 ||
        err.status === 429;

      if (isTransient && attempt <= maxRetries) {
        console.warn(`[Gemini API] Erro temporário detectado (Tentativa ${attempt}/${maxRetries}). Aguardando ${delay}ms para tentar novamente... Erro:`, errStr);
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
        delay *= 2; // Exponential backoff
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
  try {
    const allRecords = await db.select().from(records);
    res.setHeader("X-Database-Source", "postgres");
    res.json(allRecords);
  } catch (error: any) {
    console.warn("[Database Fallback] Postgres inactive/error. Falling back to Cloud Firestore for fetching records. Reason:", error.message || error);
    try {
      const fsRecords = await fetchFirestoreRecords();
      res.setHeader("X-Database-Source", "firestore");
      res.json(fsRecords);
    } catch (fsErr: any) {
      console.error("[Database Fallback] Firestore fallback failed, trying local JSON:", fsErr.message || fsErr);
      const localRecords = readLocalRecords();
      res.setHeader("X-Database-Source", "fallback-local");
      res.json(localRecords);
    }
  }
});

// GET all execution logs (Secured)
app.get("/api/logs", requireAuth, async (req: AuthRequest, res) => {
  try {
    const logs = await db.select().from(executionLogs).orderBy(desc(executionLogs.timestamp));
    res.setHeader("X-Database-Source", "postgres");
    res.json(logs);
  } catch (error: any) {
    console.warn("[Database Fallback] Postgres inactive/error. Falling back to Cloud Firestore for fetching logs. Reason:", error.message || error);
    try {
      const fsLogs = await fetchFirestoreLogs();
      res.setHeader("X-Database-Source", "firestore");
      res.json(fsLogs);
    } catch (fsErr: any) {
      console.error("[Database Fallback] Firestore fallback failed, trying local JSON:", fsErr.message || fsErr);
      const localLogs = readLocalLogs();
      const sortedLogs = localLogs.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      res.setHeader("X-Database-Source", "fallback-local");
      res.json(sortedLogs);
    }
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
    res.json({ success: true, database: "postgres" });
  } catch (err: any) {
    console.warn("[Database Fallback] Postgres inactive/error. Falling back to Cloud Firestore for logging. Reason:", err.message || err);
    try {
      await addFirestoreLog(actionStr, statusStr, detailsStr, email);
      res.json({ success: true, database: "firestore" });
    } catch (fsErr: any) {
      console.error("[Database Fallback] Firestore fallback failed, using local JSON:", fsErr.message || fsErr);
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

    // Format fields correctly for DB inserts
    const formattedRecords = newRecordsList.map((r: any) => ({
      id: r.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      sector: r.sector || "educacao",
      data: r.data || new Date().toISOString().split("T")[0],
      deputado: r.deputado || "",
      cidade: r.cidade || "",
      projetoLei: r.projetoLei || r.projeto_lei || "",
      emenda: r.emenda || "",
      recursos: r.recursos ? String(r.recursos) : "0",
      status: r.status || "Em Tramitação",
      observacoes: r.observacoes || "",
    }));

    try {
      await db.transaction(async (tx) => {
        // 1. Delete existing records
        await tx.delete(records);

        // 2. Insert new records if any
        if (formattedRecords.length > 0) {
          // Handle insertion in batches of 50 to avoid parameter limit issues in pg
          const batchSize = 50;
          for (let i = 0; i < formattedRecords.length; i += batchSize) {
            const batch = formattedRecords.slice(i, i + batchSize);
            await tx.insert(records).values(batch);
          }
        }

        // 3. Create execution log
        await tx.insert(executionLogs).values({
          action: "SYNC_RECORDS",
          status: "SUCCESS",
          details: `Substituição atômica de todos os registros. Total de registros salvos: ${formattedRecords.length}`,
          userEmail: email,
        });
      });

      res.json({ success: true, count: formattedRecords.length, database: "postgres" });
    } catch (dbError: any) {
      console.warn("[Database Fallback] Postgres transaction failed. Saving to Cloud Firestore instead. Reason:", dbError.message || dbError);
      
      try {
        await saveFirestoreRecords(formattedRecords);
        await addFirestoreLog(
          "SYNC_RECORDS",
          "SUCCESS",
          `Substituição atômica de registros concluída com sucesso no Cloud Firestore. Total: ${formattedRecords.length}`,
          email
        );
        res.json({ success: true, count: formattedRecords.length, database: "firestore" });
      } catch (fsErr: any) {
        console.error("[Database Fallback] Cloud Firestore write failed. Saving to local JSON as ultimate fallback:", fsErr.message || fsErr);
        
        // Save formatted records directly to records-store.json
        writeLocalRecords(formattedRecords);
        
        // Save log entry to logs-store.json
        addLocalLog(
          "SYNC_RECORDS",
          "SUCCESS",
          `[Fallback Local] Substituição de registros em arquivo local. Total salvos: ${formattedRecords.length}`,
          email
        );

        res.json({ success: true, count: formattedRecords.length, database: "local-json" });
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
    const ai = getGeminiClient();

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
            description: "Classifique estritamente em um dos seguintes setores: 'educacao', 'saude', 'seguranca', 'infra', 'cultura', 'meio', 'social', 'agro', 'fiscal', 'comercio', 'tecnologia'" 
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
      // Text payload - Chunk to prevent exceeding Free Tier's TPM and RPM constraints
      const chunks = chunkText(text, 120000);
      console.log(`[Gemini API] Split input text into ${chunks.length} chunk(s) to respect free-tier TPM limit.`);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`[Gemini API] Processing chunk ${i + 1}/${chunks.length} (${chunk.length} characters)...`);

        // Wait a short duration between consecutive chunk requests to prevent hitting concurrent/RPM limits
        if (i > 0) {
          const waitTimeMs = 4000;
          console.log(`[Gemini API] Waiting ${waitTimeMs / 1000} seconds before processing the next chunk...`);
          await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
        }

        const response = await generateContentWithRetry(ai, {
          model: "gemini-2.5-flash",
          contents: `
Você é uma inteligência artificial especialista na análise, estruturação e classificação de diários oficiais, notícias, emendas e relatórios de atividades políticas de deputados do estado de Santa Catarina (SC).

Analise o seguinte fragmento de texto (Parte ${i + 1} de ${chunks.length}, proveniente de um arquivo ${filename || "enviado pelo usuário"}) e extraia TODAS as ações parlamentares individuais/atividades encontradas especificamente neste trecho.

Texto para análise:
"""
${chunk}
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
            const parsedChunk = JSON.parse(aiResponseText);
            if (Array.isArray(parsedChunk)) {
              extractedRecords.push(...parsedChunk);
              console.log(`[Gemini API] Chunk ${i + 1}/${chunks.length} processed successfully, found ${parsedChunk.length} actions.`);
            }
          } catch (parseError: any) {
            console.error(`[Gemini API] Failed to parse JSON for chunk ${i + 1}:`, parseError);
            throw new Error(`Failed to decode intelligence output for section ${i + 1}: ${parseError.message}`);
          }
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

    res.status(500).json({ error: "Gemini processing failed: " + friendlyErrorMessage });
  }
});


// -------------------------------------------------------------
// VITE OR STATIC FILE MIDDLEWARE
// -------------------------------------------------------------

async function startServer() {
  let isPostgresActive = false;
  // Bootstrap tables and test connection to PostgreSQL at boot time
  try {
    console.log("[Database] Testing connection to PostgreSQL on host:", process.env.SQL_HOST);
    await bootstrapDb();
    // Standard fast query to verify database and table availability
    await db.select().from(records).limit(1);
    console.log("[Database] Successfully connected to PostgreSQL and tables verified!");
    isPostgresActive = true;
  } catch (err: any) {
    console.error("[Database] Failed to connect or bootstrap PostgreSQL. Fallback Cloud Firestore and JSON files will be used. Error details:", err.message || err);
  }

  // Run automatic data recovery routine to migrate local JSON stores to Cloud Firestore & Postgres!
  try {
    await runLocalDataRecovery(isPostgresActive ? db : null, records, executionLogs);
  } catch (recErr: any) {
    console.error("[Recovery System] Failed to complete data recovery routine:", recErr.message || recErr);
  }

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
