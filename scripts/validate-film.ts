/**
 * 结构色物理验证：将 WGSL thinFilmReflectance 的 Airy 公式移植到 TS
 * 验证：1) 同角度严格同色 2) 角度变化颜色变化 3) 膜厚决定色相
 */
const CIE_WAVELENGTHS = [420, 450, 480, 510, 540, 570, 600, 630, 660];
const CIE_X = [0.0049, 0.3362, 0.0956, 0.0735, 0.2904, 0.9163, 1.0622, 0.631, 0.1662];
const CIE_Y = [0.0012, 0.038, 0.139, 0.607, 0.954, 0.87, 0.631, 0.265, 0.061];
const CIE_Z = [0.0233, 1.7721, 0.813, 0.321, 0.073, 0.0105, 0.0008, 0, 0];

function fresnelPolarized(cosI: number, eta: number): [number, number] {
  const sinT2 = (1 - cosI * cosI) / (eta * eta);
  const cosT = Math.sqrt(Math.max(0, 1 - sinT2));
  const rs = (cosI - eta * cosT) / (cosI + eta * cosT + 1e-6);
  const rp = (eta * cosI - cosT) / (eta * cosI + cosT + 1e-6);
  return [rs * rs, rp * rp];
}

/** 与 WGSL thinFilmReflectance 逐行对应，返回线性 sRGB */
function thinFilmRGB(cosTheta: number, d: number, n1: number): [number, number, number] {
  const n0 = 1;
  const n2 = 1.45;
  const eta01 = n1 / n0;
  const eta12 = n2 / n1;
  const cosT = Math.sqrt(Math.max(0, 1 - (1 - cosTheta * cosTheta) / (eta01 * eta01)));
  const r01 = fresnelPolarized(cosTheta, eta01);
  const r12 = fresnelPolarized(cosT, eta12);
  const tt01 = [1 - r01[0], 1 - r01[1]];
  const phaseBase = 4 * Math.PI * n1 * d * cosT;
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < 9; i++) {
    const lambda = CIE_WAVELENGTHS[i];
    const c = Math.cos(phaseBase / lambda);
    let refl = 0;
    for (let k = 0; k < 2; k++) {
      const R1 = r01[k];
      const R2 = r12[k];
      const T01 = tt01[k];
      const denom = 1 + R1 * R1 * R2 * R2 - 2 * R1 * R2 * c + 1e-6;
      const numer =
        R1 + R2 * (T01 * T01 - R1 * R1) -
        2 * R1 * Math.sqrt(Math.max(0, R2 * (T01 * T01 - R1 * R1))) * c;
      refl += Math.min(1, Math.max(0, numer / denom));
    }
    const intensity = refl * 0.5;
    X += CIE_X[i] * intensity * 30;
    Y += CIE_Y[i] * intensity * 30;
    Z += CIE_Z[i] * intensity * 30;
  }
  X /= 10.568; Y /= 10.568; Z /= 10.568;
  return [
    Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z),
    Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z),
    Math.max(0, 0.0557 * X - 0.204 * Y + 1.057 * Z),
  ];
}

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✅ ${name} ${detail}`);
  else { failures++; console.error(`  ❌ ${name} ${detail}`); }
}

console.log('== 结构色（薄层干涉）物理性质 ==');

// 1. 同角度同色：完全相同输入必须逐位相等（无随机项）
const a = thinFilmRGB(0.72, 310, 1.6);
const b = thinFilmRGB(0.72, 310, 1.6);
check('同角度/同膜厚输出严格一致（结构色稳定性）', a.every((v, i) => v === b[i]), `rgb=(${a.map((v) => v.toFixed(4))})`);

// 2. 角度变化 -> 颜色变化（虹彩效应）
const normal = thinFilmRGB(0.98, 310, 1.6);
const grazing = thinFilmRGB(0.25, 310, 1.6);
const angleDelta = Math.hypot(normal[0] - grazing[0], normal[1] - grazing[1], normal[2] - grazing[2]);
check('视角变化引起颜色变化（虹彩）', angleDelta > 0.02, `Δ=${angleDelta.toFixed(4)}`);

// 3. 膜厚变化 -> 色相变化
const thin = thinFilmRGB(0.8, 220, 1.56);
const thick = thinFilmRGB(0.8, 480, 1.56);
const thicknessDelta = Math.hypot(thin[0] - thick[0], thin[1] - thick[1], thin[2] - thick[2]);
check('不同膜厚产生不同色相', thicknessDelta > 0.02, `Δ=${thicknessDelta.toFixed(4)}`);

// 4. 输出为有限非负数
const samples: [number, number, number][] = [];
for (const cos of [0.2, 0.5, 0.8, 0.99]) {
  for (const d of [150, 250, 350, 500]) samples.push(thinFilmRGB(cos, d, 1.56));
}
check('全部参数组合输出有限且非负', samples.flat().every((v) => Number.isFinite(v) && v >= 0));

// 5. 能量守恒：反射率不超过 1（映射后单通道允许大于1，但整体能量受控）
check('反射亮度处于合理区间（无数值爆炸）', samples.flat().every((v) => v < 5));

// 6. 310nm（孔雀颈参数）与 380nm（鸽颈参数）主色相不同
const peacock = thinFilmRGB(0.85, 310, 1.6);
const pigeon = thinFilmRGB(0.85, 380, 1.55);
const dominant = (rgb: number[]) => rgb.indexOf(Math.max(...rgb));
check('孔雀颈(310nm)与鸽颈(380nm)主通道不同或强度有别',
  dominant(peacock) !== dominant(pigeon) ||
  Math.abs(peacock[dominant(peacock)] - pigeon[dominant(pigeon)]) > 0.01,
  `peacock=(${peacock.map((v) => v.toFixed(3))}) pigeon=(${pigeon.map((v) => v.toFixed(3))})`);

// 7. 连续性：角度微变不应导致颜色跳变
const c1 = thinFilmRGB(0.7, 300, 1.56);
const c2 = thinFilmRGB(0.701, 300, 1.56);
const smoothDelta = Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);
check('角度微变时颜色连续（无闪烁跳变）', smoothDelta < 0.01, `Δ=${smoothDelta.toFixed(6)}`);

console.log('');
if (failures === 0) { console.log('🎉 结构色物理验证全部通过'); process.exit(0); }
else { console.error(`💥 ${failures} 项失败`); process.exit(1); }
