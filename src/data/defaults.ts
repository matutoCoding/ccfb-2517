import type { AppSettings, RegionId, RegionParams, Specimen } from '../types';

export const REGION_IDS: RegionId[] = ['head', 'neck', 'belly', 'back', 'wing', 'tail', 'down'];

export const REGION_LABELS: Record<RegionId, string> = {
  head: '头部',
  neck: '颈部',
  belly: '腹部',
  back: '背部',
  wing: '翅膀',
  tail: '尾羽',
  down: '绒羽',
};

export function defaultRegion(partial: Partial<RegionParams>): RegionParams {
  return {
    count: 400,
    archetype: 'contour',
    barbs: 24,
    length: 0.22,
    width: 0.45,
    density: 0.6,
    color: '#8a6f4d',
    tipColor: '#6b5438',
    anisotropy: 0.7,
    structural: {
      enabled: false,
      thicknessNm: 280,
      refractiveIndex: 1.56,
      iridescence: 0.8,
    },
    ...partial,
  };
}

function peacockRegions(): Record<RegionId, RegionParams> {
  return {
    head: defaultRegion({ count: 260, length: 0.14, width: 0.4, color: '#1d4e89', tipColor: '#163d6b', anisotropy: 0.75 }),
    neck: defaultRegion({
      count: 520, length: 0.17, width: 0.42, color: '#0b5d4e', tipColor: '#0a4a3e', anisotropy: 0.85,
      structural: { enabled: true, thicknessNm: 310, refractiveIndex: 1.6, iridescence: 0.95 },
    }),
    belly: defaultRegion({ count: 600, length: 0.2, width: 0.5, color: '#143f2e', tipColor: '#0e2f22', anisotropy: 0.6 }),
    back: defaultRegion({ count: 700, length: 0.24, width: 0.48, color: '#1a5c47', tipColor: '#124433', anisotropy: 0.7 }),
    wing: defaultRegion({ count: 1400, archetype: 'flight', barbs: 32, length: 0.62, width: 0.18, density: 0.9, color: '#2b3a30', tipColor: '#1c2820', anisotropy: 0.8 }),
    tail: defaultRegion({ count: 700, archetype: 'tail', barbs: 36, length: 0.95, width: 0.22, density: 0.85, color: '#3f7d4b', tipColor: '#1f5c3a', anisotropy: 0.75 }),
    down: defaultRegion({ count: 900, archetype: 'down', barbs: 18, length: 0.13, width: 0.9, color: '#5d6b58', tipColor: '#4a5546', density: 0.95, anisotropy: 0.2 }),
  };
}

function pigeonRegions(): Record<RegionId, RegionParams> {
  return {
    head: defaultRegion({ count: 220, length: 0.13, width: 0.4, color: '#7d8793', tipColor: '#66707c', anisotropy: 0.7 }),
    neck: defaultRegion({
      count: 460, length: 0.16, width: 0.44, color: '#6e7f8c', tipColor: '#55636e', anisotropy: 0.9,
      structural: { enabled: true, thicknessNm: 380, refractiveIndex: 1.55, iridescence: 0.9 },
    }),
    belly: defaultRegion({ count: 540, length: 0.19, width: 0.5, color: '#9aa3ab', tipColor: '#7e878f', anisotropy: 0.55 }),
    back: defaultRegion({ count: 620, length: 0.22, width: 0.46, color: '#8b959e', tipColor: '#6f7880', anisotropy: 0.65 }),
    wing: defaultRegion({ count: 1200, archetype: 'flight', barbs: 30, length: 0.5, width: 0.18, density: 0.88, color: '#5d666e', tipColor: '#454c53', anisotropy: 0.8 }),
    tail: defaultRegion({ count: 420, archetype: 'tail', barbs: 30, length: 0.46, width: 0.2, color: '#525b63', tipColor: '#3a4147', anisotropy: 0.7 }),
    down: defaultRegion({ count: 800, archetype: 'down', barbs: 16, length: 0.12, width: 0.9, color: '#a8afb5', tipColor: '#8d949a', density: 0.95, anisotropy: 0.2 }),
  };
}

