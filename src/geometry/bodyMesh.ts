import type { BirdProportions } from '../types';

// 程序生成鸟体：椭球身体/头/颈 + 喙 + 腿 + 眼，合并为单一网格
// 局部坐标：+X 朝头，-X 朝尾，+Y 朝上，Z 为两翼方向
// 顶点属性：position(3) normal(3) color(3) = 9 float

export interface BodyMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

export interface BodyDims {
  body: [number, number, number]; // 椭球半径 xyz
  head: [number, number, number];
  headCenter: [number, number, number];
  shoulder: [number, number, number];
  tailBase: [number, number, number];
  beakBase: [number, number, number];
}

export function computeBodyDims(p: BirdProportions): BodyDims {
  const body: [number, number, number] = [0.85 * p.bodyRatio, 0.55 * p.bodyRatio, 0.46 * p.bodyRatio];
  const head: [number, number, number] = [0.3 * p.headRatio, 0.3 * p.headRatio, 0.28 * p.headRatio];
  const headCenter: [number, number, number] = [body[0] * 0.92, body[1] * 0.62, 0];
  const shoulder: [number, number, number] = [body[0] * 0.32, body[1] * 0.12, body[2] * 0.92];
  const tailBase: [number, number, number] = [-body[0] * 0.92, -body[1] * 0.08, 0];
  const beakBase: [number, number, number] = [
    headCenter[0] + head[0] * 0.95,
    headCenter[1] - head[1] * 0.08,
    0,
  ];
  return { body, head, headCenter, shoulder, tailBase, beakBase };
}

class MeshBuilder {
  verts: number[] = [];
  idx: number[] = [];

