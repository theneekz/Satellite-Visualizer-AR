# SatViz Design Doc

# Overview

A full-stack web app for exploring the roughly 32k objects orbiting Earth in real time on an interactive 3D globe, with search, filtering, and per-satellite details that help explain orbital mechanics.

# Detailed Design

## Architecture Overview

The frontend is React + TypeScript (Vite) with a hand-written WebGPU renderer for the globe and satellites, hosted on Cloudflare Pages. It downloads every satellite's metadata and mean elements once, as a gzipped protobuf from `/v2/satellites`, and propagates positions itself with satellite.js (SGP4) in a Web Worker. Positions are in TEME, SGP4's inertial frame, and the Earth mesh rotates by Greenwich Mean Sidereal Time (GMST) to match. A scheduled Python job on GitHub Actions downloads the OMM catalog from Spacebook a few times a day and uploads the payload to Cloudflare R2, where a Pages Function serves it; for local development, a FastAPI server builds the same payload from PostgreSQL.

## Frontend

### Data Loading

`api/satellites.ts` owns the one endpoint. `getSatellites` fetches `/v2/satellites`, decodes the `OMMList` with protobuf-es (types generated from `shared/omm.proto` via `npm run ts-proto`), and maps each message onto the app's `SatelliteInfo` interface. int64 `epoch_ms` decodes as bigint and is converted with `Number()`; unset optional fields become `null`. Satellites load once on mount, with an AbortController so React StrictMode's dev-only double mount cancels the duplicate request.

### Propagation

`usePropagatedPositions` starts a Web Worker (`propagation/propagator.worker.ts`) once satellites load. It sends the worker each satellite's SGP4 inputs, packed as one typed array per field (`propagation/elements.ts`) and transferred rather than copied. The worker builds one satellite.js satrec per satellite (about 0.4s for 32k on a 2019 laptop). Every 30 seconds it propagates all of them to the current time (about 50ms once warmed up) and transfers back `ids` (`Uint32Array`) and `state` (`Float32Array`: x, y, z, vx, vy, vz per satellite), leaving out any satellite SGP4 fails on. The hook builds an `indexById` map and keeps `PositionsSnapshot` (`{ t, ids, state, indexById }`) in a ref, so updates never trigger React renders. The worker keeps each pass over the catalog off the main thread, which matters most in XR.

The payload already holds every input SGP4 reads. It leaves out MEAN_MOTION_DOT and MEAN_MOTION_DDOT, which SGP4 ignores, and keeps the epoch to the millisecond, as satellite.js's own OMM parser does. Positions match python-sgp4 to a median of 3m and at most 14m, from float32 rounding and millisecond epochs.

Vite bundles workers as ES modules (`worker.format: "es"`) because satellite.js references its optional WebAssembly builds, which use top-level await. Those builds are tree-shaken out, and the worker is about 10KB gzipped.

### WebGPU Rendering Pipeline

The globe is a procedurally built UV sphere with an Earth texture, rotated each frame by GMST from satellite.js's `gstime`, the model that defines SGP4's TEME frame (UT1 approximated by UTC). Satellites are instanced quads: the instance buffer holds each satellite's propagated TEME position and velocity, and the vertex shader extrapolates in a straight line by the time since the snapshot. This is accurate to a few km over the 30 second propagation interval, and each snapshot re-anchors it. When no filter is active, the snapshot's state block is uploaded to the GPU as-is because its layout matches the instance buffer.

The globe is lit by the real Sun: `sun.ts` computes the Sun's direction from the simulated time with the Astronomical Almanac's low-precision formula (about 0.01 degrees), and the globe shader shades a day side, a soft terminator, and a dim night side. The formula measures from the equinox of date, like TEME, so the Sun direction gets the same TEME to world axis swap and camera rotation as the satellites, but not the Earth's spin.

Because TEME and GMST come from the same model, satellites line up with the texture without a separate precession and nutation correction.

Clicking picks the nearest visible satellite on the CPU (projected distance plus an Earth occlusion test). Selecting a satellite enables a follow mode that keeps it in view until the user drags.

### Three.js Comparison Renderer

