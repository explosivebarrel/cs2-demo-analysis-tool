# CS2 Demo Analysis Tool

A self-hosted web application for analyzing CS2 (Counter-Strike 2) demo files. Upload a `.dem`, `.dem.zst` or `.gz` archive — or let the app fetch demos for you — and get detailed per-player stats, aim & duel metrics, heatmaps, an interactive replay viewer, and a match timeline.

## Features

- **Match Overview** — score, round timeline, team aggregates, economy, win probability
- **Player Stats** — Rating 2.0, RWS, KAST, IMP, K/D/A, ADR, opening duels, multikills, clutches, utility, hitgroups, weapons, movement
- **Aim & Duel Metrics** — 20+ per-player metrics (reaction time, TTK, counter-strafe errors, crosshair placement, ideal strafes, overshoot, angle control…) with tier benchmarks (weak / avg / good / elite) and clickable duel episodes: minimap replay, WASD timelines, velocity graph, event log
- **Moments** — auto-detected highlights (clutches, multikills, opening duels, mistakes, swings); click one and the replay jumps in and plays the episode
- **Heatmaps** — kills, deaths, damage, shots, flashes, smokes, molotovs, openings, clutches, holds, and more; per-player, per-side, per-phase filtering
- **Replay viewer** — interpolated smooth playback at 0.5x–8x, pan/zoom, aim arrows, shot tracers, grenade trails and paths per type, weapon icons, win probability curve, event log, round switcher, hotkeys, fullscreen
- **Auto-import** — watch folders and/or FACEIT match history polling; new demos are probed and analyzed automatically
- **Uploads** — `.dem`, `.dem.zst` and `.gz` with content-based deduplication
- **i18n** — Russian and English UI

## Metrics

| Metric | Description |
|--------|-------------|
| **Rating 2.0** | HLTV-style performance rating: `0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587` |
| **RWS** | Round Win Share — avg damage share in won rounds |
| **KAST** | % of rounds with a Kill, Assist, Survival, or Trade |
| **IMP** | Per-round impact score based on opening duels, multikills, clutches, saves |

Every rating-family metric also drives the benchmark tiers used across player pages. The [About page](http://localhost:8080/about) of a running instance documents all formulas and methodology.

## Stack

- **Backend** — Python 3.12, FastAPI, [demoparser2](https://github.com/LaihoE/demoparser)
- **Frontend** — React + TypeScript (Vite), no UI framework (canvas/DOM only)
- **Infrastructure** — Docker Compose, nginx reverse proxy
- **Storage** — plain gzipped JSON artifacts on disk (no database)

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
2. Drag and drop a `.dem` / `.dem.zst` / `.gz` file onto the upload area (or click to choose)
3. Click **Analyze** on the demo card
4. Explore the match overview, player pages, aim metrics, heatmaps, and the replay

### Auto-import (optional)

Instead of uploading manually, point the app at your demo sources via environment variables (see [Configuration](#configuration)):

- **Watch folders** — set `CS2_WATCH_DIRS` to a ':'-separated list of directories (mount them as volumes); new demo files are picked up automatically. The first scan only remembers existing files — nothing is mass-imported on startup.
- **FACEIT** — set `CS2_FACEIT_API_KEY` (free key from the [FACEIT Developer Portal](https://docs.faceit.com/getting-started/authentication/api-keys/) → App Studio → your app → API Keys) and `CS2_FACEIT_PLAYER_ID` (your profile GUID); finished matches are downloaded, unpacked and analyzed.

The current status of both sources is shown on the About page of a running instance.

## Configuration

All settings are optional environment variables of the `backend` container (set them in `docker-compose.yml`):

| Variable | Default | Description |
|----------|---------|-------------|
| `CS2_DATA_DIR` | `/data` | Base data directory |
| `CS2_INBOX_DIR` | `$CS2_DATA_DIR/inbox` | Read-only demo inbox |
| `CS2_MAX_UPLOAD_MB` | `1200` | Upload size cap (unpacked for archives) |
| `CS2_MAX_CONCURRENT_ANALYZES` | `0` | Parallel analysis limit; `0` = unlimited |
| `CS2_FRAME_SECONDS` | `0.125` | Replay timeline sample step (~8 frames/sec) |
| `CS2_WATCH_DIRS` | *(empty)* | ':'-separated watch folders for auto-import |
| `CS2_WATCH_POLL_SEC` | `20` | Watch folder scan interval |
| `CS2_FACEIT_API_KEY` | *(empty)* | FACEIT API key (enables FACEIT auto-import together with the player id) |
| `CS2_FACEIT_PLAYER_ID` | *(empty)* | Your FACEIT profile GUID |
| `CS2_FACEIT_POLL_SEC` | `300` | FACEIT match history polling interval |

## Development

```bash
# Rebuild backend after Python changes
docker compose build backend && docker compose up -d backend

# Frontend dev server (hot reload)
cd frontend
npm install
npm run dev

# Backend tests and linter (local .venv in the repo root)
cd backend
../.venv/Scripts/python -m pytest -q
../.venv/Scripts/python -m ruff check .

# End-to-end pipeline check on a real demo
../.venv/Scripts/python scripts/test_pipeline.py
```

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE) — you may use, modify and redistribute the code (including hosted services) under the same license, keeping sources open.

Map radars and weapon icons are derived from Counter-Strike 2 game assets (via [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons) and [Juknum/counter-strike-icons](https://github.com/Juknum/counter-strike-icons)) and belong to Valve; they are used here for non-commercial purposes only.
