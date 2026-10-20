// Minimal 4x4 matrix helpers (column-major, matching WGSL's mat4x4<f32> layout).
// Hand-written on purpose: this project avoids external math libraries.

export type Mat4 = Float32Array;

/** Multiplies two column-major 4x4 matrices: returns a * b. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Right-handed perspective projection, WebGPU NDC depth range [0, 1]. */
export function perspective(
  fovYRadians: number,
  aspect: number,
  near: number,
  far: number
): Mat4 {
  const f = 1 / Math.tan(fovYRadians / 2);
  const rangeInv = 1 / (near - far);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    far * rangeInv,
    -1,
    0,
    0,
    far * near * rangeInv,
    0,
  ]);
}

/** Rotation about the Y axis by `angleRadians`. */
export function rotationY(angleRadians: number): Mat4 {
  const c = Math.cos(angleRadians);
  const s = Math.sin(angleRadians);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

/** Rotation about the X axis by `angleRadians`. */
export function rotationX(angleRadians: number): Mat4 {
  const c = Math.cos(angleRadians);
  const s = Math.sin(angleRadians);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

/** Translation by (x, y, z). */
export function translation(x: number, y: number, z: number): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
