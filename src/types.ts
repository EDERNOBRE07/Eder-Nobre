export interface Record {
  id: string;
  sector: string; // 'educacao', 'saude', etc.
  data: string; // YYYY-MM-DD
  deputado: string;
  cidade: string;
  projetoLei?: string;
  emenda?: string;
  recursos?: string; // numeric as string, e.g. "1500000.00"
  status: string; // 'Em Tramitação', 'Aprovado', 'Vetado', 'Arquivado'
  observacoes?: string;
}

export interface ExecutionLog {
  id: number;
  timestamp: string;
  action: string;
  status: string;
  details?: string;
  userEmail?: string;
}

export interface Sector {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface Region {
  id: string;
  name: string;
  color: string;
  icon: string;
}
