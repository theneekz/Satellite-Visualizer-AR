# SatViz

https://satellite-visualizer-ar.pages.dev/

Interactive VR/AR/web app for visualizing satellites and man made NEOs (Near Earth Objects) orbiting Earth in real-time.

Demo of AR functionality: https://www.youtube.com/watch?v=2WOAVaL3KC0

<img width="480" height="480" alt="satviz" src="https://github.com/user-attachments/assets/8b941c1f-8cd3-4209-9a7f-afa6783933ec" />

## Features

- AR/VR immersive experience for Meta Quest
- 3D globe with live satellite positions
- Real-time orbital animation (propagation in the browser)
- Satellite search and filtering (by name, type, and launch year)
- Click to view satellite details (name, altitude, velocity, orbital period)

## AR/VR

I set out to only support Meta Quest, but if the browser supports VR/AR, a few other set ups may qualify. You can try to access the VR/AR mode manually by adding `?renderer=xr` to the url. These are untested and likely missing functionality:

- Apple Vision Pro (Safari): This supports VR, but Safari has no WebXR Layers, so the panels would fall back to regular 3D meshes. Likely works but with limited interactions.
- Desktop Chrome with a headset (for example, Quest Link): Likely works but with limited interactions.
- Android phones: Input relies on controllers so I doubt interactions will work.

## Tech Stack

| Layer        | Technology                                        |
| ------------ | ------------------------------------------------- |
| Frontend 3D  | WebGPU, Three.js (for performance comparison!)    |
| Frontend UI  | React                                             |
| Orbital Math | satellite.js (SGP4, in a Web Worker)              |
| Backend      | Python publish job; FastAPI for local development |
| Hosting      | Cloudflare Pages and R2; GitHub Actions           |
| Data Source  | Spacebook                                         |
| Database     | PostgreSQL (local development)                    |

## Project Structure

```
SatViz/
├── frontend/          # React + WebGPU visualization
├── backend/           # FastAPI server
└── docs/
    └── SatViz DD.md   # Technical design document
```

## Getting Started

TODO! See `docs/SatViz DD.md` for full technical details, architecture, and roadmap.

## Roadmap

Night time shading.
Country of origin data + color coding.
Pass predictions and satellite conjunction analysis (collision detection).
