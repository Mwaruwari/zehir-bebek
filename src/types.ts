export interface Mekan {
  id: string;
  ad: string;
  tip: 'iç' | 'dış' | 'bilinmiyor';
  donem: string;
  atmosfer: string;
  kaynakAlinti?: string;
  changed?: 'added' | 'removed' | null;
}

export interface Gecis {
  id: string;
  sahneNo: string;
  mekanAd: string;
  not: string;
  changed?: 'added' | 'removed' | null;
}

export interface Olay {
  id: string;
  sahneNo: string;
  olay: string;
  hareketPotansiyeli: string;
  kaynakAlinti?: string;
  changed?: 'added' | 'removed' | null;
}

export interface Aksesuar {
  id: string;
  ad: string;
  kategori: 'dekor' | 'aksesuar';
  kaynakAlinti: string;
  aciklama: string;
  status?: 'Satın Alınacak' | 'Üretilecek' | '';
  kullanildigiSahneler?: string[];
  changed?: 'added' | 'removed' | null;
}

export interface Scene {
  id: string;
  name: string;
  content: string;
}

export interface SceneBoundary {
  name: string;
  startIdx: number;
  endIdx: number;
  approved: boolean;
}

export interface SceneAnalysis {
  mekanlar: Mekan[];
  gecisler: Gecis[];
  olaylar: Olay[];
  aksesuarlar: Aksesuar[];
  debug?: any;
}

export interface Project {
  id: string;
  name: string;
  width: number;
  length: number;
  height: number;
  sahne?: string;
  kurum?: string;
  createdAt: string;
  scriptText?: string;
  scenes?: Scene[];
  sceneBoundaries?: SceneBoundary[];
  analysis?: SceneAnalysis;
  movementEmotionData?: {
    sceneId: string;
    sceneName: string;
    movement: number;
    emotion: number;
    justification: string;
  }[];
  movementEmotionInstruction?: string;
  isProse?: boolean;
  narrativeBeats?: { name: string; description: string; startPercentage: number; endPercentage: number }[];
  symbolicAnalysis?: {
    object: string;
    occurrence: string;
    meaning: string;
    visualLanguage: string;
  }[];
  symbolicMetaphors?: string[];
  symbolicInstruction?: string;
}

export interface ServerLog {
  timestamp: string;
  level: 'info' | 'error';
  message: string;
}
