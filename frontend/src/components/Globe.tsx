import { useEffect, useRef, useState, type RefObject } from "react";
import {
  multiply,
  perspective,
  rotationX,
  rotationY,
  translation,
} from "./mat4";
import type { PositionsSnapshot } from "../api/satellites";
import {
  CLICK_MAX_MOVE_PX,
  DRAG_SENSITIVITY,
  FOLLOW_RATE,
  FOV_DEG,
  FRAMING_DISTANCE_FACTOR,
  ZOOM_MAX_PERCENT,
  ZOOM_MIN_PERCENT,
  ZOOM_SENSITIVITY,
  cameraDistance,
  canvasSize,
  clipPlanes,
  wrapAngle,
  zoomForDistance,
} from "./camera";
import { createSatelliteRenderer } from "./satellite";
import { earthRotationAngle } from "./earthRotation";
import { sunDirection } from "./sun";
import earthTextureUrl from "../assets/earth.jpg";

const SHADER_SOURCE = /* wgsl */ `
  struct Uniforms {
    mvp: mat4x4f,
    model: mat4x4f,
    // Direction toward the Sun in the same (camera-rotated) space as the transformed normals.
    sunDir: vec4f,
  }
  @group(0) @binding(0) var<uniform> uniforms: Uniforms;
  @group(0) @binding(1) var earthTexture: texture_2d<f32>;
  @group(0) @binding(2) var earthSampler: sampler;

  struct VertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
  }

  struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) uv: vec2f,
  }

  @vertex
  fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = uniforms.mvp * vec4f(input.position, 1.0);
    out.normal = normalize((uniforms.model * vec4f(input.normal, 0.0)).xyz);
    out.uv = input.uv;
    return out;
  }

  @fragment
  fn fs_main(input: VertexOutput) -> @location(0) vec4f {
    let sunAlignment = dot(normalize(input.normal), uniforms.sunDir.xyz);
    // Soft terminator: blends from the night side into daylight across a narrow band.
    let daylight = smoothstep(-0.1, 0.15, sunAlignment);
    let dayShade = 0.35 + 0.65 * max(sunAlignment, 0.0);
    // The night side is dimmed but stays clearly readable so the surface can still be made out.
    let brightness = mix(0.8, dayShade, daylight);
    let texColor = textureSample(earthTexture, earthSampler, input.uv);
    return vec4f(texColor.rgb * brightness, 1.0);
  }
`;

/** Procedurally builds a UV-sphere: positions + normals + UVs interleaved, plus a triangle index list. */
function buildSphere(radius: number, latBands: number, lonBands: number) {
  const vertices: number[] = [];
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands; // 0 (north pole) .. PI (south pole)
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const v = lat / latBands; // 0 (north pole) .. 1 (south pole)

    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      const u = lon / lonBands; // longitude / 2*PI, normalized to [0, 1]

      const x = cosPhi * sinTheta;
      const y = cosTheta;
      const z = -sinPhi * sinTheta;

      // Position and normal are identical (unit sphere), scaled by radius for position only.
      vertices.push(x * radius, y * radius, z * radius, x, y, z, u, v);
    }
  }

  const indices: number[] = [];
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const first = lat * (lonBands + 1) + lon;
      const second = first + lonBands + 1;

      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

