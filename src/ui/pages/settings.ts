import type { AppSettings, QualityLevel } from '../../types';
import { appState } from '../../state/appState';
import { DEFAULT_SETTINGS, QUALITY_SCALE } from '../../data/defaults';
import { toast } from '../router';

export function renderSettingsPage(container: HTMLElement): () => void {
  const s = appState.settings;
  container.innerHTML = `
    <div class="page">
      <h2 class="page-title">设置</h2>
      <p class="page-desc">渲染质量与性能保护参数。设置持久化在浏览器 localStorage 中。</p>
      <div class="settings-panel" id="panel"></div>
    </div>
  `;
  const panel = container.querySelector('#panel') as HTMLElement;

  function row(labelText: string, control: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const lab = document.createElement('label');
    lab.textContent = labelText;
    row.append(lab, control);
    panel.appendChild(row);
  }

  // 渲染质量
  const qualitySel = document.createElement('select');
  (['low', 'medium', 'high'] as QualityLevel[]).forEach((q) => {
    const opt = document.createElement('option');
    opt.value = q;
    opt.textContent = q === 'low' ? '低（40% 羽毛，DPR 1）' : q === 'medium' ? '中（70% 羽毛，DPR 1.5）' : '高（100% 羽毛，DPR 2）';
    opt.selected = q === s.quality;
    qualitySel.appendChild(opt);
  });
  qualitySel.addEventListener('change', () => {
    appState.updateSettings({ quality: qualitySel.value as QualityLevel });
    toast('质量将在下次打开视口时生效');
  });
  row('渲染质量', qualitySel);

  // 旋转灵敏度
  const speedRange = document.createElement('input');
  speedRange.type = 'range';
  speedRange.min = '0.3';
  speedRange.max = '2.5';
  speedRange.step = '0.1';
  speedRange.value = String(s.rotateSpeed);
  speedRange.addEventListener('input', () => appState.updateSettings({ rotateSpeed: Number(speedRange.value) }));
  row('旋转灵敏度', speedRange);

  // FPS 显示
  const fpsCheck = document.createElement('input');
  fpsCheck.type = 'checkbox';
  fpsCheck.checked = s.showFps;
  fpsCheck.addEventListener('change', () => appState.updateSettings({ showFps: fpsCheck.checked }));
  row('显示帧率（FPS）', fpsCheck);

  // 自动旋转默认值
  const rotCheck = document.createElement('input');
  rotCheck.type = 'checkbox';
  rotCheck.checked = s.autoRotate;
  rotCheck.addEventListener('change', () => appState.updateSettings({ autoRotate: rotCheck.checked }));
  row('展示页默认自动旋转', rotCheck);

  // 背景色
  const bg = document.createElement('input');
  bg.type = 'color';
  bg.value = s.background;
  bg.addEventListener('input', () => appState.updateSettings({ background: bg.value }));
  row('视口背景色', bg);

  // 实例上限
  const cap = document.createElement('input');
  cap.type = 'number';
  cap.min = '1000';
  cap.max = '30000';
  cap.step = '500';
  cap.value = String(s.maxInstances);
  cap.addEventListener('change', () => {
    const v = Math.min(30000, Math.max(1000, Number(cap.value) || DEFAULT_SETTINGS.maxInstances));
    appState.updateSettings({ maxInstances: v });
    cap.value = String(v);
  });
  row('实例数量硬上限（防显存超限）', cap);

  // 恢复默认
  const resetBtn = document.createElement('button');
  resetBtn.className = 'danger';
  resetBtn.textContent = '恢复默认设置';
  resetBtn.addEventListener('click', () => {
    if (window.confirm('确认恢复全部默认设置？')) {
      appState.updateSettings({ ...DEFAULT_SETTINGS });
      location.reload();
    }
  });
  row('重置', resetBtn);

  const note = document.createElement('div');
  note.className = 'perf-note';
  note.innerHTML = `
    <b style="color:var(--accent)">性能设计说明</b><br/>
    1. 全部羽毛仅 4 次实例化 draw call（体羽/飞羽/尾羽/绒羽各一次），原型网格在参数不变时缓存复用。<br/>
    2. 实例变换通过存储缓冲读取，10000 根羽毛的实例数据约 0.96MB，单帧绘制压力稳定。<br/>
    3. 翅膀展开/收起只重写翅膀实例区间，不重建整只鸟。<br/>
    4. 双视口对比自动将 DPR 限制在 ${QUALITY_SCALE.high.dpr}→1.5，保证 45fps 目标。<br/>
    5. 结构色在 WGSL 中按薄层干涉 Airy 公式计算，无随机噪声：同一观察角度、同一膜厚得到严格一致的颜色。<br/>
    6. 低于 45fps 时帧率指示器会变橙提示，可降低渲染质量或羽毛数量。
  `;
  panel.appendChild(note);

  return () => undefined;
}
