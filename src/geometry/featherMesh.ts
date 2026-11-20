import type { FeatherArchetype, RegionParams } from '../types';

// 羽毛原型几何：每根羽毛 = 羽轴 ribbon + 成对羽枝 ribbon（真实几何，非贴图）
// 局部坐标：+X 为羽毛生长方向（羽根->羽尖），XY 为羽片平面，Z 为法线
// 顶点属性：position(3) normal(3) tangent(3) along(1) across(1) edge(1) = 12 float

export interface ArchetypeMesh {
  archetype: FeatherArchetype;
  vertices: Float32Array; // 交错 12 float/顶点
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

export const STRIDE_FLOATS = 12;

interface BarbCurve {
  /** 羽枝从羽轴伸出后向羽尖弯曲的程度 */
  sweep: number;
  /** 羽枝宽度方向随机扰动（由实例种子在 shader 中微调，几何保持中性） */
}

function vaneEnvelope(t: number, width: number): number {
  // 羽片宽度包络：基部窄 -> 中部最宽 -> 羽尖收窄
  const base = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, t * 1.05))), 0.7);
  const taper = 1 - 0.35 * t * t;
  return width * base * taper;
}

/**
 * 生成平面型羽毛（体羽/飞羽/尾羽）
 * @param barbs 单侧羽枝数
 * @param width 羽片相对宽度（相对长度）
 * @param asym 左右不对称度（飞羽外窄内宽），0~0.6
 */
function buildPlanar(
  archetype: FeatherArchetype,
  barbs: number,
  width: number,
  asym: number,
): ArchetypeMesh {
  const verts: number[] = [];
  const idx: number[] = [];

  const push = (
    p: [number, number, number],
    n: [number, number, number],
    t: [number, number, number],
    along: number,
    across: number,
    edge: number,
  ): number => {
    verts.push(p[0], p[1], p[2], n[0], n[1], n[2], t[0], t[1], t[2], along, across, edge);
    return verts.length / STRIDE_FLOATS - 1;
  };

  const z: [number, number, number] = [0, 0, 1];
  const zNeg: [number, number, number] = [0, 0, -1];

  // ---- 羽轴（rachis）：沿 X 的细窄梯形 ribbon，宽度向尖端递减 ----
  const shaftSegs = Math.max(6, barbs);
  for (let i = 0; i <= shaftSegs; i++) {
    const t = i / shaftSegs;
    const x = t;
    const halfW = 0.012 * (1 - 0.7 * t) + 0.002;
    for (const side of [-1, 1]) {
      const p: [number, number, number] = [x, side * halfW, 0];
      // 沿羽枝方向（大致 Y）的切线 -> 各向异性高光在羽轴上沿 X 拉长，
      // 羽轴切线取 X 方向（与羽枝不同），用 edge=2 标记
      push(p, z, [1, 0, 0], t, side, 2);
      push(p, zNeg, [1, 0, 0], t, side, 2);
    }
  }
  for (let i = 0; i < shaftSegs; i++) {
    const a = i * 4;
    // 正面
    idx.push(a, a + 2, a + 4, a + 2, a + 6, a + 4);
    // 背面
    idx.push(a + 1, a + 5, a + 3, a + 3, a + 5, a + 7);
  }

  // ---- 羽枝（barbs）：左右成对的 ribbon，从羽轴斜伸向羽片边缘 ----
  for (let b = 1; b <= barbs; b++) {
    const t = b / (barbs + 1);
    const env = vaneEnvelope(t, width);
    const sweep = 0.18 + 0.25 * t; // 羽枝向羽尖回扫
    for (const side of [-1, 1]) {
      // 飞羽不对称：side=-1 一侧（外侧）较窄
      const sideScale = side === -1 ? 1 - asym : 1 + asym * 0.5;
      const len = env * sideScale;
      if (len < 0.004) continue;
      const x0 = t;
      const y0 = side * 0.008;
      const x1 = Math.min(0.985, t + sweep * len * 2.2);
      const y1 = side * len;
      // 羽枝方向（用于各向异性）：从轴指向边缘
      const dir = (s: number): [number, number, number] => {
        const d: [number, number, number] = [x1 - x0, y1 - y0, 0];
        const l = Math.hypot(d[0], d[1]) || 1;
        return s > 0 ? [d[0] / l, d[1] / l, 0] : [-d[0] / l, -d[1] / l, 0];
      };
      const t0 = dir(1);
      const t1 = dir(-1);
      const half = 0.0035 * (1 - 0.5 * t);
      // 垂直于羽枝方向的微小偏移，形成 ribbon 宽度
      const px = -t0[1] * half;
      const py = t0[0] * half;

      const v0 = push([x0 + px, y0 + py, 0], z, t0, t, side, 0);
      const v1 = push([x0 - px, y0 - py, 0], z, t0, t, side, 0);
      const v2 = push([x1 + px, y1 + py, 0], z, t0, Math.min(1, t + 0.04), side, 1);
      const v3 = push([x1 - px, y1 - py, 0], z, t0, Math.min(1, t + 0.04), side, 1);
      idx.push(v0, v1, v2, v1, v3, v2);

      const w0 = push([x0 + px, y0 + py, 0], zNeg, t1, t, side, 0);
      const w1 = push([x0 - px, y0 - py, 0], zNeg, t1, t, side, 0);
      const w2 = push([x1 + px, y1 + py, 0], zNeg, t1, Math.min(1, t + 0.04), side, 1);
      const w3 = push([x1 - px, y1 - py, 0], zNeg, t1, Math.min(1, t + 0.04), side, 1);
      idx.push(w0, w2, w1, w1, w2, w3);
    }
  }

  return {
    archetype,
    vertices: Float32Array.from(verts),
    indices: Uint32Array.from(idx),
    vertexCount: verts.length / STRIDE_FLOATS,
    indexCount: idx.length,
  };
}

