// Orthographic orbit camera + voxel painter for the 3D positions heatmap.
// Canvas Y grows downward, world Z is up; north (world +Y) is screen-up at yaw 0.
// The radar image is drawn onto the z=gz plane through an exact affine map —
// under orthographic projection a plane maps linearly to the screen.
import { MapOverview } from '../../api'

export interface Cam {
  yaw: number    // orbit angle around world Z, radians
  pitch: number  // elevation above horizon, radians
  zoom: number   // screen px per world unit
  cx: number
  cy: number
  cz: number
}

export interface Basis {
  fwd: number[]
  right: number[]
  up: number[]
}

export const PITCH_MIN = 0.17
export const PITCH_MAX = 1.48

export function clampPitch(p: number): number {
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, p))
}

export function camBasis(cam: Cam): Basis {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw)
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch)
  const fwd = [-cp * cy, -cp * sy, -sp]
  const right = [-sy, cy, 0]
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ]
  return { fwd, right, up }
}

export function project(
  p: [number, number, number], cam: Cam, b: Basis, w: number, h: number,
): [number, number] {
  const dx = p[0] - cam.cx, dy = p[1] - cam.cy, dz = p[2] - cam.cz
  return [
    (dx * b.right[0] + dy * b.right[1] + dz * b.right[2]) * cam.zoom + w / 2,
    -(dx * b.up[0] + dy * b.up[1] + dz * b.up[2]) * cam.zoom + h / 2,
  ]
}

export function depth(p: [number, number, number], cam: Cam, b: Basis): number {
  return (p[0] - cam.cx) * b.fwd[0] + (p[1] - cam.cy) * b.fwd[1] + (p[2] - cam.cz) * b.fwd[2]
}

export interface BBox {
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
}

// Fit the whole bbox into the viewport with a small margin.
export function fitCam(bbox: BBox, w: number, h: number, yaw = 0, pitch = 0.95): Cam {
  const cam: Cam = {
    yaw, pitch: clampPitch(pitch), zoom: 1,
    cx: (bbox.minX + bbox.maxX) / 2,
    cy: (bbox.minY + bbox.maxY) / 2,
    cz: (bbox.minZ + bbox.maxZ) / 2,
  }
  const b = camBasis(cam)
  const corners: [number, number, number][] = []
  for (const x of [bbox.minX, bbox.maxX])
    for (const y of [bbox.minY, bbox.maxY])
      for (const z of [bbox.minZ, bbox.maxZ]) corners.push([x, y, z])
  let minSX = Infinity, maxSX = -Infinity, minSY = Infinity, maxSY = -Infinity
  for (const p of corners) {
    const [sx, sy] = project(p, cam, b, 0, 0)
    minSX = Math.min(minSX, sx); maxSX = Math.max(maxSX, sx)
    minSY = Math.min(minSY, sy); maxSY = Math.max(maxSY, sy)
  }
  const spanX = Math.max(1e-6, maxSX - minSX)
  const spanY = Math.max(1e-6, maxSY - minSY)
  return { ...cam, zoom: 0.88 * Math.min(w / spanX, h / spanY) }
}

// Canvas setTransform args drawing the 1024x1024 radar image onto the z=gz
// plane: radar pixel (px,py) -> world (pos_x + px*scale, pos_y - py*scale).
export function groundMatrix(
  cam: Cam, b: Basis, w: number, h: number,
  ov: Pick<MapOverview, 'pos_x' | 'pos_y' | 'scale'>, gz: number,
): [number, number, number, number, number, number] {
  const a11 = cam.zoom * b.right[0], a12 = cam.zoom * b.right[1]
  const a21 = -cam.zoom * b.up[0], a22 = -cam.zoom * b.up[1]
  const offX = (-cam.cx * b.right[0] - cam.cy * b.right[1] + (gz - cam.cz) * b.right[2]) * cam.zoom + w / 2
  const offY = -(-cam.cx * b.up[0] - cam.cy * b.up[1] + (gz - cam.cz) * b.up[2]) * cam.zoom + h / 2
  const e = a11 * ov.pos_x + a12 * ov.pos_y + offX
  const f = a21 * ov.pos_x + a22 * ov.pos_y + offY
  const s = ov.scale
  return [a11 * s, a21 * s, -a12 * s, -a22 * s, e, f]
}

// ---------------------------------------------------------------- voxels

export interface VoxelBox {
  x0: number; y0: number; z0: number
  x1: number; y1: number; z1: number
  color: string  // "r,g,b"
  alpha: number
  depth: number
}

export interface VoxelOpts {
  shift: number                    // resolution merge: 0/1/2 -> cell*1/2/4
  colTeam: number[]                // team (0/1) per artifact player column
  filterCols: Set<number> | null   // artifact columns to count (null = all)
  alpha: number                    // master opacity from the shared slider
}

