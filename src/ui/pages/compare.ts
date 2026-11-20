import type { Specimen } from '../../types';
import { appState } from '../../state/appState';
import { getSharedAdapter } from '../widgets';
import { Viewport } from '../../render/Viewport';
import { QUALITY_SCALE } from '../../data/defaults';

export function renderComparePage(container: HTMLElement): () => void {
  const ids = appState.specimens.map((s) => s.id);
  let leftId = ids[0];
  let rightId = ids[1] ?? ids[0];
  let vpLeft: Viewport | null = null;
  let vpRight: Viewport | null = null;
  let syncing = false;
  let disposed = false;

  container.innerHTML = `
    <div class="page">
      <div class="compare-layout">
        <div class="compare-selectors">
          <div class="pair">
            <label style="color:var(--fg-dim)">标本 A</label>
            <select id="sel-left" style="min-width:200px"></select>
          </div>
          <div class="pair">
            <label style="color:var(--fg-dim)">标本 B</label>
            <select id="sel-right" style="min-width:200px"></select>
          </div>
          <span class="sync-badge">🔗 同步转动已开启：拖动任一视口，两者姿态保持一致</span>
        </div>
        <div class="compare-grid">
          <div class="compare-cell" id="cell-left"><div class="empty-state">初始化中…</div></div>
          <div class="compare-cell" id="cell-right"><div class="empty-state">初始化中…</div></div>
        </div>
      </div>
    </div>
  `;
  const cellLeft = container.querySelector('#cell-left') as HTMLElement;
  const cellRight = container.querySelector('#cell-right') as HTMLElement;
  const selLeft = container.querySelector('#sel-left') as HTMLSelectElement;
  const selRight = container.querySelector('#sel-right') as HTMLSelectElement;

  function fillSelects(): void {
    [selLeft, selRight].forEach((sel, idx) => {
      const cur = idx === 0 ? leftId : rightId;
      sel.innerHTML = '';
      appState.specimens.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        opt.selected = s.id === cur;
        sel.appendChild(opt);
      });
    });
  }
  fillSelects();

  function label(cell: HTMLElement, text: string): void {
    const old = cell.querySelector('.cell-label');
    old?.remove();
    const el = document.createElement('div');
    el.className = 'cell-label';
    el.textContent = text;
    cell.prepend(el);
  }

  async function init(): Promise<void> {
    if (appState.specimens.length === 0) {
      cellLeft.innerHTML = '<div class="empty-state">标本库为空，请先创建标本</div>';
      cellRight.innerHTML = '<div class="empty-state">标本库为空，请先创建标本</div>';
      return;
    }
    const adapter = await getSharedAdapter();
    if (disposed) return;
    const dpr = Math.min(QUALITY_SCALE[appState.settings.quality].dpr, 1.5); // 双视口保护帧率
    const opts = { showFps: appState.settings.showFps, autoRotate: false, dprCap: dpr };

    const specL: Specimen = structuredClone(appState.getSpecimen(leftId)!);
    cellLeft.innerHTML = '';
    vpLeft = await Viewport.create(cellLeft, adapter, specL, appState.settings, opts);
    label(cellLeft, specL.name);

    const specR: Specimen = structuredClone(appState.getSpecimen(rightId)!);
    cellRight.innerHTML = '';
    vpRight = await Viewport.create(cellRight, adapter, specR, appState.settings, opts);
    // 初始姿态对齐
    vpRight.controls.syncFrom(vpLeft.controls.state);
    label(cellRight, specR.name);

    // 同步转动：任一视口姿态变化驱动另一个
    const link = (source: Viewport, target: Viewport) =>
      source.controls.onChange(() => {
        if (syncing) return;
        syncing = true;
        target.controls.syncFrom(source.controls.state);
        syncing = false;
      });
    link(vpLeft, vpRight);
    link(vpRight, vpLeft);
  }

  init().catch((err) => {
    cellLeft.innerHTML = `<div class="empty-state">初始化失败：${err.message}</div>`;
  });

  selLeft.addEventListener('change', () => {
    leftId = selLeft.value;
    const s = appState.getSpecimen(leftId);
    if (s && vpLeft) {
      vpLeft.updateSpecimen(structuredClone(s), true);
      label(cellLeft, s.name);
    }
  });
  selRight.addEventListener('change', () => {
    rightId = selRight.value;
    const s = appState.getSpecimen(rightId);
    if (s && vpRight) {
      vpRight.updateSpecimen(structuredClone(s), true);
      label(cellRight, s.name);
    }
  });

  const unsub = appState.subscribe(() => fillSelects());

  return () => {
    disposed = true;
    unsub();
    vpLeft?.destroy();
    vpRight?.destroy();
  };
}
