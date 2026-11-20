import { clamp, type OrbitState } from './math';

/** 指针轨道控制：拖拽旋转、滚轮缩放、触控支持；可外部同步（对比页联动） */
export class OrbitControls {
  state: OrbitState = { yaw: 0.6, pitch: 0.18, distance: 4.2, target: [0, 0.05, 0] };
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pinchDist = 0;
  private listeners = new Set<() => void>();
  speed = 1;

  constructor(private el: HTMLElement) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointermove', this.onHoverMove);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private onHoverMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || this.dragging) return;
  };

  private onDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.state.yaw += dx * 0.008 * this.speed;
    this.state.pitch = clamp(this.state.pitch + dy * 0.008 * this.speed, -1.2, 1.2);
    this.emit();
  };

  private onUp = (): void => {
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.state.distance = clamp(this.state.distance * (1 + Math.sign(e.deltaY) * 0.08), 1.6, 10);
    this.emit();
  };

  /** 双指缩放（触控） */
  setPinch(d: number): void {
    if (this.pinchDist > 0) {
      this.state.distance = clamp(this.state.distance * (this.pinchDist / d), 1.6, 10);
      this.emit();
    }
    this.pinchDist = d;
  }

  endPinch(): void {
    this.pinchDist = 0;
  }

  /** 从外部同步姿态（对比页同步转动） */
  syncFrom(other: OrbitState): void {
    this.state.yaw = other.yaw;
    this.state.pitch = other.pitch;
    this.state.distance = other.distance;
    this.emit();
  }

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('pointermove', this.onHoverMove);
  }
}