export const TEAM_COLORS: [string, string] = ['90,170,255', '255,170,60']  // team0 / team1

interface AccCell { ix: number; iy: number; iz: number; counts: number[] }

export function buildVoxelBoxes(
  data: { cell: number; zStep: number; minX: number; minY: number; minZ: number; cells: number[][] },
  opts: VoxelOpts,
): VoxelBox[] {
  const n = data.cells.length ? data.cells[0].length - 3 : opts.colTeam.length
  const step = 1 << opts.shift
  const cell = data.cell * step
  const zStep = data.zStep * step
  const acc = new Map<string, AccCell>()
  for (const row of data.cells) {
    const key = `${row[0] >> opts.shift},${row[1] >> opts.shift},${row[2] >> opts.shift}`
    let v = acc.get(key)
    if (!v) {
      v = { ix: row[0] >> opts.shift, iy: row[1] >> opts.shift, iz: row[2] >> opts.shift, counts: new Array(n).fill(0) }
      acc.set(key, v)
    }
    for (let i = 0; i < n; i++) v.counts[i] += row[3 + i]
  }

  let maxC = 0
  const merged: { a: AccCell; c: number; t0: number; t1: number }[] = []
  for (const a of acc.values()) {
    let c = 0, t0 = 0, t1 = 0
    for (let i = 0; i < n; i++) {
      const cnt = a.counts[i]
      if (!cnt) continue
      if (opts.filterCols && !opts.filterCols.has(i)) continue
      c += cnt
      if (opts.colTeam[i] === 1) t1 += cnt; else t0 += cnt
    }
    if (c <= 0) continue
    merged.push({ a, c, t0, t1 })
    maxC = Math.max(maxC, c)
  }
  if (!merged.length || maxC <= 0) return []

  const logMax = Math.log1p(maxC)
  const boxes: VoxelBox[] = merged.map(({ a, c, t0, t1 }) => {
    const x0 = data.minX + a.ix * cell
    const y0 = data.minY + a.iy * cell
    const z0 = data.minZ + a.iz * zStep
    const color = TEAM_COLORS[t1 > t0 ? 1 : 0]
    return {
      x0, y0, z0, x1: x0 + cell, y1: y0 + cell, z1: z0 + zStep,
      color,
      alpha: Math.min(1, opts.alpha * (0.25 + 0.75 * (Math.log1p(c) / logMax))),
      depth: 0,
    }
  })
  return boxes
}

// Ortho faces: top is always visible (pitch > 0), a side face is visible when
// its outward normal points toward the camera (normal . -fwd > 0).
export function drawVoxels(
  ctx: CanvasRenderingContext2D, boxes: VoxelBox[], cam: Cam, w: number, h: number,
) {
  const b = camBasis(cam)
  for (const v of boxes) v.depth = depth([(v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2, (v.z0 + v.z1) / 2], cam, b)
  boxes.sort((p, q) => q.depth - p.depth)

  const vis = {
    px: b.fwd[0] < 0, nx: b.fwd[0] > 0,
    py: b.fwd[1] < 0, ny: b.fwd[1] > 0,
  }
  const shade = { top: 1, x: 0.8, y: 0.62 }

  const P = (p: [number, number, number]): [number, number] => project(p, cam, b, w, h)
  const face = (pts: [number, number, number][], k: number, color: string, alpha: number) => {
    ctx.beginPath()
    pts.forEach((p, i) => {
      const [sx, sy] = P(p)
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy)
    })
    ctx.closePath()
    const [r, g, bl] = color.split(',').map(Number)
    ctx.fillStyle = `rgba(${r * k}, ${g * k}, ${bl * k}, ${alpha})`
    ctx.fill()
  }

  for (const v of boxes) {
    if (vis.px) face([[v.x1, v.y0, v.z0], [v.x1, v.y1, v.z0], [v.x1, v.y1, v.z1], [v.x1, v.y0, v.z1]], shade.x, v.color, v.alpha)
    if (vis.nx) face([[v.x0, v.y0, v.z0], [v.x0, v.y1, v.z0], [v.x0, v.y1, v.z1], [v.x0, v.y0, v.z1]], shade.x, v.color, v.alpha)
    if (vis.py) face([[v.x0, v.y1, v.z0], [v.x1, v.y1, v.z0], [v.x1, v.y1, v.z1], [v.x0, v.y1, v.z1]], shade.y, v.color, v.alpha)
    if (vis.ny) face([[v.x0, v.y0, v.z0], [v.x1, v.y0, v.z0], [v.x1, v.y0, v.z1], [v.x0, v.y0, v.z1]], shade.y, v.color, v.alpha)
    face([[v.x0, v.y0, v.z1], [v.x1, v.y0, v.z1], [v.x1, v.y1, v.z1], [v.x0, v.y1, v.z1]], shade.top, v.color, v.alpha)
  }
}
