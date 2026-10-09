// Orthographic orbit camera + lightweight 3D painters for the heatmap and
// replay 3D views. Canvas Y grows downward, world Z is up; north (world +Y)
// is screen-up at yaw 0. The radar image is drawn onto the z=gz plane through
// an exact affine map — under orthographic projection a plane maps linearly
// to the screen.
//
// Perf invariant: scene geometry (density plane, point arrays) is rebuilt only
// when the mode / resolution / filters change; camera movement must only
// re-project, never rebuild.
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

// Fit the whole bbox into the viewport with a small margin. Default view is
// the classic isometric angle (45° yaw, ~35.26° pitch) so vertical structure
// is visible right away.
export function fitCam(bbox: BBox, w: number, h: number, yaw = Math.PI / 4, pitch = Math.atan(1 / Math.SQRT2)): Cam {
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

// ---------------------------------------------------------------- density plane

export interface DensityPlane {
  xs: Float64Array      // cell min corner, world
  ys: Float64Array
  zs: Float64Array      // cell BOTTOM face height (voxels keep their real z)
  counts: Float64Array
  maxCount: number
  cell: number          // merged cell size (world units)
  groundZ: number
}

export interface PlaneOpts {
  shift: number                    // resolution merge: 0/1/2 -> cell*1/2/4
  filterCols: Set<number> | null   // artifact player columns to count (null = all)
  groundZ: number
}

// Built once per resolution/filter change; color and opacity are applied at
// draw time so opacity sliders never trigger a rebuild.
export function buildDensityPlane(
  data: { cell: number; zStep: number; minX: number; minY: number; minZ: number; cells: number[][] },
  opts: PlaneOpts,
): DensityPlane {
  const nCols = data.cells.length ? data.cells[0].length - 3 : opts.filterCols?.size || 0
  const step = 1 << opts.shift
  const acc = new Map<string, [number, number, number, number]>()
  for (const row of data.cells) {
    let c = 0
    for (let i = 0; i < nCols; i++) {
      if (opts.filterCols && !opts.filterCols.has(i)) continue
      c += row[3 + i]
    }
    if (c <= 0) continue
    const key = `${row[0] >> opts.shift},${row[1] >> opts.shift},${row[2] >> opts.shift}`
    const v = acc.get(key)
    if (v) v[2] += c
    else acc.set(key, [row[0] >> opts.shift, row[1] >> opts.shift, c, row[2] >> opts.shift])
  }
  const m = acc.size
  const plane: DensityPlane = {
    xs: new Float64Array(m), ys: new Float64Array(m), zs: new Float64Array(m),
    counts: new Float64Array(m), maxCount: 0,
    cell: data.cell * step, groundZ: opts.groundZ,
  }
  let i = 0
  for (const [ix, iy, c, iz] of acc.values()) {
    plane.xs[i] = data.minX + ix * plane.cell
    plane.ys[i] = data.minY + iy * plane.cell
    plane.zs[i] = data.minZ + iz * data.zStep * step
    plane.counts[i] = c
    if (c > plane.maxCount) plane.maxCount = c
    i++
  }
  return plane
}

const ALPHA_BUCKETS = 8

// Density cells drawn as the BOTTOM faces of the voxel grid — every cell sits
// at its own z, so balconies/floors of multi-level maps read as steps.
// Alpha is quantized into buckets so each bucket is a single path + fill.
export function drawDensityPlane(
  ctx: CanvasRenderingContext2D, plane: DensityPlane, cam: Cam, w: number, h: number,
  color: string, alpha: number,
) {
  const m = plane.counts.length
  if (!m || plane.maxCount <= 0) return
  const b = camBasis(cam)
  const logMax = Math.log1p(plane.maxCount)

  const order = new Int32Array(m)
  const depths = new Float64Array(m)
  for (let i = 0; i < m; i++) {
    order[i] = i
    depths[i] = depth([plane.xs[i], plane.ys[i], plane.zs[i]], cam, b)
  }
  // far -> near; index sort keeps per-frame work allocation-free
  order.sort((a, c) => depths[c] - depths[a])

  const paths: Path2D[] = []
  const alphas: number[] = []
  const p: [number, number, number] = [0, 0, 0]
  for (const i of order) {
    const t = Math.log1p(plane.counts[i]) / logMax
    const a = alpha * (0.15 + 0.85 * t)
    if (a < 0.008) continue
    const bucket = Math.min(ALPHA_BUCKETS - 1, Math.floor(t * ALPHA_BUCKETS))
    let path = paths[bucket]
    if (!path) {
      path = new Path2D()
      paths[bucket] = path
      alphas[bucket] = a
    }
    const cxw = plane.xs[i] + plane.cell / 2, cyw = plane.ys[i] + plane.cell / 2
    // viewport cull with a cell-size margin
    p[0] = cxw; p[1] = cyw; p[2] = plane.zs[i]
    const [ccx, ccy] = project(p, cam, b, w, h)
    const reach = plane.cell * cam.zoom
    if (ccx < -reach || ccx > w + reach || ccy < -reach || ccy > h + reach) continue
    const z = plane.zs[i]
    const corners: [number, number, number][] = [
      [plane.xs[i], plane.ys[i], z],
      [plane.xs[i] + plane.cell, plane.ys[i], z],
      [plane.xs[i] + plane.cell, plane.ys[i] + plane.cell, z],
      [plane.xs[i], plane.ys[i] + plane.cell, z],
    ]
    corners.forEach((c, k) => {
      const [sx, sy] = project(c, cam, b, w, h)
      if (k === 0) path.moveTo(sx, sy); else path.lineTo(sx, sy)
    })
    path.closePath()
  }
  const [cr, cg, cb] = color.split(',').map(Number)
  for (let k = 0; k < ALPHA_BUCKETS; k++) {
    if (!paths[k]) continue
    ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alphas[k]})`
    ctx.fill(paths[k])
  }
}

// ---------------------------------------------------------------- point cloud

// pts: flat [x, y, z, ...] triplets in world units. Uniform color — no depth
// sorting needed; one fillRect per point.
export function drawPoints3D(
  ctx: CanvasRenderingContext2D, pts: Float64Array, cam: Cam, w: number, h: number,
  color: string, alpha: number, radiusPx: number,
) {
  const n = pts.length / 3
  if (!n) return
  const b = camBasis(cam)
  const [cr, cg, cb] = color.split(',').map(Number)
  ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`
  const p: [number, number, number] = [0, 0, 0]
  const s = Math.max(1, radiusPx * 2)
  for (let i = 0; i < n; i++) {
    p[0] = pts[i * 3]; p[1] = pts[i * 3 + 1]; p[2] = pts[i * 3 + 2]
    const [sx, sy] = project(p, cam, b, w, h)
    if (sx < -4 || sx > w + 4 || sy < -4 || sy > h + 4) continue
    ctx.fillRect(sx - radiusPx, sy - radiusPx, s, s)
  }
}

