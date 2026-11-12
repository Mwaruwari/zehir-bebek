import { Project } from '../types';

/**
 * Browser-side safety net for project data.
 *
 * The server persists projects to src/data/projects.json, but the app runs on
 * Cloud Run, whose filesystem is ephemeral: every container restart (idle
 * scale-to-zero, redeploy, dev-server reload) resets that file to whatever is
 * committed in the repo. Anything written since then — including the server's
 * own backups/ folder, which lives in the same place — is gone.
 *
 * This module keeps an independent mirror in IndexedDB, on the user's own
 * machine, so a server-side reset is recoverable.
 *
 * IndexedDB rather than localStorage on purpose: a single project carries the
 * full script text plus base64 décor images and technical drawings, which
 * routinely exceeds localStorage's ~5 MB ceiling.
 */

const DB_NAME = 'zehir-bebek';
const DB_VERSION = 1;
const STORE_NAME = 'backups';
const BACKUP_KEY = 'projects';

export interface LocalBackup {
  projects: Project[];
  savedAt: string;
}

function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB açılamadı'));
    request.onblocked = () => reject(new Error('IndexedDB başka bir sekme tarafından kilitlenmiş'));
  });
}

/**
 * Mirrors the given projects into IndexedDB.
 *
 * Never throws: a failed local backup must not break the app or mask the
 * (successful) server save it follows.
 */
export async function saveLocalBackup(projects: Project[]): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;

  try {
    const db = await openDatabase();
    const payload: LocalBackup = {
      projects,
      savedAt: new Date().toISOString(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(payload, BACKUP_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Yerel yedek yazılamadı'));
      tx.onabort = () => reject(tx.error ?? new Error('Yerel yedek işlemi iptal edildi'));
    });

    db.close();
    return true;
  } catch (err) {
    console.warn('Yerel yedek kaydedilemedi:', err);
    return false;
  }
}

/** Reads the mirrored projects, or null when there is no usable backup. */
export async function loadLocalBackup(): Promise<LocalBackup | null> {
  if (!isIndexedDbAvailable()) return null;

  try {
    const db = await openDatabase();
    const result = await new Promise<LocalBackup | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(BACKUP_KEY);
      req.onsuccess = () => resolve(req.result as LocalBackup | undefined);
      req.onerror = () => reject(req.error ?? new Error('Yerel yedek okunamadı'));
    });

    db.close();

    if (!result || !Array.isArray(result.projects)) return null;
    return result;
  } catch (err) {
    console.warn('Yerel yedek okunamadı:', err);
    return null;
  }
}

export interface RecoveryAssessment {
  /** Projects present in the local mirror but missing from the server. */
  missingProjects: Project[];
  /** True when the server lost everything — an unambiguous reset. */
  serverIsEmpty: boolean;
}

/**
 * Compares the server's list against the local mirror.
 *
 * Only reports projects the server does not have. A project the user genuinely
 * deleted is also removed from the mirror at delete time, so it will not be
 * resurrected here.
 */
export function assessRecovery(
  serverProjects: Project[],
  backup: LocalBackup | null
): RecoveryAssessment {
  if (!backup || backup.projects.length === 0) {
    return { missingProjects: [], serverIsEmpty: serverProjects.length === 0 };
  }

  const serverIds = new Set(serverProjects.map(p => p.id));
  const missingProjects = backup.projects.filter(p => !serverIds.has(p.id));

  return {
    missingProjects,
    serverIsEmpty: serverProjects.length === 0 && backup.projects.length > 0,
  };
}
