import type { AppSettings, Specimen } from '../types';
import { OrbitControls } from '../core/orbit';
import { clamp } from '../core/math';
import { FeatherRenderer, type RenderScene } from '../render/renderer';
import { applyWingSpread, generatePlacement, type PlacementResult } from '../geometry/placement';
import { buildBodyMesh, computeBodyDims } from '../geometry/bodyMesh';
import { getArchetypeMesh } from '../geometry/featherMesh';
import type { FeatherArchetype } from '../types';
import { QUALITY_SCALE } from '../data/defaults';

export interface ViewportOptions {
  showFps: boolean;
  autoRotate: boolean;
  dprCap: number;
}

/** 单个三维视口：负责场景构建、渲染循环、FPS 统计与截图 */
export class Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly controls: OrbitControls;
  private renderer!: FeatherRenderer;
  private raf = 0;
  private lastTime = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fps = 0;
  private fpsEl: HTMLDivElement;
  private infoEl: HTMLDivElement;
  private specimen: Specimen;
  private settings: AppSettings;
  private placement: PlacementResult;
  private scene: RenderScene;
  private resizeObs!: ResizeObserver;
  private autoRotate = false;
  private disposed = false;
  /** 最近 N 帧耗时（ms），用于 45fps 达标判断 */
  frameTimes: number[] = [];

  private constructor(
    private container: HTMLElement,
    specimen: Specimen,
    settings: AppSettings,
    opts: ViewportOptions,
  ) {
    this.specimen = specimen;
    this.settings = settings;
    this.autoRotate = opts.autoRotate;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-canvas';
    container.appendChild(this.canvas);

    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'viewport-fps';
    this.fpsEl.hidden = !opts.showFps;
    container.appendChild(this.fpsEl);

    this.infoEl = document.createElement('div');
    this.infoEl.className = 'viewport-info';
    container.appendChild(this.infoEl);

    this.controls = new OrbitControls(this.canvas);
    this.controls.speed = settings.rotateSpeed;

    this.placement = generatePlacement(specimen, settings);
    this.scene = this.buildScene();
    this.infoEl.textContent = `${this.placement.total.toLocaleString()} 根羽毛`;
    this.loop = this.loop.bind(this);
  }

  static async create(
    container: HTMLElement,
    adapter: GPUAdapter,
    specimen: Specimen,
    settings: AppSettings,
    opts: ViewportOptions,
  ): Promise<Viewport> {
    const vp = new Viewport(container, specimen, settings, opts);
    // 渲染器必须绑定视口实际使用的 canvas
    vp.renderer = await FeatherRenderer.create(vp.canvas, adapter);
    vp.renderer.setScene(vp.scene);
    vp.controls.onChange(() => vp.renderer.setCamera(vp.controls.state));
    vp.renderer.setCamera(vp.controls.state);

    vp.resizeObs = new ResizeObserver(() => vp.resize(QUALITY_SCALE[settings.quality].dpr));
    vp.resizeObs.observe(container);
    requestAnimationFrame(() => vp.resize(QUALITY_SCALE[settings.quality].dpr));

    vp.raf = requestAnimationFrame(vp.loop);
    return vp;
  }

  private buildScene(): RenderScene {
    const dims = computeBodyDims(this.specimen.proportions);
    const body = buildBodyMesh(dims, this.specimen.proportions);
    const archetypes = {} as Record<FeatherArchetype, ReturnType<typeof getArchetypeMesh>>;
    const seen = new Set<FeatherArchetype>();
    for (const region of Object.values(this.specimen.regions)) {
      if (seen.has(region.archetype)) continue;
      seen.add(region.archetype);
      archetypes[region.archetype] = getArchetypeMesh(region);
    }
    // 保证四种原型都存在（未使用的给一份默认网格）
    for (const a of ['contour', 'flight', 'tail', 'down'] as FeatherArchetype[]) {
      if (!archetypes[a]) {
        archetypes[a] = getArchetypeMesh({
          count: 0, archetype: a, barbs: 20, length: 0.2, width: a === 'down' ? 0.9 : 0.4,
          density: 0.5, color: '#888888', tipColor: '#777777', anisotropy: 0.6,
          structural: { enabled: false, thicknessNm: 300, refractiveIndex: 1.56, iridescence: 0 },
        });
      }
    }
    return { placement: this.placement, archetypes, body, background: this.settings.background };
  }

  /** 标本参数变更后重建；rebuildGeometry=false 时只刷新实例数据，复用全部顶点缓冲 */
  updateSpecimen(specimen: Specimen, rebuildGeometry: boolean): void {
    this.specimen = specimen;
    this.placement = generatePlacement(specimen, this.settings);
    if (rebuildGeometry) {
      this.scene = this.buildScene();
      this.renderer.setScene(this.scene);
    } else {
      this.scene.placement = this.placement;
      this.renderer.updateInstances(this.scene);
    }
    this.infoEl.textContent = `${this.placement.total.toLocaleString()} 根羽毛`;
  }

  updateSettings(settings: AppSettings, opts: Partial<ViewportOptions>): void {
    this.settings = settings;
    this.controls.speed = settings.rotateSpeed;
    if (opts.showFps !== undefined) this.fpsEl.hidden = !opts.showFps;
    if (opts.autoRotate !== undefined) this.autoRotate = opts.autoRotate;
    if (opts.dprCap !== undefined) this.resize(opts.dprCap);
  }

  setAutoRotate(v: boolean): void {
    this.autoRotate = v;
  }

  private resize(dprCap: number): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, dprCap);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.renderer.resize(w, h);
    this.renderer.setCamera(this.controls.state);
  }

  private loop(t: number): void {
    if (this.disposed) return;
    const dt = this.lastTime ? t - this.lastTime : 16.7;
    this.lastTime = t;
    // 翅膀展开度实时驱动（每帧只更新翅膀实例的一小段缓冲）
    applyWingSpread(this.placement.wing, this.placement.dims, this.specimen.proportions.wingSpread);
    if (this.placement.wing.length > 0) this.renderer.syncWingInstances();
    if (this.autoRotate) {
      this.controls.state.yaw += dt * 0.00045;
    }
    this.renderer.setCamera(this.controls.state);
    this.renderer.render();

    this.frameTimes.push(dt);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      const ok = 1000 / Math.max(1, avg) >= 45;
      this.fpsEl.textContent = `${this.fps} FPS${ok ? '' : ' ⚠️ 低于45'}`;
      this.fpsEl.classList.toggle('fps-warn', !ok);
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  getFps(): number {
    return this.fps;
  }

  /** 截图：WebGPU 像素 + 2D Canvas 合成标本名称与参数 */
  async screenshot(): Promise<void> {
    const { buffer, width, height } = await this.renderer.capturePixels();
    const canvas2d = document.createElement('canvas');
    canvas2d.width = width;
    canvas2d.height = height;
    const ctx = canvas2d.getContext('2d')!;
    const image = new ImageData(width, height);
    const src = new Uint8Array(buffer);
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const swapRB = this.renderer.format === 'bgra8unorm';
    for (let y = 0; y < height; y++) {
      const rowStart = y * bytesPerRow;
      for (let x = 0; x < width; x++) {
        const si = rowStart + x * 4;
        const di = y * width * 4 + x * 4;
        if (swapRB) {
          image.data[di] = src[si + 2];
          image.data[di + 1] = src[si + 1];
          image.data[di + 2] = src[si];
          image.data[di + 3] = 255;
        } else {
          image.data[di] = src[si];
          image.data[di + 1] = src[si + 1];
          image.data[di + 2] = src[si + 2];
          image.data[di + 3] = 255;
        }
      }
    }
    ctx.putImageData(image, 0, 0);

    // 半透明信息条
    const barH = Math.max(64, Math.round(height * 0.12));
    ctx.fillStyle = 'rgba(10, 14, 18, 0.72)';
    ctx.fillRect(0, height - barH, width, barH);
    ctx.textBaseline = 'middle';
    const fs = Math.round(barH * 0.3);
    ctx.font = `600 ${fs}px "Microsoft YaHei", system-ui, sans-serif`;
    ctx.fillStyle = '#f2f5f8';
    ctx.fillText(this.specimen.name, 24, height - barH * 0.62);
    ctx.font = `400 ${Math.round(fs * 0.62)}px ui-monospace, monospace`;
    ctx.fillStyle = '#b9c6d4';
    const p = this.specimen.proportions;
    const params =
      `头${p.headRatio.toFixed(2)} 身${p.bodyRatio.toFixed(2)} 翅${p.wingRatio.toFixed(2)} ` +
      `尾${p.tailRatio.toFixed(2)} 展开${p.wingSpread.toFixed(2)} · ${this.placement.total}羽 · ${new Date().toLocaleString('zh-CN')}`;
    ctx.fillText(params, 24, height - barH * 0.24);

    canvas2d.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.specimen.name}-截图.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.destroy();
    this.renderer.destroy();
    this.canvas.remove();
    this.fpsEl.remove();
    this.infoEl.remove();
  }
}
