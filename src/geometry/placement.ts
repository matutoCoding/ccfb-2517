import type { FeatherArchetype, InstanceRecord, RegionId, Specimen } from '../types';
import { clamp, hashString, mulberry32, quat, v3, type Quat, type Vec3 } from '../core/math';
import { hexToLinear } from '../core/color';
import { QUALITY_SCALE } from '../data/defaults';
import { computeBodyDims, type BodyDims } from './bodyMesh';
import type { AppSettings } from '../types';

// 实例在存储缓冲中的布局（24 float / 96 字节，与 WGSL Instance 结构一一对应）
export const INSTANCE_FLOATS = 24;
export const INSTANCE_BYTES = INSTANCE_FLOATS * 4;

export interface WingInstance {
  record: InstanceRecord;
  /** 收起状态下相对肩关节的锚点偏移 */
  anchorOffset: Vec3;
  /** 收起状态羽毛朝向 */
  dir0: Vec3;
  side: 1 | -1;
  /** 跟随翅膀转动的比例（覆羽=0.4，飞羽=1） */
  follow: number;
  /** 折叠时的层叠 Z 偏移，防穿插 */
  layer: number;
}

export interface PlacementResult {
  /** 按原型分组的静态实例 */
  groups: Record<FeatherArchetype, InstanceRecord[]>;
  /** 翅膀实例（随 wingSpread 每帧更新变换） */
  wing: WingInstance[];
  total: number;
  dims: BodyDims;
}

const ARCHETYPES: FeatherArchetype[] = ['contour', 'flight', 'tail', 'down'];

function emptyGroups(): Record<FeatherArchetype, InstanceRecord[]> {
  return { contour: [], flight: [], tail: [], down: [] };
}

interface Ellipsoid {
  center: Vec3;
  radii: Vec3;
}

