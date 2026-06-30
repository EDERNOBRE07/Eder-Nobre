import { dbFirestore } from "./firebase-admin.ts";
import * as fs from "fs";
import * as path from "path";

const RECORDS_FILE = path.join(process.cwd(), "records-store.json");
const LOGS_FILE = path.join(process.cwd(), "logs-store.json");

// Helper to read local JSON files
function readLocalRecords(): any[] {
  if (!fs.existsSync(RECORDS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(RECORDS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function readLocalLogs(): any[] {
  if (!fs.existsSync(LOGS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LOGS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

// -------------------------------------------------------------
// FIRESTORE OPERATIONS
// -------------------------------------------------------------

export async function fetchFirestoreRecords(): Promise<any[]> {
  try {
    console.log("[Firestore Service] Fetching records...");
    const snapshot = await dbFirestore.collection("records").get();
    const list: any[] = [];
    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });
    return list;
  } catch (err: any) {
    console.error("[Firestore Service] Error fetching records from Firestore:", err.message || err);
    return [];
  }
}

export async function saveFirestoreRecords(newRecords: any[]): Promise<void> {
  try {
    console.log(`[Firestore Service] Saving ${newRecords.length} records...`);
    const collectionRef = dbFirestore.collection("records");
    
    // Batch delete existing records to keep it clean (atomic replacement)
    const snapshot = await collectionRef.get();
    const batch = dbFirestore.batch();
    snapshot.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log("[Firestore Service] Cleaned up previous records.");

    // Write new records in batches of 400 (Firestore limit is 500 per batch)
    if (newRecords.length > 0) {
      const batchSize = 400;
      for (let i = 0; i < newRecords.length; i += batchSize) {
        const chunk = newRecords.slice(i, i + batchSize);
        const writeBatch = dbFirestore.batch();
        
        chunk.forEach((record) => {
          const docId = record.id || Math.random().toString(36).slice(2, 9);
          const docRef = collectionRef.doc(docId);
          
          // Ensure all fields are safe for Firestore (no undefined values)
          const cleanData = {
            sector: record.sector || "educacao",
            data: record.data || new Date().toISOString().split("T")[0],
            deputado: record.deputado || "",
            cidade: record.cidade || "",
            projeto_lei: record.projeto_lei || record.projetoLei || "",
            emenda: record.emenda || "",
            recursos: record.recursos ? String(record.recursos) : "0",
            status: record.status || "Em Tramitação",
            observacoes: record.observacoes || "",
            createdAt: record.createdAt || record.created_at || new Date().toISOString()
          };
          
          writeBatch.set(docRef, cleanData);
        });
        
        await writeBatch.commit();
      }
      console.log(`[Firestore Service] Successfully wrote ${newRecords.length} records.`);
    }
  } catch (err: any) {
    console.error("[Firestore Service] Error replacing records in Firestore:", err.message || err);
    throw err;
  }
}

export async function fetchFirestoreLogs(): Promise<any[]> {
  try {
    console.log("[Firestore Service] Fetching execution logs...");
    const snapshot = await dbFirestore.collection("logs").orderBy("timestamp", "desc").limit(100).get();
    const list: any[] = [];
    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });
    return list;
  } catch (err: any) {
    console.error("[Firestore Service] Error fetching logs from Firestore:", err.message || err);
    return [];
  }
}

export async function addFirestoreLog(action: string, status: string, details: string, userEmail: string): Promise<any> {
  try {
    const cleanLog = {
      action: action || "MANUAL",
      status: status || "INFO",
      details: details || "",
      userEmail: userEmail || "anonymous",
      timestamp: new Date().toISOString()
    };
    
    const docRef = await dbFirestore.collection("logs").add(cleanLog);
    return { id: docRef.id, ...cleanLog };
  } catch (err: any) {
    console.error("[Firestore Service] Error adding log to Firestore:", err.message || err);
    // Silent fail for logs so we don't block user flows
  }
}

// -------------------------------------------------------------
// LOCAL DATA RECOVERY SYSTEM
// -------------------------------------------------------------

export async function runLocalDataRecovery(dbPostgres: any, recordsTable: any, logsTable: any): Promise<void> {
  try {
    console.log("[Recovery System] Starting data recovery check...");

    const localRecs = readLocalRecords();
    const localLogs = readLocalLogs();

    if (localRecs.length === 0 && localLogs.length === 0) {
      console.log("[Recovery System] No local JSON backup files found. Recovery skipped.");
      return;
    }

    console.log(`[Recovery System] Found ${localRecs.length} records and ${localLogs.length} logs locally.`);

    // 1. Recover to Firestore (Permanent Fallback Cloud Database)
    try {
      const fsRecords = await fetchFirestoreRecords();
      if (fsRecords.length === 0 && localRecs.length > 0) {
        console.log("[Recovery System] Recovering local records to Firestore...");
        await saveFirestoreRecords(localRecs);
        console.log("[Recovery System] Local records successfully imported to Firestore.");
        
        // Add log
        await addFirestoreLog(
          "RECOVERY",
          "SUCCESS",
          `Recuperação automática de dados locais para Firestore concluída. Importados: ${localRecs.length} registros.`,
          "system-recovery"
        );
      }
    } catch (fsErr: any) {
      console.error("[Recovery System] Error writing recovery data to Firestore:", fsErr.message || fsErr);
    }

    // 2. Recover to PostgreSQL if active
    if (dbPostgres) {
      try {
        const pgRecords = await dbPostgres.select().from(recordsTable).limit(1);
        if (pgRecords.length === 0 && localRecs.length > 0) {
          console.log("[Recovery System] Recovering local records to PostgreSQL...");
          
          const formatted = localRecs.map((r: any) => ({
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
          }));

          const batchSize = 50;
          for (let i = 0; i < formatted.length; i += batchSize) {
            const batch = formatted.slice(i, i + batchSize);
            await dbPostgres.insert(recordsTable).values(batch);
          }
          console.log("[Recovery System] Local records successfully imported to PostgreSQL.");

          // Log the recovery
          await dbPostgres.insert(logsTable).values({
            action: "RECOVERY",
            status: "SUCCESS",
            details: `Recuperação automática de dados locais para PostgreSQL concluída. Importados: ${formatted.length} registros.`,
            userEmail: "system-recovery",
          });
        }
      } catch (pgErr: any) {
        console.log("[Recovery System] PostgreSQL is currently inactive or not fully configured. PostgreSQL recovery skipped.");
      }
    }

    // 3. Clear local backup files to prevent re-running recovery
    try {
      if (fs.existsSync(RECORDS_FILE)) {
        fs.unlinkSync(RECORDS_FILE);
        console.log("[Recovery System] Local records-store.json cleared after successful cloud migration.");
      }
      if (fs.existsSync(LOGS_FILE)) {
        fs.unlinkSync(LOGS_FILE);
        console.log("[Recovery System] Local logs-store.json cleared after successful cloud migration.");
      }
    } catch (cleanErr: any) {
      console.warn("[Recovery System] Warning: could not clear local backup files:", cleanErr.message || cleanErr);
    }

    console.log("[Recovery System] Data recovery execution completed.");
  } catch (err: any) {
    console.error("[Recovery System] General recovery check error:", err.message || err);
  }
}
