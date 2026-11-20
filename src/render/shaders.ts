// 薄层干涉 + 各向异性 GGX 的 WGSL 实现
// 结构色采用 Airy 反射公式，9 个可见光谱段积分 -> CIE XYZ -> 线性 sRGB
// 同角度颜色稳定：所有随机性来自实例种子，无帧相关噪声

export const FILM_WGSL = /* wgsl */ `
// CIE 1931 标准色度观察者（420~660nm，间隔 30nm，9 个采样点）
const CIE_WAVELENGTHS = array<f32, 9>(420.0, 450.0, 480.0, 510.0, 540.0, 570.0, 600.0, 630.0, 660.0);
const CIE_X = array<f32, 9>(0.0049, 0.3362, 0.0956, 0.0735, 0.2904, 0.9163, 1.0622, 0.6310, 0.1662);
const CIE_Y = array<f32, 9>(0.0012, 0.0380, 0.1390, 0.6070, 0.9540, 0.8700, 0.6310, 0.2650, 0.0610);
const CIE_Z = array<f32, 9>(0.0233, 1.7721, 0.8130, 0.3210, 0.0730, 0.0105, 0.0008, 0.0000, 0.0000);
const SPECTRAL_STEP: f32 = 30.0;
// 标准光源 D65 的归一化系数（使等能白光 Y=1）
const D65_NORMALIZE: f32 = 10.568;

fn fresnelPolarized(cosI: f32, eta: f32) -> vec2<f32> {
  let sinT2 = (1.0 - cosI * cosI) / (eta * eta);
  let cosT = sqrt(max(0.0, 1.0 - sinT2));
  let rs = (cosI - eta * cosT) / (cosI + eta * cosT + 1e-6);
  let rp = (eta * cosI - cosT) / (eta * cosI + cosT + 1e-6);
  return vec2<f32>(rs * rs, rp * rp);
}

// Airy 薄层反射：膜厚 d(nm)、膜折射率 n1，入射角 cosTheta
fn thinFilmReflectance(cosTheta: f32, d: f32, n1: f32) -> vec3<f32> {
  let n0 = 1.0;                                   // 空气
  let n2 = 1.45;                                  // 黑色素基底近似
  let eta01 = n1 / n0;
  let eta12 = n2 / n1;
  let cosT = sqrt(max(0.0, 1.0 - (1.0 - cosTheta * cosTheta) / (eta01 * eta01)));
  let r01 = fresnelPolarized(cosTheta, eta01);
  let r12 = fresnelPolarized(cosT, eta12);
  let tt01 = vec2<f32>(1.0 - r01.x, 1.0 - r01.y);
  let phaseBase = 4.0 * 3.14159265 * n1 * d * cosT; // 单位 nm，波长也为 nm

  var xyz = vec3<f32>(0.0);
  for (var i = 0; i < 9; i++) {
    let lambda = CIE_WAVELENGTHS[i];
    let delta = phaseBase / lambda;
    let c = cos(delta);
    // 两偏振方向分别做多次反射干涉求和
    var refl = 0.0;
    for (var k = 0; k < 2; k++) {
      let R1 = r01[k];
      let R2 = r12[k];
      let T01 = tt01[k];
      let denom = 1.0 + R1 * R1 * R2 * R2 - 2.0 * R1 * R2 * c + 1e-6;
      let numer = R1 + R2 * (T01 * T01 - R1 * R1) - 2.0 * R1 * sqrt(max(0.0, R2 * (T01 * T01 - R1 * R1))) * c;
      refl += clamp(numer / denom, 0.0, 1.0);
    }
    let intensity = refl * 0.5; // 两偏振平均
    // 反射光谱 -> CIE XYZ（矩形积分）
    xyz += vec3<f32>(CIE_X[i], CIE_Y[i], CIE_Z[i]) * intensity * SPECTRAL_STEP;
  }
  xyz = xyz / D65_NORMALIZE;
  // CIE XYZ（D65 白点）-> 线性 sRGB
  var rgb = vec3<f32>(
    dot(vec3<f32>(3.2406, -1.5372, -0.4986), xyz),
    dot(vec3<f32>(-0.9689, 1.8758, 0.0415), xyz),
    dot(vec3<f32>(0.0557, -0.2040, 1.0570), xyz),
  );
  return max(vec3<f32>(0.0), rgb);
}

// 各向异性 GGX 法线分布（tangent 为顺羽枝方向，高光垂直羽枝拉长）
fn ggxAnisotropic(nDotH: f32, tDotH: f32, bDotH: f32, alphaT: f32, alphaB: f32) -> f32 {
  let a2 = alphaT * alphaB;
  let d2 = tDotH * tDotH / (alphaT * alphaT) + bDotH * bDotH / (alphaB * alphaB) + nDotH * nDotH;
  return 1.0 / (3.14159265 * a2 * d2 * d2 + 1e-6);
}

// 羽毛完整光照：包裹漫反射 + 各向异性高光 + 结构色
fn shadeFeather(
  worldPos: vec3<f32>,
  normal: vec3<f32>,
  tangent: vec3<f32>,
  baseColor: vec3<f32>,
  anisotropy: f32,
  filmThickness: f32,
  eta: f32,
  iridescence: f32,
  isShaft: f32,
  camPos: vec3<f32>,
  lightDir: vec3<f32>,
) -> vec3<f32> {
  let N = normalize(normal);
  let V = normalize(camPos - worldPos);
  let L = normalize(lightDir);
  let H = normalize(V + L);
  let nDotL = max(0.0, dot(N, L));
  let nDotV = max(0.0, dot(N, V));
  let nDotH = max(0.0, dot(N, H));
  let T = normalize(tangent - N * dot(tangent, N));
  let B = normalize(cross(N, T));
  let tDotH = dot(T, H);
  let bDotH = dot(B, H);

  // 包裹漫反射（羽毛柔和透光感）
  let wrap = clamp((nDotL + 0.35) / 1.35, 0.0, 1.0);
  let ambient = vec3<f32>(0.16, 0.18, 0.22) + max(0.0, N.y) * vec3<f32>(0.05, 0.06, 0.07);
  var diffuse = baseColor * (wrap * vec3<f32>(1.05, 1.0, 0.92) * 1.15 + ambient);

  // 各向异性：沿羽枝切线 alpha 小、垂直方向 alpha 大 => 高光顺羽枝拉长
  let baseAlpha = mix(0.9, 0.18, clamp(anisotropy, 0.0, 1.0));
  let alphaT = mix(baseAlpha, 0.12, isShaft);
  let alphaB = mix(0.9, 0.95, clamp(anisotropy, 0.0, 1.0));
  let D = ggxAnisotropic(nDotH, tDotH, bDotH, alphaT, alphaB);
  let alpha = sqrt(alphaT * alphaB);
  let k = alpha * 0.5;
  let gV = nDotV / (nDotV * (1.0 - k) + k + 1e-6);
  let gL = nDotL / (nDotL * (1.0 - k) + k + 1e-6);
  let specStrength = mix(0.55, 0.9, isShaft);
  let specular = vec3<f32>(specStrength) * D * gV * gL * 0.32;

  var color = diffuse + specular;

  // 结构色：薄层干涉，视角/光照决定光程差，种子不参与 => 同角度严格同色
  if (filmThickness > 0.0 && iridescence > 0.0) {
    let cosFilm = clamp(max(nDotV, dot(N, H)), 0.08, 1.0);
    let film = thinFilmReflectance(cosFilm, filmThickness, eta);
    let filmEnergy = clamp(dot(film, vec3<f32>(0.2126, 0.7152, 0.0722)) * 2.2, 0.0, 1.0);
    let mixed = mix(baseColor, film, clamp(iridescence * (0.55 + 0.45 * filmEnergy), 0.0, 1.0));
    let structDiffuse = mixed * (wrap * 1.15 + ambient);
    color = mix(color, structDiffuse + film * 0.25, iridescence);
  }
  return color;
}
`;

