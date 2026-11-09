import { ORBIT_PATH_MAX_POINTS, type OrbitPath } from "../api/satellites";
import { ORBIT_PATH_COLOR } from "./satelliteScene";

const SHADER_SOURCE = /* wgsl */ `
  @group(0) @binding(0) var<uniform> mvp: mat4x4f;

  @vertex
  fn vs_main(@location(0) position: vec3f) -> @builtin(position) vec4f {
    return mvp * vec4f(position, 1.0);
  }

  @fragment
  fn fs_main() -> @location(0) vec4f {
    return vec4f(${ORBIT_PATH_COLOR.join(", ")}, 1.0);
  }
`;

/** Draws the selected satellite's orbit as a line strip in the same render pass as the globe. */
export function createOrbitPathRenderer(
  device: GPUDevice,
  format: GPUTextureFormat
) {
  const uniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // Sized for the longest path, so a refresh never reallocates.
  const vertexBuffer = device.createBuffer({
    size: ORBIT_PATH_MAX_POINTS * 3 * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const shaderModule = device.createShaderModule({ code: SHADER_SOURCE });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 3 * 4,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: { topology: "line-strip" },
    // The globe hides the far side of the orbit. The line writes no depth, so it can't hide the
    // satellites drawn after it.
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less",
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  let current: OrbitPath | null = null;
  let pointCount = 0;

  /** Shows this path, or nothing for null. Only uploads when the path changes. */
  function setPath(path: OrbitPath | null) {
    if (path === current) return;
    current = path;
    pointCount = path ? path.points.length / 3 : 0;
    if (path && pointCount > 0) {
      device.queue.writeBuffer(vertexBuffer, 0, path.points);
    }
  }

  /** `mvp` must include the camera's rotation but not the Earth's spin, like the satellites'. */
  function update(mvp: Float32Array) {
    if (pointCount >= 2) device.queue.writeBuffer(uniformBuffer, 0, mvp);
  }

  function draw(pass: GPURenderPassEncoder) {
    if (pointCount < 2) return;
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(pointCount);
  }

  return { setPath, update, draw };
}
