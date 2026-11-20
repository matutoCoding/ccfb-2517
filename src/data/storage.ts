import type { Specimen } from '../types';

const DB_NAME = 'feather-specimen-db';
const DB_VERSION = 1;
const STORE = 'specimens';

/** IndexedDB 封装：标本持久化到浏览器 */
class SpecimenStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const t = db.transaction(STORE, mode);
          const req = fn(t.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
    );
  }

  async getAll(): Promise<Specimen[]> {
    return this.tx('readonly', (s) => s.getAll() as IDBRequest<Specimen[]>);
  }

  async put(specimen: Specimen): Promise<void> {
    await this.tx('readwrite', (s) => s.put(specimen));
  }

  async delete(id: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(id));
  }

  async clear(): Promise<void> {
    await this.tx('readwrite', (s) => s.clear());
  }
}

export const specimenStore = new SpecimenStore();

const SETTINGS_KEY = 'feather-specimen-settings';

export function loadSettings<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: unknown): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 存储不可用时静默降级 */
  }
}

/** 导出标本为 JSON 文件下载 */
export function exportSpecimens(specimens: Specimen[]): void {
  const payload = {
    format: 'feather-specimen',
    version: 1,
    exportedAt: new Date().toISOString(),
    specimens,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `feather-specimens-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 解析导入文件，校验并返回标本数组 */
export async function parseImportFile(file: File): Promise<Specimen[]> {
  const text = await file.text();
  const data = JSON.parse(text);
  const list: unknown[] = Array.isArray(data) ? data : data?.specimens;
  if (!Array.isArray(list)) throw new Error('文件格式不正确：缺少 specimens 数组');
  const valid: Specimen[] = [];
  for (const item of list) {
    const s = item as Partial<Specimen>;
    if (!s || typeof s.id !== 'string' || !s.regions || !s.proportions) {
      throw new Error('文件中存在缺少必要字段的标本记录');
    }
    valid.push(s as Specimen);
  }
  return valid;
}
