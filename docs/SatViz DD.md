# SatViz Design Doc

# Overview

A full-stack web app for exploring the roughly 32k objects orbiting Earth in real time on an interactive 3D globe, with search, filtering, and per-satellite details that help explain orbital mechanics.

# Detailed Design

## Architecture Overview

The frontend is React + TypeScript (Vite) with a hand-written WebGPU renderer for the globe and satellites. The backend is Python + FastAPI, using sgp4 for vectorized propagation and Skyfield for the TEME to GCRS frame rotation, with OMM element sets stored in PostgreSQL. At startup the backend reads every element set from the database and builds every cache once; it then serves two binary endpoints: static satellite metadata as gzipped protobuf, and current positions as a packed typed-array buffer. Positions are in the GCRS inertial frame and the frontend rotates the Earth mesh to match the time.

## Frontend

### Data Loading

`api/satellites.ts` owns both endpoints. `getSatellites` fetches `/v2/satellites`, decodes the `OMMList` with protobuf-es (types generated from `shared/omm.proto` via `npm run ts-proto`), and maps each message onto the app's `SatelliteInfo` interface. int64 `epoch_ms` decodes as bigint and is converted with `Number()`; unset optional fields become `null`. Satellites load once on mount.

`getPositions` fetches `/v2/positions` and creates `Uint32Array` (ids) and `Float32Array` (x, y, z, vx, vy, vz per satellite) views directly onto the response, with no per-satellite objects. It builds an `indexById` map once per poll. `PositionsSnapshot` is `{ t, ids, state, indexById }`. Positions are polled every 30 seconds and held in a ref, so polling never triggers React renders.

Both effects use an AbortController so React StrictMode's dev-only double mount cancels the duplicate request.

### WebGPU Rendering Pipeline

The globe is a procedurally built UV sphere with an Earth texture, rotated each frame by the Earth Rotation Angle (ERA) computed client-side from UTC (UT1 approximated by UTC). Satellites are instanced quads: the instance buffer holds each satellite's polled GCRS position and velocity, and the vertex shader extrapolates in a straight line by the time since the snapshot. This is accurate to a few km over a 30 second poll interval, and each poll re-anchors it. When no filter is active, the snapshot's state block is uploaded to the GPU as-is because its layout matches the instance buffer.

The globe is lit by the real Sun: `sun.ts` computes the Sun's direction from the simulated time with the Astronomical Almanac's low-precision formula (about 0.01 degrees), and the globe shader shades a day side, a soft terminator, and a dim night side. The Sun direction gets the same GCRS to world axis swap and camera rotation as the satellites, but not the Earth's spin.

Precession and nutation are not applied to the Earth mesh, so satellites appear about 0.37 degrees (roughly 44 km at LEO) off relative to the texture. This is accepted for visualization.

Clicking picks the nearest visible satellite on the CPU (projected distance plus an Earth occlusion test). Selecting a satellite enables a follow mode that keeps it in view until the user drags.

### React UI Layer

- SatelliteList: virtualized with @tanstack/react-virtual using fixed 34px rows, so only about 40 rows are in the DOM regardless of list size. Selection scrolls by index.
- SatelliteFilterBar: name/NORAD search, object type, RCS size, and launch year range, debounced 250ms. Filtering runs client-side over the full list and the globe draws only visible ids.
- SatelliteCard: live altitude, speed, and lat/lon recomputed every second from the latest snapshot (`liveState.ts`, WGS84, same ERA as the globe), plus an orbit diagram and OMM details.

## Backend

### Startup and Caching

A FastAPI lifespan hook runs `load_dataset` before the server accepts requests (about 1.5s): read every OMM record from PostgreSQL (about 0.45s), build one sgp4 `Satrec` per record with `sgp4.omm.initialize` into a `SatrecArray`, and build the gzipped protobuf payload. Building once at startup prevents concurrent first requests from each rebuilding the cache. If the database is unreachable the error is logged, the server still starts, and endpoints return 503.

The result is one immutable `Dataset` (version, satrecs, sat_ids, satellites_gz) stored on `app.state.dataset`; there are no module-level caches. A future reload builds a new `Dataset` and replaces it in one assignment, so a request never sees a mix of old and new data. The version is a hash of the satellites payload, and gzip runs with `mtime=0`, so every server or worker that loads the same records produces identical bytes and the same version. Each uvicorn worker and each server still builds its own `Dataset`, since sgp4 objects live in process memory.

The data currently comes from a Spacebook OMM snapshot (`spacebook_omm_2026-09-21.json`, 32,510 records) imported into the database. The live CelesTrak fetch is disabled until API usage is secured.

### API Endpoints