function fibonacciPoint(index: number, total: number): Vec3 {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / Math.max(1, total - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * index;
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
}

function ellipsoidSurface(e: Ellipsoid, unit: Vec3): { pos: Vec3; normal: Vec3 } {
  const pos: Vec3 = [
    e.center[0] + e.radii[0] * unit[0],
    e.center[1] + e.radii[1] * unit[1],
    e.center[2] + e.radii[2] * unit[2],
  ];
  const n: Vec3 = [unit[0] / e.radii[0], unit[1] / e.radii[1], unit[2] / e.radii[2]];
  return { pos, normal: v3.normalize(n) };
}

function makeRecord(
  region: RegionId,
  archetypeIndex: number,
  pos: Vec3,
  q: Quat,
  scale: number,
  s: Specimen,
  rng: () => number,
): InstanceRecord {
  const rp = s.regions[region];
  const c = hexToLinear(rp.color);
  const tc = hexToLinear(rp.tipColor);
  return {
    region,
    archetypeIndex,
    position: pos,
    quaternion: q,
    scale: [scale, scale, scale],
    color: c,
    tipColor: tc,
    anisotropy: rp.anisotropy,
    filmThickness: rp.structural.enabled ? rp.structural.thicknessNm : 0,
    refractiveIndex: rp.structural.refractiveIndex,
    iridescence: rp.structural ? rp.structural.iridescence : 0,
    seed: Math.floor(rng() * 2147483647),
  };
}

/** 体羽朝向：表面切线方向朝尾（-X），略微抬起 */
function contourOrientation(normal: Vec3, rng: () => number, lift = 0.28): Quat {
  const flow: Vec3 = [-1, 0.18, 0];
  const dot = v3.dot(flow, normal);
  let tangent = v3.sub(flow, v3.scale(normal, dot));
  if (v3.len(tangent) < 1e-4) tangent = [0, 0, 1];
  tangent = v3.normalize(tangent);
  const dir = v3.normalize(v3.add(tangent, v3.scale(normal, lift)));
  const jittered = v3.jitter(dir, 0.12, rng);
  return quat.fromDirection(jittered);
}

function scaledCount(raw: number, qualityScale: number, maxTotal: number, planned: number): number {
  let n = Math.max(0, Math.round(raw * qualityScale));
  if (planned > maxTotal) n = Math.max(0, Math.floor((n * maxTotal) / planned));
  return n;
}

export function generatePlacement(specimen: Specimen, settings: AppSettings): PlacementResult {
  const p = specimen.proportions;
  const dims = computeBodyDims(p);
  const { countScale } = QUALITY_SCALE[settings.quality];
  const rng = mulberry32(hashString(specimen.id) ^ 0x9e3779b9);

  // 先计算计划总量，超出上限时等比缩减
  const planned = REGION_IDS_ALL.reduce((sum, r) => sum + specimen.regions[r].count, 0) * countScale;
  const cap = settings.maxInstances;
  const countOf = (raw: number) => scaledCount(raw, countScale, cap, planned);

  const groups = emptyGroups();
  const wing: WingInstance[] = [];
  const archIndex: Record<FeatherArchetype, number> = { contour: 0, flight: 1, tail: 2, down: 3 };

  const bodyEll: Ellipsoid = { center: [0, 0, 0], radii: dims.body };
  const headEll: Ellipsoid = { center: dims.headCenter, radii: dims.head };
  const neckEll: Ellipsoid = {
    center: [dims.body[0] * 0.72, dims.body[1] * 0.42, 0],
    radii: [dims.head[0] * 0.8, dims.head[1] * 0.95, dims.head[2] * 0.85],
  };

  const placeContour = (region: RegionId, ell: Ellipsoid, filter: (u: Vec3) => boolean) => {
    const target = countOf(specimen.regions[region].count);
    if (target === 0) return;
    const rp = specimen.regions[region];
    // 多取候选以通过过滤
    const candidates = Math.floor(target * 2.4) + 16;
    let placed = 0;
    for (let i = 0; i < candidates && placed < target; i++) {
      const u = fibonacciPoint(i, candidates);
      if (!filter(u)) continue;
      const { pos, normal } = ellipsoidSurface(ell, u);
      const q = contourOrientation(normal, rng, region === 'down' ? 0.5 : 0.28);
      const size = rp.length * (0.82 + 0.36 * rng());
      const finalPos = region === 'down' ? v3.sub(pos, v3.scale(normal, 0.05)) : pos;
      groups[rp.archetype].push(
        makeRecord(region, archIndex[rp.archetype], finalPos, q, size, specimen, rng),
      );
      placed++;
    }
  };

  // 头部 / 颈部
  placeContour('head', headEll, () => true);
  placeContour('neck', neckEll, () => true);
  // 背部：身体上半且不进入侧翼带
  placeContour('back', bodyEll, (u) => u[1] >= -0.15 && Math.abs(u[2]) < 0.8);
  // 腹部
  placeContour('belly', bodyEll, (u) => u[1] < 0.1);
  // 绒羽：贴身体内缩的蓬松层
  placeContour('down', bodyEll, () => true);

  // ---- 尾羽：尾基部扇形展开，静态 ----
  {
    const region: RegionId = 'tail';
    const target = countOf(specimen.regions[region].count);
    const rp = specimen.regions[region];
    const base = dims.tailBase;
    for (let i = 0; i < target; i++) {
      const f = target === 1 ? 0.5 : i / (target - 1);
      const fan = (f - 0.5) * 1.1; // 绕 Y 扇形
      const lift = (0.5 - Math.abs(f - 0.5)) * 0.35;
      const dir: Vec3 = v3.normalize([-1, lift, Math.sin(fan) * 0.8]);
      const q = quat.fromDirection(dir, [0, 1, 0]);
      const size = rp.length * p.tailRatio * (0.85 + 0.3 * rng());
      const pos: Vec3 = [base[0], base[1] + (rng() - 0.5) * 0.03, base[2] + (rng() - 0.5) * 0.05];
      groups.tail.push(makeRecord(region, archIndex.tail, pos, q, size, specimen, rng));
    }
  }

  // ---- 翅膀：肩关节驱动，展开/收起时整组旋转，层叠偏移防穿插 ----
  // 约定：anchorOffset/dir0 均为“完全展开态(spread=1)”的局部定义，
  // 初始 record 变换由 applyWingSpread(spread=初始值) 统一计算，与动画帧完全同路径，杜绝漂移。
  {
    const region: RegionId = 'wing';
    const target = countOf(specimen.regions[region].count);
    const rp = specimen.regions[region];
    const nPrimary = Math.round(target * 0.45);
    const nSecondary = Math.round(target * 0.35);
    const nCovert = target - nPrimary - nSecondary;

    for (const side of [1, -1] as const) {
      const shoulder: Vec3 = [dims.shoulder[0], dims.shoulder[1], side * dims.shoulder[2]];

      const addWingFeather = (
        kind: 'primary' | 'secondary' | 'covert',
        index: number,
        total: number,
      ) => {
        const f = total === 1 ? 0.5 : index / (total - 1);
        // 展开态锚点（相对肩关节）与展开态羽毛方向
        let anchorOffset: Vec3;
        let dirSpread: Vec3;
        let follow: number;
        let sizeScale: number;
        if (kind === 'primary') {
          // 初级飞羽：展开时沿 ±Z 方向依次排开
          anchorOffset = [-0.05 - f * 0.18, -0.02 - f * 0.05, side * (0.05 + f * 0.42)];
          const fan = (f - 0.5) * 0.5;
          dirSpread = v3.normalize([-0.15 + fan * 0.3, -0.08, side]);
          follow = 1;
          sizeScale = (0.9 + 0.25 * (1 - f)) * p.wingRatio;
        } else if (kind === 'secondary') {
          anchorOffset = [0.08 - f * 0.16, 0.04 - f * 0.04, side * (0.06 + (1 - f) * 0.3)];
          dirSpread = v3.normalize([-0.1, -0.05, side]);
          follow = 0.92;
          sizeScale = 0.78 * p.wingRatio;
        } else {
          // 覆羽：肩关节周围的小羽，只部分跟随
          const u: Vec3 = [0.5 - f, 0.35 + 0.3 * Math.sin(f * Math.PI), side * 0.85];
          const surf = ellipsoidSurface(
            { center: [0, 0, 0], radii: [0.34 * p.wingRatio, 0.26, 0.2] },
            v3.normalize(u),
          );
          anchorOffset = surf.pos;
          dirSpread = v3.normalize(v3.add(v3.scale(surf.normal, 0.6), [-0.2, 0, side * 0.9]));
          follow = 0.4;
          sizeScale = 0.42 * p.wingRatio;
        }
        const size = rp.length * sizeScale * (0.9 + 0.2 * rng());
        const rec = makeRecord(
          region,
          archIndex.flight,
          v3.add(shoulder, anchorOffset),
          quat.fromDirection(dirSpread),
          size,
          specimen,
          rng,
        );
        // 折叠层叠：沿身体侧面法线方向逐层外移，避免共面穿插
        const layer = (index % 12) * 0.006 * side;
        wing.push({
          record: rec,
          anchorOffset,
          dir0: dirSpread,
          side,
          follow,
          layer,
        });
      };

      for (let i = 0; i < nPrimary / 2; i++) addWingFeather('primary', i, Math.ceil(nPrimary / 2));
      for (let i = 0; i < nSecondary / 2; i++) addWingFeather('secondary', i, Math.ceil(nSecondary / 2));
      for (let i = 0; i < nCovert / 2; i++) addWingFeather('covert', i, Math.ceil(nCovert / 2));
    }
  }

  const total =
    ARCHETYPES.reduce((s, a) => s + groups[a].length, 0) + wing.length;
  const result: PlacementResult = { groups, wing, total, dims };
  // 初始变换与动画帧走同一条数学路径，保证 spread 往返零漂移
  applyWingSpread(wing, dims, p.wingSpread);
  return result;
}

const REGION_IDS_ALL: RegionId[] = ['head', 'neck', 'belly', 'back', 'wing', 'tail', 'down'];

/**
 * 根据展开度更新翅膀实例变换（CPU 侧，每帧调用；约几千实例，开销远低于一帧绘制）
 * 折叠角 = (1-spread) * 夹角；绕 foldDir×spreadDir 轴旋转
 */
export function applyWingSpread(
  wing: WingInstance[],
  dims: BodyDims,
  spread: number,
): void {
  const cache = new Map<1 | -1, { shoulder: Vec3; axis: Vec3; fullAngle: number }>();
  for (const side of [1, -1] as const) {
    const shoulder: Vec3 = [dims.shoulder[0], dims.shoulder[1], side * dims.shoulder[2]];
    const foldDir = v3.normalize([-0.82, -0.32, side * 0.46]);
    const spreadDir = v3.normalize([-0.08, -0.04, side]);
    const axis = v3.normalize(v3.cross(foldDir, spreadDir));
    const fullAngle = Math.acos(clamp(v3.dot(foldDir, spreadDir), -1, 1));
    cache.set(side, { shoulder, axis, fullAngle });
  }

  for (const w of wing) {
    const { shoulder, axis, fullAngle } = cache.get(w.side)!;
    // follow 控制覆羽不完全展开；spread=0 时 angle=fullAngle（相对展开态折回）
    const angle = (1 - spread) * fullAngle * w.follow;
    const qRot = quat.fromAxisAngle(axis, angle);
    const offset = v3.add(w.anchorOffset, [0, 0, w.layer * (1 - spread)]);
    const rotatedOffset = quat.rotateVec(qRot, offset);
    w.record.position = v3.add(shoulder, rotatedOffset);
    const rotatedDir = quat.rotateVec(qRot, w.dir0);
    w.record.quaternion = quat.fromDirection(rotatedDir);
  }
}
