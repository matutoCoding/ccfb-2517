import type { FeatherArchetype, InstanceRecord } from '../types';
import { mat4, type Mat4, type OrbitState } from '../core/math';
import { hexToLinear } from '../core/color';
import { BODY_SHADER, FEATHER_SHADER } from './shaders';
import { INSTANCE_BYTES, INSTANCE_FLOATS, type PlacementResult } from '../geometry/placement';
import type { ArchetypeMesh } from '../geometry/featherMesh';
import type { BodyMesh } from '../geometry/bodyMesh';

const ARCH_ORDER: FeatherArchetype[] = ['contour', 'flight', 'tail', 'down'];

export interface RenderScene {
  placement: PlacementResult;
  archetypes: Record<FeatherArchetype, ArchetypeMesh>;
  body: BodyMesh;
  background: string;
}

export async function requireWebGPU(): Promise<GPUAdapter> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    throw new Error('NO_WEBGPU');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('NO_ADAPTER');
  return adapter;
}

function createBuffer(device: GPUDevice, usage: number, data?: ArrayBufferView): GPUBuffer {
  const buffer = device.createBuffer({
    size: data ? Math.max(16, Math.ceil(data.byteLength / 16) * 16) : 16,
    usage,
    mappedAtCreation: !!data,
  });
  if (data) {
    new Uint8Array(buffer.getMappedRange()).set(
      new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength),
    );
    buffer.unmap();
  }
  return buffer;
}

/** 类型安全的 writeBuffer 包装（规避 TS TypedArray 泛型与 BufferSource 的兼容性问题） */
function writeF32(device: GPUDevice, buffer: GPUBuffer, offsetBytes: number, data: Float32Array, srcFloats = 0, lengthFloats?: number): void {
  const len = lengthFloats ?? data.length - srcFloats;
  device.queue.writeBuffer(buffer, offsetBytes, data.buffer as ArrayBuffer, srcFloats * 4, len * 4);
}

function writeInstance(arr: Float32Array, offset: number, rec: InstanceRecord): void {
  const o = offset * INSTANCE_FLOATS;
  const [px, py, pz] = rec.position;
  const [qx, qy, qz, qw] = rec.quaternion;
  const [sx, sy, sz] = rec.scale;
  // 四元数 -> 3x3 旋转（含缩放），列主序写入模型矩阵列
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  const r00 = (1 - 2 * (yy + zz)) * sx;
  const r01 = 2 * (xy - wz) * sx;
  const r02 = 2 * (xz + wy) * sx;
  const r10 = 2 * (xy + wz) * sy;
  const r11 = (1 - 2 * (xx + zz)) * sy;
  const r12 = 2 * (yz - wx) * sy;
  const r20 = 2 * (xz - wy) * sz;
  const r21 = 2 * (yz + wx) * sz;
  const r22 = (1 - 2 * (xx + yy)) * sz;
  // 列0: r00,r10,r20,seed ; 列1: r01,r11,r21,anisotropy ; ...
  arr[o + 0] = r00; arr[o + 1] = r10; arr[o + 2] = r20; arr[o + 3] = rec.seed;
  arr[o + 4] = r01; arr[o + 5] = r11; arr[o + 6] = r21; arr[o + 7] = rec.anisotropy;
  arr[o + 8] = r02; arr[o + 9] = r12; arr[o + 10] = r22; arr[o + 11] = rec.filmThickness;
  arr[o + 12] = px; arr[o + 13] = py; arr[o + 14] = pz; arr[o + 15] = rec.refractiveIndex;
  arr[o + 16] = rec.color[0]; arr[o + 17] = rec.color[1]; arr[o + 18] = rec.color[2]; arr[o + 19] = rec.iridescence;
  arr[o + 20] = rec.tipColor[0]; arr[o + 21] = rec.tipColor[1]; arr[o + 22] = rec.tipColor[2]; arr[o + 23] = 0;
}

export class FeatherRenderer {
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  device!: GPUDevice;
  private cameraBuffer!: GPUBuffer;
  private bodyVB!: GPUBuffer;
  private bodyIB!: GPUBuffer;
  private bodyCount = 0;
  private archVB: GPUBuffer[] = [];
  private archIB: GPUBuffer[] = [];
  private archIndexCount: number[] = [];
  private instanceBuffer!: GPUBuffer;
  private instanceData = new Float32Array(0);
  private capacity = 0;
  private ranges: { start: number; count: number }[] = [];
  private bodyPipeline!: GPURenderPipeline;
  private featherPipeline!: GPURenderPipeline;
  private bodyBind!: GPUBindGroup;
  private featherBind!: GPUBindGroup;
  private scene: RenderScene | null = null;
  private sampleCount = 4;
  private msaa: GPUTexture | null = null;
  private depth: GPUTexture | null = null;
  private width = 1;
  private height = 1;
  private lightDir: [number, number, number] = [0.55, 0.8, 0.42];

  constructor(canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
  }

