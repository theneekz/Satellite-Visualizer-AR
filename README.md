# SatViz

https://satellite-visualizer-ar.pages.dev/

Interactive VR/AR/web app for visualizing satellites and man made NEOs (Near Earth Objects) orbiting Earth in real-time.

Demo of XR functionality: https://www.youtube.com/watch?v=2WOAVaL3KC0

<img width="480" height="480" alt="satviz" src="https://github.com/user-attachments/assets/8b941c1f-8cd3-4209-9a7f-afa6783933ec" />

## Features

- 3D globe with live satellite positions
- Real-time orbital animation (propagation in the browser)
- Satellite search and filtering (by name, type, year)
- Click to view satellite details (name, altitude, velocity, orbital period)

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
