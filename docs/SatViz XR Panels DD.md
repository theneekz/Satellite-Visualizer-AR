# SatViz XR Panels Design Doc

# Overview

Bring the satellite list, filters, and satellite card into the immersive XR mode (`?renderer=xr`) on Meta Quest with the same functionality as the desktop panels, drawn as WebXR compositor layers with controller and hand input and a hand-anchored menu for opening and closing them. Scope is Quest Browser (Chromium-based) only. Status: planning, with the UI stack decided.

# Detailed Design

## Architecture Overview

The XR mode is `components/three/GlobeThree` on `WebGPURenderer` forced onto WebGL 2, with TSL shaders, the thumbstick for spin and zoom, and the trigger for dragging the globe and selecting satellites. Quest Browser does not support the DOM Overlay module, so the HTML panels are not visible in a headset. Each panel becomes a WebXR Layers quad layer created through `renderer.xr.createQuadLayer`, which `WebGPURenderer` supports natively, with its content drawn by Canvas 2D. App state stays in `App.tsx` as the single source of truth, and the XR panels read it through refs so React never runs inside the XR frame loop.

## Frontend

### WebXR Layers

The system compositor samples a layer's texture directly at display resolution instead of drawing it into the eye buffers and resampling it through lens distortion, which is why Meta recommends layers for text and UI. They give the sharpest text available in WebXR.

- `createQuadLayer(width, height, translation, quaternion, pixelWidth, pixelHeight, renderCall)` returns a plane mesh that goes in the scene. In a session that plane punches a hole (zero blending) so the layer, composited behind the projection layer, shows through with correct occlusion by the globe and satellites.
- `renderer.xr.renderLayers()` runs each layer's render callback and is called in the frame loop before `renderer.render`.
- Every panel uses a flat quad layer. The list covers about 20 degrees at 1m, small enough that its edges stay sharp without a cylinder's curve.
- A layer always composites behind 3D content, so nothing passes through a panel. The card's leader line ends at its edge.
- A layer's size is fixed when it is created, so open and close animations move and fade layers rather than scale them.
- three re-renders every layer each frame. Each layer is a single textured quad, so that cost is small.
- The IWER emulator gets layers from `webxr-layers-polyfill`, which is already installed.
- Staying on `WebGPURenderer` means no renderer switch and no TSL to GLSL shader port.

### Panel Rendering

Each panel owns an offscreen Canvas 2D and a `CanvasTexture`. The layer's render callback draws a single plane with that texture into the layer's render target.

- Panels redraw only when their data changes: scroll, hover, press, selection, filters, and once a second for the card's live values. A redraw sets `needsUpdate` on the texture, so an unchanged panel costs no upload.
- Each panel keeps a list of hit regions (buttons, chips, rows, slider handles) built during its draw, so drawing and hit testing never disagree.
- Canvas sizes are chosen per panel for about 1 to 1.5 pixels per arcminute at the panel's distance, for example 1024 by 1536 for the list.
- Widgets are built in-house: button, chip, toggle, two-handle slider, text field, scrollbar and scrubber. They share one small style module (colors, radii, font sizes) matching the desktop panels.

### Frame Budget

Quest 3 runs at 72Hz (13.9ms) or 90Hz (11.1ms) per stereo frame, which leaves the main thread a few milliseconds at most.

- Canvas redraws and texture uploads happen only on change, as above.
- React re-renders happen only on filter or selection changes, never per frame. The DOM `SatelliteList` is not mounted while presenting, since its effects still run.
- `filterSatellites` over 32,510 records runs on the main thread. The 250ms debounce is enough on desktop, but it needs profiling in the headset and a move to a Web Worker or chunked pass if it drops frames.
- No per-frame hover picking against satellites. Panel hit tests are cheap, but a ray against every satellite each frame is not without a spatial index. Satellite picking stays on trigger only.
- Mostly opaque panel backgrounds.

### Satellite List

The list holds 32,510 rows. Virtualization was required on desktop to stop stutter, and Canvas 2D makes it inherent in XR: each redraw paints only the 15 to 20 rows in view at the current scroll offset, so there are no per-row objects and list size never affects frame time.

- Hits map to rows arithmetically: `index = floor((localY + scrollOffset) / rowHeight)`.
- Scrolling: thumbstick while the ray is over the list, ray drag, and hand pinch-drag, all with inertia. A redraw happens only on frames where the offset changed.
- A fast-scroll scrubber on the edge is required, since thumbstick scrolling through 32k rows is not usable on its own.
- Selecting a row selects the satellite and the globe follows it, as on desktop. Selecting from the globe scrolls the row into view.
- Implemented: a 400 by 860 quad layer 1m away, 40 degrees to the left, mirroring the card, with 40px rows so a ray can pick one easily. It has the title and count, rows with hover and selection highlights, a non-interactive scrollbar, thumbstick scrolling (deflection squared, up to 2000 layout pixels per second), the close button, and the grab bar, which `components/three/xr/panelStyle` now shares with the card. The input router tests both panels and the nearest hit wins. The list opens with each session, and until the hand menu exists the left controller's Y button reopens it. Inertia, ray and pinch drag scrolling, and the scrubber come later.

