import { Aksesuar } from '../types';

/**
 * Analizin asla doldurmadığı, yalnızca tasarımcının elle girdiği alanlar.
 * Yeniden çalıştırma bu alanları ezmemeli.
 */
export const ELLE_DOLDURULAN_ALANLAR = [
  'tur',
  'kaynak',
  'adet',
  'olcu',
  'anlamTasiyor',
  'tasarimKarari'
] as const;

export type ElleDoldurulanAlan = typeof ELLE_DOLDURULAN_ALANLAR[number];

function normalizeAd(ad: unknown): string {
  return typeof ad === 'string' ? ad.trim().toLocaleLowerCase('tr-TR') : '';
}

function hasValue(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;
}

/** Bir öğeye elle dokunulmuş mu? Ya işaretli, ya da elle doldurulan bir alanı dolu. */
export function isManuallyEdited(item: Aksesuar): boolean {
  if (!item) return false;
  if (item.elleDuzenlendi) return true;
  return ELLE_DOLDURULAN_ALANLAR.some(field => hasValue(item[field]));
}

/** Listede elle dokunulmuş kaç öğe var? Uyarı metninde kullanılır. */
export function countManuallyEdited(items: Aksesuar[] | undefined): number {
  if (!Array.isArray(items)) return 0;
  return items.filter(isManuallyEdited).length;
}

/**
 * Yeni analiz sonucunu, kullanıcının elle girdiği alanları koruyarak birleştirir.
 *
 * Eşleme öğe adı üzerinden yapılır (büyük/küçük harf ve baştaki-sondaki boşluk
 * önemsiz, Türkçe harfler doğru küçültülür). Analizden gelen bir alan boşsa ve
 * eski kayıtta doluysa, eski değer korunur. Analiz zaten bu alanları
 * doldurmuyor, bu yüzden pratikte eski değerler her zaman kazanır.
 *
 * Eski listede olup yeni analizde hiç çıkmayan ama elle düzenlenmiş öğeler
 * listenin sonuna eklenir: kullanıcının emek verdiği bir satır, analizin onu
 * bu kez bulamaması yüzünden kaybolmamalı.
 */
export function preserveManualFields(
  incoming: Aksesuar[],
  existing: Aksesuar[] | undefined
): Aksesuar[] {
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const existingList = Array.isArray(existing) ? existing : [];
  if (existingList.length === 0) return incomingList;

  const byName = new Map<string, Aksesuar>();
  for (const item of existingList) {
    const key = normalizeAd(item?.ad);
    if (key && !byName.has(key)) byName.set(key, item);
  }

  const matchedKeys = new Set<string>();

  const merged = incomingList.map(item => {
    const key = normalizeAd(item?.ad);
    const old = key ? byName.get(key) : undefined;
    if (!old) return item;

    matchedKeys.add(key);
    const result: Aksesuar = { ...item };

    for (const field of ELLE_DOLDURULAN_ALANLAR) {
      if (!hasValue(result[field]) && hasValue(old[field])) {
        (result as any)[field] = old[field];
      }
    }

    // Eski kullanım notunu da koru
    if (!hasValue(result.aciklama) && hasValue(old.aciklama)) {
      result.aciklama = old.aciklama;
    }

    if (old.elleDuzenlendi) result.elleDuzenlendi = true;

    return result;
  });

  // Analizin bu kez bulamadığı, elle düzenlenmiş öğeleri kaybetme
  const orphans = existingList.filter(item => {
    const key = normalizeAd(item?.ad);
    return key && !matchedKeys.has(key) && isManuallyEdited(item);
  });

  return [...merged, ...orphans];
}
