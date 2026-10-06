# SatViz XR Panels Design Doc

# Overview

Bring the satellite list, filters, and satellite card into the immersive XR mode (`?renderer=xr`) on Meta Quest with the same functionality as the desktop panels, using spatial panels, controller and hand input, and a hand-anchored menu for opening and closing them. Status: planning. The UI stack decision is open until the @pmndrs and React Three Fiber research below is done.

# Detailed Design

## Architecture Overview

The XR mode today is `components/three/GlobeThree` on `WebGPURenderer` forced onto WebGL 2, with TSL shaders, a thumbstick for spin and zoom, and the trigger for selection. The HTML panels are not visible in a headset because Quest Browser does not support the DOM Overlay module, so the panels must be rebuilt as 3D objects in the scene. The leading candidate is `@pmndrs/uikit` (Yoga flexbox layout, MSDF text, batched panels) with `@pmndrs/pointer-events` for ray, poke, and hand input and `@pmndrs/handle` for grabbing, which are the same building blocks Meta's Immersive Web SDK (IWSDK) uses. App state stays in `App.tsx` as the single source of truth, and the XR panels read it through refs or signals so React never runs inside the XR frame loop.

## Frontend

### Renderer Constraint

uikit 1.0.76's panel and glyph materials use `onBeforeCompile`, which `WebGPURenderer` ignores, so uikit does not render on the current XR path. Using uikit means running XR on the classic `WebGLRenderer` and porting the satellite and Earth materials from TSL to GLSL for the XR build only. `?renderer=three` stays on `WebGPURenderer` for the WebGPU comparison. Performance is not the reason for the switch: `WebGPURenderer` supports XR multiview and runs XR on WebGL 2 either way. The XR globe should become its own module rather than more branches in `GlobeThree`.

### Frame Budget

Quest 3 runs at 72Hz (13.9ms) or 90Hz (11.1ms) per stereo frame, which leaves the main thread a few milliseconds at most. Rules that follow from this:

- Panels redraw only when their data changes (uikit updates are dirty-driven).
- React re-renders happen only on filter or selection changes, never per frame. The DOM `SatelliteList` should not stay mounted while presenting, since its effects still run.
- `filterSatellites` over 32,510 records runs on the main thread. The 250ms debounce is enough on desktop, but it needs profiling in the headset and a move to a Web Worker or chunked pass if it drops frames.
- No per-frame hover picking against satellites. Panel hit tests are cheap, but a ray against every satellite each frame is not without a spatial index. Satellite picking stays on trigger only.
- Mostly opaque panel backgrounds, since overlapping transparency is GPU overdraw in a headset.

### Satellite List

The list holds 32,510 rows. Virtualization was required on desktop to stop stutter, and it is required again in XR because uikit has scroll containers but no virtualization, and one uikit node plus MSDF text per row would stall the headset.

- A fixed pool of row components (visible count plus 2) is recycled. Scrolling only translates the pool by the fractional row offset, which is a matrix change with no relayout.
- A row's text is rebound only when its index crosses a row boundary, and rebinds per frame are capped during fast flings. This needs measuring on device.
- Hits map to rows arithmetically: one flat hit target and `index = floor((localY + scrollOffset) / rowHeight)`, with no per-row raycasts.
- Scrolling: thumbstick while the ray is over the list, ray drag, and hand pinch-drag, all with inertia. A fast-scroll scrubber on the edge is required, since thumbstick scrolling through 32k rows is not usable on its own.
- Selecting a row selects the satellite and the globe follows it, as on desktop.

### Filters and Search

- Search stays. Quest Browser 26.1+ supports the system keyboard in WebXR (`XRSession.isSystemKeyboardSupported`): tapping the 3D search field focuses a hidden DOM `<input>`, and its value is mirrored into the field and fed through the existing debounce. Limitations: each keyboard session overwrites the field's whole value, there are no key events, and the input must be in the DOM.
- Type and size become chips instead of dropdowns.
- Launch year becomes a two-handle range slider (1957 to the current year) instead of two text inputs.
- Clear filters stays.

### Satellite Card

- Kept: name, NORAD id and designator, badges, live position (refreshed once a second), period, and inclination.
- Behind a More toggle: orbital elements (RAAN, argument of perigee, mean anomaly, BSTAR), revolutions, and source.
- The 2D orbit diagram is replaced by a 3D orbit ring drawn around the globe for the selected satellite, with a leader line from the satellite to the card.
- The card is tied to selection, so it needs no reopen control: selecting opens it, and close or deselect hides it.

### Input

- Controllers and hands are both first class. Far panels use rays; panels within reach accept poke. Both come from pointer-events.
- Hands have no thumbstick, so the globe also needs grab-to-rotate and two-hand pinch-to-scale, which `@pmndrs/handle` provides.
- Panels are hit-tested before the globe, and while a ray is over a panel, the thumbstick drives that panel instead of the globe.
- Fix: a trigger press that misses every satellite currently clears the selection, which happens constantly by accident in XR. A miss should do nothing; deselect is the card's close button or the B button.
- Ray polish: shorten the ray to its hit point, show a cursor dot, highlight on hover, and give a short haptic pulse on hover.

