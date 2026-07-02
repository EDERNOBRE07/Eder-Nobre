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
      const data = doc.data();
      list.push({
        id: doc.id,
        sector: data.sector || "educacao",
        data: data.data || new Date().toISOString().split("T")[0],
        deputado: data.deputado || "",
        cidade: data.cidade || "",
        projetoLei: data.projetoLei || data.projeto_lei || "",
        emenda: data.emenda || "",
        recursos: data.recursos ? String(data.recursos) : "0",
        status: data.status || "Em Tramitação",
        observacoes: data.observacoes || "",
        createdAt: data.createdAt || data.created_at || new Date().toISOString()
      });
    });
    return list;
  } catch (err: any) {
    console.error("[Firestore Service] Error fetching records from Firestore:", err.message || err);
    throw err;
  }
}

export async function saveFirestoreRecords(newRecords: any[]): Promise<void> {
  try {
    console.log(`[Firestore Service] Saving ${newRecords.length} records...`);
    const collectionRef = dbFirestore.collection("records");
    
    // Batch delete existing records to keep it clean (atomic replacement)
    const snapshot = await collectionRef.get();
    if (snapshot.size > 0) {
      const batch = dbFirestore.batch();
      snapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log("[Firestore Service] Cleaned up previous records.");
    } else {
      console.log("[Firestore Service] No previous records to clean up in Firestore.");
    }

    // Write new records in batches of 400 (Firestore limit is 500 per batch)
    if (newRecords.length > 0) {
      const batchSize = 400;
      for (let i = 0; i < newRecords.length; i += batchSize) {
        const chunk = newRecords.slice(i, i + batchSize);
        const writeBatch = dbFirestore.batch();
        
        chunk.forEach((record) => {
          const docId = record.id || Math.random().toString(36).slice(2, 9);
          const docRef = collectionRef.doc(docId);
          
          // Ensure all fields are safe for Firestore (no undefined values) and save both for safety
          const cleanData = {
            sector: record.sector || "educacao",
            data: record.data || new Date().toISOString().split("T")[0],
            deputado: record.deputado || "",
            cidade: record.cidade || "",
            projetoLei: record.projetoLei || record.projeto_lei || "",
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
    throw err;
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

    let recoveredToFsCount = 0;
    let recoveredToPgCount = 0;

    // 1. Recover to Firestore (Permanent Fallback Cloud Database)
    try {
      const fsRecords = await fetchFirestoreRecords();
      const fsIds = new Set(fsRecords.map(r => r.id));
      
      // Filtra registros locais que ainda não estão salvos no Firestore
      const toRecoverFs = localRecs.filter(r => !fsIds.has(r.id));
      
      if (toRecoverFs.length > 0) {
        console.log(`[Recovery System] Recovering ${toRecoverFs.length} local records to Firestore...`);
        // saveFirestoreRecords realiza substituição completa. Por segurança, mesclamos registros antigos com os novos e salvamos tudo.
        const mergedFsRecords = [...fsRecords, ...toRecoverFs];
        await saveFirestoreRecords(mergedFsRecords);
        recoveredToFsCount = toRecoverFs.length;
        console.log("[Recovery System] Local records merged and saved to Firestore.");
        
        await addFirestoreLog(
          "RECOVERY",
          "SUCCESS",
          `Recuperação de dados locais concluída no Firestore. Mesclados e adicionados: ${toRecoverFs.length} novos registros.`,
          "system-recovery"
        );
      } else {
        console.log("[Recovery System] All local records already exist in Firestore fallback.");
      }
    } catch (fsErr: any) {
      console.error("[Recovery System] Error writing recovery data to Firestore:", fsErr.message || fsErr);
    }

    // 2. Recover to PostgreSQL if active
    if (dbPostgres) {
      try {
        const pgRecords = await dbPostgres.select().from(recordsTable);
        const pgIds = new Set(pgRecords.map((r: any) => r.id));
        
        // Filtra registros locais que ainda não estão salvos no PostgreSQL
        const toRecoverPg = localRecs.filter(r => !pgIds.has(r.id));
        
        if (toRecoverPg.length > 0) {
          console.log(`[Recovery System] Recovering ${toRecoverPg.length} local records to PostgreSQL...`);
          
          const formatted = toRecoverPg.map((r: any) => ({
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
          recoveredToPgCount = formatted.length;
          console.log(`[Recovery System] ${formatted.length} local records successfully imported to PostgreSQL.`);

          // Log de recuperação no PostgreSQL
          await dbPostgres.insert(logsTable).values({
            action: "RECOVERY",
            status: "SUCCESS",
            details: `Recuperação automática de dados locais para PostgreSQL concluída. Importados: ${formatted.length} novos registros mesclados.`,
            userEmail: "system-recovery",
          });
        } else {
          console.log("[Recovery System] All local records already exist in PostgreSQL database.");
        }
      } catch (pgErr: any) {
        console.log("[Recovery System] PostgreSQL recovery skipped or failed:", pgErr.message || pgErr);
      }
    }

    // 3. Recover Local Logs if any to PostgreSQL
    if (dbPostgres && localLogs.length > 0) {
      try {
        const pgLogs = await dbPostgres.select().from(logsTable).limit(200);
        const pgLogKeys = new Set(pgLogs.map((l: any) => `${l.action}_${l.timestamp}_${l.userEmail}`));
        const toRecoverLogs = localLogs.filter(l => !pgLogKeys.has(`${l.action}_${l.timestamp}_${l.userEmail}`));
        
        if (toRecoverLogs.length > 0) {
          console.log(`[Recovery System] Recovering ${toRecoverLogs.length} local logs to PostgreSQL...`);
          const formattedLogs = toRecoverLogs.map((l: any) => ({
            timestamp: l.timestamp ? new Date(l.timestamp) : new Date(),
            action: l.action || "MANUAL",
            status: l.status || "SUCCESS",
            details: l.details || "",
            userEmail: l.userEmail || "anonymous"
          }));
          
          const batchSize = 50;
          for (let i = 0; i < formattedLogs.length; i += batchSize) {
            const batch = formattedLogs.slice(i, i + batchSize);
            await dbPostgres.insert(logsTable).values(batch);
          }
          console.log("[Recovery System] Local logs successfully imported to PostgreSQL.");
        }
      } catch (logPgErr: any) {
        console.log("[Recovery System] PostgreSQL logs recovery skipped or failed:", logPgErr.message || logPgErr);
      }
    }

    // 4. Limpa arquivos locais APENAS se as operações de migração foram feitas com segurança para alguma das nuvens
    // Se ambas as gravações falharem (bancos completamente inacessíveis no boot), preservamos os arquivos JSON locais para a próxima oportunidade.
    const recoveredSomewhere = recoveredToFsCount > 0 || recoveredToPgCount > 0 || (localRecs.length === 0);
    
    if (recoveredSomewhere) {
      try {
        if (fs.existsSync(RECORDS_FILE)) {
          fs.unlinkSync(RECORDS_FILE);
          console.log("[Recovery System] Local records-store.json cleared after successful cloud migration/merge.");
        }
        if (fs.existsSync(LOGS_FILE)) {
          fs.unlinkSync(LOGS_FILE);
          console.log("[Recovery System] Local logs-store.json cleared after successful cloud migration/merge.");
        }
      } catch (cleanErr: any) {
        console.warn("[Recovery System] Warning: could not clear local backup files:", cleanErr.message || cleanErr);
      }
    } else {
      console.log("[Recovery System] Cloud databases were not writable. Preserving local backup JSON files for next boot.");
    }

    console.log("[Recovery System] Data recovery execution completed.");
  } catch (err: any) {
    console.error("[Recovery System] General recovery check error:", err.message || err);
  }
}
