import './styles.css';
import { appState } from './state/appState';
import { router } from './ui/router';
import { renderLibraryPage } from './ui/pages/library';
import { renderEditorPage } from './ui/pages/editor';
import { renderDisplayPage } from './ui/pages/display';
import { renderComparePage } from './ui/pages/compare';
import { renderSettingsPage } from './ui/pages/settings';

async function boot(): Promise<void> {
  // WebGPU 能力检测：不支持时给出明确提示，不继续初始化
  if (!('gpu' in navigator) || !navigator.gpu) {
    document.getElementById('unsupported')!.hidden = false;
    return;
  }
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch {
    adapter = null;
  }
  if (!adapter) {
    document.getElementById('unsupported')!.hidden = false;
    return;
  }

  await appState.init();

  router.register({
    '/library': renderLibraryPage,
    '/editor': renderEditorPage,
    '/display': renderDisplayPage,
    '/compare': renderComparePage,
    '/settings': renderSettingsPage,
  });
  router.start('/library');
}

boot().catch((err) => {
  console.error(err);
  const panel = document.getElementById('unsupported')!;
  panel.hidden = false;
  panel.querySelector('.unsupported-card')!.innerHTML =
    `<h1>⚠️ 初始化失败</h1><p>${String(err?.message ?? err)}</p>`;
});