export const FEATHER_SHADER = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  camPos: vec4<f32>,
  lightDir: vec4<f32>,
};
@group(0) @binding(0) var<uniform> camera: Camera;

struct Instance {
  model0: vec4<f32>,  // 模型矩阵列0 + seed
  model1: vec4<f32>,  // 列1 + anisotropy
  model2: vec4<f32>,  // 列2 + filmThickness
  model3: vec4<f32>,  // 列3 + eta
  color: vec4<f32>,   // rgb + iridescence
  tipColor: vec4<f32>,
};
@group(0) @binding(1) var<storage, read> instances: array<Instance>;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) tangent: vec3<f32>,
  @location(3) along: f32,
  @location(4) across: f32,
  @location(5) edge: f32,
};
struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) tangent: vec3<f32>,
  @location(3) color: vec3<f32>,
  @location(4) anisotropy: f32,
  @location(5) film: vec4<f32>,
  @location(6) edge: f32,
};

fn instanceModel(it: Instance) -> mat4x4<f32> {
  return mat4x4<f32>(
    vec4<f32>(it.model0.xyz, 0.0),
    vec4<f32>(it.model1.xyz, 0.0),
    vec4<f32>(it.model2.xyz, 0.0),
    vec4<f32>(it.model3.xyz, 1.0),
  );
}

