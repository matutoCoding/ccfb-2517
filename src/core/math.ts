// 轻量向量 / 四元数 / 矩阵数学库（行优先 Float32Array，列主序适配 WebGPU）
// WebGPU uniform 需要列主序矩阵，mat4 存储按列主序排列。

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Quat = [number, number, number, number];
export type Mat4 = Float32Array;

export const v3 = {
  add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  },
  sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },
  scale(a: Vec3, s: number): Vec3 {
    return [a[0] * s, a[1] * s, a[2] * s];
  },
  dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },
  cross(a: Vec3, b: Vec3): Vec3 {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  },
  len(a: Vec3): number {
    return Math.hypot(a[0], a[1], a[2]);
  },
  normalize(a: Vec3): Vec3 {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  },
  /** 确定性伪随机方向（斐波那契球扰动） */
  jitter(a: Vec3, amount: number, rng: () => number): Vec3 {
    const j: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
    return v3.normalize(v3.add(a, v3.scale(j, amount)));
  },
};

/** 确定性 PRNG：mulberry32，保证同标本每次生成完全一致 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字符串稳定哈希（标本 id -> 种子） */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const quat = {
  identity(): Quat {
    return [0, 0, 0, 1];
  },
  /** 绕单位轴 axis 旋转 angle（弧度） */
  fromAxisAngle(axis: Vec3, angle: number): Quat {
    const h = angle * 0.5;
    const s = Math.sin(h);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
  },
  multiply(a: Quat, b: Quat): Quat {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  },
  rotateVec(q: Quat, v: Vec3): Vec3 {
    const [x, y, z, w] = q;
    // q * v * q^-1
    const u: Vec3 = [x, y, z];
    const uv = v3.cross(u, v);
    const uuv = v3.cross(u, uv);
    return [
      v[0] + 2 * (w * uv[0] + uuv[0]),
      v[1] + 2 * (w * uv[1] + uuv[1]),
      v[2] + 2 * (w * uv[2] + uuv[2]),
    ];
  },
  /** 由局部 +X 方向 dir 与可选上方向构造朝向四元数 */
  fromDirection(dir: Vec3, upHint: Vec3 = [0, 1, 0]): Quat {
    const x = v3.normalize(dir);
    let z = v3.cross(x, upHint);
    if (v3.len(z) < 1e-5) z = v3.cross(x, [0, 0, 1]);
    z = v3.normalize(z);
    const y = v3.cross(z, x);
    // 旋转矩阵（行主序） -> 四元数
    const m = [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
    return quat.fromBasis(m);
  },
  /** m 为行主序 3x3：行0=X轴, 行1=Y轴, 行2=Z轴 */
  fromBasis(m: number[]): Quat {
    const t = m[0] + m[4] + m[8];
    let q: Quat;
    if (t > 0) {
      const s = Math.sqrt(t + 1) * 2;
      q = [(m[5] - m[7]) / s, (m[6] - m[2]) / s, (m[1] - m[3]) / s, 0.25 * s];
    } else if (m[0] > m[4] && m[0] > m[8]) {
      const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
      q = [0.25 * s, (m[3] + m[1]) / s, (m[6] + m[2]) / s, (m[5] - m[7]) / s];
    } else if (m[4] > m[8]) {
      const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
      q = [(m[3] + m[1]) / s, 0.25 * s, (m[7] + m[5]) / s, (m[6] - m[2]) / s];
    } else {
      const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
      q = [(m[6] + m[2]) / s, (m[7] + m[5]) / s, 0.25 * s, (m[1] - m[3]) / s];
    }
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  /** 球面插值 */
  slerp(a: Quat, b: Quat, t: number): Quat {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const target: Quat = [...b] as Quat;
    if (dot < 0) {
      dot = -dot;
      target[0] = -target[0];
      target[1] = -target[1];
      target[2] = -target[2];
      target[3] = -target[3];
    }
    if (dot > 0.9995) {
      const r: Quat = [
        a[0] + (target[0] - a[0]) * t,
        a[1] + (target[1] - a[1]) * t,
        a[2] + (target[2] - a[2]) * t,
        a[3] + (target[3] - a[3]) * t,
      ];
      const l = Math.hypot(...r) || 1;
      return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
    }
    const theta0 = Math.acos(Math.min(1, dot));
    const theta = theta0 * t;
    const sinTheta = Math.sin(theta);
    const sinTheta0 = Math.sin(theta0);
    const s1 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
    const s2 = sinTheta / sinTheta0;
    return [
      s1 * a[0] + s2 * target[0],
      s1 * a[1] + s2 * target[1],
      s1 * a[2] + s2 * target[2],
      s1 * a[3] + s2 * target[3],
    ];
  },
};

/** 列主序 4x4（适配 WebGPU） */
export const mat4 = {
  identity(): Mat4 {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = far * nf;
    m[11] = -1;
    m[14] = far * near * nf;
    return m;
  },
  lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
    const z = v3.normalize(v3.sub(eye, target));
    const x = v3.normalize(v3.cross(up, z));
    const y = v3.cross(z, x);
    const m = new Float32Array(16);
    // 列主序
    m[0] = x[0]; m[1] = x[1]; m[2] = x[2];
    m[4] = y[0]; m[5] = y[1]; m[6] = y[2];
    m[8] = z[0]; m[9] = z[1]; m[10] = z[2];
    m[12] = -v3.dot(x, eye);
    m[13] = -v3.dot(y, eye);
    m[14] = -v3.dot(z, eye);
    m[15] = 1;
    return m;
  },
  multiply(a: Mat4, b: Mat4): Mat4 {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = s;
      }
    }
    return out;
  },
  invert(a: Mat4): Mat4 {
    const out = new Float32Array(16);
    const inv = new Float32Array(16);
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[3] * a[11] - a[5] * a[2] * a[10] - a[9] * a[3] * a[7] + a[9] * a[2] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[3] * a[11] + a[4] * a[2] * a[10] + a[8] * a[3] * a[7] - a[8] * a[2] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    if (det === 0) return mat4.identity();
    det = 1 / det;
    for (let i = 0; i < 16; i++) out[i] = inv[i] * det;
    return out;
  },
};

/** 轨道相机状态 */
export interface OrbitState {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;
}

export function orbitViewMatrix(o: OrbitState): Mat4 {
  const cp = Math.cos(o.pitch);
  const eye: Vec3 = [
    o.target[0] + o.distance * cp * Math.sin(o.yaw),
    o.target[1] + o.distance * Math.sin(o.pitch),
    o.target[2] + o.distance * cp * Math.cos(o.yaw),
  ];
  return mat4.lookAt(eye, o.target, [0, 1, 0]);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