/**
 * 绒羽：从基部向半球方向放射的细长羽枝（3D 蓬松结构）
 */
function buildDown(barbs: number, width: number): ArchetypeMesh {
  const verts: number[] = [];
  const idx: number[] = [];
  const push = (
    p: [number, number, number],
    n: [number, number, number],
    t: [number, number, number],
    along: number,
    across: number,
    edge: number,
  ): number => {
    verts.push(p[0], p[1], p[2], n[0], n[1], n[2], t[0], t[1], t[2], along, across, edge);
    return verts.length / STRIDE_FLOATS - 1;
  };

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const rays = Math.max(10, barbs);
  for (let i = 0; i < rays; i++) {
    // 斐波那契半球，偏向 +X 半球（绒羽球心在羽根）
    const u = i / (rays - 1);
    const theta = u * Math.PI * 0.95;
    const phi = i * goldenAngle;
    const dir: [number, number, number] = [
      Math.cos(theta) * 0.9 + 0.1,
      Math.sin(theta) * Math.cos(phi),
      Math.sin(theta) * Math.sin(phi),
    ];
    const l = Math.hypot(...dir) || 1;
    dir[0] /= l; dir[1] /= l; dir[2] /= l;
    const len = 0.55 + 0.35 * ((i * 7) % rays) / rays;
    const half = 0.006 * width;
    // ribbon 宽度方向：与 dir 垂直的任意两轴之一，取 dir 叉乘 Y 或 Z
    let side: [number, number, number] = [
      dir[1] * 0 - dir[2] * 1,
      dir[2] * 0 - dir[0] * 0,
      dir[0] * 1 - dir[1] * 0,
    ];
    const sl = Math.hypot(...side) || 1;
    side = [side[0] / sl, side[1] / sl, side[2] / sl];
    const normal: [number, number, number] = [
      dir[1] * side[2] - dir[2] * side[1],
      dir[2] * side[0] - dir[0] * side[2],
      dir[0] * side[1] - dir[1] * side[0],
    ];
    const base: [number, number, number] = [0, 0, 0];
    const tip: [number, number, number] = [dir[0] * len, dir[1] * len, dir[2] * len];
    const b0 = push(base, normal, dir, 0, 0, 0);
    const b1 = push([base[0] + side[0] * half, base[1] + side[1] * half, base[2] + side[2] * half], normal, dir, 0, 0, 0);
    const t0 = push(tip, normal, dir, 1, 0, 1);
    const t1 = push([tip[0] + side[0] * half * 0.3, tip[1] + side[1] * half * 0.3, tip[2] + side[2] * half * 0.3], normal, dir, 1, 0, 1);
    idx.push(b0, b1, t0, b1, t1, t0);
  }

  return {
    archetype: 'down',
    vertices: Float32Array.from(verts),
    indices: Uint32Array.from(idx),
    vertexCount: verts.length / STRIDE_FLOATS,
    indexCount: idx.length,
  };
}

const archetypeCache = new Map<string, ArchetypeMesh>();

/** 按区域参数取（缓存的）原型网格。几何只依赖 barbs/width/archetype，参数不变则复用 */
export function getArchetypeMesh(params: RegionParams): ArchetypeMesh {
  const barbs = Math.round(params.barbs);
  const key = `${params.archetype}|${barbs}|${params.width.toFixed(3)}`;
  const hit = archetypeCache.get(key);
  if (hit) return hit;

  let mesh: ArchetypeMesh;
  if (params.archetype === 'flight') {
    mesh = buildPlanar('flight', barbs, params.width, 0.45);
  } else if (params.archetype === 'tail') {
    mesh = buildPlanar('tail', barbs, params.width, 0.15);
  } else if (params.archetype === 'down') {
    mesh = buildDown(barbs, params.width);
  } else {
    mesh = buildPlanar('contour', barbs, params.width, 0.05);
  }
  archetypeCache.set(key, mesh);
  return mesh;
}
