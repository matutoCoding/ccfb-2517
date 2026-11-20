// 小型 UI 控件工厂，统一滑杆/颜色/开关的生成
import { hexToRgb } from '../core/color';

export function sliderRow(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
  fmt: (v: number) => string = (v) => v.toFixed(2),
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'slider-row';
  const head = document.createElement('div');
  head.className = 'slider-head';
  const name = document.createElement('span');
  name.textContent = label;
  const val = document.createElement('b');
  val.textContent = fmt(value);
  head.append(name, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = fmt(v);
    onChange(v);
  });
  row.append(head, input);
  return row;
}

export function colorRow(label: string, value: string, onChange: (hex: string) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'color-row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = value;
  picker.addEventListener('input', () => onChange(picker.value));
  row.append(lab, picker);
  return row;
}

export function switchRow(label: string, value: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const lab = document.createElement('label');
  lab.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.textContent = label;
  lab.append(input, text);
  return lab;
}

/** 由标本主色生成抽象鸟形 SVG 缩略图（不依赖 WebGPU） */
export function specimenThumbSvg(specimen: {
  regions: { back: { color: string }; wing: { color: string }; neck: { structural: { enabled: boolean } } };
}): string {
  const c = hexToRgb(specimen.regions.back.color);
  const w = hexToRgb(specimen.regions.wing.color);
  const irr = specimen.regions.neck.structural.enabled;
  const gradId = `g${Math.round(c[0] * 255)}${Math.round(c[1] * 255)}${Math.round(c[2] * 255)}`;
  const rgb = (x: number[]) => `rgb(${x.map((v) => Math.round(v * 255)).join(',')})`;
  return `
  <svg class="thumb-svg" viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${rgb(c)}"/>
        <stop offset="100%" stop-color="${rgb(w)}"/>
      </linearGradient>
    </defs>
    <ellipse cx="96" cy="66" rx="52" ry="30" fill="url(#${gradId})"/>
    <circle cx="146" cy="46" r="18" fill="${rgb(c)}"/>
    <polygon points="162,44 184,50 162,55" fill="#c9a35f"/>
    <circle cx="151" cy="42" r="2.6" fill="#111"/>
    <path d="M50 64 Q18 58 6 78 Q30 74 52 76 Z" fill="${rgb(w)}" opacity="0.92"/>
    <path d="M88 92 L84 112 M104 92 L108 112" stroke="#8a7a5e" stroke-width="3" stroke-linecap="round"/>
    ${irr ? '<ellipse cx="138" cy="56" rx="10" ry="8" fill="url(#irid)" opacity="0.85"/><linearGradient id="irid"><stop offset="0%" stop-color="#2fe6c8"/><stop offset="45%" stop-color="#5a7bff"/><stop offset="100%" stop-color="#b05cff"/></linearGradient>' : ''}
  </svg>`;
}

export async function getSharedAdapter(): Promise<GPUAdapter> {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('无法获取 GPU 适配器');
  return adapter;
}
