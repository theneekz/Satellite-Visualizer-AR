import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  NoBlending,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  Vector3,
  type Intersection,
  type WebGPURenderer,
} from "three/webgpu";

export interface CanvasLayerOptions {
  // The panel's layout size in CSS-like pixels, which drawing uses.
  width: number;
  height: number;
  // Canvas pixels per layout pixel; sets the layer's resolution.
  pixelRatio: number;
  // The panel's size in the room is layout pixels times this.
  metersPerPixel: number;
  position: Vector3;
  quaternion: Quaternion;
  // Draws the panel in layout pixels; the context is already scaled by the pixel ratio.
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/**
 * A flat XR panel drawn with Canvas 2D. `object` goes in the scene, and the panel shows one of
 * two ways, chosen per session with `setUsesLayers`:
 *
 * - As a WebXR quad layer (when the session grants "layers", as Quest Browser does), which the
 *   headset's compositor samples at display resolution, so text stays sharper than drawn into
 *   the scene. Its plane punches a hole the layer shows through, so 3D content in front still
 *   covers it. The caller runs `renderer.xr.renderLayers()` each frame. three has no way to
 *   remove a layer, so a hidden panel keeps its layer and draws it fully transparent, and its
 *   plane is hidden so it punches no hole.
 * - Otherwise (the IWER emulator has no layers), as the canvas on an ordinary transparent mesh.
 *   three's own fallback for this is broken during a session: `renderLayers` marks each layer's
 *   render target as an XR target with external textures but supplies none, so it draws nothing
 *   and the plane shows black. The caller must not run `renderLayers` in this mode.
 *
 * The canvas is redrawn only after `invalidate`, on the next `update`.
 */
export function createCanvasLayer(renderer: WebGPURenderer, options: CanvasLayerOptions) {
  const { width, height, pixelRatio, metersPerPixel, draw } = options;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext("2d")!;

  const texture = new CanvasTexture(canvas);
  // Colors pass through untouched, like the rest of the scene (see GlobeThree's output space).
  texture.colorSpace = NoColorSpace;
  // Transparent areas stay transparent rather than haloing, since the layer blends by alpha.
  texture.premultiplyAlpha = true;

  // The layer's own little scene: the canvas on a quad that exactly fills an orthographic view.
  const layerScene = new Scene();
  const layerCamera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  layerCamera.position.z = 1;
  const material = new MeshBasicNodeMaterial({ map: texture, toneMapped: false });
  // Written as-is, alpha included, into the cleared layer.
  material.blending = NoBlending;
  const quad = new Mesh(new PlaneGeometry(1, 1), material);
  layerScene.add(quad);

  let visible = false;
  let usesLayers = false;
  let dirty = true;
  const savedClearColor = new Color();

  function renderLayer() {
    // Clear to transparent so the layer only shows the panel, or nothing while it is hidden.
    renderer.getClearColor(savedClearColor);
    const savedClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    quad.visible = visible;
    renderer.render(layerScene, layerCamera);
    renderer.setClearColor(savedClearColor, savedClearAlpha);
  }

  const plane = renderer.xr.createQuadLayer(
    width * metersPerPixel,
    height * metersPerPixel,
    options.position,
    options.quaternion,
    canvas.width,
    canvas.height,
    renderLayer
  );
  plane.visible = false;
  // The panel's pose lives on `object`, so moving it moves the plane, and three moves the layer to
  // match each frame.
  plane.position.set(0, 0, 0);
  plane.quaternion.identity();

  // The same canvas drawn straight into the scene, for sessions without layers. The texture is
  // premultiplied, so the material blends it as premultiplied too.
  const meshMaterial = new MeshBasicNodeMaterial({
    map: texture,
    toneMapped: false,
    transparent: true,
    premultipliedAlpha: true,
  });
  const mesh = new Mesh(plane.geometry, meshMaterial);
  mesh.visible = false;

  // The panel, centered on its origin and facing +Z.
  const object = new Group();
  object.position.copy(options.position);
  object.quaternion.copy(options.quaternion);
  object.add(plane, mesh);

  function applyVisibility() {
    plane.visible = visible && usesLayers;
    mesh.visible = visible && !usesLayers;
  }

  function setVisible(value: boolean) {
    visible = value;
    applyVisibility();
  }

  /** Whether the current session shows this panel as a layer (see above). */
  function setUsesLayers(value: boolean) {
    usesLayers = value;
    applyVisibility();
  }

  function invalidate() {
    dirty = true;
  }

  /** Redraws the canvas if something changed since the last draw. */
  function update() {
    if (!visible || !dirty) return;
    dirty = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    draw(ctx);
    texture.needsUpdate = true;
  }

  const hits: Intersection[] = [];

  /**
   * Where the ray meets the panel's front, as layout pixels from its top left and as a point in
   * `object`'s space, with the distance along the ray; or null if it misses or the panel is hidden.
   */
  function hitTest(raycaster: Raycaster) {
    if (!visible) return null;
    hits.length = 0;
    // The panel may have moved since the last render.
    object.updateMatrixWorld();
    plane.raycast(raycaster, hits);
    const hit = hits[0];
    if (!hit?.uv) return null;
    return {
      x: hit.uv.x * width,
      y: (1 - hit.uv.y) * height,
      local: object.worldToLocal(hit.point.clone()),
      distance: hit.distance,
    };
  }

  function dispose() {
    texture.dispose();
    material.dispose();
    meshMaterial.dispose();
    quad.geometry.dispose();
    plane.geometry.dispose();
  }

  return { object, setVisible, setUsesLayers, invalidate, update, hitTest, dispose };
}

export type CanvasLayer = ReturnType<typeof createCanvasLayer>;
