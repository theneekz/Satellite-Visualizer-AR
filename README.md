# SatViz

Interactive VR/AR/web app for visualizing satellites and NEOs (Near Earth Objects) orbiting Earth in real-time.

Demo of all functionality: https://www.youtube.com/watch?v=2WOAVaL3KC0

<img width="480" height="480" alt="satviz" src="https://github.com/user-attachments/assets/8b941c1f-8cd3-4209-9a7f-afa6783933ec" />

## Features

- 3D globe with live satellite positions
- Real-time orbital animation (2-3 second updates via polling)
- Satellite search and filtering (by type, country, constellation)
- Click to view satellite details (name, altitude, velocity, orbital period)

## Tech Stack

| Layer        | Technology                                     |
| ------------ | ---------------------------------------------- |
| Frontend 3D  | WebGPU, Three.js (for performance comparison!) |
| Frontend UI  | React                                          |
| Backend      | Python + FastAPI                               |
| Orbital Math | skyfield + sgp4                                |
| Data Source  | Spacebook                                      |
| Database     | PostgreSQL                                     |

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

Pass predictions and satellite conjunction analysis (collision detection).