- GET /v2/satellites: static metadata as a protobuf `OMMList` (`shared/omm.proto`), gzipped once at startup and served with `Content-Encoding: gzip`. About 2.8MB compressed (5MB raw). Sent with the dataset version as its `ETag` and `Cache-Control: public, no-cache`, so browsers (and any CDN) keep a copy and revalidate; an unchanged dataset answers `304 Not Modified` with no body. The frontend's `fetch` gets this from the browser HTTP cache with no code changes.
- GET /v2/positions: computed per request in about 30ms. One vectorized SGP4 call for all satellites at the current time, failed or non-finite results dropped, TEME rotated to GCRS with a single matrix multiply. The body is `[ids: uint32 x n][state: float32 x 6n]`, little-endian, 28 bytes per satellite (about 0.87MB), with the snapshot time in the `X-Timescale` header and `Cache-Control: no-store`. Not compressed, since float data only shrinks about 7% under gzip.

### Database

PostgreSQL (local `satviz` database by default; override with `DATABASE_URL`). `db/schema.sql` defines one `satellites` table with one row per object, keyed by NORAD id, holding its latest element set. Column names are the OMM keywords in lowercase, so `database.read_omm_records` maps each row straight back to the OMM dict that sgp4 and `build_omm_proto` consume. Elements are DOUBLE PRECISION so values round-trip exactly (verified: identical metadata and bit-identical SGP4 output versus the JSON file). Postgres formats EPOCH back into OMM's string form during the query, which keeps the read as fast as parsing the JSON.

`python -m db.import_omm [file]` (run from backend/) applies the schema and upserts an OMM JSON file by NORAD id, so re-importing a newer snapshot replaces older element sets. A scheduled CelesTrak refresh would write through the same upsert. Element set history and the satcat join (country, launch data) are not modeled yet.

## Security

CORS allows GET requests from the Vite dev origin (localhost:5173) only. All data is public.

### Authorization

N/A. Public tool with no user accounts.

### Authentication

N/A

## Dependencies

- Frontend: React, WebGPU, @bufbuild/protobuf (with protoc-gen-es for codegen), @tanstack/react-virtual
- Backend: FastAPI, uvicorn, sgp4, Skyfield, numpy, protobuf, psycopg 3
- Data: PostgreSQL, loaded from a Spacebook OMM snapshot (CelesTrak planned)
- Tooling: protoc for generating Python and TypeScript code from `shared/omm.proto`

# Alternatives considered

## Three.js vs WebGPU

Three.js is simpler but adds abstraction overhead. WebGPU gives direct control over instancing and buffers, which lets the polled position buffer go to the GPU without reshaping. Decision: WebGPU.

## GCRS vs ECEF Coordinate Frame

ECEF would allow a static Earth mesh, but orbits would render as open ground-track spirals. GCRS keeps orbits as closed ellipses. Decision: backend serves GCRS and the frontend rotates the Earth. If the 0.37 degree offset matters later (for example a close follow view), either add precession and nutation to the Earth rotation, or serve TEME directly and rotate the Earth by GMST, which is SGP4's native convention, is more accurate, and would remove the need for Skyfield.

## FlatBuffers vs Protobuf for Satellite Metadata

Both were built and measured on 32,510 records. FlatBuffers took about 2s to build in Python (the pure-Python builder) and produced 7.8MB raw / 2.4MB gzipped. Protobuf took about 0.4s and produced 5.0MB raw / 2.8MB gzipped, and its schema carries derived fields (period, perigee, apogee) and satcat fields that the FlatBuffers OMM schema cannot. FlatBuffers' zero-copy reads give no benefit because the UI needs every field as an object for filtering and the card. Decision: protobuf.

## Compression

GZipMiddleware at its default level 9 cost about 560ms per satellites request. Decision: gzip the static satellites payload once at startup, and leave positions uncompressed because they barely compress and change on every request.

## Polling vs WebSocket

Polling every 30 seconds plus GPU-side straight-line extrapolation gives smooth motion with a simple stateless backend. WebSockets remain an option for scale or push features such as alerts.

## Satellite List: Virtualization vs Pagination vs Server-side Queries

Rendering all 32k rows (about 130k DOM nodes) made selection and filtering lag. Pagination would hurt browsing and saves nothing because the globe needs all data client-side anyway. Server-side search would add a round trip per keystroke versus about 2ms of local filtering. Decision: virtualize the list and keep filtering on the client.

## Lazy Cache vs Startup Hook

Building caches on first request caused concurrent requests to each parse the JSON and rebuild, about 3.8s under GIL contention. A lock would serialize this, but a startup hook removes the race entirely and takes the cost off the first request. Decision: startup hook.

## Keeping Skyfield

Skyfield is currently only used for the current time and the TEME to GCRS rotation, both replaceable with sgp4 and a client-side GMST rotation. Building satellites through Skyfield's `EarthSatellite` was replaced with sgp4's `omm.initialize`, which halved startup time. Decision: keep Skyfield for now, since pass predictions and conjunction analysis are planned and would use it.

## Sun Position: Client vs Backend

Skyfield can compute a precise Sun position but needs a JPL ephemeris file (about 17MB), far more precision than lighting needs. Decision: compute the Sun's direction on the client from the same timestamp used for Earth rotation.

## Future Work

Scheduled OMM refresh into the database, element set history, satcat join for country and launch data, satellites shaded by whether they are in sunlight, orbit path rendering, pass predictions, and conjunction analysis.