### Filters and Search

- Search stays. Quest Browser 26.1+ supports the system keyboard in WebXR (`XRSession.isSystemKeyboardSupported`): tapping the search field focuses a hidden DOM `<input>`, and its value is mirrored into the drawn field and fed through the existing debounce. Limitations: each keyboard session overwrites the field's whole value, there are no key events, and the input must be in the DOM.
- Type and size become chips instead of dropdowns.
- Launch year becomes a two-handle range slider (1957 to the current year) instead of two text inputs.
- Clear filters stays.
- The controls sit at the top of the list panel above the rows, as the page puts the filter bar inside its list, rather than in a panel of their own. Clear filters sits on the Type label's line so showing it never moves the rows, and the chips wrap to the filter options in the data.
- Pressing the chosen chip again goes back to All. The slider's handles show their years while dragged and apply on release, so a drag does not refilter 32k satellites every frame; a handle at either end means no limit, so satellites with unknown launch years stay listed. Search is debounced 250ms like the page's.
- The page's list is unmounted while a session runs, and its filter bar starts from the applied filters when it remounts, so changes made in XR carry back to the page.
- Implemented. The system keyboard is untested on device; in the emulator, the computer's keyboard types into the hidden input.

### Satellite Card

- Same data as the page's card: name, NORAD id and designator, badges, live position (refreshed once a second), orbit, data (epoch, element set age, source, revolutions), and orbital elements. `components/satelliteDetails.ts` builds the contents for both cards, so they can't drift apart.
- The four sections sit in a 2x2 grid instead of the page's single column, so the card stays within a comfortable field of view. Its quad layer is 520 by 448 layout pixels at 1mm each and 1.5 canvas pixels per layout pixel, placed 1m from the user, 40 degrees to the right, facing them.
- The orbit visualization is deferred: the 2D orbit diagram and its 3D replacement (an orbit ring around the globe with a leader line to the card) come later.
- The card is tied to selection, so it needs no reopen control: selecting opens it, and close or deselect hides it.
- Implemented (phase 1, except the orbit visualization and the plain-mesh sharpness comparison).

### Input

Layers receive no input, so a small input router owns it.

- Each frame, each controller or hand ray is tested against the layer planes first, then the globe. The nearest hit owns that input source's hover, trigger, and thumbstick.
- A panel hit converts to canvas pixels through the plane's UV, then to the panel's hit regions.
- While a ray is over a panel, the thumbstick drives that panel instead of spinning and zooming the globe.
- Controllers and hands are both first class. Far panels use rays; panels within reach accept poke.
- Hands have no thumbstick, so the globe also needs grab-to-rotate and two-hand pinch-to-scale. `@pmndrs/handle` provides these and has no materials, so it works with `WebGPURenderer`.
- The globe's trigger drag tracks a grab point on the ray at the near surface's distance, so turning and moving the controller both drag it, and a press only turns the globe once it passes a 3 degree click threshold. Clicks pick what the ray pointed at when the trigger went down. A selected satellite turns toward the headset, so it sits at eye level. These are implemented.
- Fix still to do: a trigger click that misses every satellite clears the selection, which happens constantly by accident in XR. A miss should do nothing; deselect is the card's close button or the B button.
- Ray polish: shorten the ray to its hit point, show a cursor dot, highlight on hover, and give a short haptic pulse on hover.

### Panel Layout and Opening and Closing

- Panels are world-locked around the globe in a shallow arc about 1 to 1.3m away and slightly below eye height: list and filters on the left, card on the right.
- Each panel has a grab bar centered under it, in the style of Horizon OS and visionOS windows. A trigger press on the bar carries the grabbed spot at a fixed distance along the ray, and the panel turns to face the head, pitching as well as turning so it stays square when placed overhead or low, but never rolls, so its top and bottom edges stay level. While dragging, that controller's thumbstick pushes the panel away or pulls it in, from 0.3m to 4m. A panel's pose lives on its group, so moving it moves its layer plane, and three updates the layer's transform from it each frame. This is implemented for the card with controllers; hand pinch-drag comes with hand input. It is hand-rolled on the same ray math as the globe drag rather than `@pmndrs/handle`, which would need its pointer event system.
- Panels lazy-follow only on recenter. IWSDK's `Follower` is a reference for the thresholds and smoothing.
- A menu on the non-dominant hand holds List, Filters, Search, Recenter, and Exit XR. With hands it fades in when the palm faces up; with controllers it floats above the left controller.
- Closing a panel animates it moving into its menu icon and fading out, and reopening moves it back to its last pose, so the user always sees where a panel went.
- Y or B toggles all panels, and holding it recenters them. Which buttons Quest Browser exposes needs testing; the system buttons are reserved.

