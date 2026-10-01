# SatViz Design Doc

# Overview

A full-stack web app for visualizing Near Earth Objects (NEOs) and satellites in real-time. Users can explore what's orbiting Earth, track satellites live, and learn about orbital mechanics through an interactive 3D experience.

# Detailed Design

## Architecture Overview

Frontend renders an interactive 3D globe using WebGPU for high-performance GPU rendering (10k+ satellites at 60 FPS). React handles UI controls and panels. Python backend fetches OMM data from CelesTrak, performs orbital calculations using skyfield library, and serves satellite positions via REST API. All positions are served in the GCRS inertial frame; the frontend rotates the Earth mesh to match the current time. PostgreSQL will cache OMM records in V2.

## Frontend

### WebGPU Rendering Pipeline
High-performance 3D visualization using WebGPU instead of Three.js. This gives direct GPU control, enabling 10-100x faster rendering. The visualizer displays Earth as a sphere, satellite positions as points, and orbital paths as lines. Camera is freely rotatable and zoomable.

Satellites and orbital paths are drawn directly in GCRS (inertial) coordinates, so orbits render as stable closed ellipses. The Earth mesh is the only object that rotates: each frame the frontend rotates it about the Z axis by the Earth Rotation Angle (ERA) for the current time. ERA is computed client-side from the UTC timestamp (treating UT1 as UTC, which is accurate to well under a degree and sufficient for visualization) using ERA = 2π(0.7790572732640 + 1.00273781191135448 × (JD − 2451545.0)). Polar motion and nutation are ignored. LOD (level of detail) culling keeps performance smooth even with 10k+ objects.

### React UI Layer
React components handle satellite search, filtering (by type/country/constellation), and info panels. State management keeps UI in sync with WebGPU rendering state. No three.js abstraction—React stays lightweight and separate from GPU rendering.

### Key Data Structures
Satellites receive: name, NORAD ID, current GCRS position (X, Y, Z in km), velocity, orbital period, satellite type, country of origin. Lat/lon/altitude are derived values used only for info panels. Orbital paths are computed by backend and streamed as GCRS X, Y, Z coordinate arrays (km). Every position response includes the UTC timestamp it was computed for, which the frontend uses for Earth rotation and interpolation between polls.

## Backend

### OMM Data Management
On startup, backend fetches OMM (Orbit Mean-Elements Message) XML from CelesTrak and caches in memory. Caches for 6 hours before re-fetching. The XML is parsed into field dictionaries with `sgp4.omm.parse_xml()`, and each dictionary is passed to Skyfield's `EarthSatellite.from_omm()`. OMM provides clean structured data (vs legacy TLE) and supports up to 9-digit satellite IDs. In-memory caching keeps V1 simple; database persistence deferred to V2.

### Orbital Calculations
Python backend uses Skyfield's native OMM support and SGP4 propagation model to compute satellite positions at any timestamp. OMM's structured format (vs legacy TLE) provides cleaner parsing and better data reliability. Calculations are done per-request for current position data. Skyfield converts SGP4's TEME output to GCRS, and the backend returns those position arrays (X, Y, Z in km) directly for the WebGPU rendering pipeline with no further frame conversion. Lat/lon/altitude for info panels come from Skyfield's `subpoint` on the same position. Orbital paths are produced by propagating one full orbital period at fixed time steps and returning the resulting GCRS positions.

### API Endpoints
GET /satellites (list all with current positions) | GET /satellites/:id (details and current state) | GET /earth-view (real-time position stream via WebSocket, optional for V1)

### Database

Deferred to V2. V1 uses in-memory caching for simplicity. V2 will add PostgreSQL for persistence, fallback when CelesTrak is unavailable, and FlatBuffers serialization for efficient position streaming.

## Security

### Authorization

N/A—this is a public tool. No user accounts or authentication required for MVP. All satellite data from CelesTrak is public domain.

### Authentication

N/A

## Dependencies

### Critical
- **skyfield** (Python) – SGP4 orbital mechanics, OMM parsing via `EarthSatellite.from_omm()`
- **sgp4** (Python) – OMM XML parsing via `sgp4.omm.parse_xml()`, and the low-level orbital calculations Skyfield uses internally
- **CelesTrak API** – Free OMM (Orbit Mean-Elements Message) XML data source (celestrak.org)
- **WebGPU** – Modern GPU API for web (Chrome 113+, Firefox future, Safari future)
- **React** – UI framework
- **FastAPI** (Python) – Web server

# Alternatives Considered

## Three.js vs WebGPU
Three.js is simpler to learn but adds abstraction overhead and shader limits. WebGPU gives direct GPU control, enabling efficient culling and vastly better performance for 10k+ satellites. Trade-off: steeper learning curve for WebGPU. Decision: Use WebGPU to set this project apart and achieve true scalability.

## Node.js vs Python Backend
Node.js keeps the stack JavaScript end-to-end but orbital math libraries are better in Python. Python backend is more mature for SGP4 calculations. Trade-off: need to manage two languages. Decision: Python for orbital calculations (backend), Node.js or Python for API server depending on team comfort.

## GCRS vs ECEF Coordinate Frame
ECEF (Earth-fixed) positions would let the frontend keep a static Earth mesh, but orbit paths become open ground-track spirals because the Earth rotates beneath them, which hides orbit shape, inclination, and plane. GCRS (inertial) keeps orbits as closed ellipses and matches the goal of teaching orbital mechanics. Trade-off: the frontend must rotate the Earth mesh by the Earth Rotation Angle each frame, and ground-track or lat/lon views need a conversion. Decision: Backend serves GCRS; frontend rotates the Earth.

## Real-time Updates: Polling vs WebSocket

**Data needed:** Frontend requires current satellite positions (GCRS X, Y, Z) at regular intervals for the 3D globe animation. Satellite metadata (name, type, country) is fetched once on load. Filtering and highlighting are client-side operations with no backend involvement.

**Polling (V1 decision):** Frontend makes GET /satellites requests every 2-3 seconds. Backend recalculates all satellite positions from cached OMM data at that moment and returns full list. Satellite orbits are smooth curves, so 2-3 second updates provide fluid animation without requiring real-time precision.

Pros: Simple stateless implementation, easier to debug and scale, no connection management overhead. Cons: Network overhead from repeated HTTP requests.

**WebSocket (V2 candidate):** Backend maintains persistent connection and pushes position updates every 2-3 seconds (or delta-only updates to reduce bandwidth). More efficient for scale.

Triggers for V2 upgrade: thousands of concurrent users (polling becomes expensive), real-time alerts (conjunction warnings, visibility notifications), multi-user features (seeing others' selected satellites).

Decision: Start with polling for V1 simplicity and faster time-to-launch. Reserve WebSocket for V2 when scale or notification features require it.

## V2 Roadmap: Database, Optimization & Advanced Features
After V1 launch, add PostgreSQL for persistence and fallback (when CelesTrak unavailable), FlatBuffers serialization for efficient position streaming (5-20x smaller, zero-copy to WebGPU), pass prediction calculations, and satellite conjunction detection. Pass predictions compute when satellites cross horizon for user locations (expensive, pre-computed nightly). Conjunction analysis detects collision risks by checking 500k+ satellite pairs nightly. Both use skyfield background jobs. UI includes pass timeline, location-based alerts, and conjunction visualization on 3D globe.