### Panel Layout and Opening and Closing

- Panels are world-locked around the globe in a shallow arc about 1 to 1.3m away and slightly below eye height: list and filters on the left, card on the right.
- Each panel has a grab bar along its bottom edge for moving it, in the style of Horizon OS and visionOS windows.
- Panels lazy-follow only on recenter. IWSDK's `Follower` is a reference for the thresholds and smoothing.
- A menu on the non-dominant hand holds List, Filters, Search, Recenter, and Exit XR. With hands it fades in when the palm faces up; with controllers it floats above the left controller.
- Closing a panel animates it shrinking into its menu icon, and reopening flies it back to its last pose, so the user always sees where a panel went.
- Y or B toggles all panels, and holding it recenters them. Which buttons Quest Browser exposes needs testing; the system buttons are reserved.

### Phases

0. Spike: a classic `WebGLRenderer` XR scene with ported satellite shaders and one uikit panel holding a recycled 32k-row list, profiled on a real Quest 3 for a stable 72Hz while flinging. The IWER emulator is for iteration only, not timing.
1. Input routing (panels before globe), the trigger-miss fix, and hand grab-rotate and pinch-scale for the globe.
2. Satellite card, leader line, and orbit ring.
3. List, scrubber, and system keyboard search.
4. Filters.
5. Hand menu, close and reopen animations, recenter, and grab bars.
6. Polish: haptics, foveation and multiview tuning, and DOM Overlay for handheld Android AR, where the existing React panels would work as is.

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

- three (classic `WebGLRenderer` for XR if uikit is adopted)
- @pmndrs/uikit, @pmndrs/pointer-events, @pmndrs/handle (candidates, pending research)
- Possibly @react-three/fiber, @react-three/xr, @react-three/uikit (see Open Questions)
- Dev: iwer, @iwer/devui, webxr-layers-polyfill, @vitejs/plugin-basic-ssl (already installed)

# Alternatives considered

## UI Stack

- Classic `WebGLRenderer` with vanilla uikit, pointer-events, and handle: the leading option. The cost is a TSL to GLSL port of the satellite and Earth materials for XR. In return it gets layout, crisp text, hover and press states, ray, hand, and poke input, and grabbing without writing them.
- Stay on `WebGPURenderer` with custom canvas-texture panels: no shader port, but layout, text crispness, scrolling, hover, animation, poke, and grab would all be custom. Reasonable for one read-only card, but expensive for the list, filters, and menu.
- Adopt IWSDK fully: the most capability out of the box, but it pins three to a fork (super-three 0.181, versus 0.186 here) and brings its own ECS (elics), so the XR mode would become a rewrite separate from the rest of the app. Its patterns (PanelUI, Follower) are still worth borrowing.
- React Three Fiber with @react-three/xr and @react-three/uikit: under research (see Open Questions). It is the primary path the @pmndrs docs describe, and it would keep the XR UI in React like the desktop panels, but it adds a reconciler and a React-driven scene alongside the imperative globe.

## Rendering the Panels

- DOM Overlay: not supported on Quest 3 or for immersive-vr on Quest 2. Kept only as a later add-on for handheld Android AR.
- WebXR quad or cylinder layers: the sharpest text the compositor offers, but composited outside the scene and harder to combine with uikit. Deferred to polish.
- three-mesh-ui: uses `ShaderMaterial`, which `WebGPURenderer` does not support, and is less maintained than uikit. Avoid.

## What to Omit

- Dropping search was considered and rejected once the WebXR system keyboard was confirmed, since search is the main way to navigate 32k rows.
- The renderer switch link and backend label are dropped in XR. Exit XR moves into the hand menu.

## Reopening Closed Panels

- A floor dock under the globe is simpler to build and easy to discover, but it is fixed in place, less consistent with hand-tracked input, and adds clutter. It is the fallback if the hand menu tests poorly.
- Panels closing with no visible destination were rejected, since users lose track of where panels went.

## Open Questions

- React Three Fiber: the @pmndrs packages (uikit, pointer-events, handle, xr) are documented React-first through @react-three/fiber and @react-three/xr. Is moving the XR globe to R3F worth it versus using their vanilla builds? Consider how the imperative render loop, `setAnimationLoop`, and ref-driven updates would map onto R3F's `useFrame`, and whether R3F's renderer setup works with `WebGPURenderer` or forces `WebGLRenderer` anyway.
- Virtualized lists: does @react-three/uikit (or uikit's vanilla API) offer a virtualized or recycled list, or a pattern for one? If not, the recycled pool above is built by hand either way.
- Does @react-three/xr provide hand menus, pointer rays, teleport-free grab, and controller button mapping that would replace pieces of this plan?
- Spike results: frame time on Quest 3 for the recycled list during a fling, text rebind cost per row, and the TSL to GLSL port effort.
- Hand menu or floor dock, decided after testing on device.
- Which Quest controller buttons are exposed to WebXR for the panel toggle and recenter.
