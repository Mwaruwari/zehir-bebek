import {
  Project,
  Aksesuar,
  OgeTur,
  OgeKaynak,
  AnlamTasiyor,
  TasarimKarari,
  OGE_TUR_SECENEKLERI,
  OGE_KAYNAK_SECENEKLERI
} from '../types';

/**
 * Eski öğe şemasını yeni 10 sütunlu şemaya taşır.
 *
 * Eski -> yeni eşleme:
 *   kategori: 'dekor'    -> tur: 'Dekor'
 *   kategori: 'aksesuar' -> tur: 'Aksesuar'
 *   status: 'Satın Alınacak' -> kaynak: 'Satın al'
 *   status: 'Üretilecek'     -> kaynak: 'Üret'
 *
 * Yeni alanlar (Adet, Ölçü, Tasarım kararı) boş gelir; analiz bunları
 * tahmin etmez, kullanıcı doldurur.
 *
 * Bu fonksiyon asla hata atmaz; tanımadığı değeri boş bırakır.
 */

const TUR_ESLEME: Record<string, OgeTur> = {
  'dekor': 'Dekor',
  'aksesuar': 'Aksesuar',
  'mobilya': 'Mobilya',
  'kostüm aksesuarı': 'Kostüm aksesuarı',
  'kostum aksesuari': 'Kostüm aksesuarı'
};

const KAYNAK_ESLEME: Record<string, OgeKaynak> = {
  'satın alınacak': 'Satın al',
  'satin alinacak': 'Satın al',
  'satın al': 'Satın al',
  'üretilecek': 'Üret',
  'uretilecek': 'Üret',
  'üret': 'Üret',
  'kirala/ödünç': 'Kirala/Ödünç',
  'kirala': 'Kirala/Ödünç',
  'ödünç': 'Kirala/Ödünç',
  'depodan': 'Depodan'
};

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

export function migrateAksesuar(raw: any): Aksesuar {
  const item = raw && typeof raw === 'object' ? raw : {};

  // Tür: yeni alan varsa ve geçerliyse onu kullan, yoksa eski kategoriden türet
  let tur: OgeTur = '';
  if (OGE_TUR_SECENEKLERI.includes(item.tur)) {
    tur = item.tur;
  } else {
    tur = TUR_ESLEME[normalize(item.tur) || normalize(item.kategori)] || '';
  }

  // Kaynak: yeni alan varsa onu kullan, yoksa eski status'tan türet
  let kaynak: OgeKaynak = '';
  if (OGE_KAYNAK_SECENEKLERI.includes(item.kaynak)) {
    kaynak = item.kaynak;
  } else {
    kaynak = KAYNAK_ESLEME[normalize(item.kaynak) || normalize(item.status)] || '';
  }

  const anlamTasiyor: AnlamTasiyor =
    item.anlamTasiyor === 'Evet' || item.anlamTasiyor === 'Hayır' ? item.anlamTasiyor : '';

  const tasarimKarari: TasarimKarari =
    item.tasarimKarari === 'Verildi' || item.tasarimKarari === 'Bekliyor' ? item.tasarimKarari : '';

  const migrated: Aksesuar = {
    id: asString(item.id) || Math.random().toString(36).substring(2, 9),
    ad: asString(item.ad),
    tur,
    kullanildigiSahneler: Array.isArray(item.kullanildigiSahneler)
      ? item.kullanildigiSahneler.filter((s: unknown) => typeof s === 'string')
      : [],
    kaynakAlinti: asString(item.kaynakAlinti),
    kaynak,
    adet: asString(item.adet),
    olcu: asString(item.olcu),
    anlamTasiyor,
    tasarimKarari
  };

  // Eski kullanım notunu silmiyoruz; tabloda gösterilmez ama veri kaybolmaz.
  const aciklama = asString(item.aciklama);
  if (aciklama) migrated.aciklama = aciklama;

  if (item.changed === 'added' || item.changed === 'removed') {
    migrated.changed = item.changed;
  }

  return migrated;
}

/** Bir projedeki öğe listesini yeni şemaya taşır. Hata durumunda projeyi olduğu gibi döndürür. */
export function migrateProject(project: Project): Project {
  try {
    const list = (project as any)?.analysis?.aksesuarlar;
    if (!Array.isArray(list) || list.length === 0) return project;

    return {
      ...project,
      analysis: {
        ...project.analysis!,
        aksesuarlar: list.map(migrateAksesuar)
      }
    };
  } catch {
    return project;
  }
}

export function migrateProjects(projects: Project[]): Project[] {
  if (!Array.isArray(projects)) return [];
  return projects.map(migrateProject);
}