@vertex
fn vsMain(@builtin(instance_index) ii: u32, vin: VsIn) -> VsOut {
  let it = instances[ii];
  let model = instanceModel(it);
  let world = model * vec4<f32>(vin.position, 1.0);
  var out: VsOut;
  out.clip = camera.viewProj * world;
  out.worldPos = world.xyz;
  out.normal = normalize((model * vec4<f32>(vin.normal, 0.0)).xyz);
  out.tangent = normalize((model * vec4<f32>(vin.tangent, 0.0)).xyz);
  // 羽根到羽尖的色素渐变
  out.color = mix(it.color.rgb, it.tipColor.rgb, clamp(vin.along * 0.9, 0.0, 1.0));
  out.anisotropy = it.model1.w;
  out.film = vec4<f32>(it.model2.w, it.model3.w, it.color.w, 0.0);
  out.edge = vin.edge;
  return out;
}

${FILM_WGSL}

@fragment
fn fsMain(vout: VsOut) -> @location(0) vec4<f32> {
  let isShaft = f32(vout.edge > 1.5);
  let col = shadeFeather(
    vout.worldPos, vout.normal, vout.tangent, vout.color,
    vout.anisotropy, vout.film.x, vout.film.y, vout.film.z,
    isShaft, camera.camPos.xyz, camera.lightDir.xyz,
  );
  // 羽枝边缘软化：edge=1 的顶点做 alpha 裁剪式渐隐（配合 MSAA 抗锯齿）
  var alpha = 1.0;
  if (vout.edge > 0.5 && vout.edge < 1.5) {
    alpha = 0.85;
  }
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(4.0)), alpha);
}
`;

export const BODY_SHADER = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  camPos: vec4<f32>,
  lightDir: vec4<f32>,
};
@group(0) @binding(0) var<uniform> camera: Camera;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
};
struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
};

@vertex
fn vsMain(vin: VsIn) -> VsOut {
  var out: VsOut;
  out.clip = camera.viewProj * vec4<f32>(vin.position, 1.0);
  out.worldPos = vin.position;
  out.normal = normalize(vin.normal);
  out.color = vin.color;
  return out;
}

@fragment
fn fsMain(vout: VsOut) -> @location(0) vec4<f32> {
  let N = normalize(vout.normal);
  let L = normalize(camera.lightDir.xyz);
  let V = normalize(camera.camPos.xyz - vout.worldPos);
  let H = normalize(L + V);
  let nDotL = max(0.0, dot(N, L));
  let wrap = clamp((nDotL + 0.3) / 1.3, 0.0, 1.0);
  let ambient = vec3<f32>(0.18, 0.2, 0.24) + max(0.0, N.y) * vec3<f32>(0.06);
  let shin = pow(max(0.0, dot(N, H)), 28.0) * 0.12;
  let col = vout.color * (wrap * vec3<f32>(1.05, 1.0, 0.92) + ambient) + vec3<f32>(shin);
  return vec4<f32>(col, 1.0);
}
`;