  push(p: [number, number, number], n: [number, number, number], c: [number, number, number]): number {
    this.verts.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2]);
    return this.verts.length / 9 - 1;
  }

  ellipsoid(
    center: [number, number, number],
    radii: [number, number, number],
    color: [number, number, number],
    lat = 18,
    lon = 26,
  ): void {
    const start = this.verts.length / 9;
    for (let i = 0; i <= lat; i++) {
      const theta = (i / lat) * Math.PI;
      const st = Math.sin(theta);
      const ct = Math.cos(theta);
      for (let j = 0; j <= lon; j++) {
        const phi = (j / lon) * Math.PI * 2;
        const ux = st * Math.cos(phi);
        const uy = ct;
        const uz = st * Math.sin(phi);
        const p: [number, number, number] = [
          center[0] + radii[0] * ux,
          center[1] + radii[1] * uy,
          center[2] + radii[2] * uz,
        ];
        const n: [number, number, number] = [
          ux / radii[0],
          uy / radii[1],
          uz / radii[2],
        ];
        const nl = Math.hypot(...n) || 1;
        this.push(p, [n[0] / nl, n[1] / nl, n[2] / nl], color);
      }
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const a = start + i * (lon + 1) + j;
        const b = a + lon + 1;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  /** 圆锥，沿 +X 方向（喙） */
  cone(base: [number, number, number], length: number, radius: number, color: [number, number, number], seg = 16): void {
    const start = this.verts.length / 9;
    const tip: [number, number, number] = [base[0] + length, base[1], base[2]];
    for (let j = 0; j <= seg; j++) {
      const phi = (j / seg) * Math.PI * 2;
      const ring: [number, number, number] = [base[0], base[1] + Math.cos(phi) * radius, base[2] + Math.sin(phi) * radius];
      const n: [number, number, number] = [radius / length, Math.cos(phi), Math.sin(phi)];
      const nl = Math.hypot(...n) || 1;
      this.push(ring, [n[0] / nl, n[1] / nl, n[2] / nl], color);
    }
    const tipIdx = this.push(tip, [1, 0, 0], color);
    for (let j = 0; j < seg; j++) {
      this.idx.push(start + j, start + j + 1, tipIdx);
    }
  }

  /** 圆柱（腿/脚） */
  cylinder(a: [number, number, number], b: [number, number, number], radius: number, color: [number, number, number], seg = 10): void {
    const dir: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...dir) || 1;
    const axis: [number, number, number] = [dir[0] / l, dir[1] / l, dir[2] / l];
    const ref: [number, number, number] = Math.abs(axis[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    const t1: [number, number, number] = [
      axis[1] * ref[2] - axis[2] * ref[1],
      axis[2] * ref[0] - axis[0] * ref[2],
      axis[0] * ref[1] - axis[1] * ref[0],
    ];
    const t2: [number, number, number] = [
      axis[1] * t1[2] - axis[2] * t1[1],
      axis[2] * t1[0] - axis[0] * t1[2],
      axis[0] * t1[1] - axis[1] * t1[0],
    ];
    const start = this.verts.length / 9;
    for (const end of [a, b]) {
      for (let j = 0; j <= seg; j++) {
        const phi = (j / seg) * Math.PI * 2;
        const n: [number, number, number] = [
          t1[0] * Math.cos(phi) + t2[0] * Math.sin(phi),
          t1[1] * Math.cos(phi) + t2[1] * Math.sin(phi),
          t1[2] * Math.cos(phi) + t2[2] * Math.sin(phi),
        ];
        this.push([end[0] + n[0] * radius, end[1] + n[1] * radius, end[2] + n[2] * radius], n, color);
      }
    }
    for (let j = 0; j < seg; j++) {
      const r0 = start + j;
      const r1 = start + seg + 1 + j;
      this.idx.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
    }
  }

  build(): BodyMesh {
    return {
      vertices: Float32Array.from(this.verts),
      indices: Uint32Array.from(this.idx),
      vertexCount: this.verts.length / 9,
      indexCount: this.idx.length,
    };
  }
}

export function buildBodyMesh(dims: BodyDims, proportions: BirdProportions): BodyMesh {
  const mb = new MeshBuilder();
  const skin: [number, number, number] = [0.16, 0.13, 0.1];
  const skinLight: [number, number, number] = [0.2, 0.17, 0.13];
  const beakColor: [number, number, number] = [0.55, 0.42, 0.22];
  const legColor: [number, number, number] = [0.45, 0.38, 0.28];
  const eyeColor: [number, number, number] = [0.01, 0.01, 0.012];

  // 身体
  mb.ellipsoid([0, 0, 0], dims.body, skin, 22, 30);
  // 颈部连接球
  const neckCenter: [number, number, number] = [
    dims.body[0] * 0.72,
    dims.body[1] * 0.42,
    0,
  ];
  mb.ellipsoid(neckCenter, [dims.head[0] * 0.75, dims.head[1] * 0.9, dims.head[2] * 0.8], skinLight, 14, 20);
  // 头
  mb.ellipsoid(dims.headCenter, dims.head, skinLight, 16, 22);
  // 喙
  mb.cone(dims.beakBase, 0.32 * proportions.headRatio, 0.07 * proportions.headRatio, beakColor);
  // 眼
  for (const side of [-1, 1]) {
    mb.ellipsoid(
      [
        dims.headCenter[0] + dims.head[0] * 0.42,
        dims.headCenter[1] + dims.head[1] * 0.28,
        side * dims.head[2] * 0.92,
      ],
      [0.045, 0.045, 0.045],
      eyeColor,
      8,
      12,
    );
  }
  // 腿
  for (const side of [-1, 1]) {
    const hip: [number, number, number] = [0.05, -dims.body[1] * 0.75, side * dims.body[2] * 0.32];
    const ankle: [number, number, number] = [0.02, -dims.body[1] * 1.55, side * dims.body[2] * 0.35];
    const toe: [number, number, number] = [ankle[0] + 0.18, ankle[1] - 0.02, ankle[2]];
    mb.cylinder(hip, ankle, 0.028, legColor);
    mb.cylinder(ankle, toe, 0.018, legColor);
  }
  return mb.build();
}
