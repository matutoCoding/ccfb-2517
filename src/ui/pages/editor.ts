import type { RegionId, Specimen } from '../../types';
import { appState } from '../../state/appState';
import { REGION_IDS, REGION_LABELS } from '../../data/defaults';
import { router, toast } from '../router';
import { colorRow, sliderRow, switchRow, getSharedAdapter } from '../widgets';
import { Viewport } from '../../render/Viewport';
import { QUALITY_SCALE } from '../../data/defaults';
import { clamp } from '../../core/math';

export function renderEditorPage(container: HTMLElement, params: URLSearchParams): () => void {
  let currentId = params.get('id') ?? appState.specimens[0]?.id;
  let viewport: Viewport | null = null;
  let activeRegion: RegionId = 'neck';
  let saveTimer = 0;
  let disposed = false;

  container.innerHTML = `
    <div class="page">
      <div class="editor-layout">
        <aside class="editor-side" id="side"></aside>
        <section class="editor-view" id="stage">
          <div class="empty-state">正在初始化 WebGPU 渲染器…</div>
        </div>
      </div>
    </div>
  `;
  const side = container.querySelector('#side') as HTMLElement;
  const stage = container.querySelector('#stage') as HTMLElement;

  const getSpec = (): Specimen | undefined => appState.getSpecimen(currentId!);

  /** 防抖保存 + 刷新预览 */
  function scheduleUpdate(rebuildGeometry: boolean): void {
    const s = getSpec();
    if (!s) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      if (disposed) return;
      appState.update(s.id, { regions: structuredClone(s.regions), proportions: { ...s.proportions } });
      viewport?.updateSpecimen(structuredClone(s), rebuildGeometry);
    }, 120);
  }

  function renderSide(): void {
    const s = getSpec();
    side.innerHTML = '';
    if (!s) {
      side.innerHTML = '<div class="empty-state">请先在标本库新建标本。</div>';
      return;
    }

    // ---- 标本选择与元数据 ----
    const meta = document.createElement('div');
    meta.className = 'section';
    meta.innerHTML = '<h3>标本信息</h3>';
    const select = document.createElement('select');
    select.style.marginBottom = '10px';
    appState.specimens.forEach((sp) => {
      const opt = document.createElement('option');
      opt.value = sp.id;
      opt.textContent = sp.name;
      opt.selected = sp.id === s.id;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      currentId = select.value;
      activeRegion = 'neck';
      const sp = getSpec()!;
      viewport?.updateSpecimen(structuredClone(sp), true);
      renderSide();
    });
    const nameInput = document.createElement('input');
    nameInput.placeholder = '标本名称';
    nameInput.value = s.name;
    nameInput.style.width = '100%';
    nameInput.style.marginBottom = '8px';
    nameInput.addEventListener('change', () => {
      appState.update(s.id, { name: nameInput.value || '未命名标本' });
    });
    const speciesInput = document.createElement('input');
    speciesInput.placeholder = '拉丁学名';
    speciesInput.value = s.species;
    speciesInput.style.width = '100%';
    speciesInput.style.marginBottom = '8px';
    speciesInput.addEventListener('change', () => appState.update(s.id, { species: speciesInput.value }));
    const descInput = document.createElement('textarea');
    descInput.placeholder = '标本描述';
    descInput.rows = 2;
    descInput.style.width = '100%';
    descInput.value = s.description;
    descInput.addEventListener('change', () => appState.update(s.id, { description: descInput.value }));
    meta.append(select, nameInput, speciesInput, descInput);
    side.appendChild(meta);

    // ---- 鸟体比例 ----
    const propSec = document.createElement('div');
    propSec.className = 'section';
    propSec.innerHTML = '<h3>鸟体程序生成 · 比例</h3>';
    const p = s.proportions;
    propSec.append(
      sliderRow('头部比例', p.headRatio, 0.5, 1.8, 0.01, (v) => { p.headRatio = v; scheduleUpdate(true); }),
      sliderRow('身体比例', p.bodyRatio, 0.6, 1.6, 0.01, (v) => { p.bodyRatio = v; scheduleUpdate(true); }),
      sliderRow('翅膀比例', p.wingRatio, 0.5, 1.8, 0.01, (v) => { p.wingRatio = v; scheduleUpdate(true); }),
      sliderRow('尾羽比例', p.tailRatio, 0.4, 2.0, 0.01, (v) => { p.tailRatio = v; scheduleUpdate(true); }),
      sliderRow('翅膀展开', p.wingSpread, 0, 1, 0.01, (v) => { p.wingSpread = v; scheduleUpdate(false); }, (v) => `${Math.round(v * 100)}%`),
    );
    side.appendChild(propSec);

    // ---- 部位页签 ----
    const tabSec = document.createElement('div');
    tabSec.className = 'section';
    tabSec.innerHTML = '<h3>羽毛分区编辑</h3>';
    const tabs = document.createElement('div');
    tabs.className = 'region-tabs';
    REGION_IDS.forEach((rid) => {
      const btn = document.createElement('button');
      btn.textContent = REGION_LABELS[rid];
      btn.classList.toggle('active', rid === activeRegion);
      btn.addEventListener('click', () => {
        activeRegion = rid;
        renderSide();
      });
      tabs.appendChild(btn);
    });
    tabSec.appendChild(tabs);

    const rp = s.regions[activeRegion];
    tabSec.append(
      sliderRow('羽毛数量', rp.count, 0, 3000, 20, (v) => { rp.count = v; scheduleUpdate(true); }, (v) => String(Math.round(v))),
      sliderRow('单侧羽枝数', rp.barbs, 6, 48, 1, (v) => { rp.barbs = Math.round(v); scheduleUpdate(true); }, (v) => String(Math.round(v))),
      sliderRow('羽毛长度', rp.length, 0.04, 1.2, 0.01, (v) => { rp.length = v; scheduleUpdate(false); }),
      sliderRow('羽片宽度比', rp.width, 0.08, 1.0, 0.01, (v) => { rp.width = v; scheduleUpdate(true); }),
      sliderRow('密度/叠压', rp.density, 0, 1, 0.01, (v) => { rp.density = v; scheduleUpdate(false); }, (v) => `${Math.round(v * 100)}%`),
      sliderRow('各向异性高光', rp.anisotropy, 0, 1, 0.01, (v) => { rp.anisotropy = v; scheduleUpdate(false); }, (v) => `${Math.round(v * 100)}%`),
    );
    const colors = document.createElement('div');
    colors.append(
      colorRow('色素基色', rp.color, (hex) => { rp.color = hex; scheduleUpdate(false); }),
      colorRow('羽尖颜色', rp.tipColor, (hex) => { rp.tipColor = hex; scheduleUpdate(false); }),
    );
    tabSec.appendChild(colors);

    // ---- 结构色（薄层干涉） ----
    const sc = rp.structural;
    const box = document.createElement('div');
    box.className = 'struct-box';
    box.append(switchRow('启用结构色（薄层干涉）', sc.enabled, (v) => { sc.enabled = v; scheduleUpdate(false); renderSide(); }));
    if (sc.enabled) {
      box.append(
        sliderRow('薄膜厚度 nm', sc.thicknessNm, 100, 600, 5, (v) => { sc.thicknessNm = v; scheduleUpdate(false); }, (v) => `${Math.round(v)} nm`),
        sliderRow('薄膜折射率', sc.refractiveIndex, 1.3, 2.2, 0.01, (v) => { sc.refractiveIndex = v; scheduleUpdate(false); }),
        sliderRow('虹彩强度', sc.iridescence, 0, 1, 0.01, (v) => { sc.iridescence = v; scheduleUpdate(false); }, (v) => `${Math.round(v * 100)}%`),
      );
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:11.5px;color:var(--fg-muted);line-height:1.6;margin-top:6px';
      hint.textContent = '厚度决定干涉色相：~310nm 偏蓝绿（孔雀颈），~380nm 偏紫（鸽颈）。颜色仅由角度与膜厚决定，同角度严格稳定。';
      box.appendChild(hint);
    }
    tabSec.appendChild(box);
    side.appendChild(tabSec);

    // ---- 截图 ----
    const shotSec = document.createElement('div');
    shotSec.className = 'section';
    const shotBtn = document.createElement('button');
    shotBtn.className = 'teal';
    shotBtn.style.width = '100%';
    shotBtn.textContent = '📷 截图（含名称与参数）';
    shotBtn.addEventListener('click', () => {
      viewport?.screenshot().then(() => toast('截图已保存')).catch((e) => toast(`截图失败：${e.message}`, 'error'));
    });
    const backBtn = document.createElement('button');
    backBtn.style.width = '100%';
    backBtn.style.marginTop = '8px';
    backBtn.textContent = '返回标本库';
    backBtn.addEventListener('click', () => router.navigate('/library'));
    shotSec.append(shotBtn, backBtn);
    side.appendChild(shotSec);
  }

  renderSide();

  // 初始化三维视口
  getSharedAdapter()
    .then((adapter) => {
      const s = getSpec();
      if (!s || disposed) return;
      stage.innerHTML = '';
      return Viewport.create(stage, adapter, structuredClone(s), appState.settings, {
        showFps: appState.settings.showFps,
        autoRotate: false,
        dprCap: QUALITY_SCALE[appState.settings.quality].dpr,
      }).then((vp) => {
        viewport = vp;
      });
    })
    .catch((err) => {
      stage.innerHTML = `<div class="empty-state">渲染器初始化失败：${err.message}</div>`;
    });

  const unsub = appState.subscribe(() => {
    if (!getSpec()) {
      currentId = appState.specimens[0]?.id;
      renderSide();
    }
  });

  return () => {
    disposed = true;
    window.clearTimeout(saveTimer);
    unsub();
    const s = getSpec();
    if (s) appState.flush();
    viewport?.destroy();
  };
}