function sparrowRegions(): Record<RegionId, RegionParams> {
  return {
    head: defaultRegion({ count: 200, length: 0.12, width: 0.4, color: '#9c7a4e', tipColor: '#7c5f3b', anisotropy: 0.6 }),
    neck: defaultRegion({ count: 300, length: 0.14, width: 0.44, color: '#b9a079', tipColor: '#96805f', anisotropy: 0.55 }),
    belly: defaultRegion({ count: 480, length: 0.17, width: 0.52, color: '#d3c4a3', tipColor: '#b3a484', anisotropy: 0.45 }),
    back: defaultRegion({ count: 560, length: 0.2, width: 0.46, color: '#8a6a42', tipColor: '#6d5232', anisotropy: 0.6 }),
    wing: defaultRegion({ count: 1050, archetype: 'flight', barbs: 28, length: 0.38, width: 0.18, density: 0.85, color: '#745634', tipColor: '#553e25', anisotropy: 0.75 }),
    tail: defaultRegion({ count: 320, archetype: 'tail', barbs: 26, length: 0.3, width: 0.2, color: '#6b5030', tipColor: '#4d3820', anisotropy: 0.65 }),
    down: defaultRegion({ count: 700, archetype: 'down', barbs: 14, length: 0.1, width: 0.9, color: '#c8bfa9', tipColor: '#aaa18c', density: 0.95, anisotropy: 0.15 }),
  };
}

export function createPresetSpecimen(
  kind: 'peacock' | 'pigeon' | 'sparrow',
  id: string,
  now: number,
): Specimen {
  const base = {
    id,
    createdAt: now,
    updatedAt: now,
    proportions: {
      headRatio: 1,
      bodyRatio: 1,
      wingRatio: 1,
      tailRatio: 1,
      wingSpread: 0,
    },
  };
  if (kind === 'peacock') {
    return {
      ...base,
      name: '蓝孔雀标本',
      species: 'Pavo cristatus',
      description: '颈部具金属光泽结构色，尾羽修长。结构色由角蛋白薄层干涉产生。',
      proportions: { ...base.proportions, tailRatio: 1.6, wingRatio: 1.25, wingSpread: 0 },
      regions: peacockRegions(),
    };
  }
  if (kind === 'pigeon') {
    return {
      ...base,
      name: '原鸽标本',
      species: 'Columba livia',
      description: '颈部绿紫色虹彩结构色，随观察角度变化。典型薄层干涉现象。',
      proportions: { ...base.proportions, wingRatio: 1.1 },
      regions: pigeonRegions(),
    };
  }
  return {
    ...base,
    name: '树麻雀标本',
    species: 'Passer montanus',
    description: '常规色素色羽毛，无结构色，用于对照观察。',
    proportions: { ...base.proportions, headRatio: 0.9, bodyRatio: 0.9, wingRatio: 0.85, tailRatio: 0.8 },
    regions: sparrowRegions(),
  };
}

export function createBlankSpecimen(id: string, now: number): Specimen {
  const regions = {
    head: defaultRegion({ count: 200 }),
    neck: defaultRegion({ count: 300 }),
    belly: defaultRegion({ count: 500 }),
    back: defaultRegion({ count: 600 }),
    wing: defaultRegion({ count: 1100, archetype: 'flight', barbs: 30, length: 0.45, width: 0.18 }),
    tail: defaultRegion({ count: 350, archetype: 'tail', barbs: 28, length: 0.4, width: 0.2 }),
    down: defaultRegion({ count: 800, archetype: 'down' }),
  };
  return {
    id,
    name: '未命名标本',
    species: '',
    description: '',
    createdAt: now,
    updatedAt: now,
    proportions: { headRatio: 1, bodyRatio: 1, wingRatio: 1, tailRatio: 1, wingSpread: 0 },
    regions,
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  quality: 'high',
  rotateSpeed: 1,
  showFps: true,
  autoRotate: false,
  background: '#101418',
  maxInstances: 14000,
};

/** 各质量档的实例数量缩放系数与 DPR 上限 */
export const QUALITY_SCALE: Record<AppSettings['quality'], { countScale: number; dpr: number }> = {
  low: { countScale: 0.4, dpr: 1 },
  medium: { countScale: 0.7, dpr: 1.5 },
  high: { countScale: 1, dpr: 2 },
};
