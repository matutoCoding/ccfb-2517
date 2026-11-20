// 颜色工具：hex <-> 线性 RGB（WGSL 在线性空间计算光照）

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(rgb: RGB): string {
  const to = (x: number) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

/** sRGB gamma -> 线性 */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function hexToLinear(hex: string): RGB {
  const rgb = hexToRgb(hex);
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}