### Phases

1. Satellite card: the first quad layer, the Canvas 2D panel base (redraw on change, hit regions), the shared style module, and the close button. The orbit diagram, orbit ring, and leader line follow once the orbit visualization is designed. It needs the minimal input router (panels before globe) for its buttons, and it is where text sharpness is judged against the same canvas on a plain mesh.
2. Input: the trigger-miss fix, hand grab-rotate and pinch-scale for the globe, and ray polish.
3. List, scrubber, and system keyboard search. Profiled on a real Quest 3 for a stable 72Hz while flinging 32k rows before moving on; the IWER emulator is for iteration only, not timing.
4. Filters (implemented on the list panel).
5. Hand menu, close and reopen animations, recenter, and grab bars.
6. Polish: haptics, foveation and multiview tuning.

## Backend

N/A. The panels use the existing `/v2/satellites` and `/v2/positions` data.

### Database

N/A

## Security

The XR dev server (`npm run dev:xr`) serves over HTTPS on the LAN with a self-signed certificate, since WebXR requires a secure context. It is for development only. The system keyboard's hidden input only feeds the local filter.

### Authorization

N/A

### Authentication

N/A

## Dependencies

- three (`WebGPURenderer` on WebGL 2 for XR, with its native WebXR Layers support)
- @pmndrs/handle (grab, move, rotate, and scale for panels and the globe)
- Dev: iwer, @iwer/devui, webxr-layers-polyfill, @vitejs/plugin-basic-ssl (already installed)

# Alternatives considered

## UI Stack

Decision: `WebGPURenderer` with WebXR quad layers drawn by Canvas 2D, an in-house input router, and `@pmndrs/handle`. With only a few panels and only Quest to support, the sharpest text, no renderer switch or shader port, built-in list virtualization, and a small dependency set outweigh building the widgets ourselves.

- Classic `WebGLRenderer` with vanilla `@pmndrs/uikit`, `@pmndrs/uikit-horizon`, and `@pmndrs/pointer-events`: the fallback if building the widgets costs more than expected. uikit gives Yoga flexbox layout, MSDF text, and Horizon OS styled components (button, toggle, slider, input field, dropdown, radio group). But uikit 1.0.76's panel and glyph materials and `@pmndrs/xr`'s pointer ray and cursor visuals all use `onBeforeCompile`, which `WebGPURenderer` ignores, so this route needs a TSL to GLSL port of the satellite and Earth materials for XR. uikit has no virtualized list either; its scroll position signal would drive a hand-built recycled row pool, possibly through `@tanstack/virtual-core`'s custom `observeElementRect`, `observeElementOffset`, and `scrollToFn` hooks.
- React Three Fiber with `@react-three/xr` and `@react-three/uikit`: the path the @pmndrs docs lead with, keeping the XR UI in React like the desktop panels. Every @pmndrs package also ships a vanilla build, so React Three Fiber is not required to use them. It would add a reconciler, a rewrite of the imperative globe loop into `useFrame`, and React work near the frame loop, and it carries the same `WebGLRenderer` requirement for uikit. Rejected.
- Adopt IWSDK fully: the most capability out of the box, but it pins three to a fork (super-three 0.181, versus 0.186 here) and brings its own ECS (elics), so the XR mode would become a rewrite separate from the rest of the app. Its patterns (PanelUI, Follower) are still worth borrowing.

## Rendering the Panels

- Canvas 2D on plain textured meshes in the scene: the same drawing code without layers, but text is resampled through the eye buffers and loses sharpness. Kept as the fallback if layers misbehave, and as the sharpness comparison when the card is built.
- DOM Overlay: not supported on Quest 3 or for immersive-vr on Quest 2, and handheld Android AR is out of scope.
- three-mesh-ui: uses `ShaderMaterial`, which `WebGPURenderer` does not support, and is less maintained than uikit. Avoid.

## What to Omit

- Dropping search was considered and rejected once the WebXR system keyboard was confirmed, since search is the main way to navigate 32k rows.
- The renderer switch link and backend label are dropped in XR. Exit XR moves into the hand menu.

## Reopening Closed Panels

- A floor dock under the globe is simpler to build and easy to discover, but it is fixed in place, less consistent with hand-tracked input, and adds clutter. It is the fallback if the hand menu tests poorly.
- Panels closing with no visible destination were rejected, since users lose track of where panels went.

## Open Questions

- How much sharper the card's layer text is than the same canvas on a mesh (phase 1), and frame time on Quest 3 while flinging the list (phase 3).
- Whether layers that have not changed can skip three's per-frame layer render, and whether that matters.
- Hand menu or floor dock, decided after testing on device.
- Which Quest controller buttons are exposed to WebXR for the panel toggle and recenter.
- Whether to clamp the globe's pitch to plus or minus 90 degrees on desktop and XR, so it can't turn upside down and reverse horizontal drags.
