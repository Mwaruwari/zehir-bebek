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

/** Öğe tablosundaki "Tür" sütunu. Boş = henüz doldurulmadı (analiz tahmin etmez). */
export type OgeTur = '' | 'Aksesuar' | 'Dekor' | 'Mobilya' | 'Kostüm aksesuarı';
export const OGE_TUR_SECENEKLERI: Exclude<OgeTur, ''>[] = [
  'Aksesuar', 'Dekor', 'Mobilya', 'Kostüm aksesuarı'
];

/** Öğe tablosundaki "Kaynak" sütunu. Boş = henüz karar verilmedi (analiz tahmin etmez). */
export type OgeKaynak = '' | 'Satın al' | 'Üret' | 'Kirala/Ödünç' | 'Depodan';
export const OGE_KAYNAK_SECENEKLERI: Exclude<OgeKaynak, ''>[] = [
  'Satın al', 'Üret', 'Kirala/Ödünç', 'Depodan'
];

export type AnlamTasiyor = '' | 'Evet' | 'Hayır';
export type TasarimKarari = '' | 'Bekliyor' | 'Verildi';

/**
 * Bir dekor/aksesuar öğesi. Dışa aktarım sütun sırası:
 * No | Öğe | Tür | Sahneler | Metinden alıntı | Kaynak | Adet | Ölçü (cm) |
 * Anlam taşıyor | Tasarım kararı
 * ("No" satır sırasından üretilir, saklanmaz.)
 */
export interface Aksesuar {
  id: string;
  /** Öğe */
  ad: string;
  /** Tür — analiz tahmin etmez, kullanıcı doldurur */
  tur: OgeTur;
  /** Sahneler */
  kullanildigiSahneler?: string[];
  /** Metinden alıntı */
  kaynakAlinti: string;
  /** Kaynak — analiz tahmin etmez, kullanıcı doldurur */
  kaynak: OgeKaynak;
  /** Adet — analiz tahmin etmez, kullanıcı doldurur */
  adet?: string;
  /** Ölçü (cm) — analiz tahmin etmez, kullanıcı doldurur */
  olcu?: string;
  /** Anlam taşıyor — kabul edilen sembole bağlanırsa otomatik "Evet" olur */
  anlamTasiyor?: AnlamTasiyor;
  /** Tasarım kararı — analiz tahmin etmez, kullanıcı doldurur */
  tasarimKarari?: TasarimKarari;
  /** Eski sürümlerden kalan kullanım notu. Yeni analizlerde üretilmez, tabloda gösterilmez. */
  aciklama?: string;
  /** Kullanıcı bu satıra elle dokunduysa true. Yeniden çalıştırma bu satırı ezmez. */
  elleDuzenlendi?: boolean;
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
