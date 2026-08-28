# CS2 Demo Analysis Tool

A self-hosted web application for analyzing CS2 (Counter-Strike 2) demo files. Upload a `.dem` file and get detailed per-player stats, heatmaps, a replay viewer, and performance metrics.

## Features

- **Match Overview** — score, round timeline, team aggregates, economy
- **Player Stats** — Rating 2.0, RWS, KAST, IMP, K/D/A, ADR, opening duels, multikills, clutches, utility, hitgroups, weapons, movement
- **Round-by-round series** — chart and table views with per-round IMP
- **Heatmaps** — kills, deaths, damage, shots, flashes, smokes, molotovs, openings, clutches, holds, and more; per-player, per-side, per-phase filtering
- **Replay viewer** — animated tick-by-tick player positions with pan/zoom, aim arrows, shot tracers, bomb events
- **About page** — formulas and explanations for all metrics
- **i18n** — Russian and English UI

## Metrics

| Metric | Description |
|--------|-------------|
| **Rating 2.0** | HLTV-style performance rating: `0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587` |
| **RWS** | Round Win Share — avg damage share in won rounds |
| **KAST** | % of rounds with a Kill, Assist, Survival, or Trade |
| **IMP** | Per-round impact score based on opening duels, multikills, clutches, saves |

## Stack

- **Backend** — Python (FastAPI), custom demo parser
- **Frontend** — React + TypeScript (Vite), no UI framework
- **Infrastructure** — Docker Compose, nginx reverse proxy

## Requirements

- Docker and Docker Compose

## Quick Start

```bash
git clone https://github.com/explosivebarrel/cs2-demo-analysis-tool.git
cd cs2-demo-analysis-tool
docker compose up -d
```

The app will be available at `http://localhost:8080`.

## Usage

1. Open `http://localhost:8080` in your browser
2. Drag and drop a `.dem` file onto the upload area (or click to choose)
3. Click **Analyze** on the demo card
4. Explore the match overview, player pages, heatmaps, and replay

## Development

```bash
# Rebuild backend after Python changes
docker compose build backend && docker compose up -d backend

# Frontend dev server (hot reload)
cd frontend
npm install
npm run dev
```

## License

MIT — see [LICENSE](LICENSE).
