import type { AppSettings, Specimen } from '../types';
import { DEFAULT_SETTINGS, createBlankSpecimen, createPresetSpecimen } from '../data/defaults';
import { loadSettings, saveSettings, specimenStore } from '../data/storage';

type Listener = () => void;

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** 全局应用状态：标本列表 + 设置，最小发布订阅 */
class AppState {
  specimens: Specimen[] = [];
  settings: AppSettings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<Listener>();
  private saveTimer: number | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  async init(): Promise<void> {
    this.settings = loadSettings(DEFAULT_SETTINGS);
    const stored = await specimenStore.getAll();
    if (stored.length === 0) {
      const now = Date.now();
      this.specimens = [
        createPresetSpecimen('peacock', uid(), now),
        createPresetSpecimen('pigeon', uid(), now),
        createPresetSpecimen('sparrow', uid(), now),
      ];
      await Promise.all(this.specimens.map((s) => specimenStore.put(s)));
    } else {
      this.specimens = stored.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    this.emit();
  }

  getSpecimen(id: string): Specimen | undefined {
    return this.specimens.find((s) => s.id === id);
  }

  async addBlank(): Promise<Specimen> {
    const s = createBlankSpecimen(uid(), Date.now());
    this.specimens = [s, ...this.specimens];
    await specimenStore.put(s);
    this.emit();
    return s;
  }

  async duplicate(id: string): Promise<Specimen | null> {
    const src = this.getSpecimen(id);
    if (!src) return null;
    const now = Date.now();
    const copy: Specimen = structuredClone(src);
    copy.id = uid();
    copy.name = `${src.name}（副本）`;
    copy.createdAt = now;
    copy.updatedAt = now;
    this.specimens = [copy, ...this.specimens];
    await specimenStore.put(copy);
    this.emit();
    return copy;
  }

  async remove(id: string): Promise<void> {
    this.specimens = this.specimens.filter((s) => s.id !== id);
    await specimenStore.delete(id);
    this.emit();
  }

  /** 保存编辑（带防抖，避免滑杆拖动时频繁写 IDB） */
  async update(id: string, patch: Partial<Specimen>): Promise<void> {
    const s = this.getSpecimen(id);
    if (!s) return;
    Object.assign(s, patch, { updatedAt: Date.now() });
    this.emit();
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      specimenStore.put(s);
      this.saveTimer = null;
    }, 300);
  }

  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await Promise.all(this.specimens.map((s) => specimenStore.put(s)));
  }

  async importSpecimens(imported: Specimen[]): Promise<number> {
    let added = 0;
    for (const raw of imported) {
      const s: Specimen = structuredClone(raw);
      // 避免 id 冲突
      if (this.getSpecimen(s.id)) s.id = uid();
      s.updatedAt = Date.now();
      this.specimens = [s, ...this.specimens];
      await specimenStore.put(s);
      added++;
    }
    this.emit();
    return added;
  }

  updateSettings(patch: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.emit();
  }
}

export const appState = new AppState();
