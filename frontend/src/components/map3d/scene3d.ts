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

const ALPHA_BUCKETS_MAX = 32

// Density cells drawn as the BOTTOM faces of the voxel grid — every cell sits
// at its own z, so balconies/floors of multi-level maps read as steps.
// Density is quantized into `shades` log-spaced buckets (one path+fill each);
// the count comes from CS2_HM3D_SHADES via the heatmap3d payload.
export function drawDensityPlane(
  ctx: CanvasRenderingContext2D, plane: DensityPlane, cam: Cam, w: number, h: number,
  color: string, alpha: number, shades = 8,
) {
  const m = plane.counts.length
  if (!m || plane.maxCount <= 0) return
  const buckets = Math.max(1, Math.min(ALPHA_BUCKETS_MAX, Math.round(shades)))
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
    if (alpha * (0.15 + 0.85 * t) < 0.008) continue
    const bucket = Math.min(buckets - 1, Math.floor(t * buckets))
    let path = paths[bucket]
    if (!path) {
      // deterministic per-bucket alpha, evenly spread from 0.4 to 1.0 — low
      // shades (3-4) still produce clearly visible steps
      path = new Path2D()
      paths[bucket] = path
      alphas[bucket] = alpha * (0.4 + 0.6 * ((bucket + 1) / buckets))
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
  for (let k = 0; k < buckets; k++) {
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

// Painter for a vertical capsule (Unity-primitive style: cylinder + two
// hemispheres). Body strips and hemisphere rings are back-face culled (the
// shape is convex, so culled quads never need per-quad sorting) and shaded by
// their normal vs the view direction.
export function drawCapsule3D(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, z: number,      // feet center, world
  radius: number, height: number,
  cam: Cam, w: number, h: number, color: string, alpha: number,
) {
  const b = camBasis(cam)
  const P = (px: number, py: number, pz: number): [number, number] => project([px, py, pz], cam, b, w, h)
  const zCyl0 = z + radius, zCyl1 = z + height - radius
  const SEGS = 10, RINGS = 3
  const [cr, cg, cb] = color.split(',').map(Number)

  const quad = (p: [number, number, number][], nx: number, ny: number, nz: number) => {
    const face = -(nx * b.fwd[0] + ny * b.fwd[1] + nz * b.fwd[2])
    if (face <= 0.04) return
    const k = 0.45 + 0.55 * face
    ctx.beginPath()
    p.forEach((q, i) => {
      const [sx, sy] = P(q[0], q[1], q[2])
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy)
    })
    ctx.closePath()
    ctx.fillStyle = `rgba(${cr * k}, ${cg * k}, ${cb * k}, ${alpha})`
    ctx.fill()
  }

  for (let s = 0; s < SEGS; s++) {
    const a0 = (s / SEGS) * Math.PI * 2, a1 = ((s + 1) / SEGS) * Math.PI * 2
    quad([
      [x + Math.cos(a0) * radius, y + Math.sin(a0) * radius, zCyl0],
      [x + Math.cos(a1) * radius, y + Math.sin(a1) * radius, zCyl0],
      [x + Math.cos(a1) * radius, y + Math.sin(a1) * radius, zCyl1],
      [x + Math.cos(a0) * radius, y + Math.sin(a0) * radius, zCyl1],
    ], Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0)
  }
  // hemisphere rings: ring r spans latitudes [r/M, (r+1)/M] * 90°
  for (let sign of [1, -1]) {
    const zc = sign > 0 ? zCyl1 : zCyl0
    for (let ring = 0; ring < RINGS; ring++) {
      const p0 = (ring / RINGS) * Math.PI / 2, p1 = ((ring + 1) / RINGS) * Math.PI / 2
      const c0 = Math.cos(p0), c1 = Math.cos(p1)
      const s0 = sign * Math.sin(p0), s1 = sign * Math.sin(p1)
      for (let s = 0; s < SEGS; s++) {
        const a0 = (s / SEGS) * Math.PI * 2, a1 = ((s + 1) / SEGS) * Math.PI * 2
        const am = (a0 + a1) / 2, cap = Math.cos((p0 + p1) / 2)
        quad([
          [x + Math.cos(a0) * radius * c0, y + Math.sin(a0) * radius * c0, zc + radius * s0],
          [x + Math.cos(a1) * radius * c0, y + Math.sin(a1) * radius * c0, zc + radius * s0],
          [x + Math.cos(a1) * radius * c1, y + Math.sin(a1) * radius * c1, zc + radius * s1],
          [x + Math.cos(a0) * radius * c1, y + Math.sin(a0) * radius * c1, zc + radius * s1],
        ], Math.cos(am) * cap, Math.sin(am) * cap, sign * Math.sin((p0 + p1) / 2))
      }
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