function Globe({
  positionsRef,
  visibleIds,
  selectedId,
  onSelect,
}: {
  positionsRef: RefObject<PositionsSnapshot | null>;
  // Only these satellites are drawn; null means all of them.
  visibleIds: Set<number> | null;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  // The GPU effect below runs once, so it reads the latest props through refs.
  const selectedIdRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const visibleIdsRef = useRef(visibleIds);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    onSelectRef.current = onSelect;
    visibleIdsRef.current = visibleIds;
  });

  useEffect(() => {
    if (!navigator.gpu) {
      setError("WebGPU is not supported in this browser.");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let frameId = 0;

    async function init() {
      const initialSize = canvasSize();
      canvas!.width = initialSize.width;
      canvas!.height = initialSize.height;
      canvas!.style.width = `${initialSize.width}px`;
      canvas!.style.height = `${initialSize.height}px`;

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        if (!cancelled) setError("No WebGPU adapter found.");
        return;
      }
      const device = await adapter.requestDevice();
      if (cancelled) return;

      const context = canvas!.getContext("webgpu");
      if (!context) {
        setError("Failed to get WebGPU canvas context.");
        return;
      }

      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "opaque" });

      const { vertices, indices } = buildSphere(1, 16, 24);

      const vertexBuffer = device.createBuffer({
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(vertexBuffer, 0, vertices);

      const indexBuffer = device.createBuffer({
        size: indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(indexBuffer, 0, indices);

      // Two mat4x4<f32> (mvp, model), 64 bytes each, then a vec4f sun direction (16 bytes).
      const uniformBuffer = device.createBuffer({
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const shaderModule = device.createShaderModule({ code: SHADER_SOURCE });

      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: shaderModule,
          entryPoint: "vs_main",
          buffers: [
            {
              arrayStride: 8 * 4,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
                { shaderLocation: 2, offset: 6 * 4, format: "float32x2" },
              ],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fs_main",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list", cullMode: "back" },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });

      // Load the Earth texture: fetch the bundled image, decode it into a bitmap, and
      // upload it into a GPUTexture via copyExternalImageToTexture.
      const earthImageResponse = await fetch(earthTextureUrl);
      const earthImageBlob = await earthImageResponse.blob();
      const earthBitmap = await createImageBitmap(earthImageBlob);
      if (cancelled) return;

      const earthTexture = device.createTexture({
        size: [earthBitmap.width, earthBitmap.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      device.queue.copyExternalImageToTexture(
        { source: earthBitmap },
        { texture: earthTexture },
        [earthBitmap.width, earthBitmap.height]
      );
      earthBitmap.close();

      const earthSampler = device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "clamp-to-edge",
      });

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: earthTexture.createView() },
          { binding: 2, resource: earthSampler },
        ],
      });

      const satellite = createSatelliteRenderer(device, format);

      let depthTexture = device.createTexture({
        size: [canvas!.width, canvas!.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      let depthView = depthTexture.createView();

      const mvpUniform = new Float32Array(36);

      // Click-and-drag to rotate: yaw spins the globe about its polar axis and pitch tilts it
      // about the screen's horizontal axis. Neither is limited, so the poles can be brought
      // to the front and the globe can go over the top.
      let yaw = 0;
      let pitch = 0;
      // While true, the camera turns to keep the selected satellite centered.
      let following = false;
      // While true, the zoom eases out until the newly selected satellite is far enough in front of
      // the camera; cleared once it gets there or the user scrolls.
      let framing = false;
      let lastSelectedId: number | null = null;
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let downX = 0;
      let downY = 0;

      // Camera state from the most recent frame, used to match clicks to satellites.
      let lastMvp: Float32Array | null = null;
      let lastModel: Float32Array | null = null;
      let lastDistance = 0;

      function handleClick(e: PointerEvent) {
        if (!lastMvp || !lastModel) return;
        const rect = canvas!.getBoundingClientRect();
        const x = ((e.clientX - rect.left) * canvas!.width) / rect.width;
        const y = ((e.clientY - rect.top) * canvas!.height) / rect.height;
        const id = satellite.pick(
          lastMvp,
          lastModel,
          lastDistance,
          canvas!.width,
          canvas!.height,
          x,
          y
        );
        // Clicking a satellite (even the already selected one) re-centers on it; clicking
        // empty space clears the selection.
        if (id !== null) following = true;
        // The satellite is already on screen, so keep the zoom: marking the selection as seen
        // stops the frame loop from zooming out for it (that is only for list selections). The
        // ref is updated now too; otherwise frames before React re-renders still see the old
        // selection, treat it as a change, and swing the camera back toward it.
        selectedIdRef.current = id;
        lastSelectedId = id;
        framing = false;
        onSelectRef.current(id);
      }

      function handlePointerDown(e: PointerEvent) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        downX = e.clientX;
        downY = e.clientY;
        canvas!.setPointerCapture(e.pointerId);
      }

      function handlePointerMove(e: PointerEvent) {
        if (!dragging) return;
        // Dragging the globe hands control back to the user.
        if (
          Math.hypot(e.clientX - downX, e.clientY - downY) >= CLICK_MAX_MOVE_PX
        ) {
          following = false;
        }
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        yaw += dx * DRAG_SENSITIVITY;
        pitch += dy * DRAG_SENSITIVITY;
      }

      function handlePointerCancel(e: PointerEvent) {
        dragging = false;
        canvas!.releasePointerCapture(e.pointerId);
      }

      function handlePointerUp(e: PointerEvent) {
        handlePointerCancel(e);
        if (
          Math.hypot(e.clientX - downX, e.clientY - downY) < CLICK_MAX_MOVE_PX
        ) {
          handleClick(e);
        }
      }

      canvas!.addEventListener("pointerdown", handlePointerDown);
      canvas!.addEventListener("pointermove", handlePointerMove);
      canvas!.addEventListener("pointerup", handlePointerUp);
      canvas!.addEventListener("pointercancel", handlePointerCancel);

      // Scroll-to-zoom: camera distance from the globe, clamped to a sensible range.
      // zoomPercent 100 = default distance; higher = zoomed in (closer), lower = zoomed out.
      let zoomPercent = 100;

      function handleWheel(e: WheelEvent) {
        e.preventDefault();
        framing = false;
        zoomPercent -= e.deltaY * ZOOM_SENSITIVITY;
        zoomPercent = Math.min(
          ZOOM_MAX_PERCENT,
          Math.max(ZOOM_MIN_PERCENT, zoomPercent)
        );
      }

      canvas!.addEventListener("wheel", handleWheel, { passive: false });

      // Recreate the depth texture whenever the window resizes (WebGPU textures don't
      // auto-resize). The projection is rebuilt every frame from the live size and zoom.
      function handleResize() {
        const size = canvasSize();
        if (canvas!.width === size.width && canvas!.height === size.height)
          return;

        canvas!.width = size.width;
        canvas!.height = size.height;
        canvas!.style.width = `${size.width}px`;
        canvas!.style.height = `${size.height}px`;

        depthTexture.destroy();
        depthTexture = device.createTexture({
          size: [canvas!.width, canvas!.height],
          format: "depth24plus",
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        depthView = depthTexture.createView();
      }

      window.addEventListener("resize", handleResize);

      let lastFrameTime = performance.now();
      let lastSnapshot: PositionsSnapshot | null = null;
      let lastVisibleIds: Set<number> | null | undefined = undefined;

      function frame() {
        if (cancelled) return;

        // Re-upload when a new poll arrives or the filter changes.
        const snapshot = positionsRef.current;
        const visible = visibleIdsRef.current;
        if (
          snapshot &&
          (snapshot !== lastSnapshot || visible !== lastVisibleIds)
        ) {
          lastSnapshot = snapshot;
          lastVisibleIds = visible;
          satellite.setPositions(snapshot, visible);
        }
        satellite.setSelected(selectedIdRef.current);

        const now = performance.now();
        const frameDt = (now - lastFrameTime) / 1000;
        satellite.step(frameDt);
        lastFrameTime = now;

        // Selecting a satellite turns the camera so it is at the center of the screen, then
        // keeps it there as it orbits until the user drags. Zoom is left alone. Rotating the
        // globe by (yaw, pitch) puts a point at (sx, sy, sz) on the +Z axis (toward the camera)
        // when yaw = atan2(-sx, sz) and pitch = atan2(sy, hypot(sx, sz)).
        const selected = selectedIdRef.current;
        if (selected !== lastSelectedId) {
          lastSelectedId = selected;
          following = framing = selected !== null;
        }
        if (following && selected !== null) {
          const target = satellite.scenePosition(selected);
          if (target) {
            const [sx, sy, sz] = target;
            const targetYaw = Math.atan2(-sx, sz);
            const targetPitch = Math.atan2(sy, Math.hypot(sx, sz));
            // Exponential smoothing: eases in, and stays put once it arrives.
            const k = 1 - Math.exp(-Math.min(frameDt, 0.1) * FOLLOW_RATE);
            yaw += wrapAngle(targetYaw - yaw) * k;
            pitch += wrapAngle(targetPitch - pitch) * k;
            // Zoom out (never in) after a selection, eased in log space so large changes feel even.
            if (framing) {
              const minDistance =
                Math.hypot(sx, sy, sz) * FRAMING_DISTANCE_FACTOR;
              const frameZoom = Math.max(
                ZOOM_MIN_PERCENT,
                zoomForDistance(minDistance, canvas!.width / canvas!.height)
              );
              const targetZoom = Math.min(zoomPercent, frameZoom);
              zoomPercent *= (targetZoom / zoomPercent) ** k;
              if (Math.abs(Math.log(targetZoom / zoomPercent)) < 0.01)
                framing = false;
            }
          }
        }

        const aspect = canvas!.width / canvas!.height;
        const distance = cameraDistance(zoomPercent, aspect);
        const { near, far } = clipPlanes(distance);
        const projection = perspective(
          (FOV_DEG * Math.PI) / 180,
          aspect,
          near,
          far
        );
        const view = translation(0, 0, -distance);
        const model = multiply(rotationX(pitch), rotationY(yaw));
        // Satellites live in the inertial frame, so they only get the camera rotation (`model`).
        // The Earth mesh additionally spins by the Earth Rotation Angle for the current time.
        const mvp = multiply(multiply(projection, view), model);
        lastMvp = mvp;
        lastModel = model;
        lastDistance = distance;
        const earthModel = multiply(
          model,
          rotationY(earthRotationAngle(satellite.simTime()))
        );
        const earthMvp = multiply(multiply(projection, view), earthModel);
        mvpUniform.set(earthMvp, 0);
        mvpUniform.set(earthModel, 16);
        // The Sun is inertial like the satellites: same GCRS -> world axis swap as the satellite
        // shader, then only the camera rotation (not the Earth's spin).
        const [sx, sy, sz] = sunDirection(satellite.simTime());
        const sunWorld = [sx, sz, -sy];
        for (let row = 0; row < 3; row++) {
          mvpUniform[32 + row] =
            model[row] * sunWorld[0] +
            model[4 + row] * sunWorld[1] +
            model[8 + row] * sunWorld[2];
        }
        device.queue.writeBuffer(uniformBuffer, 0, mvpUniform);
        satellite.update(mvp, canvas!.width, canvas!.height);

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context!.getCurrentTexture().createView(),
              clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
          depthStencilAttachment: {
            view: depthView,
            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store",
          },
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setIndexBuffer(indexBuffer, "uint16");
        pass.drawIndexed(indices.length);
        satellite.draw(pass);
        pass.end();
        device.queue.submit([encoder.finish()]);

        frameId = requestAnimationFrame(frame);
      }

      frameId = requestAnimationFrame(frame);

      return () => {
        window.removeEventListener("resize", handleResize);
        canvas!.removeEventListener("wheel", handleWheel);
        canvas!.removeEventListener("pointerdown", handlePointerDown);
        canvas!.removeEventListener("pointermove", handlePointerMove);
        canvas!.removeEventListener("pointerup", handlePointerUp);
        canvas!.removeEventListener("pointercancel", handlePointerCancel);
      };
    }

    let removeListeners: (() => void) | null = null;
    init()
      .then((cleanup) => {
        if (cleanup) removeListeners = cleanup;
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to initialize WebGPU."
          );
        }
      });

    return () => {
      cancelled = true;
      if (frameId) cancelAnimationFrame(frameId);
      if (removeListeners) removeListeners();
    };
  }, []);

  if (error) {
    return <p>WebGPU unavailable: {error}</p>;
  }

  // The canvas fills the window; its pixel-buffer width/height are set (and kept in sync on
  // resize) above. The list and card overlay it, so the globe stays centered behind them.
  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}

export default Globe;
