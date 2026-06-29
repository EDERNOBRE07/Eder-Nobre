import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";

// Load environment variables from .env
dotenv.config();

// Initialize DB pool and connection
import { db } from "./src/db/index.ts";
import { records, executionLogs } from "./src/db/schema.ts";
import { requireAuth, AuthRequest } from "./src/middleware/auth.ts";
import { desc } from "drizzle-orm";

const app = express();
const PORT = 3000;

// Body parser with 20MB limit to handle files/extracted text
app.use(express.json({ limit: "20mb" }));

// Initialize Gemini SDK lazily to avoid crashes if API key is missing on startup
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.trim() === "") {
      throw new Error("GEMINI_API_KEY environment variable is required. Por favor, adicione uma chave de API do Gemini válida nas Configurações/Secrets da plataforma.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
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
    res.json(allRecords);
  } catch (error: any) {
    console.error("Error fetching records:", error);
    res.status(500).json({ error: "Failed to fetch records from database" });
  }
});

// GET all execution logs (Secured)
app.get("/api/logs", requireAuth, async (req: AuthRequest, res) => {
  try {
    const logs = await db.select().from(executionLogs).orderBy(desc(executionLogs.timestamp));
    res.json(logs);
  } catch (error: any) {
    console.error("Error fetching execution logs:", error);
    res.status(500).json({ error: "Failed to fetch logs from database" });
  }
});

// POST to insert a single log entry manually (Secured)
app.post("/api/logs/add", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { action, status, details } = req.body;
    await db.insert(executionLogs).values({
      action: action || "MANUAL",
      status: status || "INFO",
      details: typeof details === "object" ? JSON.stringify(details) : String(details),
      userEmail: req.user?.email || "anonymous",
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to create log" });
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

    res.json({ success: true, count: formattedRecords.length });
  } catch (error: any) {
    console.error("Error updating database records:", error);
    // Log failure
    try {
      await db.insert(executionLogs).values({
        action: "SYNC_RECORDS",
        status: "ERROR",
        details: `Falha na sincronização dos registros: ${error.message}`,
        userEmail: req.user?.email || "anonymous",
      });
    } catch (e) {
      console.error("Failed to log failure:", e);
    }
    res.status(500).json({ error: "Database transaction failed: " + error.message });
  }
});

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

    let contents: any;
    if (fileBase64 && mimeType) {
      contents = {
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
      };
    } else {
      contents = `
Você é uma inteligência artificial especialista na análise, estruturação e classificação de diários oficiais, notícias, emendas e relatórios de atividades políticas de deputados do estado de Santa Catarina (SC).

Analise o texto extraído abaixo (proveniente de um arquivo ${filename || "enviado pelo usuário"}) e extraia TODAS as ações parlamentares individuais/atividades que encontrar.

Texto para análise:
"""
${text}
"""

Extraia as ações e classifique cada uma de forma inteligente seguindo este esquema estrito.
      `;
    }

    // Perform Structured content generation with retry
    const response = await generateContentWithRetry(ai, {
      model: "gemini-2.5-flash",
      contents: contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
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
        }
      }
    });

    const aiResponseText = response.text;
    if (!aiResponseText) {
      throw new Error("Gemini returned an empty response.");
    }

    const extractedRecords = JSON.parse(aiResponseText);

    // Save successful execution log
    await db.insert(executionLogs).values({
      action: "IMPORT_FILE",
      status: "SUCCESS",
      details: `Processamento IA concluído para o arquivo '${filename || "Texto Colado"}'. Extraídos ${extractedRecords.length} registros com sucesso usando o Gemini 3.5 Flash.`,
      userEmail: email,
    });

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
    } catch (e) {
      console.error("Failed to write error log:", e);
    }

    res.status(500).json({ error: "Gemini processing failed: " + friendlyErrorMessage });
  }
});


// -------------------------------------------------------------
// VITE OR STATIC FILE MIDDLEWARE
// -------------------------------------------------------------

async function startServer() {
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
