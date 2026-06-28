import React, { useState, useEffect, useRef } from "react";
import { 
  signInAnonymously, 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged, 
  signOut,
  User,
  GoogleAuthProvider
} from "firebase/auth";
import { auth, googleAuthProvider } from "./lib/firebase.ts";
import { Record as DBRecord, ExecutionLog, Sector, Region } from "./types.ts";
import { SECTORS, getSectorById } from "./utils/sectors.ts";
import { REGIONS, getRegionIdForCity } from "./utils/regionMapper.ts";
import { motion, AnimatePresence } from "motion/react";
import { 
  LayoutDashboard, 
  Search, 
  Upload, 
  Download, 
  Trash2, 
  Edit, 
  Check, 
  Plus, 
  FileText, 
  LogOut, 
  User as UserIcon, 
  ShieldAlert, 
  RefreshCw, 
  ChevronRight, 
  Calendar, 
  MapPin, 
  DollarSign, 
  Activity,
  Maximize2,
  X,
  FileSpreadsheet,
  FileMinus,
  HelpCircle,
  Cloud,
  Folder
} from "lucide-react";

// Third-party file parsers (installed)
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import * as pdfjs from "pdfjs-dist";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function App() {
  // Authentication State
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string>("");
  const [authLoading, setAuthLoading] = useState(true);

  // App Data State
  const [records, setRecords] = useState<DBRecord[]>([]);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Navigation and Filter State
  const [activeTab, setActiveTab] = useState<string>("dashboard"); // "dashboard", "logs", or sector ID
  const [globalSearch, setGlobalSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");

  // Manual Editor Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingRecord, setEditingRecord] = useState<Partial<DBRecord>>({});
  const [editingSector, setEditingSector] = useState<string>("educacao");

  // File Staging and Batch Preview State
  const [isImportPanelOpen, setIsImportPanelOpen] = useState(false);
  const [stagedRecords, setStagedRecords] = useState<DBRecord[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importSource, setImportSource] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [isPasteAreaOpen, setIsPasteAreaOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Google Drive State Variables
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [driveSearch, setDriveSearch] = useState("");
  const [isFetchingDrive, setIsFetchingDrive] = useState(false);

  // Email / Password Auth Modal States
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authModalError, setAuthModalError] = useState("");
  const [anonymousAuthFailed, setAnonymousAuthFailed] = useState(false);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthModalError("");
    if (!authEmail || !authPassword) {
      setAuthModalError("Por favor, preencha todos os campos.");
      return;
    }
    try {
      setAuthLoading(true);
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
        showToast("Login realizado com sucesso!", "success");
      } else {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        showToast("Conta criada e conectada com sucesso!", "success");
      }
      setIsAuthModalOpen(false);
      setAuthEmail("");
      setAuthPassword("");
    } catch (err: any) {
      console.error("Email auth error:", err);
      let friendlyMessage = err.message;
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        friendlyMessage = "E-mail ou senha incorretos.";
      } else if (err.code === "auth/email-already-in-use") {
        friendlyMessage = "Este e-mail já está em uso.";
      } else if (err.code === "auth/weak-password") {
        friendlyMessage = "A senha deve ter pelo menos 6 caracteres.";
      } else if (err.code === "auth/invalid-email") {
        friendlyMessage = "Formato de e-mail inválido.";
      }
      setAuthModalError(friendlyMessage);
      showToast("Falha na autenticação: " + friendlyMessage, "error");
    } finally {
      setAuthLoading(false);
    }
  };

  // -------------------------------------------------------------
  // AUTHENTICATION FLOW
  // -------------------------------------------------------------
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setAnonymousAuthFailed(false);
        const jwt = await currentUser.getIdToken();
        setToken(jwt);
        showToast("Conexão segura restabelecida!", "success");
      } else {
        setUser(null);
        setToken("");
        // Auto sign-in anonymously for zero friction "Qualquer usuário pode operar o sistema"
        try {
          setAuthLoading(true);
          await signInAnonymously(auth);
          setAnonymousAuthFailed(false);
        } catch (err: any) {
          console.error("Anonymous authentication failed:", err);
          setAnonymousAuthFailed(true);
          showToast("Sessão anônima não permitida. Por favor, conecte sua conta.", "info");
        }
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Fetch data from database when authenticated
  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token]);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleGoogleLogin = async () => {
    try {
      setAuthLoading(true);
      const result = await signInWithPopup(auth, googleAuthProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setDriveToken(credential.accessToken);
        showToast("Sessão e Google Drive conectados com sucesso!", "success");
      } else {
        showToast("Sessão iniciada via Google com sucesso!", "success");
      }
    } catch (err: any) {
      console.error("Google sign in failed:", err);
      showToast("Erro ao fazer login com Google.", "error");
    } finally {
      setAuthLoading(false);
    }
  };

  // -------------------------------------------------------------
  // GOOGLE DRIVE INTEGRATION HELPERS
  // -------------------------------------------------------------
  const fetchDriveFiles = async (tokenToUse: string) => {
    setIsFetchingDrive(true);
    try {
      const q = "trashed = false and (name contains '.pdf' or name contains '.docx' or name contains '.xlsx' or name contains '.xls' or name contains '.csv' or name contains '.txt')";
      const url = `https://www.googleapis.com/drive/v3/files?pageSize=50&q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime)`;
      
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${tokenToUse}`
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          setDriveToken(null);
          throw new Error("Sua sessão do Google Drive expirou. Por favor, reconecte.");
        }
        throw new Error(`Erro API Google Drive: ${response.statusText}`);
      }
      
      const data = await response.json();
      setDriveFiles(data.files || []);
    } catch (err: any) {
      console.error("Failed to fetch Google Drive files:", err);
      showToast(err.message || "Erro ao listar arquivos do Google Drive.", "error");
    } finally {
      setIsFetchingDrive(false);
    }
  };

  const handleImportFromDrive = async (fileId: string, fileName: string, mimeType: string) => {
    if (!driveToken) {
      showToast("Conecte ao Google Drive primeiro.", "error");
      return;
    }
    
    const confirmed = window.confirm(`Deseja mesmo baixar e processar o arquivo "${fileName}" do seu Google Drive?`);
    if (!confirmed) return;
    
    setImportLoading(true);
    setImportSource(`Google Drive: ${fileName}`);
    
    try {
      const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${driveToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Não foi possível baixar o arquivo. Status: ${response.status}`);
      }
      
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: mimeType });
      await processFileForClassification(file);
      showToast(`Arquivo "${fileName}" carregado e enviado para análise com sucesso!`, "success");
    } catch (err: any) {
      console.error("Error importing file from Google Drive:", err);
      showToast(`Falha ao importar do Google Drive: ${err.message}`, "error");
      setImportLoading(false);
    }
  };

  useEffect(() => {
    if (driveToken) {
      fetchDriveFiles(driveToken);
    } else {
      setDriveFiles([]);
    }
  }, [driveToken]);

  const handleLogout = async () => {
    try {
      setAuthLoading(true);
      await signOut(auth);
      showToast("Sessão encerrada.", "info");
    } catch (err) {
      showToast("Erro ao encerrar sessão.", "error");
    } finally {
      setAuthLoading(false);
    }
  };

  // -------------------------------------------------------------
  // DATABASE ACCESS FLOW
  // -------------------------------------------------------------
  const fetchData = async () => {
    if (!token) return;
    setDataLoading(true);
    try {
      // 1. Fetch Records
      const recRes = await fetch("/api/records", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!recRes.ok) throw new Error("HTTP " + recRes.status);
      const recData = await recRes.json();
      setRecords(recData);

      // 2. Fetch Logs
      const logRes = await fetch("/api/logs", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (logRes.ok) {
        const logData = await logRes.json();
        setLogs(logData);
      }
    } catch (err: any) {
      console.error("Failed to fetch data:", err);
      showToast("Falha de conexão com a base SQL.", "error");
    } finally {
      setDataLoading(false);
    }
  };

  // Sync state back to SQL Server (atomic ReplaceAll snapshot save)
  const syncWithDatabase = async (updatedRecordsList: DBRecord[]) => {
    if (!token) {
      showToast("Você precisa estar autenticado para salvar alterações.", "error");
      return;
    }
    setSyncing(true);
    try {
      const response = await fetch("/api/records/replaceAll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(updatedRecordsList)
      });

      if (!response.ok) {
        const errObj = await response.json();
        throw new Error(errObj.error || "HTTP " + response.status);
      }

      showToast("Dados sincronizados com o banco de dados SQL!", "success");
      await fetchData(); // Reload to obtain updated logs and confirmed records
    } catch (err: any) {
      console.error("Sync failed:", err);
      showToast("Falha ao salvar no SQL: " + err.message, "error");
    } finally {
      setSyncing(false);
    }
  };

  // Helper to log manual operations to SQL logs
  const logOperation = async (action: string, status: string, details: string) => {
    if (!token) return;
    try {
      await fetch("/api/logs/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action, status, details })
      });
    } catch (e) {
      console.error("Logging failed:", e);
    }
  };

  // -------------------------------------------------------------
  // FILE PARSING PIPELINE
  // -------------------------------------------------------------
  const handleFileUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    await processFileForClassification(file);
    e.target.value = ""; // reset
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64Data = result.split(",")[1];
        resolve(base64Data);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const processFileForClassification = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    setImportLoading(true);
    setImportSource(file.name);
    try {
      let extractedText = "";

      if (ext === "csv" || ext === "txt") {
        extractedText = await file.text();
        if (!extractedText.trim()) {
          throw new Error("Não foi possível extrair nenhum texto legível deste documento.");
        }
        await sendTextToGemini(extractedText, file.name);
      } else if (ext === "xlsx" || ext === "xls") {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        let sheetsText = "";
        workbook.SheetNames.forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          sheetsText += `--- Planilha: ${sheetName} ---\n`;
          sheetsText += XLSX.utils.sheet_to_csv(sheet) + "\n";
        });
        extractedText = sheetsText;
        if (!extractedText.trim()) {
          throw new Error("Não foi possível extrair nenhum texto legível deste documento.");
        }
        await sendTextToGemini(extractedText, file.name);
      } else if (ext === "docx") {
        const arrayBuffer = await file.arrayBuffer();
        const parseResult = await mammoth.extractRawText({ arrayBuffer });
        extractedText = parseResult.value;
        if (!extractedText.trim()) {
          throw new Error("Não foi possível extrair nenhum texto legível deste documento.");
        }
        await sendTextToGemini(extractedText, file.name);
      } else if (ext === "pdf") {
        const base64Data = await fileToBase64(file);
        // Send the PDF directly as a base64 document to Gemini for native document parsing
        await sendTextToGemini("", file.name, base64Data, "application/pdf");
      } else {
        throw new Error(`O formato de arquivo .${ext} não é suportado.`);
      }

    } catch (err: any) {
      console.error("File processing failed:", err);
      showToast("Falha no processamento: " + err.message, "error");
      setImportLoading(false);
    }
  };

  const handlePasteClassification = async () => {
    if (!pastedText.trim()) {
      showToast("Por favor, cole um texto para analisar.", "error");
      return;
    }
    setImportLoading(true);
    setImportSource("Texto Colado Manualmente");
    try {
      await sendTextToGemini(pastedText, "Texto Colado");
      setPastedText("");
      setIsPasteAreaOpen(false);
    } catch (err: any) {
      showToast("Falha ao analisar texto: " + err.message, "error");
      setImportLoading(false);
    }
  };

  const sendTextToGemini = async (textPayload: string, filename: string, fileBase64?: string, mimeType?: string) => {
    if (!token) {
      showToast("Não autenticado.", "error");
      return;
    }
    try {
      const response = await fetch("/api/records/classify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ text: textPayload, filename, fileBase64, mimeType })
      });

      if (!response.ok) {
        const errObj = await response.json();
        throw new Error(errObj.error || "Erro de classificação no servidor");
      }

      const resData = await response.json();
      if (resData.records && Array.isArray(resData.records)) {
        setStagedRecords(resData.records);
        showToast(`Gemini processou e extraiu ${resData.records.length} registros!`, "success");
      } else {
        throw new Error("Nenhum registro pôde ser estruturado pela inteligência artificial.");
      }
    } catch (err: any) {
      console.error("Gemini proxy query failed:", err);
      showToast(err.message, "error");
    } finally {
      setImportLoading(false);
    }
  };

  // -------------------------------------------------------------
  // RECORD MUTATIONS
  // -------------------------------------------------------------
  const handleOpenAddModal = (sectorId: string) => {
    setModalMode("create");
    setEditingSector(sectorId);
    setEditingRecord({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sector: sectorId,
      data: new Date().toISOString().split("T")[0],
      deputado: "",
      cidade: "",
      projetoLei: "",
      emenda: "",
      recursos: "0",
      status: "Em Tramitação",
      observacoes: ""
    });
    setIsModalOpen(true);
  };

  const checkDuplicate = (
    record: Partial<DBRecord>,
    existingList: DBRecord[],
    ignoreId?: string
  ): DBRecord | null => {
    if (!record.deputado) return null;
    
    const normalize = (str: string) => 
      str.toLowerCase()
         .replace(/[\s\r\n\t]+/g, " ")
         .trim();

    const rDeputado = normalize(record.deputado);
    const rCidade = normalize(record.cidade || "");
    const rData = record.data ? record.data.split("T")[0] : "";
    const rRecursos = record.recursos ? Number(record.recursos) : 0;
    
    for (const item of existingList) {
      if (ignoreId && item.id === ignoreId) continue;
      
      const itemDeputado = normalize(item.deputado || "");
      const itemCidade = normalize(item.cidade || "");
      const itemData = item.data ? item.data.split("T")[0] : "";
      const itemRecursos = item.recursos ? Number(item.recursos) : 0;
      
      const isSameDeputado = rDeputado === itemDeputado;
      const isSameCidade = rCidade === itemCidade;
      const isSameData = rData === itemData;
      const isSameRecursos = rRecursos === itemRecursos;
      
      if (isSameDeputado && isSameCidade && isSameData && isSameRecursos) {
        return item;
      }
    }
    return null;
  };

  const getStagedRecordStatus = (r: DBRecord, index: number) => {
    // Check if it duplicates an already saved database record
    const dbDuplicate = checkDuplicate(r, records);
    if (dbDuplicate) {
      return { isDuplicate: true, type: "database", reason: `Já cadastrado na base SQL` };
    }
    // Check if it duplicates an earlier record in the same staged list
    const earlierStaged = stagedRecords.slice(0, index);
    const stagedDuplicate = checkDuplicate(r, earlierStaged);
    if (stagedDuplicate) {
      return { isDuplicate: true, type: "staged", reason: "Repetido neste mesmo arquivo" };
    }
    return { isDuplicate: false, type: "", reason: "" };
  };

  const handleRemoveStagedDuplicates = () => {
    const uniqueStaged: DBRecord[] = [];
    let countRemoved = 0;
    
    stagedRecords.forEach((r, idx) => {
      const status = getStagedRecordStatus(r, idx);
      if (status.isDuplicate) {
        countRemoved++;
      } else {
        uniqueStaged.push(r);
      }
    });
    
    if (countRemoved === 0) {
      showToast("Nenhum registro duplicado foi encontrado no lote.", "info");
    } else {
      setStagedRecords(uniqueStaged);
      showToast(`${countRemoved} registros duplicados foram removidos do lote provisório.`, "success");
    }
  };

  const handleOpenEditModal = (record: DBRecord) => {
    setModalMode("edit");
    setEditingSector(record.sector);
    setEditingRecord({ ...record });
    setIsModalOpen(true);
  };

  const handleSaveModalRecord = async () => {
    if (!editingRecord.deputado?.trim()) {
      showToast("A descrição da ação do deputado é obrigatória.", "error");
      return;
    }
    if (!editingRecord.data) {
      showToast("A data é obrigatória.", "error");
      return;
    }

    const updated = {
      ...editingRecord,
      sector: editingSector,
    } as DBRecord;

    // Duplication Check
    const duplicate = checkDuplicate(updated, records, modalMode === "edit" ? updated.id : undefined);
    if (duplicate) {
      const confirmSave = window.confirm(
        `⚠️ Atenção: Já existe um registro semelhante cadastrado!\n\n` +
        `• Setor: ${duplicate.sector}\n` +
        `• Data: ${formatDateString(duplicate.data)}\n` +
        `• Deputado/Ação: "${duplicate.deputado.substring(0, 80)}..."\n` +
        `• Cidade: ${duplicate.cidade || "—"}\n\n` +
        `Deseja realmente salvar este registro duplicado?`
      );
      if (!confirmSave) {
        return; // Cancel saving
      }
    }

    let updatedList: DBRecord[] = [];
    if (modalMode === "create") {
      updatedList = [...records, updated];
      await logOperation("CREATE_RECORD", "SUCCESS", `Manual record created under sector '${editingSector}'.`);
    } else {
      updatedList = records.map((r) => (r.id === updated.id ? updated : r));
      await logOperation("EDIT_RECORD", "SUCCESS", `Manual record ${updated.id} edited.`);
    }

    setRecords(updatedList);
    setIsModalOpen(false);
    // Sincronizar com banco de dados
    await syncWithDatabase(updatedList);
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!window.confirm("Deseja realmente remover permanentemente este registro da base SQL?")) return;
    const filtered = records.filter((r) => r.id !== recordId);
    setRecords(filtered);
    await logOperation("DELETE_RECORD", "SUCCESS", `Record ${recordId} deleted.`);
    await syncWithDatabase(filtered);
  };

  // Commit Batch Preview Staged Records
  const handleCommitStagedRecords = async () => {
    if (stagedRecords.length === 0) return;
    
    // Check if there are still duplicates inside
    const hasDuplicates = stagedRecords.some((r, idx) => getStagedRecordStatus(r, idx).isDuplicate);
    if (hasDuplicates) {
      const confirmCommit = window.confirm(
        "⚠️ Alguns registros neste lote foram marcados como duplicados. " +
        "Deseja importá-los mesmo assim? (Recomendamos clicar em 'Limpar Duplicados' antes)."
      );
      if (!confirmCommit) return;
    }

    // We append staged records to current list
    const combined = [...records, ...stagedRecords];
    setRecords(combined);
    setStagedRecords([]);
    setIsImportPanelOpen(false);
    await syncWithDatabase(combined);
  };

  // Clear staged preview
  const handleDiscardStaged = () => {
    setStagedRecords([]);
    showToast("Registros provisórios descartados.", "info");
  };

  // -------------------------------------------------------------
  // CALCULATED METRICS
  // -------------------------------------------------------------
  const getSectorCount = (sectorId: string) => records.filter(r => r.sector === sectorId).length;
  const getSectorInvestments = (sectorId: string) => {
    return records
      .filter(r => r.sector === sectorId)
      .reduce((sum, r) => sum + (parseFloat(r.recursos || "0") || 0), 0);
  };

  const totalInvestments = records.reduce((sum, r) => sum + (parseFloat(r.recursos || "0") || 0), 0);

  // Helper to format currency values to BRL
  const formatBRL = (value?: string | number) => {
    const numeric = typeof value === "string" ? parseFloat(value) || 0 : value || 0;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(numeric);
  };

  const formatDateString = (dt?: string) => {
    if (!dt) return "—";
    const parts = dt.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dt;
  };

  // -------------------------------------------------------------
  // REGIONAL STATS & MAP CALCS
  // -------------------------------------------------------------
  const getRegionStats = () => {
    const stats: Record<string, { count: number; investment: number; cities: Set<string> }> = {};
    REGIONS.forEach(reg => {
      stats[reg.id] = { count: 0, investment: 0, cities: new Set() };
    });

    let unmappedCount = 0;
    records.forEach(r => {
      const rid = getRegionIdForCity(r.cidade);
      if (rid && stats[rid]) {
        stats[rid].count += 1;
        stats[rid].investment += parseFloat(r.recursos || "0") || 0;
        if (r.cidade) stats[rid].cities.add(r.cidade);
      } else {
        unmappedCount += 1;
      }
    });

    return { stats, unmappedCount };
  };

  const { stats: regionStats, unmappedCount } = getRegionStats();
  const maxRegionCount = Math.max(...Object.values(regionStats).map(s => s.count), 1);

  // -------------------------------------------------------------
  // RECORD FILTERS
  // -------------------------------------------------------------
  const getFilteredRecords = (sectorId?: string) => {
    return records.filter((r) => {
      // Sector filter if active tab is sector
      if (sectorId && r.sector !== sectorId) return false;

      // Status filter
      if (statusFilter && r.status !== statusFilter) return false;

      // City filter
      if (cityFilter && !r.cidade?.toLowerCase().includes(cityFilter.toLowerCase())) return false;

      // Date range filters
      if (dateFromFilter && r.data < dateFromFilter) return false;
      if (dateToFilter && r.data > dateToFilter) return false;

      // Global text search across multiple fields
      if (globalSearch) {
        const query = globalSearch.toLowerCase();
        const inDeputado = r.deputado?.toLowerCase().includes(query);
        const inCidade = r.cidade?.toLowerCase().includes(query);
        const inPL = r.projetoLei?.toLowerCase().includes(query);
        const inEmenda = r.emenda?.toLowerCase().includes(query);
        const inObs = r.observacoes?.toLowerCase().includes(query);
        const inSector = getSectorById(r.sector)?.name.toLowerCase().includes(query);
        if (!inDeputado && !inCidade && !inPL && !inEmenda && !inObs && !inSector) return false;
      }

      return true;
    }).sort((a, b) => b.data.localeCompare(a.data));
  };

  const filteredList = activeTab === "dashboard" || activeTab === "logs" 
    ? getFilteredRecords() 
    : getFilteredRecords(activeTab);

  // -------------------------------------------------------------
  // EXPORT TO CSV
  // -------------------------------------------------------------
  const handleExportCSV = (sectorId?: string) => {
    const listToExport = sectorId ? records.filter(r => r.sector === sectorId) : records;
    if (listToExport.length === 0) {
      showToast("Nenhum dado disponível para exportação.", "info");
      return;
    }

    const headers = ["ID", "Setor", "Data", "Ação do Deputado", "Cidade", "Projeto de Lei", "Emenda", "Recursos (R$)", "Status", "Observações"];
    const csvRows = [
      headers.join(";"),
      ...listToExport.map(r => {
        const sectorName = getSectorById(r.sector)?.name || r.sector;
        const line = [
          r.id,
          sectorName,
          formatDateString(r.data),
          r.deputado.replace(/"/g, '""').replace(/\n/g, ' '),
          (r.cidade || "").replace(/"/g, '""'),
          (r.projetoLei || "").replace(/"/g, '""'),
          (r.emenda || "").replace(/"/g, '""'),
          r.recursos || "0",
          r.status,
          (r.observacoes || "").replace(/"/g, '""').replace(/\n/g, ' ')
        ];
        return line.map(field => `"${field}"`).join(";");
      })
    ];

    const csvContent = "\uFEFF" + csvRows.join("\n"); // UTF-8 BOM
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", sectorId ? `matriz_${sectorId}.csv` : "matriz_completa.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Relatório exportado em CSV com sucesso!", "success");
  };

  // Status badges configurations
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "Aprovado":
        return "bg-emerald-50 text-emerald-800 border-emerald-200/50";
      case "Em Tramitação":
        return "bg-amber-50 text-amber-800 border-amber-200/50";
      case "Vetado":
        return "bg-rose-50 text-rose-800 border-rose-200/50";
      default:
        return "bg-stone-100 text-stone-700 border-stone-200";
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row relative">
      {/* Toast alert indicator */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -15, scale: 0.95 }}
            className={`fixed bottom-6 right-6 z-50 py-3.5 px-6 rounded shadow-xl border text-sm flex items-center gap-3 font-medium transition-colors ${
              toast.type === "success" 
                ? "bg-slate-900 text-blue-100 border-blue-500/30" 
                : toast.type === "error" 
                ? "bg-rose-950 text-rose-100 border-rose-500/30" 
                : "bg-slate-800 text-slate-100 border-slate-700"
            }`}
          >
            <span>{toast.type === "success" ? "⚜️" : toast.type === "error" ? "⚠️" : "ℹ️"}</span>
            <p>{toast.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==========================================
          SIDEBAR
         ========================================== */}
      <aside className="w-full md:w-64 bg-slate-900 text-slate-300 flex-shrink-0 flex flex-col border-r border-slate-800 shadow-xl">
        {/* Title Brand / Logo */}
        <div className="py-7 px-6 border-b border-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center font-bold text-white shadow-md">
            M
          </div>
          <div>
            <h1 className="font-sans text-lg font-bold tracking-tight text-slate-100">MATRIZ MV</h1>
            <p className="text-[10px] tracking-widest text-blue-500/80 font-bold uppercase">DIRETRIZES POLÍTICAS</p>
          </div>
        </div>

        {/* User Authentication Panel */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/40 text-xs flex flex-col gap-2">
          <div className="flex items-center gap-2 text-slate-400">
            <UserIcon size={14} className="text-blue-500" />
            <span className="truncate font-medium flex items-center gap-1.5 max-w-[180px]">
              <span className="truncate">{user ? (user.isAnonymous ? "Sessão Convidado" : user.email) : "Conectando..."}</span>
              {user && !user.isAnonymous && <span className="text-emerald-500 font-bold" title="Conta Autenticada">✓</span>}
            </span>
          </div>
          <div className="flex flex-col gap-2 mt-1">
            {user && user.isAnonymous ? (
              <div className="flex flex-col gap-1.5 w-full">
                <button 
                  onClick={() => { setAuthMode("login"); setAuthModalError(""); setIsAuthModalOpen(true); }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-2.5 rounded transition-all text-[11px] text-center shadow-sm"
                >
                  Entrar / Criar Conta (E-mail)
                </button>
                <button 
                  onClick={handleGoogleLogin} 
                  className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-1 px-2.5 rounded transition-all text-[10px] text-center"
                  title="O login via Google pode ser bloqueado no iframe. Use login com e-mail acima."
                >
                  Entrar com Google
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogout} 
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 px-2.5 rounded transition-colors text-[11px] flex items-center justify-center gap-1"
              >
                <LogOut size={11} /> Sair da Conta
              </button>
            )}
          </div>
        </div>

        {/* Navigation Options */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5 scrollbar-thin">
          <p className="px-3 text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-2">Painel de Controle</p>
          
          <button 
            onClick={() => { setActiveTab("dashboard"); setIsImportPanelOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition-all duration-150 ${
              activeTab === "dashboard" && !isImportPanelOpen
                ? "bg-blue-500/10 text-blue-400 border-l-2 border-blue-500 pl-4.5"
                : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            <LayoutDashboard size={15} />
            <span>Painel Geral</span>
            <span className="ml-auto text-[10px] bg-slate-800 text-slate-400 py-0.5 px-2 rounded-full font-mono">{records.length}</span>
          </button>

          <button 
            onClick={() => { setActiveTab("logs"); setIsImportPanelOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition-all duration-150 ${
              activeTab === "logs"
                ? "bg-blue-500/10 text-blue-400 border-l-2 border-blue-500 pl-4.5"
                : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            <Activity size={15} />
            <span>Logs de Execução</span>
            <span className="ml-auto text-[10px] bg-slate-800 text-slate-400 py-0.5 px-2 rounded-full font-mono">{logs.length}</span>
          </button>

          <p className="px-3 pt-4 text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-2">Setores Editoriais</p>

          <div className="space-y-1">
            {SECTORS.map((s) => {
              const count = getSectorCount(s.id);
              const isActive = activeTab === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => { setActiveTab(s.id); setIsImportPanelOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-blue-500/5 text-blue-300 font-bold border-l-2 border-blue-400 pl-4"
                      : "hover:bg-slate-800/60 text-slate-400 hover:text-slate-300"
                  }`}
                >
                  <span className="text-sm">{s.icon}</span>
                  <span className="truncate">{s.name}</span>
                  {count > 0 && (
                    <span className="ml-auto text-[10px] bg-slate-800/80 text-slate-400 py-0.5 px-1.5 rounded">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer Brand Info */}
        <div className="p-4 border-t border-slate-800 text-[10px] text-slate-500 text-center bg-slate-950/20">
          <p>Conexão SQL Ativa (PostgreSQL)</p>
          <p className="mt-1 text-blue-500/60 font-mono font-bold">Data Engine Active</p>
        </div>
      </aside>

      {/* ==========================================
          MAIN CONTENT AREA
         ========================================== */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top Header Panel */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 md:px-8 shadow-sm">
          {/* Global Search box */}
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 w-full max-w-sm focus-within:border-blue-500 focus-within:bg-white transition-all shadow-sm">
            <Search size={15} className="text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar em todos os registros..." 
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="bg-transparent text-xs text-slate-800 outline-none w-full placeholder-slate-400 font-medium"
            />
            {globalSearch && (
              <button onClick={() => setGlobalSearch("")} className="text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Syncing/Reload indicators */}
            {syncing && (
              <span className="text-[11px] text-blue-600 font-bold flex items-center gap-1.5 bg-blue-50 px-3 py-1 border border-blue-200 rounded-lg shadow-sm">
                <RefreshCw size={12} className="animate-spin text-blue-500" /> Sincronizando SQL...
              </span>
            )}
            {dataLoading && (
              <span className="text-[11px] text-slate-500 flex items-center gap-1 px-2.5 py-1">
                <RefreshCw size={11} className="animate-spin text-slate-400" /> Carregando...
              </span>
            )}

            <button 
              onClick={() => setIsImportPanelOpen(prev => !prev)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-sans font-bold text-xs py-2 px-4 rounded-lg shadow-sm flex items-center gap-2 transition-colors"
            >
              <Upload size={13} className="text-white" />
              <span>Importar Lote (IA)</span>
            </button>

            <button 
              onClick={() => handleExportCSV()}
              className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold text-xs py-2 px-3.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <Download size={13} />
              <span>Exportar Tudo</span>
            </button>
          </div>
        </header>

        {/* Scrollable Container */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 scrollbar-thin">
          
          {anonymousAuthFailed && (!user || user.isAnonymous) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3.5 shadow-sm text-amber-900 leading-normal font-sans text-xs">
              <span className="text-xl">⚠️</span>
              <div className="space-y-1">
                <p className="font-bold text-amber-950">Aviso do Sistema de Autenticação</p>
                <p>
                  A sessão anônima automática foi desativada no painel administrativo do seu projeto Firebase. 
                  Para conseguir cadastrar, editar ou classificar registros parlamentares usando inteligência artificial, você precisa se conectar com uma conta de usuário.
                </p>
                <div className="pt-2 flex items-center gap-2.5">
                  <button 
                    onClick={() => { setAuthMode("login"); setAuthModalError(""); setIsAuthModalOpen(true); }}
                    className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-1.5 px-3 rounded-lg transition-colors text-xs shadow-sm"
                  >
                    Entrar / Criar Conta (E-mail e Senha)
                  </button>
                  <span className="text-amber-500 font-medium">ou</span>
                  <button 
                    onClick={handleGoogleLogin}
                    className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold py-1.5 px-3 rounded-lg transition-colors text-xs shadow-sm"
                  >
                    Entrar com Google
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==========================================
              IMPORT PANEL (AI BATCH CLASSIFICATION)
             ========================================== */}
          {isImportPanelOpen && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-slate-900 text-slate-100 p-6 rounded-xl shadow-xl border-l-4 border-blue-500 space-y-6"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-sans text-lg font-bold tracking-tight text-blue-400 uppercase">
                    Importação com Classificação Inteligente por Inteligência Artificial
                  </h3>
                  <p className="text-slate-400 text-xs mt-1">
                    Arraste ou carregue um arquivo (PDF, Excel, Word, CSV) ou cole um texto livre. Nosso sistema extrai as informações e o Gemini 3.5 Flash faz o mapeamento estruturado de campos e setores políticos de Santa Catarina.
                  </p>
                </div>
                <button 
                  onClick={() => { setIsImportPanelOpen(false); setStagedRecords([]); }}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Upload Drop Zone / Paste toggles / Google Drive Cloud */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                
                {/* File Dropzone */}
                <div 
                  onClick={handleFileUploadClick}
                  className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-8 text-center cursor-pointer bg-slate-950/40 hover:bg-slate-950/70 transition-all flex flex-col items-center justify-center space-y-3 group min-h-[190px]"
                >
                  <div className="w-12 h-12 rounded-full bg-slate-800 group-hover:bg-blue-500/10 flex items-center justify-center transition-colors">
                    <Upload className="text-slate-400 group-hover:text-blue-400 transition-colors" size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-200">Arraste seu arquivo aqui ou clique para buscar</p>
                    <p className="text-[10px] text-slate-500 mt-1">PDF, DOCX, XLSX, XLS, CSV ou TXT</p>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    className="hidden" 
                    accept=".pdf,.docx,.xlsx,.xls,.csv,.txt"
                  />
                </div>

                {/* Direct Paste Area Toggle */}
                <div className="border border-slate-800 rounded-xl p-5 bg-slate-950/20 flex flex-col justify-between min-h-[190px]">
                  <div>
                    <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                      <FileText size={14} className="text-blue-500" /> Área de Colagem Direta de Textos
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Cole notícias, trechos de diários oficiais, ofícios ou anotações diretamente sem carregar arquivos.
                    </p>
                  </div>
                  
                  {isPasteAreaOpen ? (
                    <div className="space-y-3 mt-3">
                      <textarea
                        rows={3}
                        placeholder="Cole aqui o texto parlamentar..."
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                      />
                      <div className="flex justify-end gap-2 text-xs">
                        <button 
                          onClick={() => setIsPasteAreaOpen(false)} 
                          className="py-1 px-3 rounded hover:bg-slate-800 text-slate-400"
                        >
                          Cancelar
                        </button>
                        <button 
                          onClick={handlePasteClassification} 
                          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3.5 rounded transition-colors"
                        >
                          Analisar Texto
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setIsPasteAreaOpen(true)}
                      className="mt-4 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2 px-4 rounded-xl w-full transition-colors text-center"
                    >
                      Abrir Caixa de Texto
                    </button>
                  )}
                </div>

                {/* Google Drive Integration Card */}
                <div className="border border-slate-800 rounded-xl p-5 bg-slate-950/20 flex flex-col justify-between min-h-[190px]">
                  {!driveToken ? (
                    <div className="flex flex-col justify-between h-full w-full">
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                          <Cloud size={14} className="text-emerald-500" /> Importar do Google Drive
                        </h4>
                        <p className="text-[11px] text-slate-500 mt-1.5 leading-normal">
                          Importe relatórios de atividades, diários oficiais ou documentos parlamentares diretamente da sua nuvem.
                        </p>
                      </div>
                      <button
                        onClick={handleGoogleLogin}
                        className="mt-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 px-4 rounded-xl w-full transition-colors flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Cloud size={14} /> Conectar Google Drive
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                          <Cloud size={14} className="text-emerald-500" /> Google Drive Ativo
                        </h4>
                        <button 
                          onClick={() => fetchDriveFiles(driveToken)}
                          className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded hover:bg-slate-800"
                          title="Recarregar arquivos"
                        >
                          <RefreshCw size={12} className={isFetchingDrive ? "animate-spin text-emerald-500" : ""} />
                        </button>
                      </div>
                      
                      {/* Search Input inside Card */}
                      <div className="mt-2 relative">
                        <input 
                          type="text"
                          placeholder="Pesquisar arquivos..."
                          value={driveSearch}
                          onChange={(e) => setDriveSearch(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded pl-2 pr-6 py-1 text-[10px] text-slate-100 outline-none focus:border-emerald-500"
                        />
                        <Search size={10} className="absolute right-2 top-2.5 text-slate-500" />
                      </div>

                      {/* Files List Container */}
                      <div className="mt-2 flex-1 overflow-y-auto scrollbar-thin space-y-1 max-h-[75px] pr-1">
                        {isFetchingDrive ? (
                          <div className="flex items-center justify-center gap-1.5 py-4">
                            <RefreshCw size={10} className="animate-spin text-emerald-500" />
                            <span className="text-[9px] text-slate-500">Listando arquivos...</span>
                          </div>
                        ) : driveFiles.length === 0 ? (
                          <p className="text-[9px] text-slate-500 text-center py-4">Nenhum arquivo compatível (.pdf, .docx, .xlsx, .xls, .csv, .txt) encontrado.</p>
                        ) : (
                          driveFiles
                            .filter(f => f.name.toLowerCase().includes(driveSearch.toLowerCase()))
                            .map(f => (
                              <button
                                key={f.id}
                                onClick={() => handleImportFromDrive(f.id, f.name, f.mimeType)}
                                className="w-full text-left bg-slate-950/40 hover:bg-emerald-950/20 border border-slate-800/80 hover:border-emerald-700/50 rounded p-1 transition-all flex items-center gap-1.5 group"
                              >
                                <Folder size={11} className="text-emerald-500 shrink-0" />
                                <div className="truncate flex-1">
                                  <p className="text-[9px] font-medium text-slate-300 truncate group-hover:text-emerald-300">{f.name}</p>
                                  <p className="text-[8px] text-slate-500">Modificado: {new Date(f.modifiedTime).toLocaleDateString("pt-BR")}</p>
                                </div>
                              </button>
                            ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

              </div>

              {/* Loader during Gemini execution */}
              {importLoading && (
                <div className="p-8 text-center bg-slate-950/30 rounded border border-slate-800 flex flex-col items-center justify-center space-y-3">
                  <RefreshCw size={24} className="text-blue-500 animate-spin" />
                  <div>
                    <p className="text-xs font-bold text-slate-100">Processando com Inteligência Artificial (Fast Mode)...</p>
                    <p className="text-[10px] text-slate-500 mt-1">Extraindo, traduzindo e classificando registros de '{importSource}'</p>
                  </div>
                </div>
              )}

              {/* Staged Records (Preview before database sync) */}
              {stagedRecords.length > 0 && (() => {
                const duplicatesCount = stagedRecords.filter((r, idx) => getStagedRecordStatus(r, idx).isDuplicate).length;
                return (
                  <div className="space-y-4 pt-4 border-t border-slate-800 animate-fadeIn">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
                          📋 Pré-Visualização de Lote Extraído ({stagedRecords.length} Ações)
                          {duplicatesCount > 0 && (
                            <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                              {duplicatesCount} duplicados detectados
                            </span>
                          )}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">Revise o resultado estruturado pelo Gemini 3.5 Flash antes de gravar no banco de dados.</p>
                      </div>
                      <div className="flex gap-2">
                        {duplicatesCount > 0 && (
                          <button 
                            onClick={handleRemoveStagedDuplicates}
                            className="bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-bold py-1.5 px-3 rounded-xl transition-all flex items-center gap-1.5 shadow"
                          >
                            🧹 Limpar Duplicados
                          </button>
                        )}
                        <button 
                          onClick={handleDiscardStaged} 
                          className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold py-1.5 px-3 rounded transition-colors"
                        >
                          Descartar
                        </button>
                        <button 
                          onClick={handleCommitStagedRecords} 
                          className="bg-blue-600 hover:bg-blue-700 text-white font-sans font-bold text-xs py-1.5 px-4 rounded-xl shadow transition-all"
                        >
                          Confirmar e Gravar no SQL Server {duplicatesCount > 0 ? "⚠️" : "⚜️"}
                        </button>
                      </div>
                    </div>

                    {duplicatesCount > 0 && (
                      <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn leading-relaxed">
                        <div className="flex items-start gap-2.5">
                          <span className="text-lg">⚠️</span>
                          <div>
                            <p className="font-bold text-amber-200">Registros Duplicados Encontrados</p>
                            <p className="text-slate-400 text-[11px] mt-0.5">
                              Existem {duplicatesCount} ações que já foram inseridas no banco de dados anteriormente ou estão repetidas dentro deste mesmo lote. 
                              Você pode remover todas automaticamente clicando no botão ao lado.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={handleRemoveStagedDuplicates}
                          className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-1.5 px-3 rounded-lg text-[11px] transition-colors shadow-sm shrink-0 self-start sm:self-center"
                        >
                          Remover {duplicatesCount} Duplicados do Lote
                        </button>
                      </div>
                    )}

                    <div className="overflow-x-auto border border-slate-800 rounded bg-slate-950/80 scrollbar-thin max-h-80">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-900 border-b border-slate-800">
                            <th className="p-3 text-slate-400 font-medium">Verificação</th>
                            <th className="p-3 text-slate-400 font-medium">Setor</th>
                            <th className="p-3 text-slate-400 font-medium">Data</th>
                            <th className="p-3 text-slate-400 font-medium">Ação do Deputado</th>
                            <th className="p-3 text-slate-400 font-medium">Cidade</th>
                            <th className="p-3 text-slate-400 font-medium">PL / Emenda</th>
                            <th className="p-3 text-slate-400 font-medium text-right">Investimento</th>
                            <th className="p-3 text-slate-400 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900">
                          {stagedRecords.map((r, idx) => {
                            const s = getSectorById(r.sector);
                            const status = getStagedRecordStatus(r, idx);
                            return (
                              <tr key={idx} className={`hover:bg-slate-900/50 transition-colors ${status.isDuplicate ? "bg-amber-950/10" : ""}`}>
                                <td className="p-3 whitespace-nowrap font-medium">
                                  {status.isDuplicate ? (
                                    <span 
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                      title={status.reason}
                                    >
                                      ⚠️ {status.reason}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                      ✓ Seguro (Novo)
                                    </span>
                                  )}
                                </td>
                                <td className="p-3 whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-blue-200">
                                    {s?.icon} {s?.name || r.sector}
                                  </span>
                                </td>
                                <td className="p-3 whitespace-nowrap text-slate-300 font-mono text-[11px]">{formatDateString(r.data)}</td>
                                <td className="p-3 max-w-xs text-slate-100 font-medium leading-relaxed">{r.deputado}</td>
                                <td className="p-3 whitespace-nowrap text-slate-300">{r.cidade || "—"}</td>
                                <td className="p-3 max-w-[120px] truncate text-slate-400 font-mono text-[10px]">
                                  {r.projetoLei ? `PL: ${r.projetoLei}` : r.emenda ? `Emenda: ${r.emenda}` : "—"}
                                </td>
                                <td className="p-3 text-right text-blue-400 font-bold whitespace-nowrap">{formatBRL(r.recursos)}</td>
                                <td className="p-3 whitespace-nowrap">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeClass(r.status)}`}>
                                    {r.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

            </motion.div>
          )}

          {/* ==========================================
              DASHBOARD PANEL (HOME)
             ========================================== */}
          {activeTab === "dashboard" && (
            <div className="space-y-8 animate-fadeIn">
              
              {/* Header Title */}
              <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                <div>
                  <h2 className="font-sans text-2xl font-black tracking-tight text-slate-900 leading-none">Diretrizes & Ações Políticas de Santa Catarina</h2>
                  <p className="text-slate-500 text-xs mt-1">Sincronizado atômico com SQL Server e alimentado pela inteligência artificial de classificação Gemini.</p>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Investimento Total Declarado</p>
                  <p className="font-sans text-3xl font-black text-blue-600 tracking-tight mt-0.5">{formatBRL(totalInvestments)}</p>
                </div>
              </div>

              {/* Bento Grid Sector Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                {SECTORS.map((s) => {
                  const count = getSectorCount(s.id);
                  const invest = getSectorInvestments(s.id);
                  return (
                    <motion.div
                      key={s.id}
                      whileHover={{ y: -2 }}
                      onClick={() => setActiveTab(s.id)}
                      className="bg-white border border-slate-200 hover:border-slate-300 p-4 rounded-xl shadow-sm cursor-pointer transition-all flex flex-col justify-between relative group overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 right-0 h-1 bg-slate-200 group-hover:bg-blue-500 transition-colors" style={{ backgroundColor: s.color }} />
                      <div className="flex justify-between items-start pt-1.5">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{s.name}</span>
                        <span className="text-xl">{s.icon}</span>
                      </div>
                      <div className="mt-4">
                        <p className="font-sans text-2xl font-black text-slate-900 leading-none">{count}</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">registro{count !== 1 ? "s" : ""}</p>
                      </div>
                      <div className="mt-3.5 pt-2 border-t border-slate-100 text-[11px] font-bold text-slate-500 group-hover:text-blue-600 truncate transition-colors">
                        {invest > 0 ? formatBRL(invest) : "Sem verbas"}
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Regional Stats Map & Recharts Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* Regional Macrodistribution Map */}
                <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-sm lg:col-span-8 flex flex-col justify-between">
                  <div>
                    <h3 className="font-sans text-base font-bold text-slate-800 flex items-center gap-2">
                      🗺️ Distribuição de Recursos por Macro-Região
                    </h3>
                    <p className="text-slate-500 text-xs mt-0.5">Visão espacial das ações políticas catalogadas no estado de SC.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-6">
                    {REGIONS.map((reg) => {
                      const regionData = regionStats[reg.id] || { count: 0, investment: 0, cities: new Set() };
                      const pct = Math.round((regionData.count / maxRegionCount) * 100) || 0;
                      return (
                        <div 
                          key={reg.id} 
                          className={`border rounded-xl p-3.5 flex flex-col justify-between transition-all ${
                            regionData.count > 0 
                              ? "bg-slate-50/50 border-slate-200 hover:border-slate-300" 
                              : "bg-slate-50/10 border-slate-100 opacity-50"
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <span className="text-lg">{reg.icon}</span>
                            {regionData.count > 0 && (
                              <span className="text-[9px] font-extrabold bg-slate-200/55 text-slate-800 py-0.5 px-1.5 rounded">
                                {pct}% peso
                              </span>
                            )}
                          </div>
                          <div className="mt-3">
                            <h4 className="text-xs font-extrabold text-slate-700 tracking-wide uppercase truncate">{reg.name}</h4>
                            <p className="font-sans text-xl font-bold text-slate-900 mt-1">{regionData.count}</p>
                            <p className="text-[10px] text-slate-400 font-semibold uppercase mt-0.5">ações catalogadas</p>
                          </div>
                          <div className="mt-3.5 pt-2 border-t border-slate-200/40 flex flex-col gap-1">
                            <span className="text-[10px] text-slate-500 font-bold">{formatBRL(regionData.investment)}</span>
                            {regionData.cities.size > 0 && (
                              <span className="text-[9px] text-slate-400 italic truncate" title={Array.from(regionData.cities).join(", ")}>
                                {Array.from(regionData.cities).slice(0, 3).join(", ")}
                                {regionData.cities.size > 3 && "..."}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {unmappedCount > 0 && (
                    <div className="mt-4 bg-slate-100/65 text-slate-500 text-[11px] p-2 rounded text-center font-medium">
                      ⚠️ {unmappedCount} registro{unmappedCount !== 1 ? "s possuem" : " possui"} cidades não mapeadas nas macro-regiões de SC (ex: geral para todo o estado).
                    </div>
                  )}
                </div>

                {/* Investment distribution representation */}
                <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-sm lg:col-span-4 flex flex-col justify-between">
                  <div>
                    <h3 className="font-sans text-base font-bold text-slate-800 flex items-center gap-1.5">
                      📊 Top Setores por Investimento
                    </h3>
                    <p className="text-slate-500 text-xs mt-0.5">Ranking financeiro das verbas de emendas ou projetos.</p>
                  </div>

                  <div className="mt-6 space-y-4">
                    {SECTORS.map((s) => ({ sector: s, value: getSectorInvestments(s.id) }))
                      .sort((a, b) => b.value - a.value)
                      .slice(0, 6)
                      .map(({ sector, value }) => {
                        const pct = totalInvestments > 0 ? (value / totalInvestments) * 100 : 0;
                        return (
                          <div key={sector.id} className="space-y-1 text-xs">
                            <div className="flex justify-between items-center text-slate-600 font-medium">
                              <span className="flex items-center gap-1.5 font-bold text-slate-700">
                                <span>{sector.icon}</span>
                                <span>{sector.name}</span>
                              </span>
                              <span>{formatBRL(value)}</span>
                            </div>
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                className="h-full rounded-full transition-all duration-500" 
                                style={{ width: `${pct}%`, backgroundColor: sector.color }} 
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-100 text-center">
                    <button 
                      onClick={() => handleExportCSV()}
                      className="text-xs text-blue-600 hover:text-blue-700 font-bold tracking-wide uppercase"
                    >
                      Exportar Relatório Completo CSV
                    </button>
                  </div>
                </div>

              </div>

              {/* Recent Activity Table */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <h3 className="font-sans text-base font-bold text-slate-900">Histórico Recente de Atividades</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Últimos registros sincronizados na base SQL Server.</p>
                  </div>
                  <span className="text-[10px] font-mono bg-slate-200/60 text-slate-600 py-1 px-2.5 rounded font-bold uppercase tracking-wider">
                    Exibindo últimos 10 de {records.length} registros
                  </span>
                </div>

                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Setor</th>
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Data</th>
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Ação do Deputado</th>
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Município</th>
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">PL / Emenda</th>
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px] text-right">Verbas</th>
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {records
                        .sort((a, b) => b.data.localeCompare(a.data))
                        .slice(0, 10)
                        .map((r) => {
                          const s = getSectorById(r.sector);
                          return (
                            <tr key={r.id} className="hover:bg-slate-50/50">
                              <td className="p-3 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                                  {s?.icon} {s?.name || r.sector}
                                </span>
                              </td>
                              <td className="p-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">{formatDateString(r.data)}</td>
                              <td className="p-3 max-w-sm text-slate-800 font-medium leading-relaxed">{r.deputado}</td>
                              <td className="p-3 whitespace-nowrap text-slate-600">{r.cidade || "—"}</td>
                              <td className="p-3 whitespace-nowrap text-slate-500 font-mono text-[10px]">
                                {r.projetoLei ? `PL: ${r.projetoLei}` : r.emenda ? `Emenda: ${r.emenda}` : "—"}
                              </td>
                              <td className="p-3 text-right text-slate-900 font-bold whitespace-nowrap">{formatBRL(r.recursos)}</td>
                              <td className="p-3 whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeClass(r.status)}`}>
                                  {r.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      {records.length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-slate-400 italic">
                            Nenhum registro encontrado. Clique em "Importar Lote (IA)" para carregar documentos políticos.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* ==========================================
              EXECUTION LOGS VIEW
             ========================================== */}
          {activeTab === "logs" && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="font-sans text-2xl font-black text-slate-900 tracking-tight">Logs de Execução do Sistema</h2>
                  <p className="text-slate-500 text-xs mt-1">Histórico completo de processamentos por inteligência artificial, sincronizações SQL e alterações no sistema.</p>
                </div>
                <button 
                  onClick={fetchData} 
                  className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold text-xs py-2 px-3.5 rounded-xl flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <RefreshCw size={13} /> Atualizar Logs
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Horário</th>
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Ação</th>
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Status</th>
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Iniciado Por</th>
                        <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Detalhamento Técnico</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {logs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/30">
                          <td className="p-3 whitespace-nowrap text-slate-500 font-mono">
                            {new Date(log.timestamp).toLocaleString("pt-BR")}
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800 font-mono uppercase">
                              {log.action}
                            </span>
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              log.status === "SUCCESS" 
                                ? "bg-emerald-50 text-emerald-800" 
                                : log.status === "ERROR" 
                                ? "bg-rose-50 text-rose-800" 
                                : "bg-blue-50 text-blue-800"
                            }`}>
                              {log.status}
                            </span>
                          </td>
                          <td className="p-3 whitespace-nowrap text-slate-600 font-medium">
                            {log.userEmail || "anonymous"}
                          </td>
                          <td className="p-3 text-slate-700 font-medium leading-relaxed max-w-md break-words">
                            {log.details}
                          </td>
                        </tr>
                      ))}
                      {logs.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-slate-400 italic">
                            Nenhum log de execução registrado ainda.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==========================================
              SECTOR GRID / TABLE TAB VIEW
             ========================================== */}
          {activeTab !== "dashboard" && activeTab !== "logs" && (() => {
            const sec = getSectorById(activeTab);
            if (!sec) return null;
            return (
              <div className="space-y-6 animate-fadeIn">
                
                {/* Sector Header Block */}
                <div className="bg-white border-t-4 border-slate-900 p-6 rounded-xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4" style={{ borderTopColor: sec.color }}>
                  <div className="flex items-center gap-4">
                    <span className="text-4xl">{sec.icon}</span>
                    <div>
                      <h2 className="font-sans text-2xl font-black text-slate-950 tracking-tight">{sec.name}</h2>
                      <p className="text-slate-500 text-xs mt-0.5">
                        {getSectorCount(sec.id)} registros catalogados · total de {formatBRL(getSectorInvestments(sec.id))} em recursos investidos.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 self-stretch sm:self-auto">
                    <button 
                      onClick={() => handleExportCSV(sec.id)}
                      className="flex-1 sm:flex-none bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold text-xs py-2 px-3.5 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Download size={13} /> Exportar CSV
                    </button>
                    <button 
                      onClick={() => handleOpenAddModal(sec.id)}
                      className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 text-white font-sans font-bold text-xs py-2 px-4 rounded-xl shadow flex items-center justify-center gap-1.5 transition-all"
                    >
                      <Plus size={14} className="text-white" /> Novo Registro
                    </button>
                  </div>
                </div>

                {/* Sub-Filters and controls bar */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-wrap gap-4 items-center">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Status</label>
                    <select 
                      value={statusFilter} 
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Todos</option>
                      <option value="Em Tramitação">Em Tramitação</option>
                      <option value="Aprovado">Aprovado</option>
                      <option value="Vetado">Vetado</option>
                      <option value="Arquivado">Arquivado</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Município / Cidade</label>
                    <input 
                      type="text" 
                      placeholder="Filtrar município..."
                      value={cityFilter}
                      onChange={(e) => setCityFilter(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:border-blue-500 w-36"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">De (Data)</label>
                    <input 
                      type="date" 
                      value={dateFromFilter}
                      onChange={(e) => setDateFromFilter(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Até (Data)</label>
                    <input 
                      type="date" 
                      value={dateToFilter}
                      onChange={(e) => setDateToFilter(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <button 
                    onClick={() => {
                      setStatusFilter("");
                      setCityFilter("");
                      setDateFromFilter("");
                      setDateToFilter("");
                    }}
                    className="mt-4 ml-auto text-xs text-slate-500 hover:text-slate-700 font-semibold"
                  >
                    Limpar Filtros
                  </button>
                </div>

                {/* Primary Records Grid/Table */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Data</th>
                          <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Ação do Deputado</th>
                          <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Município</th>
                          <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">PL / Emenda</th>
                          <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px] text-right">Verbas</th>
                          <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Status</th>
                          <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Obs.</th>
                          <th className="p-3 text-slate-500 font-bold uppercase tracking-wider text-[10px] w-20"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredList.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50/50">
                            <td className="p-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">{formatDateString(r.data)}</td>
                            <td className="p-3 max-w-sm text-slate-800 font-medium leading-relaxed">{r.deputado}</td>
                            <td className="p-3 whitespace-nowrap text-slate-600 font-semibold">{r.cidade || "—"}</td>
                            <td className="p-3 whitespace-nowrap text-slate-500 font-mono text-[10px]">
                              {r.projetoLei ? `PL: ${r.projetoLei}` : r.emenda ? `Emenda: ${r.emenda}` : "—"}
                            </td>
                            <td className="p-3 text-right text-slate-900 font-bold whitespace-nowrap">{formatBRL(r.recursos)}</td>
                            <td className="p-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeClass(r.status)}`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="p-3 max-w-[120px] truncate text-slate-500 italic" title={r.observacoes}>{r.observacoes || "—"}</td>
                            <td className="p-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 justify-end">
                                <button 
                                  onClick={() => handleOpenEditModal(r)}
                                  className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors"
                                  title="Editar"
                                >
                                  <Edit size={13} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteRecord(r.id)}
                                  className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                                  title="Excluir"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filteredList.length === 0 && (
                          <tr>
                            <td colSpan={8} className="p-12 text-center text-slate-400 italic">
                              Nenhum registro encontrado para os filtros selecionados.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            );
          })()}

        </main>
      </div>

      {/* ==========================================
          MANUAL RECORD EDITOR MODAL
         ========================================== */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-sans text-lg font-bold text-slate-900 tracking-tight">
                {modalMode === "create" ? "Criar Novo Registro Político" : "Editar Registro Político"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs scrollbar-thin">
              
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Data *</label>
                  <input 
                    type="date"
                    value={editingRecord.data || ""}
                    onChange={(e) => setEditingRecord({ ...editingRecord, data: e.target.value })}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-slate-800 outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Setor Editorial *</label>
                  <select 
                    value={editingSector}
                    onChange={(e) => setEditingSector(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-slate-800 outline-none focus:border-blue-500"
                  >
                    {SECTORS.map(s => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Ação do Deputado *</label>
                <textarea 
                  rows={4}
                  placeholder="Descreva detalhadamente a ação parlamentar, verba destinada ou andamento de autoria..."
                  value={editingRecord.deputado || ""}
                  onChange={(e) => setEditingRecord({ ...editingRecord, deputado: e.target.value })}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-slate-800 outline-none focus:border-blue-500 leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Município Beneficiado / Cidade</label>
                  <input 
                    type="text"
                    placeholder="Ex: Lages, Chapecó..."
                    value={editingRecord.cidade || ""}
                    onChange={(e) => setEditingRecord({ ...editingRecord, cidade: e.target.value })}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-slate-800 outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Status de Tramitação</label>
                  <select 
                    value={editingRecord.status || "Em Tramitação"}
                    onChange={(e) => setEditingRecord({ ...editingRecord, status: e.target.value })}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-slate-800 outline-none focus:border-blue-500"
                  >
                    <option value="Em Tramitação">Em Tramitação</option>
                    <option value="Aprovado">Aprovado</option>
                    <option value="Vetado">Vetado</option>
                    <option value="Arquivado">Arquivado</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Projeto de Lei (Opcional)</label>
                  <input 
                    type="text"
                    placeholder="Ex: PL 0234/2026"
                    value={editingRecord.projetoLei || ""}
                    onChange={(e) => setEditingRecord({ ...editingRecord, projetoLei: e.target.value })}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-slate-800 outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Emenda Parlamentar (Opcional)</label>
                  <input 
                    type="text"
                    placeholder="Ex: Emenda Impositiva 50"
                    value={editingRecord.emenda || ""}
                    onChange={(e) => setEditingRecord({ ...editingRecord, emenda: e.target.value })}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-slate-800 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Recursos / Verbas Investidas (R$)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold">R$</span>
                  <input 
                    type="number"
                    placeholder="0.00"
                    value={editingRecord.recursos || "0"}
                    onChange={(e) => setEditingRecord({ ...editingRecord, recursos: e.target.value })}
                    className="border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-slate-800 outline-none focus:border-blue-500 w-full font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Observações Adicionais</label>
                <textarea 
                  rows={2}
                  placeholder="Quaisquer outras anotações complementares..."
                  value={editingRecord.observacoes || ""}
                  onChange={(e) => setEditingRecord({ ...editingRecord, observacoes: e.target.value })}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3.5">
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="py-2 px-4 rounded-lg hover:bg-slate-200 text-slate-600 font-semibold transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveModalRecord} 
                className="bg-blue-600 hover:bg-blue-700 text-white font-sans font-bold py-2 px-6 rounded-lg shadow transition-all flex items-center gap-1.5"
              >
                <Check size={14} className="text-white" />
                <span>Salvar Registro</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ==========================================
          EMAIL / PASSWORD AUTHENTICATION MODAL
         ========================================== */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col"
          >
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <div>
                <h3 className="font-sans text-base font-bold text-slate-900 tracking-tight">
                  {authMode === "login" ? "Acessar Conta" : "Criar Nova Conta"}
                </h3>
                <p className="text-slate-500 text-[11px] mt-0.5">
                  {authMode === "login" 
                    ? "Entre com seu e-mail e senha cadastrados." 
                    : "Cadastre-se para manter seus registros seguros."}
                </p>
              </div>
              <button 
                onClick={() => { setIsAuthModalOpen(false); setAuthModalError(""); }} 
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleEmailAuth} className="p-6 space-y-4">
              {authModalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs font-medium leading-relaxed">
                  ⚠️ {authModalError}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">E-mail *</label>
                <input 
                  type="email"
                  required
                  placeholder="seu-email@gmail.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 outline-none focus:border-blue-500 text-xs transition-colors"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Senha *</label>
                <input 
                  type="password"
                  required
                  placeholder="Sua senha secreta"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 outline-none focus:border-blue-500 text-xs transition-colors"
                />
              </div>

              {/* Submit button */}
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-sans font-bold py-2.5 px-4 rounded-lg shadow transition-all flex items-center justify-center gap-2 mt-2 text-xs"
              >
                <span>{authMode === "login" ? "Entrar na Conta" : "Criar e Ativar Conta"}</span>
              </button>

              {/* Auth Mode Toggle */}
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode(authMode === "login" ? "register" : "login");
                    setAuthModalError("");
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 font-bold transition-colors"
                >
                  {authMode === "login" 
                    ? "Não tem uma conta? Cadastre-se aqui" 
                    : "Já possui uma conta? Faça login"}
                </button>
              </div>

              {/* Helpful iframe warning info */}
              <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200 text-[10px] text-slate-500 leading-relaxed">
                💡 <strong>Dica de Conexão:</strong> Como o sistema é executado dentro do ambiente seguro do AI Studio, o login padrão do Google via popup pode ser bloqueado pelo navegador. Usar login com <strong>e-mail e senha</strong> é a solução 100% garantida e rápida de conectar.
              </div>
            </form>
          </motion.div>
        </div>
      )}

    </div>
  );
}
