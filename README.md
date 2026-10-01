# SatViz

Interactive web app for visualizing satellites and NEOs (Near Earth Objects) orbiting Earth in real-time.

## Features

- 3D globe with live satellite positions
- Real-time orbital animation (2-3 second updates via polling)
- Satellite search and filtering (by type, country, constellation)
- Click to view satellite details (name, altitude, velocity, orbital period)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend 3D | WebGPU (high-performance GPU rendering) |
| Frontend UI | React + Tailwind |
| Backend | Python + FastAPI |
| Orbital Math | skyfield + sgp4 |
| Data Source | CelesTrak TLE API |
| Database | PostgreSQL |

## Project Structure

```
SatViz/
├── frontend/          # React + WebGPU visualization
├── backend/           # FastAPI server
└── docs/
    └── SatViz DD.md   # Technical design document
```

## Getting Started

See `docs/SatViz DD.md` for full technical details, architecture, and roadmap.

## Roadmap

Pass predictions and satellite conjunction analysis (collision detection).