`?renderer=three` swaps in `components/three/GlobeThree`, a Three.js port with the same props and behavior (camera, follow, picking, Sun lighting, instanced satellites), so the two can be compared on the same data. It is lazy-loaded, so the default page never downloads Three.js (about 250KB gzipped). It uses `WebGPURenderer`, which runs on WebGPU when available and falls back to WebGL 2 otherwise; the active backend is shown on screen. Shaders are written in TSL (Three's shading language), which compiles to WGSL or GLSL, and that is what makes the fallback possible. Its render loop uses `setAnimationLoop`, the hook a WebXR session drives, as groundwork for a VR mode.

### React UI Layer

- SatelliteList: virtualized with @tanstack/react-virtual using fixed 34px rows, so only about 40 rows are in the DOM regardless of list size. Selection scrolls by index.
- SatelliteFilterBar: name/NORAD search, object type, RCS size, and launch year range, debounced 250ms. Filtering runs client-side over the full list and the globe draws only visible ids.
- SatelliteCard: live altitude, speed, and lat/lon recomputed every second from the latest snapshot (`liveState.ts`, WGS84, same GMST as the globe), plus an orbit diagram and OMM details.

## Backend

### Publish Job

`publish.py` builds the `/v2/satellites` payload and uploads it to Cloudflare R2. The scheduled workflow `.github/workflows/publish-satellites.yml` runs it every 8 hours. Each run makes one request for Spacebook's OMM JSON, with a User-Agent that names the project, a timeout, and no retries. It is the only code that calls Spacebook, so the request count doesn't grow with traffic, and a failed run leaves the published payload in place until the next one.

Before uploading, the job reads the published object's metadata. It skips the upload when the version is unchanged, and it refuses to replace the payload with one under 90% of the published satellite count, which signals a truncated download. The object, `satellites.pb.gz`, is stored with `Content-Type: application/x-protobuf`, `Content-Encoding: gzip`, and custom metadata for `version` and `count`. `--input` publishes a saved OMM JSON file instead of downloading one, and `--output` writes the payload to a local file instead of uploading it.

### Serving

In production, the Pages Function `frontend/functions/v2/satellites.ts` serves `/v2/satellites` from the R2 bucket bound as `SATELLITES`. It passes the request's If-None-Match to R2, so a browser that has the current payload gets `304 Not Modified` with no body. Otherwise it returns the stored gzip bytes with `encodeBody: "manual"`, which keeps the Workers runtime from compressing them again. Requests for static assets don't invoke the Function.

For local development, `main.py` (FastAPI) serves the same endpoint, and Vite proxies `/v2` to it. A lifespan hook reads every OMM record from PostgreSQL and builds the payload once, before the server accepts requests, and stores it on `app.state.payload`. If the database is unreachable, the error is logged, the server still starts, and the endpoint returns 503.

Both build the payload with `satellites_payload.py`: the protobuf `OMMList`, gzipped once with `mtime=0`, and a version hash of the protobuf. The payload is immutable, and identical records produce identical bytes and the same version on any machine.

### API Endpoints

- GET /v2/satellites: static metadata and mean elements as a protobuf `OMMList` (`shared/omm.proto`), served with `Content-Encoding: gzip`. About 2.9MB compressed (5.2MB raw) for 32,579 records. Sent with an ETag and `Cache-Control: public, no-cache`, so browsers keep a copy and revalidate; an unchanged payload answers `304 Not Modified` with no body. The frontend's `fetch` gets this from the browser HTTP cache with no code changes.

### Database

PostgreSQL, for local development only; production serves what the publish job uploads. The local `satviz` database is the default; override it with `DATABASE_URL`. `db/schema.sql` defines one `satellites` table with one row per object, keyed by NORAD id, holding its latest element set. Column names are the OMM keywords in lowercase, so `database.read_omm_records` maps each row straight back to the OMM dict that `build_omm_proto` consumes. Elements are DOUBLE PRECISION so values round-trip exactly (verified: identical metadata and bit-identical SGP4 output versus the JSON file). Postgres formats EPOCH back into OMM's string form during the query, which keeps the read as fast as parsing the JSON.

`python -m db.import_omm [file]` (run from backend/) applies the schema and upserts an OMM JSON file by NORAD id, so re-importing a newer snapshot replaces older element sets. Locally, the data comes from a Spacebook OMM snapshot imported this way. Element set history and the satcat join (country, launch data) are not modeled yet.

## Security

CORS on the local API allows GET requests from the Vite dev origin (localhost:5173) only. All data is public. The publish job uploads with an R2 API token scoped to the bucket, stored as GitHub Actions secrets, and the workflow can only read the repository. The Pages Function reads R2 only through its binding.

### Authorization

N/A. Public tool with no user accounts.

### Authentication

N/A

## Dependencies

- Frontend: React, WebGPU, @bufbuild/protobuf (with protoc-gen-es for codegen), satellite.js (SGP4), @tanstack/react-virtual, three (comparison renderer)
- Hosting: Cloudflare Pages (static site and the `/v2/satellites` Function), Cloudflare R2 (the published payload), GitHub Actions (the publish job)
- Backend: protobuf and boto3 (publish job); FastAPI, uvicorn, and psycopg 3 (local API)
- Data: Spacebook OMM catalog; PostgreSQL for local development
- Tooling: protoc for generating Python and TypeScript code from `shared/omm.proto`

# Alternatives considered

## Server-side vs Client-side Propagation

The backend first propagated every satellite and served positions at `/v2/positions`, which kept satellite.js out of the browser. Each poll sent 0.91MB (28 bytes per satellite; gzip only gets it to 0.78MB), about 109MB per viewer-hour at one poll every 30 seconds, and the server needed an always-on Python process and PostgreSQL. The browser already downloads every SGP4 input in `/v2/satellites`, and satellite.js propagates the whole catalog in about 50ms (19ms with its WebAssembly bulk API) on a 2019 Intel Core i9, within 14m of python-sgp4. Caching `/v2/positions` at Cloudflare's edge, precomputing position files into R2, and running satellite.js in a Cloudflare Worker all keep the per-viewer bandwidth; the last two also need an always-on process or the Workers Paid plan. Decision: propagate in a Web Worker and serve only the static payload.

## Hosting: Cloudflare vs Firebase

Firebase Hosting charges $0.15/GB after 360MB a day, and Cloud Functions $0.12/GB after 5GB a month. Cloudflare R2 and Pages charge nothing for egress, and the payload fits their free tiers: static assets are unlimited, Functions get 100,000 requests a day, and R2 includes 10M reads a month. Firebase's Auth and Firestore don't apply to a public app with no accounts. Decision: Cloudflare Pages, a Pages Function, and R2.

## Publish Job: GitHub Actions vs Cloudflare Cron Trigger

GitHub Actions is free for a public repository and runs the existing Python code. Scheduled workflows can start late under load, can't run more often than every 5 minutes, and are disabled after 60 days without repository activity in a public repository. A missed run leaves the last payload in place, and element sets stay usable for days, so an 8-hour schedule tolerates this. A Cron Trigger would mean porting the job to JavaScript, and parsing the 30MB catalog needs the Workers Paid plan (the free plan allows 10ms of CPU per run). Decision: GitHub Actions.

## Coordinate Frame: TEME vs GCRS vs ECEF

ECEF would allow a static Earth mesh, but orbits would render as open ground-track spirals; an inertial frame keeps orbits as closed ellipses. GCRS needed Skyfield's TEME to GCRS rotation on the backend and left satellites about 0.37 degrees (roughly 44km at LEO) off the Earth texture, because the Earth rotated by the Earth Rotation Angle without precession and nutation. TEME is SGP4's native frame, and rotating the Earth by the GMST that defines it is consistent by construction. Decision: TEME, with the Earth rotated by GMST.

## FlatBuffers vs Protobuf for Satellite Metadata

Both were built and measured on 32,510 records. FlatBuffers took about 2s to build in Python (the pure-Python builder) and produced 7.8MB raw / 2.4MB gzipped. Protobuf took about 0.4s and produced 5.0MB raw / 2.8MB gzipped, and its schema carries derived fields (period, perigee, apogee) and satcat fields that the FlatBuffers OMM schema cannot. FlatBuffers' zero-copy reads give no benefit because the UI needs every field as an object for filtering and the card. Decision: protobuf.

## Compression

GZipMiddleware at its default level 9 cost about 560ms per satellites request. Decision: gzip the payload once when it is built, by the publish job or at local startup, and serve the stored bytes.

## Satellite List: Virtualization vs Pagination vs Server-side Queries

Rendering all 32k rows (about 130k DOM nodes) made selection and filtering lag. Pagination would hurt browsing and saves nothing because the globe needs all data client-side anyway. Server-side search would add a round trip per keystroke versus about 2ms of local filtering. Decision: virtualize the list and keep filtering on the client.

## Lazy Cache vs Startup Hook

Building caches on first request caused concurrent requests to each parse the JSON and rebuild, about 3.8s under GIL contention. A lock would serialize this, but a startup hook removes the race entirely and takes the cost off the first request. Decision: startup hook.

## Skyfield

Skyfield was only used for the current time and the TEME to GCRS rotation. Switching to TEME with GMST and propagating in the browser removed both uses. Decision: removed. Pass predictions or conjunction analysis can add it back in a scheduled job that publishes static files.

## Sun Position: Client vs Backend

Skyfield can compute a precise Sun position but needs a JPL ephemeris file (about 17MB), far more precision than lighting needs. Decision: compute the Sun's direction on the client from the same timestamp used for Earth rotation.

## Future Work

Element set history (dated payloads in R2), satcat join for country and launch data, satellites shaded by whether they are in sunlight (satellite.js has `shadowFraction`), orbit path rendering and pass predictions (both possible in the browser now), conjunction analysis as a scheduled job, and conditional requests to Spacebook if its API returns `ETag` or `Last-Modified`.
