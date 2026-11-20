import { appState } from '../../state/appState';
import { exportSpecimens, parseImportFile } from '../../data/storage';
import { router, toast } from '../router';
import { specimenThumbSvg } from '../widgets';
import type { Specimen } from '../../types';

export function renderLibraryPage(container: HTMLElement): () => void {
  container.innerHTML = `
    <div class="page">
      <h2 class="page-title">标本库</h2>
      <p class="page-desc">标本数据持久化在浏览器 IndexedDB 中，支持 JSON 导出归档与导入恢复。</p>
      <div class="toolbar">
        <button class="primary" id="btn-new">＋ 新建标本</button>
        <button id="btn-export">⬇ 导出全部</button>
        <button id="btn-import">⬆ 导入 JSON</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden />
        <div class="spacer"></div>
        <input type="search" id="search" placeholder="按名称/物种搜索…" style="width:220px" />
      </div>
      <div class="specimen-grid" id="grid"></div>
    </div>
  `;

  const grid = container.querySelector('#grid') as HTMLDivElement;
  const search = container.querySelector('#search') as HTMLInputElement;
  let keyword = '';

  function card(s: Specimen): HTMLElement {
    const el = document.createElement('div');
    el.className = 'specimen-card';
    const featherCount = Object.values(s.regions).reduce((sum, r) => sum + r.count, 0);
    el.innerHTML = `
      <div class="card-thumb">${specimenThumbSvg(s)}</div>
      <div class="card-body">
        <div class="card-name"></div>
        <div class="card-species"></div>
        <div class="card-desc"></div>
        <div class="card-meta"></div>
      </div>
      <div class="card-actions">
        <button class="small teal" data-act="display">三维展示</button>
        <button class="small" data-act="edit">编辑</button>
        <button class="small" data-act="duplicate">复制</button>
        <button class="small danger" data-act="delete">删除</button>
      </div>
    `;
    el.querySelector('.card-name')!.textContent = s.name;
    el.querySelector('.card-species')!.textContent = s.species || '未命名物种';
    el.querySelector('.card-desc')!.textContent = s.description || '暂无描述';
    el.querySelector('.card-meta')!.textContent =
      `约 ${featherCount.toLocaleString()} 根羽毛 · 更新于 ${new Date(s.updatedAt).toLocaleDateString('zh-CN')}`;

    el.addEventListener('click', async (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (!act) return;
      if (act === 'display') router.navigate(`/display?id=${s.id}`);
      else if (act === 'edit') router.navigate(`/editor?id=${s.id}`);
      else if (act === 'duplicate') {
        await appState.duplicate(s.id);
        toast('已复制标本');
      } else if (act === 'delete') {
        if (window.confirm(`确认删除「${s.name}」？该操作不可撤销。`)) {
          await appState.remove(s.id);
          toast('标本已删除');
        }
      }
    });
    return el;
  }

  function draw(): void {
    const list = appState.specimens.filter(
      (s) =>
        !keyword ||
        s.name.includes(keyword) ||
        s.species.toLowerCase().includes(keyword.toLowerCase()),
    );
    grid.innerHTML = '';
    if (list.length === 0) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">暂无标本，点击「新建标本」开始创建。</div>';
      return;
    }
    list.forEach((s) => grid.appendChild(card(s)));
  }

  const unsubscribe = appState.subscribe(draw);
  draw();

  container.querySelector('#btn-new')!.addEventListener('click', async () => {
    const s = await appState.addBlank();
    router.navigate(`/editor?id=${s.id}`);
  });
  container.querySelector('#btn-export')!.addEventListener('click', () => {
    if (appState.specimens.length === 0) return toast('没有可导出的标本', 'error');
    exportSpecimens(appState.specimens);
    toast(`已导出 ${appState.specimens.length} 件标本`);
  });
  const fileInput = container.querySelector('#import-file') as HTMLInputElement;
  container.querySelector('#btn-import')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const imported = await parseImportFile(file);
      const n = await appState.importSpecimens(imported);
      toast(`成功导入 ${n} 件标本`);
    } catch (err) {
      toast(`导入失败：${(err as Error).message}`, 'error');
    } finally {
      fileInput.value = '';
    }
  });
  search.addEventListener('input', () => {
    keyword = search.value.trim();
    draw();
  });

  return unsubscribe;
}