  static async create(canvas: HTMLCanvasElement, adapter: GPUAdapter): Promise<FeatherRenderer> {
    const r = new FeatherRenderer(canvas);
    await r.init(adapter);
    return r;
  }

  private async init(adapter: GPUAdapter): Promise<void> {
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    this.device = device;
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.sampleCount = 4;

    this.cameraBuffer = createBuffer(device, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, new Float32Array(48));

    const cameraLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    const featherLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    const bodyModule = device.createShaderModule({ code: BODY_SHADER });
    const featherModule = device.createShaderModule({ code: FEATHER_SHADER });

    const bodyLayout = device.createPipelineLayout({ bindGroupLayouts: [cameraLayout] });
    this.bodyPipeline = device.createRenderPipeline({
      layout: bodyLayout,
      vertex: {
        module: bodyModule,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 9 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: {
        module: bodyModule,
        entryPoint: 'fsMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
      multisample: { count: this.sampleCount },
    });
    this.featherPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [featherLayout] }),
      vertex: {
        module: featherModule,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 12 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x3' },
              { shaderLocation: 3, offset: 36, format: 'float32' },
              { shaderLocation: 4, offset: 40, format: 'float32' },
              { shaderLocation: 5, offset: 44, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: featherModule,
        entryPoint: 'fsMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
      multisample: { count: this.sampleCount },
    });
    this.bodyBind = device.createBindGroup({
      layout: cameraLayout,
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }],
    });
  }

  setScene(scene: RenderScene): void {
    const device = this.device;
    this.scene = scene;

    // 鸟体网格
    this.bodyVB?.destroy();
    this.bodyIB?.destroy();
    this.bodyVB = createBuffer(device, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, scene.body.vertices);
    this.bodyIB = createBuffer(device, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, scene.body.indices);
    this.bodyCount = scene.body.indexCount;

    // 四种羽毛原型（几何内容相同时复用旧缓冲，避免滑杆拖动时的无效重建）
    const newVB: GPUBuffer[] = [];
    const newIB: GPUBuffer[] = [];
    const newCounts: number[] = [];
    ARCH_ORDER.forEach((arch, i) => {
      const mesh = scene.archetypes[arch];
      const old = this.archIndexCount[i];
      if (old === mesh.indexCount && this.archVB[i] && this.archIB[i]) {
        newVB.push(this.archVB[i]);
        newIB.push(this.archIB[i]);
      } else {
        this.archVB[i]?.destroy();
        this.archIB[i]?.destroy();
        newVB.push(createBuffer(device, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, mesh.vertices));
        newIB.push(createBuffer(device, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, mesh.indices));
      }
      newCounts.push(mesh.indexCount);
    });
    this.archVB = newVB;
    this.archIB = newIB;
    this.archIndexCount = newCounts;

    // 实例缓冲：静态分组 + 翅膀，按原型顺序排列
    this.rebuildInstances();
  }

  /** 仅刷新实例数据（排布/颜色/材质变化、几何不变时使用，代价远低于 setScene） */
  updateInstances(scene: RenderScene): void {
    this.scene = scene;
    this.rebuildInstances();
  }

  private rebuildInstances(): void {
    if (!this.scene) return;
    const { placement } = this.scene;
    const total = placement.total;
    let needed = Math.max(16, Math.ceil(total / 16) * 16);
    // 适配器存储缓冲绑定上限保护（典型 128MB，至少支持 100 万+ 实例）
    const maxBindInstances = Math.floor(
      this.device.limits.maxStorageBufferBindingSize / INSTANCE_BYTES,
    );
    needed = Math.min(needed, Math.max(16, maxBindInstances));
    if (needed > this.capacity) {
      this.instanceBuffer?.destroy();
      this.capacity = Math.max(needed, 2048);
      this.instanceBuffer = this.device.createBuffer({
        size: this.capacity * INSTANCE_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.instanceData = new Float32Array(this.capacity * INSTANCE_FLOATS);
      this.featherBind = this.device.createBindGroup({
        layout: this.featherPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.cameraBuffer } },
          { binding: 1, resource: { buffer: this.instanceBuffer } },
        ],
      });
    }

    let cursor = 0;
    this.ranges = [];
    for (const arch of ARCH_ORDER) {
      const start = cursor;
      for (const rec of placement.groups[arch]) {
        writeInstance(this.instanceData, cursor++, rec);
      }
      // 翅膀飞羽追加到 flight 原型区间末尾
      if (arch === 'flight') {
        for (const w of placement.wing) {
          writeInstance(this.instanceData, cursor++, w.record);
        }
      }
      this.ranges.push({ start, count: cursor - start });
    }
    writeF32(this.device, this.instanceBuffer, 0, this.instanceData, 0, needed * INSTANCE_FLOATS);
  }

  /** 翅膀动画后，仅重写翅膀实例区间 */
  syncWingInstances(): void {
    if (!this.scene) return;
    const { placement } = this.scene;
    if (placement.wing.length === 0) return;
    const flightRange = this.ranges[1];
    const wingStart = flightRange.start + flightRange.count - placement.wing.length;
    let cursor = wingStart;
    for (const w of placement.wing) {
      writeInstance(this.instanceData, cursor++, w.record);
    }
    writeF32(
      this.device,
      this.instanceBuffer,
      wingStart * INSTANCE_BYTES,
      this.instanceData,
      wingStart * INSTANCE_FLOATS,
      placement.wing.length * INSTANCE_FLOATS,
    );
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.msaa?.destroy();
    this.depth?.destroy();
    this.msaa = this.device.createTexture({
      size: [this.width, this.height],
      sampleCount: this.sampleCount,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depth = this.device.createTexture({
      size: [this.width, this.height],
      sampleCount: this.sampleCount,
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  setCamera(orbit: OrbitState): void {
    const aspect = this.width / this.height;
    const proj = mat4.perspective((45 * Math.PI) / 180, aspect, 0.1, 100);
    const view = orbitView(orbit);
    const viewProj = mat4.multiply(proj, view);
    const full = new Float32Array(48);
    full.set(viewProj, 0);
    const cp = Math.cos(orbit.pitch);
    const eye = [
      orbit.target[0] + orbit.distance * cp * Math.sin(orbit.yaw),
      orbit.target[1] + orbit.distance * Math.sin(orbit.pitch),
      orbit.target[2] + orbit.distance * cp * Math.cos(orbit.yaw),
    ];
    full.set(eye, 16);
    full.set([this.lightDir[0], this.lightDir[1], this.lightDir[2], 0], 20);
    writeF32(this.device, this.cameraBuffer, 0, full);
  }

  render(): void {
    if (!this.scene) return;
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.msaa!.createView(),
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: hexClear(this.scene.background),
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
      depthStencilAttachment: {
        view: this.depth!.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    this.recordDraw(pass);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** 读取当前画布像素（用于截图），返回原始字节（格式同画布，可能为 bgra） */
  async capturePixels(): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
    // 离屏 MSAA 纹理 + 单采样 resolve 纹理（resolveTarget 需与管线 sampleCount 一致）
    const msaa = this.device.createTexture({
      size: [this.width, this.height],
      sampleCount: this.sampleCount,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const resolved = this.device.createTexture({
      size: [this.width, this.height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const depth = this.device.createTexture({
      size: [this.width, this.height],
      sampleCount: this.sampleCount,
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: msaa.createView(),
          resolveTarget: resolved.createView(),
          clearValue: hexClear(this.scene?.background ?? '#101418'),
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    this.recordDraw(pass);
    pass.end();

    const bytesPerRow = Math.ceil((this.width * 4) / 256) * 256;
    const out = this.device.createBuffer({
      size: bytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer({ texture: resolved }, { buffer: out, bytesPerRow }, [this.width, this.height]);
    this.device.queue.submit([encoder.finish()]);
    await out.mapAsync(GPUMapMode.READ);
    const copy = out.getMappedRange().slice(0);
    out.unmap();
    msaa.destroy();
    resolved.destroy();
    depth.destroy();
    out.destroy();
    return { buffer: copy, width: this.width, height: this.height };
  }

  /** 录制一整帧的绘制指令（鸟体 + 4 组实例化羽毛） */
  private recordDraw(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.bodyPipeline);
    pass.setBindGroup(0, this.bodyBind);
    pass.setVertexBuffer(0, this.bodyVB);
    pass.setIndexBuffer(this.bodyIB, 'uint32');
    pass.drawIndexed(this.bodyCount);

    pass.setPipeline(this.featherPipeline);
    pass.setBindGroup(0, this.featherBind);
    for (let i = 0; i < ARCH_ORDER.length; i++) {
      const range = this.ranges[i];
      if (range.count === 0) continue;
      pass.setVertexBuffer(0, this.archVB[i]);
      pass.setIndexBuffer(this.archIB[i], 'uint32');
      pass.drawIndexed(this.archIndexCount[i], range.count, 0, 0, range.start);
    }
  }

  destroy(): void {
    this.bodyVB?.destroy();
    this.bodyIB?.destroy();
    this.archVB.forEach((b) => b.destroy());
    this.archIB.forEach((b) => b.destroy());
    this.instanceBuffer?.destroy();
    this.cameraBuffer.destroy();
    this.msaa?.destroy();
    this.depth?.destroy();
  }
}

function orbitView(o: OrbitState): Mat4 {
  const cp = Math.cos(o.pitch);
  const eye: [number, number, number] = [
    o.target[0] + o.distance * cp * Math.sin(o.yaw),
    o.target[1] + o.distance * Math.sin(o.pitch),
    o.target[2] + o.distance * cp * Math.cos(o.yaw),
  ];
  return mat4.lookAt(eye, o.target, [0, 1, 0]);
}

function hexClear(hex: string): GPUColor {
  const [r, g, b] = hexToLinear(hex);
  return { r, g, b, a: 1 };
}
