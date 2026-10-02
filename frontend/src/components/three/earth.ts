import {
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Vector3,
  type Texture,
} from "three/webgpu";
import { dot, float, max, mix, normalWorld, smoothstep, texture, uniform } from "three/tsl";

/**
 * The textured Earth, lit by the Sun with a soft terminator and a dim night side (the same
 * shading as the WebGPU renderer). Rotate the mesh about Y by the Earth Rotation Angle; Three's
 * sphere UVs already put the texture's prime meridian on +X, so no extra offset is needed.
 */
export function createEarth(map: Texture) {
  // Direction toward the Sun in world space; set each frame.
  const sunDirection = uniform(new Vector3(1, 0, 0));

  const sunAlignment = dot(normalWorld, sunDirection);
  // Soft terminator: blends from the night side into daylight across a narrow band.
  const daylight = smoothstep(-0.1, 0.15, sunAlignment);
  const dayShade = float(0.35).add(max(sunAlignment, 0).mul(0.65));
  // The night side is dimmed but stays clearly readable.
  const brightness = mix(float(0.4), dayShade, daylight);

  const material = new MeshBasicNodeMaterial();
  material.colorNode = texture(map).rgb.mul(brightness);

  // Same tessellation as the WebGPU renderer's sphere (24 longitude x 16 latitude bands).
  const mesh = new Mesh(new SphereGeometry(1, 24, 16), material);

  function dispose() {
    mesh.geometry.dispose();
    material.dispose();
  }

  return { mesh, sunDirection: sunDirection.value, dispose };
}
