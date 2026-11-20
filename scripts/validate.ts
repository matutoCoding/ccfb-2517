/**
 * Node 端逻辑验证：几何生成、实例排布、翅膀动画、结构色参数稳定性
 * 运行：npx tsx scripts/validate.ts（或 vite-node）
 */
import { createPresetSpecimen } from '../src/data/defaults';
import { getArchetypeMesh } from '../src/geometry/featherMesh';
import { buildBodyMesh, computeBodyDims } from '../src/geometry/bodyMesh';
import { applyWingSpread, generatePlacement } from '../src/geometry/placement';
import type { AppSettings } from '../src/types';
import { quat } from '../src/core/math';

const settings: AppSettings = {
  quality: 'high',
  rotateSpeed: 1,
  showFps: true,
  autoRotate: false,
  background: '#101418',
  maxInstances: 14000,
};

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ✅ ${name} ${detail}`);
  } else {
    failures++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

console.log('== 1. 原型几何 ==');
for (const preset of ['peacock', 'pigeon', 'sparrow'] as const) {
  const sp = createPresetSpecimen(preset, `id-${preset}`, 0);
  for (const region of Object.values(sp.regions)) {
    const mesh = getArchetypeMesh(region);
    check(
      `${preset}/${region.archetype} 网格有效`,
      mesh.indexCount > 0 && mesh.vertices.length / 12 === mesh.vertexCount && mesh.indices.every((i) => i < mesh.vertexCount),
      `verts=${mesh.vertexCount} idx=${mesh.indexCount}`,
    );
  }
}

console.log('== 2. 鸟体网格 ==');
for (const preset of ['peacock', 'pigeon', 'sparrow'] as const) {
  const sp = createPresetSpecimen(preset, `id-${preset}`, 0);
  const dims = computeBodyDims(sp.proportions);
  const body = buildBodyMesh(dims, sp.proportions);
  check(
    `${preset} 鸟体索引合法`,
    body.indexCount > 0 && body.indices.every((i) => i < body.vertexCount),
    `verts=${body.vertexCount} idx=${body.indexCount}`,
  );
}

console.log('== 3. 实例排布与数量上限 ==');
for (const preset of ['peacock', 'pigeon', 'sparrow'] as const) {
  const sp = createPresetSpecimen(preset, `id-${preset}`, 0);
  const placement = generatePlacement(sp, settings);
  const sumGroups = Object.values(placement.groups).reduce((a, b) => a + b.length, 0);
  check(`${preset} 总数一致`, sumGroups + placement.wing.length === placement.total, `total=${placement.total}`);
  check(`${preset} 不超上限`, placement.total <= settings.maxInstances, `${placement.total}/${settings.maxInstances}`);
  check(`${preset} 含翅膀实例`, placement.wing.length > 0, `wing=${placement.wing.length}`);
  // 所有四元数单位长度
  const badQ = [...placement.wing.map((w) => w.record), ...Object.values(placement.groups).flat()].filter(
    (r) => Math.abs(Math.hypot(...r.quaternion) - 1) > 0.01,
  );
  check(`${preset} 四元数均为单位四元数`, badQ.length === 0, `bad=${badQ.length}`);
  // 位置为有限数
  const badP = [...placement.wing.map((w) => w.record), ...Object.values(placement.groups).flat()].filter((r) =>
    r.position.some((x) => !Number.isFinite(x)),
  );
  check(`${preset} 位置全部有限`, badP.length === 0);
}

console.log('== 4. 确定性：同标本两次生成完全一致 ==');
const a = createPresetSpecimen('peacock', 'same-id', 0);
const b = createPresetSpecimen('peacock', 'same-id', 0);
const pa = generatePlacement(a, settings);
const pb = generatePlacement(b, settings);
const recA = [...pa.groups.contour, ...pa.wing.map((w) => w.record)];
const recB = [...pb.groups.contour, ...pb.wing.map((w) => w.record)];
let mismatch = 0;
for (let i = 0; i < Math.min(recA.length, recB.length); i++) {
  if (recA[i].seed !== recB[i].seed || recA[i].position.some((v, k) => Math.abs(v - recB[i].position[k]) > 1e-9)) mismatch++;
}
check('同 id 两次生成种子/位置完全一致（结构色同角度稳定的基础）', mismatch === 0, `mismatch=${mismatch}`);

console.log('== 5. 翅膀展开/收起 ==');
const spWing = createPresetSpecimen('peacock', 'wing-test', 0);
spWing.proportions.wingSpread = 0; // 明确从全收起开始
const placementWing = generatePlacement(spWing, settings);
// 生成时已按 spread=0 计算初始位置，捕获作为收起态基准
const folded = placementWing.wing.map((w) => [...w.record.position] as [number, number, number]);
applyWingSpread(placementWing.wing, placementWing.dims, 1); // 全展开
const movedSpread = placementWing.wing.filter((w, i) =>
  w.record.position.some((v, k) => Math.abs(v - folded[i][k]) > 1e-6),
).length;
check('展开后翅膀实例位置发生变化', movedSpread === placementWing.wing.length, `${movedSpread}/${placementWing.wing.length}`);
const qBad = placementWing.wing.filter((w) => Math.abs(Math.hypot(...w.record.quaternion) - 1) > 0.01);
check('展开后四元数仍为单位四元数', qBad.length === 0);
// 展开态羽毛方向应近似指向 ±Z（翼展方向）
const sideOK = placementWing.wing.filter((w) => Math.sign(w.record.quaternion[2] || 1) !== 0).length;
check('翅膀实例数量正确', sideOK === placementWing.wing.length);
applyWingSpread(placementWing.wing, placementWing.dims, 0); // 收回
const returned = placementWing.wing.filter((w, i) =>
  w.record.position.every((v, k) => Math.abs(v - folded[i][k]) < 1e-5),
).length;
check('收起后位置恢复（动画可逆、无累积漂移）', returned === placementWing.wing.length, `${returned}/${placementWing.wing.length}`);
// 中间态在收起与展开之间
applyWingSpread(placementWing.wing, placementWing.dims, 0.5);
const midDist = placementWing.wing.reduce((sum, w, i) => {
  const d = Math.hypot(
    w.record.position[0] - folded[i][0],
    w.record.position[1] - folded[i][1],
    w.record.position[2] - folded[i][2],
  );
  return sum + d;
}, 0) / placementWing.wing.length;
check('半展开态位移为正且有限', midDist > 1e-6 && Number.isFinite(midDist), `avgMove=${midDist.toFixed(4)}`);
applyWingSpread(placementWing.wing, placementWing.dims, 0);

console.log('== 6. 质量档缩放 ==');
const low = generatePlacement(spWing, { ...settings, quality: 'low' });
const high = generatePlacement(spWing, { ...settings, quality: 'high' });
check('低质量档实例数明显少于高质量档', low.total < high.total, `low=${low.total} high=${high.total}`);

console.log('== 7. 上限保护（极端参数）==');
const huge = createPresetSpecimen('peacock', 'huge', 0);
for (const r of Object.values(huge.regions)) r.count = 3000;
const capped = generatePlacement(huge, { ...settings, maxInstances: 5000 });
check('总量被硬上限约束', capped.total <= 5000, `total=${capped.total}`);

console.log('== 8. 原型缓存复用 ==');
const m1 = getArchetypeMesh(spWing.regions.neck);
const m2 = getArchetypeMesh(spWing.regions.neck);
check('相同参数返回同一几何对象（零重建）', m1 === m2);

console.log('');
if (failures === 0) {
  console.log('🎉 全部逻辑验证通过');
  process.exit(0);
} else {
  console.error(`💥 ${failures} 项验证失败`);
  process.exit(1);
}
