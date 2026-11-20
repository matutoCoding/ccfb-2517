import { appState } from '../../state/appState';
import { router, toast } from '../router';
import { getSharedAdapter } from '../widgets';
import { Viewport } from '../../render/Viewport';
import { QUALITY_SCALE } from '../../data/defaults';

export function renderDisplayPage(container: HTMLElement, params: URLSearchParams): () => void {
  let currentId = params.get('id') ?? appState.specimens[0]?.id;
  let viewport: Viewport | null = null;
  let disposed = false;

  container.innerHTML = `
    <div class="page">
      <div class="display-layout">
        <div class="display-toolbar">
          <label style="color:var(--fg-dim)">选择标本</label>
          <select id="spec-select" style="min-width:220px"></select>
          <label class="switch"><input type="checkbox" id="auto-rotate"/> <span>自动旋转</span></label>
          <button class="teal" id="shot">📷 截图（含名称与参数）</button>
          <button id="go-edit">编辑此标本</button>
          <div class="spacer" style="flex:1"></div>
          <span class="sync-badge" id="perf-badge"></span>
        </div>
        <div class="display-stage" id="stage">
          <div class="empty-state">正在初始化 WebGPU 渲染器…</div>
        </div>
      </div>
    </div>
  `;
  const stage = container.querySelector('#stage') as HTMLElement;
  const select = container.querySelector('#spec-select') as HTMLSelectElement;
  const autoRot = container.querySelector('#auto-rotate') as HTMLInputElement;
  const perfBadge = container.querySelector('#perf-badge') as HTMLElement;

  function fillSelect(): void {
    select.innerHTML = '';
    if (appState.specimens.length === 0) {
      select.innerHTML = '<option>（标本库为空）</option>';
      return;
    }
    appState.specimens.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      opt.selected = s.id === currentId;
      select.appendChild(opt);
    });
  }
  fillSelect();
  autoRot.checked = appState.settings.autoRotate;

  getSharedAdapter()
    .then(async (adapter) => {
      if (disposed || appState.specimens.length === 0) return;
      const spec = structuredClone(appState.getSpecimen(currentId!) ?? appState.specimens[0]);
      currentId = spec.id;
      select.value = currentId;
      stage.innerHTML = '';
      viewport = await Viewport.create(stage, adapter, spec, appState.settings, {
        showFps: appState.settings.showFps,
        autoRotate: autoRot.checked,
        dprCap: QUALITY_SCALE[appState.settings.quality].dpr,
      });
      const hint = document.createElement('div');
      hint.className = 'viewport-hint';
      hint.textContent = '拖拽旋转 · 滚轮缩放';
      stage.appendChild(hint);
      const tick = window.setInterval(() => {
        if (disposed) return window.clearInterval(tick);
        const fps = viewport?.getFps() ?? 0;
        if (fps > 0) perfBadge.textContent = `当前 ${fps} FPS · 目标 ≥45`;
      }, 700);
    })
    .catch((err) => {
      stage.innerHTML = `<div class="empty-state">渲染器初始化失败：${err.message}</div>`;
    });

  select.addEventListener('change', () => {
    currentId = select.value;
    const s = appState.getSpecimen(currentId);
    if (s) viewport?.updateSpecimen(structuredClone(s), true);
  });
  autoRot.addEventListener('change', () => {
    viewport?.setAutoRotate(autoRot.checked);
    appState.updateSettings({ autoRotate: autoRot.checked });
  });
  container.querySelector('#shot')!.addEventListener('click', () => {
    viewport?.screenshot().then(() => toast('截图已保存')).catch((e) => toast(`截图失败：${e.message}`, 'error'));
  });
  container.querySelector('#go-edit')!.addEventListener('click', () => {
    if (currentId) router.navigate(`/editor?id=${currentId}`);
  });

  const unsub = appState.subscribe(() => {
    const existed = appState.getSpecimen(currentId!);
    fillSelect();
    if (existed) {
      select.value = currentId!;
      viewport?.updateSpecimen(structuredClone(existed), true);
    }
  });

  return () => {
    disposed = true;
    unsub();
    viewport?.destroy();
  };
}
