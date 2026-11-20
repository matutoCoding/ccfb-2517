// 标本与参数核心类型定义

export type RegionId = 'head' | 'neck' | 'belly' | 'back' | 'wing' | 'tail' | 'down';

export type FeatherArchetype = 'contour' | 'flight' | 'tail' | 'down';

/** 薄层干涉结构色参数（孔雀颈羽/鸽子颈羽等） */
export interface StructuralColor {
  /** 是否启用结构色 */
  enabled: boolean;
  /** 薄膜厚度 nm，决定干涉色相（典型 100~600） */
  thicknessNm: number;
  /** 薄膜折射率（角蛋白约 1.56，含黑色素颗粒可更高） */
  refractiveIndex: number;
  /** 结构色与色素底色的混合强度 0~1 */
  iridescence: number;
}

export interface RegionParams {
  /** 该部位羽毛数量 */
  count: number;
  /** 羽毛原型 */
  archetype: FeatherArchetype;
  /** 羽枝数量（单侧），决定羽毛几何精细度 */
  barbs: number;
  /** 羽毛长度（鸟体尺度归一化单位） */
  length: number;
  /** 羽片宽度占长度比例 */
  width: number;
  /** 羽毛密度表现：控制叠压与舒展，0~1 */
  density: number;
  /** 色素基色（hex，#rrggbb） */
  color: string;
  /** 羽尖颜色（hex） */
  tipColor: string;
  /** 各向异性强度 0~1（顺羽枝拉长的高光） */
  anisotropy: number;
  /** 结构色 */
  structural: StructuralColor;
}

export interface BirdProportions {
  /** 头部相对比例 0.5~1.8 */
  headRatio: number;
  /** 身体相对比例 0.6~1.6 */
  bodyRatio: number;
  /** 翅膀相对比例 0.5~1.8 */
  wingRatio: number;
  /** 尾羽相对比例 0.4~2.0 */
  tailRatio: number;
  /** 翅膀展开程度 0=收起 1=全展开 */
  wingSpread: number;
}

export interface Specimen {
  id: string;
  name: string;
  species: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  proportions: BirdProportions;
  regions: Record<RegionId, RegionParams>;
}

export type QualityLevel = 'low' | 'medium' | 'high';

export interface AppSettings {
  /** 渲染质量，影响羽毛数量上限与 DPR */
  quality: QualityLevel;
  /** 旋转灵敏度 */
  rotateSpeed: number;
  /** 是否显示帧率 */
  showFps: boolean;
  /** 展示页自动旋转 */
  autoRotate: boolean;
  /** 背景色（hex） */
  background: string;
  /** 实例数量上限（硬保护，防止显存超限） */
  maxInstances: number;
}

export interface InstanceRecord {
  /** 实例所属部位 */
  region: RegionId;
  /** 原型编号 */
  archetypeIndex: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
  color: [number, number, number];
  tipColor: [number, number, number];
  anisotropy: number;
  filmThickness: number;
  refractiveIndex: number;
  iridescence: number;
  /** 稳定随机种子（决定羽枝微小形态差异，同角度颜色稳定的关键） */
  seed: number;
}