// Painter for a single axis-aligned box (replay players). Faces: top + the
// side faces facing the camera; k shades them for a fake lighting.
export function drawBox3D(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  cam: Cam, w: number, h: number, color: string, alpha: number,
  strokeColor?: string,
) {
  const b = camBasis(cam)
  const P = (p: [number, number, number]): [number, number] => project(p, cam, b, w, h)
  const faces: { pts: [number, number, number][]; k: number }[] = []
  if (b.fwd[0] < 0) faces.push({ pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], k: 0.8 })
  if (b.fwd[0] > 0) faces.push({ pts: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], k: 0.8 })
  if (b.fwd[1] < 0) faces.push({ pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], k: 0.62 })
  if (b.fwd[1] > 0) faces.push({ pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], k: 0.62 })
  faces.push({ pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], k: 1 })
  // draw sides far-first so overlapping side faces stack correctly
  faces.sort((a, c) => depth(c.pts[0], cam, b) - depth(a.pts[0], cam, b))
  const [cr, cg, cb2] = color.split(',').map(Number)
  for (const f of faces) {
    ctx.beginPath()
    f.pts.forEach((p, i) => {
      const [sx, sy] = P(p)
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy)
    })
    ctx.closePath()
    ctx.fillStyle = `rgba(${cr * f.k}, ${cg * f.k}, ${cb2 * f.k}, ${alpha})`
    ctx.fill()
    if (strokeColor) {
      const [sr, sg, sb] = strokeColor.split(',').map(Number)
      ctx.strokeStyle = `rgba(${sr}, ${sg}, ${sb}, ${Math.min(1, alpha + 0.2)})`
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }
}

// Ground disc (smokes, fire zones, bomb marker) — a filled polygon on z=gz.
export function drawGroundDisc(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number, gz: number,
  cam: Cam, w: number, h: number, color: string, alpha: number,
) {
  if (alpha <= 0.008) return
  const b = camBasis(cam)
  ctx.beginPath()
  const N = 20
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2
    const [sx, sy] = project([x + Math.cos(a) * radius, y + Math.sin(a) * radius, gz], cam, b, w, h)
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy)
  }
  ctx.closePath()
  const [cr, cg, cb] = color.split(',').map(Number)
  ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`
  ctx.fill()
}

// Screen-space polyline through 3D points (grenade trails).
export function drawPolyline3D(
  ctx: CanvasRenderingContext2D,
  pts: [number, number, number][], cam: Cam, w: number, h: number,
  color: string, alpha: number, widthPx: number,
) {
  if (pts.length < 2) return
  const b = camBasis(cam)
  ctx.beginPath()
  pts.forEach((p, i) => {
    const [sx, sy] = project(p, cam, b, w, h)
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy)
  })
  const [cr, cg, cb] = color.split(',').map(Number)
  ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`
  ctx.lineWidth = widthPx
  ctx.lineCap = 'round'
  ctx.stroke()
}
