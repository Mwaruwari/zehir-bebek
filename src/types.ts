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
  presentationImages?: PresentationImage[];
  verbalLanguage?: VerbalLanguage;
  verbalLanguageHistory?: VerbalLanguage[];
  sozselDilVersiyonlari?: VerbalLanguage[];
  technicalDrawings?: TechnicalDrawing[];
  placedProps?: PlacedProp[];
  styleLibrary?: StyleReference[];
  productionPlanSummary?: {
    materialList: { item: string; qty: string; notes: string }[];
    jobSequence: string[];
    createdAt: string;
  };
  productionPlanDetailed?: {
    materialList: { item: string; spec: string; qty: string; costEstimate?: string }[];
    durationEstimate: string;
    jobSequence: { step: string; phase: string; duration: string; team: string; steps: string[] }[];
    teamRequirements: string[];
    createdAt: string;
  };
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

export interface PresentationImage {
  id: string;
  name: string;
  data: string;
  sceneId: string; // empty or scene ID
  order: number;
  title: string;
  description: string;
}

export interface VerbalLanguage {
  headline: string;
  narrative: string;
  createdAt?: string;
}

export interface TechnicalDrawing {
  id: string;
  title: string;
  uploadedAt: string;
  image: string;
  style: 'reference' | 'simple' | 'scaled' | 'labeled';
  materialNotes: string[];
  scale: string;
  approved: boolean;
  notes?: string;
}

export interface PlacedProp {
  id: string;
  propId: string;
  name: string;
  x: number; // percent
  y: number; // percent
  widthPercent: number;
  lengthPercent: number;
}

export interface StyleReference {
  id: string;
  name: string;
  image: string;
  uploadedAt: string;
}

export interface ServerLog {
  timestamp: string;
  level: 'info' | 'error';
  message: string;
}
