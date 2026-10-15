// 3D replay scene: voxel-map density plane, players as team-colored capsules
// with a view-sector band, grenade trails as 3D arcs, shot rays, smoke/fire
// zones and the planted bomb on the ground plane.
// Element selection mirrors drawFrame.ts (2D) — same time windows and fade
// rules — so both views stay consistent. Camera/projection come from scene3d.
import { MapOverview, ReplayData } from '../../api'
import { zOnLevel } from '../../lib/coords'
import { F_ALIVE, F_FLAGS, F_TEAM, F_WID, F_YAW, FLAG_FLASHED, fieldsOf, playerSpeedAt, resolveActiveBomb, TEAM_COLORS } from '../../lib/replay'
import { TRAIL_COLORS, weaponIcon } from '../replay/drawFrame'
import { Cam, camBasis, depth, drawCapsule3D, drawDensityPlane, drawGroundDisc, drawPolyline3D, project } from './scene3d'
import type { DensityPlane } from './scene3d'

function buildCapsuleScreenPath(
  p0: [number, number],
  p1: [number, number],
  r: number,
): Path2D {
  const path = new Path2D()
  const dx = p1[0] - p0[0]
  const dy = p1[1] - p0[1]
  const len = Math.hypot(dx, dy)
  if (len < 0.2) {
    path.arc(p0[0], p0[1], r, 0, Math.PI * 2)
    return path
  }
  const nx = (-dy / len) * r
  const ny = (dx / len) * r
  const ang = Math.atan2(dy, dx)

  // Bottom hemisphere: arc from (ang + PI/2) through bottom (ang + PI) to (ang + 3*PI/2)
  path.arc(p0[0], p0[1], r, ang + Math.PI / 2, ang + (3 * Math.PI) / 2)
  // Left side straight line to top hemisphere
  path.lineTo(p1[0] - nx, p1[1] - ny)
  // Top hemisphere: arc from (ang - PI/2) through top (ang) to (ang + PI/2)
  path.arc(p1[0], p1[1], r, ang - Math.PI / 2, ang + Math.PI / 2)
  // Right side straight line back to bottom hemisphere
  path.lineTo(p0[0] + nx, p0[1] + ny)
  path.closePath()
  return path
}

const ZONE_COLORS: Record<string, string> = {
  sm: '100,200,150', fr: '255,100,30', fd: '255,240,80', hd: '255,160,80',
}
// world-unit radii (2D uses screen px on the map square; 3D works in world)
const ZONE_RADIUS: Record<string, number> = { sm: 170, fr: 130, fd: 60, hd: 75 }
const CAPSULE_R = 16
const CAPSULE_H = 72
// view sector: chevron band with sharp corner at capsule mid-height, radii in capsule-radius units
const SECTOR_HALF = Math.PI / 6
const SECTOR_R_IN = 1.1 * CAPSULE_R
const SECTOR_R_BASE = 1.3 * CAPSULE_R
const SECTOR_R_PEAK = 1.55 * CAPSULE_R
const SECTOR_SEGS = 6
const EYE = 48
const RAY_LEN = 300

function hexRgb(hex: string): string {
  const v = hex.replace('#', '')
  const n = parseInt(v.length === 3 ? v.split('').map(c => c + c).join('') : v, 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

function getDetonationZ(e: Record<string, unknown>, replay: ReplayData, fallbackZ: number): number {
  if (typeof e.z === 'number' && Number.isFinite(e.z) && e.z !== 0) {
    return e.z
  }
  const x = e.x as number
  const y = e.y as number
  let bestZ: number | null = null
  let bestDist = Infinity
  for (const ev of replay.events) {
    const g = ev as Record<string, unknown>
    if (g.ty !== 'g') continue
    const tr = g.tr as number[] | undefined
    if (!tr || tr.length < 3) continue
    const endX = tr[tr.length - 3]
    const endY = tr[tr.length - 2]
    const endZ = tr[tr.length - 1]
    const dx = x - endX
    const dy = y - endY
    const d2 = dx * dx + dy * dy
    if (d2 < 90000 && d2 < bestDist) {
      bestDist = d2
      bestZ = endZ
    }
  }
  return bestZ ?? fallbackZ
}

function drawFlashFlare(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  progress: number,
  camZoom: number,
  alphaMult: number,
) {
  const alpha = Math.max(0, (1 - progress) ** 2) * alphaMult
  if (alpha < 0.01) return
  const zScale = Math.max(0.7, Math.min(1.8, camZoom))

  // 1. Soft radial glow
  const rGlow = (20 + 16 * progress) * zScale
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rGlow)
  glow.addColorStop(0, `rgba(255, 255, 255, ${0.92 * alpha})`)
  glow.addColorStop(0.35, `rgba(255, 248, 200, ${0.62 * alpha})`)
  glow.addColorStop(1, 'rgba(255, 240, 160, 0)')
  ctx.beginPath()
  ctx.arc(cx, cy, rGlow, 0, Math.PI * 2)
  ctx.fillStyle = glow
  ctx.fill()

  // 2. Star rays (billboard 4 cardinal rays + 4 diagonal rays)
  const lMain = (36 + 22 * (1 - progress)) * zScale
  const wMain = 2.4 * zScale
  const lDiag = lMain * 0.58
  const wDiag = wMain * 0.65

  const drawRay = (ang: number, len: number, width: number) => {
    const tipX = cx + Math.cos(ang) * len
    const tipY = cy + Math.sin(ang) * len
    const nx = -Math.sin(ang) * width
    const ny = Math.cos(ang) * width
    const rayGrad = ctx.createLinearGradient(cx, cy, tipX, tipY)
    rayGrad.addColorStop(0, `rgba(255, 255, 255, ${0.95 * alpha})`)
    rayGrad.addColorStop(0.5, `rgba(255, 250, 220, ${0.65 * alpha})`)
    rayGrad.addColorStop(1, 'rgba(255, 245, 200, 0)')

    ctx.beginPath()
    ctx.moveTo(cx + nx, cy + ny)
    ctx.lineTo(tipX, tipY)
    ctx.lineTo(cx - nx, cy - ny)
    ctx.closePath()
    ctx.fillStyle = rayGrad
    ctx.fill()
  }

  const rot = Math.PI / 15
  for (let k = 0; k < 4; k++) drawRay(rot + (k * Math.PI) / 2, lMain, wMain)
  for (let k = 0; k < 4; k++) drawRay(rot + Math.PI / 4 + (k * Math.PI) / 2, lDiag, wDiag)

  // 3. Central piercing white core
  const rCore = 3.8 * zScale
  ctx.beginPath()
  ctx.arc(cx, cy, rCore, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
  ctx.fill()
}

function drawHEExplosion(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  rPx: number,
  progress: number,
  alphaMult: number,
) {
  const alpha = Math.max(0, (1 - progress) ** 1.3) * 0.85 * alphaMult
  if (alpha < 0.01 || rPx < 1) return

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rPx)
  grad.addColorStop(0, `rgba(255, 245, 180, ${alpha})`)
  grad.addColorStop(0.28, `rgba(255, 145, 30, ${alpha * 0.78})`)
  grad.addColorStop(0.65, `rgba(215, 60, 15, ${alpha * 0.38})`)
  grad.addColorStop(1, 'rgba(80, 25, 10, 0)')

  ctx.beginPath()
  ctx.arc(cx, cy, rPx, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()
}

function drawSmokeSphere(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  rPx: number,
  fade: number,
  alphaMult: number,
) {
  const alpha = fade * alphaMult
  if (alpha < 0.01 || rPx < 1) return

  // Depth-like radial falloff: maximum opacity at center, soft feather at perimeter
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rPx)
  grad.addColorStop(0, `rgba(165, 180, 195, ${0.40 * alpha})`)
  grad.addColorStop(0.50, `rgba(160, 175, 190, ${0.30 * alpha})`)
  grad.addColorStop(0.78, `rgba(150, 165, 180, ${0.16 * alpha})`)
  grad.addColorStop(1, 'rgba(140, 155, 170, 0)')

  ctx.beginPath()
  ctx.arc(cx, cy, rPx, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()
}

export interface Replay3DOpts {
  ov: MapOverview
  level?: string
  nadeTrailMode?: 'trail' | 'path'
  nadeFilter?: Set<number> | null
  groundZ: number
  plane?: DensityPlane | null
  showPlane?: boolean
  planeAlpha?: number
  planeColor?: string
  shades?: number
}

export default function drawReplay3D(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  cam: Cam,
  replay: ReplayData,
  frameIdx: number,
  opts: Replay3DOpts,
) {
  const { ov, groundZ: gz } = opts
  const level = opts.level ?? 'default'
  const FIELDS = fieldsOf(replay)
  const b = camBasis(cam)
  const P = (x: number, y: number, z: number): [number, number] => project([x, y, z], cam, b, w, h)
  const curTick = replay.ticks[Math.floor(frameIdx)] ?? 0

  // voxel map surface (positions density), drawn under everything else
  // Neutral slate-grey '130,140,155' provides high contrast for both orange (T) and blue (CT) player capsules
  const planeColor = opts.planeColor ?? '130,140,155'
  if (opts.showPlane !== false && opts.plane && opts.plane.counts.length)
    drawDensityPlane(ctx, opts.plane, cam, w, h, planeColor, opts.planeAlpha ?? 0.35, opts.shades ?? 8)

  // current round boundaries (round markers carry freezeEndTick + endTick)
  let roundStartT = 0
  let roundEndT = Infinity
  let roundEndActual = Infinity
  for (const ev of replay.events) {
    const e = ev as Record<string, unknown>
    if (e.ty !== 'r') continue
    if ((e.t as number) <= curTick) {
      roundStartT = e.t as number
      roundEndActual = (e.e as number) ?? Infinity
    } else if ((e.t as number) < roundEndT) {
      roundEndT = e.t as number
    }
  }

  // Active grenade effects & zones in 3D -----------------------------------
  // 1. Molotov / incendiary fire zones: multi-layer flat fire on actual floor z
  if (!opts.nadeFilter?.has(3)) {
    for (const ev of replay.events) {
      const e = ev as Record<string, unknown>
      if (e.ty !== 'fr') continue
      const t0 = e.t as number
      if (t0 > curTick || t0 < roundStartT) continue
      const expire = replay.events.find(e2 => {
        const q = e2 as Record<string, unknown>
        return q.ty === 'fx' && (q.t as number) > t0 &&
          Math.abs((q.x as number) - (e.x as number)) < 50 &&
          Math.abs((q.y as number) - (e.y as number)) < 50
      })
      const expT = expire ? (expire as Record<string, unknown>).t as number : t0 + 7 * replay.tickrate
      if (curTick > expT) continue

      const fadeIn = Math.min(1, (curTick - t0) / (0.5 * replay.tickrate))
      const fadeOut = Math.max(0, (expT - curTick) / (0.7 * replay.tickrate))
      const fade = Math.min(fadeIn, fadeOut)
      if (fade <= 0.01) continue

      const zGround = getDetonationZ(e, replay, gz)
      const onLevel = zOnLevel(zGround, ov, level)
      const alphaMult = onLevel ? 1 : 0.3
      const flicker = 0.88 + 0.12 * Math.sin(curTick * 0.9 + (e.x as number) * 0.05)
      const fireAlpha = fade * flicker * alphaMult

      // Multi-layer flat fire on the actual ground plane zGround
      drawGroundDisc(ctx, e.x as number, e.y as number, 130, zGround, cam, w, h, '230,60,15', fireAlpha * 0.28)
      drawGroundDisc(ctx, e.x as number, e.y as number, 85, zGround, cam, w, h, '255,120,20', fireAlpha * 0.42)
      drawGroundDisc(ctx, e.x as number, e.y as number, 45, zGround, cam, w, h, '255,195,45', fireAlpha * 0.55)
    }
  }

  // 2. Smoke grenades: ground contact disc + active volumetric spheres
  interface ActiveSmoke {
    cx: number; cy: number; rPx: number
    fade: number; alphaMult: number; d: number
  }
  const activeSmokes: ActiveSmoke[] = []
  if (!opts.nadeFilter?.has(0)) {
    for (const ev of replay.events) {
      const e = ev as Record<string, unknown>
      if (e.ty !== 'sm') continue
      const t0 = e.t as number
      if (t0 > curTick || t0 < roundStartT) continue
      const expire = replay.events.find(e2 => {
        const q = e2 as Record<string, unknown>
        return q.ty === 'sx' && (q.t as number) > t0 &&
          Math.abs((q.x as number) - (e.x as number)) < 50 &&
          Math.abs((q.y as number) - (e.y as number)) < 50
      })
      const expT = expire ? (expire as Record<string, unknown>).t as number : t0 + 20 * replay.tickrate
      if (curTick > expT) continue

      const fadeIn = Math.min(1, (curTick - t0) / (0.8 * replay.tickrate))
      const fadeOut = Math.max(0, (expT - curTick) / (2.0 * replay.tickrate))
      const smokeFade = Math.min(fadeIn, fadeOut)
      if (smokeFade <= 0.01) continue

      const zGround = getDetonationZ(e, replay, gz)
      const onLevel = zOnLevel(zGround, ov, level)
      const alphaMult = onLevel ? 1 : 0.3
      const rWorld = 40 + 95 * Math.sqrt(fadeIn)
      const rPx = rWorld * cam.zoom
      const zCenter = zGround + 55
      const [cx, cy] = P(e.x as number, e.y as number, zCenter)
      const d = depth([e.x as number, e.y as number, zCenter], cam, b)

      // Soft contact disc on the floor under the smoke
      drawGroundDisc(ctx, e.x as number, e.y as number, rWorld * 0.85, zGround, cam, w, h, '140,155,170', 0.15 * smokeFade * alphaMult)

      activeSmokes.push({ cx, cy, rPx, fade: smokeFade, alphaMult, d })
    }
  }

  // 3. High-explosive (HE) grenades: ground flash + expanding blast sphere
  interface ActiveHE {
    cx: number; cy: number; rPx: number; progress: number; alphaMult: number
  }
  const activeHEs: ActiveHE[] = []
  if (!opts.nadeFilter?.has(1)) {
    const heDur = 0.5 * replay.tickrate
    for (const ev of replay.events) {
      const e = ev as Record<string, unknown>
      if (e.ty !== 'hd') continue
      const t0 = e.t as number
      if (curTick < t0 || curTick > t0 + heDur) continue
      const progress = (curTick - t0) / heDur
      const zDet = getDetonationZ(e, replay, gz)
      const onLevel = zOnLevel(zDet, ov, level)
      const alphaMult = onLevel ? 1 : 0.3
      const rWorld = 25 + 115 * Math.sqrt(progress)
      const rPx = rWorld * cam.zoom
      const zCenter = zDet + 25
      const [cx, cy] = P(e.x as number, e.y as number, zCenter)
      const alpha = Math.max(0, (1 - progress) ** 1.3) * 0.85 * alphaMult

      // Ground flash disc
      drawGroundDisc(ctx, e.x as number, e.y as number, rWorld * 0.9, zDet, cam, w, h, '255,150,40', alpha * 0.3)

      activeHEs.push({ cx, cy, rPx, progress, alphaMult })
    }
  }

  // 4. Flashbangs: billboard starburst / flare
  interface ActiveFlash {
    cx: number; cy: number; progress: number; alphaMult: number
  }
  const activeFlashes: ActiveFlash[] = []
  if (!opts.nadeFilter?.has(2)) {
    const flashDur = 0.35 * replay.tickrate
    for (const ev of replay.events) {
      const e = ev as Record<string, unknown>
      if (e.ty !== 'fd') continue
      const t0 = e.t as number
      if (curTick < t0 || curTick > t0 + flashDur) continue
      const progress = (curTick - t0) / flashDur
      const zDet = getDetonationZ(e, replay, gz)
      const onLevel = zOnLevel(zDet, ov, level)
      const alphaMult = onLevel ? 1 : 0.3
      const [cx, cy] = P(e.x as number, e.y as number, zDet)
      activeFlashes.push({ cx, cy, progress, alphaMult })
    }
  }

  // grenade trails: 3D polylines through the trail points (they carry z)
  const TRAIL_FADE_TICKS = replay.tickrate * 2.5
  for (const ev of replay.events) {
    const e = ev as Record<string, unknown>
    if (e.ty !== 'g') continue
    const throwTick = e.t as number
    if (throwTick > curTick || throwTick < roundStartT) continue
    const tr = e.tr as number[]
    const gtype = (e.g as number) ?? 4
    if (opts.nadeFilter?.has(gtype)) continue
    if (!tr || tr.length < 6) continue
    const rgb = hexRgb(TRAIL_COLORS[gtype] ?? '#aaaaaa')

    const nPts = Math.floor(tr.length / 3)
    const ticksPerSeg = replay.tickrate / 4
    const endX = tr[tr.length - 3], endY = tr[tr.length - 2]
    const detTypes: Record<number, string[]> = { 0: ['sm'], 1: ['hd'], 2: ['fd'], 3: ['fr'], 4: [] }
    let detonateTick = throwTick + nPts * ticksPerSeg
    let bestDetDist = Infinity
    for (const ev2 of replay.events) {
      const e2 = ev2 as Record<string, unknown>
      if (!(detTypes[gtype] ?? []).includes(e2.ty as string)) continue
      if ((e2.t as number) < throwTick) continue
      const dx = (e2.x as number) - endX, dy = (e2.y as number) - endY
      const d2 = dx * dx + dy * dy
      if (d2 < 90000 && d2 < bestDetDist) { bestDetDist = d2; detonateTick = e2.t as number }
    }
    const flightPts = Math.min(nPts, Math.max(2, Math.ceil((detonateTick - throwTick) / ticksPerSeg) + 1))
    const aliveUntil = detonateTick + TRAIL_FADE_TICKS
    if (curTick > aliveUntil) continue

    const flightDur = Math.max(1, detonateTick - throwTick)
    const progress = (Math.min(curTick, detonateTick) - throwTick) / flightDur
    const visiblePts = Math.max(2, Math.min(flightPts, Math.ceil(progress * flightPts + 1)))
    const detFade = curTick > detonateTick
      ? Math.max(0, 1 - (curTick - detonateTick) / TRAIL_FADE_TICKS)
      : 1
    const nadeTrailMode = opts.nadeTrailMode ?? 'trail'
    const trailSegs = Math.ceil(TRAIL_FADE_TICKS / ticksPerSeg)
    const startPt = nadeTrailMode === 'trail' ? Math.max(0, visiblePts - trailSegs) : 0
    const endPt = Math.min(nPts, visiblePts)
    if (endPt - startPt < 2) continue

    const numSegs = endPt - 1 - startPt
    for (let pi = startPt; pi < endPt - 1; pi++) {
      const p0 = [tr[pi * 3], tr[pi * 3 + 1], tr[pi * 3 + 2]] as [number, number, number]
      const p1 = [tr[(pi + 1) * 3], tr[(pi + 1) * 3 + 1], tr[(pi + 1) * 3 + 2]] as [number, number, number]
      const [sx0, sy0] = P(p0[0], p0[1], p0[2])
      const [sx1, sy1] = P(p1[0], p1[1], p1[2])
      const segFrac = numSegs > 1 ? (pi - startPt) / (numSegs - 1) : 1
      const alpha = (nadeTrailMode === 'trail' ? 0.15 + segFrac * 0.75 : 0.65) * detFade
      if (alpha <= 0.01) continue
      ctx.beginPath()
      ctx.moveTo(sx0, sy0)
      ctx.lineTo(sx1, sy1)
      ctx.strokeStyle = `rgba(${rgb},${alpha.toFixed(3)})`
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.stroke()
    }

    if (curTick <= detonateTick) {
      const headIdx = Math.min(nPts - 1, visiblePts - 1)
      const hx = tr[headIdx * 3], hy = tr[headIdx * 3 + 1], hz = tr[headIdx * 3 + 2]
      const [shx, shy] = P(hx, hy, hz)
      ctx.beginPath()
      ctx.arc(shx, shy, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${rgb},1)`
      ctx.fill()
    }
  }

  // shot rays: origin from the shooter's interpolated position at eye height
  const tracerWindow = replay.tickrate * 0.25
  const hurtMap = new Map<string, { hx: number; hy: number; hz?: number }>()
  for (const ev of replay.events) {
    const e = ev as Record<string, unknown>
    if (e.ty !== 'hi') continue
    if ((e.t as number) > curTick || curTick - (e.t as number) > tracerWindow) continue
    const key = `${e.t}:${e.a}`
    if (!hurtMap.has(key)) {
      hurtMap.set(key, {
        hx: e.x as number,
        hy: e.y as number,
        hz: typeof e.z === 'number' ? (e.z as number) : undefined,
      })
    }
  }

  // interpolated player position (mirrors drawFrame.framePos: no lerp across
  // death/respawn transitions or teleport-sized jumps)
  const n = replay.players.length
  const fi = Math.floor(frameIdx)
  const frac = frameIdx - fi
  const frameBase = fi * n * FIELDS
  if (frameBase + n * FIELDS > replay.data.length) return
  const nextBaseAll = frac > 0 && fi + 1 < replay.ticks.length ? (fi + 1) * n * FIELDS : -1
  const aliveAt = (base: number) => replay.data[base + F_ALIVE]
  function playerPos(pidx: number): [number, number, number] {
    const base = frameBase + pidx * FIELDS
    const x0 = replay.data[base], y0 = replay.data[base + 1], z0 = replay.data[base + 2]
    if (nextBaseAll < 0) return [x0, y0, z0]
    const bn = nextBaseAll + pidx * FIELDS
    const x1 = replay.data[bn], y1 = replay.data[bn + 1], z1 = replay.data[bn + 2]
    if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 500 || aliveAt(base) !== aliveAt(bn)) return [x0, y0, z0]
    return [x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac, z0 + (z1 - z0) * frac]
  }

  for (const shot of replay.shots) {
    const [stTick, pidx, sx, sy] = shot
    if (stTick > curTick || curTick - stTick > tracerWindow) continue
    const syaw = ((shot[4] ?? 0) * Math.PI) / 180
    const spitch = (((shot[5] ?? 0) * Math.PI) / 180)
    const cosP = Math.cos(spitch)
    const sinP = Math.sin(spitch)
    const [, , pz] = playerPos(pidx)
    const teamByte = replay.data[frameBase + pidx * FIELDS + F_TEAM] ?? 0
    const rgb = hexRgb(TEAM_COLORS[teamByte] ?? '#ffffff')
    const fade = 1 - (curTick - stTick) / tracerWindow
    const ox = sx + Math.cos(syaw) * cosP * 12
    const oy = sy + Math.sin(syaw) * cosP * 12
    const oz = (pz + EYE) - sinP * 12
    let hitPt: { hx: number; hy: number; hz?: number } | null = null
    for (let dt = 0; dt <= 3 && !hitPt; dt++) hitPt = hurtMap.get(`${stTick + dt}:${pidx}`) ?? null
    let hitZ = oz
    if (hitPt) {
      // Find victim player closest to hit point to ensure hit is at body/head height (not feet)
      let victimZ: number | undefined
      let minD2 = Infinity
      for (let vi = 0; vi < n; vi++) {
        if (vi === pidx) continue
        const [vx, vy, vz] = playerPos(vi)
        const d2 = (vx - hitPt.hx) ** 2 + (vy - hitPt.hy) ** 2
        if (d2 < minD2) {
          minD2 = d2
          victimZ = vz
        }
      }
      if (hitPt.hz !== undefined) {
        // If hz is at feet level (e.g. legacy artifact where hz was victim_Z without hitgroup offset),
        // lift it to chest level so it doesn't render on the floor underneath the capsule!
        if (victimZ !== undefined && hitPt.hz <= victimZ + 8) {
          hitZ = victimZ + 42
        } else {
          hitZ = hitPt.hz
        }
      } else if (victimZ !== undefined) {
        hitZ = victimZ + 42
      } else {
        hitZ = oz
      }
    }
    const targetEnd: [number, number, number] = hitPt
      ? [hitPt.hx, hitPt.hy, hitZ]
      : [
          ox + Math.cos(syaw) * cosP * RAY_LEN,
          oy + Math.sin(syaw) * cosP * RAY_LEN,
          oz - sinP * RAY_LEN,
        ]
    drawPolyline3D(ctx, [
      [ox, oy, oz],
      targetEnd,
    ], cam, w, h, rgb, fade * 0.8, 1.5)
    if (hitPt) {
      const [ex, ey] = P(hitPt.hx, hitPt.hy, hitZ)
      const cs = 4
      ctx.beginPath()
      ctx.moveTo(ex - cs, ey - cs); ctx.lineTo(ex + cs, ey + cs)
      ctx.moveTo(ex + cs, ey - cs); ctx.lineTo(ex - cs, ey + cs)
      ctx.strokeStyle = `rgba(255,255,255,${fade})`
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }

  // active bomb on ground: flat horizontal glow at actual bomb.z (planted or dropped)
  const bomb = resolveActiveBomb(replay, frameIdx, curTick, roundStartT, roundEndActual)
  if (bomb) {
    const onLevel = zOnLevel(bomb.z, ov, level)
    const alphaMult = onLevel ? 1 : 0.35
    const isPlanted = bomb.state === 'planted'
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / (isPlanted ? 160 : 380))

    if (isPlanted) {
      // concentric discs in horizontal plane at bomb.z for rich flat glow
      const col = '255,50,50'
      drawGroundDisc(ctx, bomb.x, bomb.y, 34, bomb.z, cam, w, h, col, (0.15 + 0.1 * pulse) * alphaMult)
      drawGroundDisc(ctx, bomb.x, bomb.y, 22, bomb.z, cam, w, h, col, (0.35 + 0.2 * pulse) * alphaMult)
      drawGroundDisc(ctx, bomb.x, bomb.y, 10, bomb.z, cam, w, h, col, (0.65 + 0.25 * pulse) * alphaMult)
    } else {
      // dropped bomb: warm amber/orange flat glow
      const col = '255,175,40'
      drawGroundDisc(ctx, bomb.x, bomb.y, 26, bomb.z, cam, w, h, col, (0.14 + 0.08 * pulse) * alphaMult)
      drawGroundDisc(ctx, bomb.x, bomb.y, 16, bomb.z, cam, w, h, col, (0.32 + 0.14 * pulse) * alphaMult)
      drawGroundDisc(ctx, bomb.x, bomb.y, 8, bomb.z, cam, w, h, col, (0.60 + 0.18 * pulse) * alphaMult)
    }
  }

  // players: team-colored capsules with a view sector, weapon icon + number
  // above, speed with movement direction to the right, hp bar below
  const teamCount: Record<number, number> = {}
  const playerNum: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const team = replay.players[i]?.team ?? 0
    teamCount[team] = (teamCount[team] ?? 0) + 1
    playerNum[i] = teamCount[team]
  }

  // last player_blind event per player index (t = blind tick, d = blind seconds)
  const lastBlind: { t: number; d: number }[] = []
  for (const ev of replay.events) {
    const e = ev as Record<string, unknown>
    if (e.ty !== 'fl') continue
    const t = e.t as number
    if (t > curTick) continue
    const p = (e.p as number) ?? -1
    if (p < 0 || p >= n) continue
    const cur = lastBlind[p]
    if (!cur || t >= cur.t) lastBlind[p] = { t, d: (e.d as number) ?? 3 }
  }

  // view sector: chevron band with sharp corner drawn as small world-space polygons; pieces beyond
  // the capsule axis depth render before it, the rest after
  function getOuterPt(yaw: number, da: number, x: number, y: number, zMid: number): [number, number, number] {
    const u = Math.min(1, Math.abs(da) / SECTOR_HALF)
    const sign = da >= 0 ? 1 : -1
    const px = (1 - u) * SECTOR_R_PEAK + u * (SECTOR_R_BASE * Math.cos(SECTOR_HALF))
    const py = sign * u * (SECTOR_R_BASE * Math.sin(SECTOR_HALF))
    const rx = x + Math.cos(yaw) * px - Math.sin(yaw) * py
    const ry = y + Math.sin(yaw) * px + Math.cos(yaw) * py
    return [rx, ry, zMid]
  }

  function capArc(x: number, y: number, zMid: number, a: number, outward: number): [number, number, number][] {
    const capR = (SECTOR_R_BASE - SECTOR_R_IN) / 2
    const rm = (SECTOR_R_BASE + SECTOR_R_IN) / 2
    const pts: [number, number, number][] = []
    for (let s = 0; s <= 4; s++) {
      const phi = (s / 4) * Math.PI
      const rr = rm + Math.cos(phi) * capR
      const at = a + outward * Math.sin(phi) * (capR / rm)
      pts.push([x + Math.cos(at) * rr, y + Math.sin(at) * rr, zMid])
    }
    return pts
  }

  function sectorPiece(x: number, y: number, zMid: number, yaw: number, sIdx: number): [number, number, number][] {
    const a0 = yaw - SECTOR_HALF + (2 * SECTOR_HALF) * (sIdx / SECTOR_SEGS)
    const a1 = yaw - SECTOR_HALF + (2 * SECTOR_HALF) * ((sIdx + 1) / SECTOR_SEGS)
    const da0 = a0 - yaw
    const da1 = a1 - yaw
    const cap0 = sIdx === 0
    const cap1 = sIdx === SECTOR_SEGS - 1

    const pts: [number, number, number][] = []
    // outer edge: straight facet from outer(a0) to outer(a1)
    pts.push(getOuterPt(yaw, da0, x, y, zMid))
    pts.push(getOuterPt(yaw, da1, x, y, zMid))

    if (cap1) {
      const cpts = capArc(x, y, zMid, a1, 1)
      pts.push(...cpts.slice(1))
    }

    // inner edge: circular arc from a1 back to a0
    const SUB = 4
    const startS = cap1 ? SUB - 1 : SUB
    const endS = cap0 ? 1 : 0
    for (let s = startS; s >= endS; s--) {
      const a = a0 + (a1 - a0) * (s / SUB)
      pts.push([x + Math.cos(a) * SECTOR_R_IN, y + Math.sin(a) * SECTOR_R_IN, zMid])
    }

    if (cap0) {
      const cpts = capArc(x, y, zMid, a0, -1).reverse()
      pts.push(...cpts)
    }

    return pts
  }
  const fillPoly = (pts: [number, number, number][], rgb: string, alpha: number) => {
    ctx.beginPath()
    pts.forEach((p, i) => {
      const [sx, sy] = P(p[0], p[1], p[2])
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy)
    })
    ctx.closePath()
    ctx.fillStyle = `rgba(${rgb},${alpha})`
    ctx.fill()
  }

  const capsules: { i: number; x: number; y: number; z: number; yaw: number; d: number }[] = []
  for (let i = 0; i < n; i++) {
    const base = frameBase + i * FIELDS
    if (!aliveAt(base)) continue
    const [x, y, z] = playerPos(i)
    const bn = nextBaseAll < 0 ? -1 : nextBaseAll + i * FIELDS
    const yaw0 = replay.data[base + F_YAW] ?? 0
    const yaw1 = bn >= 0 ? (replay.data[bn + F_YAW] ?? yaw0) : yaw0
    const yaw = ((yaw0 + (((yaw1 - yaw0 + 540) % 360) - 180) * frac) * Math.PI) / 180
    capsules.push({ i, x, y, z, yaw, d: depth([x, y, z], cam, b) })
  }
  type RenderItem =
    | { type: 'capsule'; c: (typeof capsules)[0]; d: number }
    | { type: 'smoke'; sm: ActiveSmoke; d: number }

  const sceneItems: RenderItem[] = [
    ...capsules.map(c => ({ type: 'capsule' as const, c, d: c.d })),
    ...activeSmokes.map(sm => ({ type: 'smoke' as const, sm, d: sm.d })),
  ]
  sceneItems.sort((p, q) => q.d - p.d) // far first

  ctx.textAlign = 'center'
  for (const item of sceneItems) {
    if (item.type === 'smoke') {
      drawSmokeSphere(ctx, item.sm.cx, item.sm.cy, item.sm.rPx, item.sm.fade, item.sm.alphaMult)
      continue
    }

    const c = item.c
    const base = frameBase + c.i * FIELDS
    const teamByte = replay.data[base + F_TEAM] ?? 0
    const rgb = hexRgb(TEAM_COLORS[teamByte] ?? '#ffffff')
    const onLevel = zOnLevel(c.z, ov, level)
    const alpha = onLevel ? 0.92 : 0.25
    const flags = replay.data[base + F_FLAGS] ?? 0
    const hasBomb = (flags & 1) === 1
    const zMid = c.z + CAPSULE_H / 2
    const [mx, my] = P(c.x, c.y, zMid)

    if (hasBomb) {
      // bomb carrier: white ring on the ground under the capsule
      const ring: [number, number, number][] = []
      for (let s = 0; s <= 16; s++) {
        const a = (s / 16) * Math.PI * 2
        ring.push([c.x + Math.cos(a) * (CAPSULE_R + 5), c.y + Math.sin(a) * (CAPSULE_R + 5), c.z + 0.5])
      }
      ctx.beginPath()
      ring.forEach((p, i) => {
        const [sx, sy] = P(p[0], p[1], p[2])
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy)
      })
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // view sector behind the capsule body — white: same-hue fill would melt
    // into the capsule
    const dPlayer = depth([c.x, c.y, zMid], cam, b)
    const back: { pts: [number, number, number][]; d: number }[] = []
    const front: { pts: [number, number, number][]; d: number }[] = []
    for (let s = 0; s < SECTOR_SEGS; s++) {
      const a0 = c.yaw - SECTOR_HALF + (2 * SECTOR_HALF) * (s / SECTOR_SEGS)
      const a1 = c.yaw - SECTOR_HALF + (2 * SECTOR_HALF) * ((s + 1) / SECTOR_SEGS)
      const pts = sectorPiece(c.x, c.y, zMid, c.yaw, s)
      const am = (a0 + a1) / 2
      const outPt = getOuterPt(c.yaw, am - c.yaw, c.x, c.y, zMid)
      const inPt: [number, number, number] = [c.x + Math.cos(am) * SECTOR_R_IN, c.y + Math.sin(am) * SECTOR_R_IN, zMid]
      const midPt: [number, number, number] = [(outPt[0] + inPt[0]) / 2, (outPt[1] + inPt[1]) / 2, zMid]
      const d = depth(midPt, cam, b)
      ;(d > dPlayer ? back : front).push({ pts, d })
    }
    for (const p of back) fillPoly(p.pts, '255,255,255', alpha * 0.7)

    drawCapsule3D(ctx, c.x, c.y, c.z, CAPSULE_R, CAPSULE_H, cam, w, h, rgb, alpha)

    // sector pieces in front of the body
    front.sort((p, q) => q.d - p.d)
    for (const p of front) fillPoly(p.pts, '255,255,255', alpha * 0.7)

    // blind effect overlay: 2D screen silhouette shader (yellow pie + contour, mirrors drawFrame)
    const blind = lastBlind[c.i]
    const stillFlashed = (flags & FLAG_FLASHED) !== 0
    if (blind || stillFlashed) {
      const remainSec = blind ? (blind.t + blind.d * replay.tickrate - curTick) / replay.tickrate : 0
      const severity = blind ? Math.min(1, blind.d / 5) : 0.25
      const frac = blind ? Math.max(0, Math.min(1, remainSec / Math.max(0.1, blind.d))) : 0
      const sweep = severity * frac
      if (sweep > 0.02 || stillFlashed) {
        const p0 = P(c.x, c.y, c.z + CAPSULE_R)
        const p1 = P(c.x, c.y, c.z + CAPSULE_H - CAPSULE_R)
        const rPx = CAPSULE_R * cam.zoom
        const capPath = buildCapsuleScreenPath(p0, p1, rPx)

        ctx.save()
        ctx.clip(capPath)

        // Yellow blind sweep from capsule mid-point
        if (sweep > 0.02) {
          const rCover = Math.max(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + rPx, rPx) * 1.5
          ctx.beginPath()
          ctx.moveTo(mx, my)
          ctx.arc(mx, my, rCover, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sweep)
          ctx.closePath()
          ctx.fillStyle = `rgba(255,214,64,${0.55 * alpha})`
          ctx.fill()
        }
        if (stillFlashed) {
          ctx.fillStyle = `rgba(255,235,120,${0.25 * alpha})`
          ctx.fill(capPath)
        }
        ctx.restore()

        // Glowing yellow contour around the capsule screen silhouette
        ctx.strokeStyle = `rgba(255,214,64,${(stillFlashed ? 0.9 : 0.75) * alpha})`
        ctx.lineWidth = 1.8
        ctx.stroke(capPath)
      }
    }

    // labels: weapon icon + team number above the capsule, hp bar below,
    // speed + movement arrow to the right (mirrors drawFrame)
    const [lx, ly] = P(c.x, c.y, c.z + CAPSULE_H)
    const [fx, fy] = P(c.x, c.y, c.z)
    if (lx > -60 && lx < w + 60 && ly > -60 && ly < h + 60) {
      const hp = replay.data[base + 4] ?? 0
      const wid = replay.data[base + F_WID] ?? 0
      const winfo = replay.weapons[wid]
      const weapKey = winfo?.key ?? (winfo?.raw ?? '').replace(/^weapon_/, '').toLowerCase()
      const icon = weapKey ? weaponIcon(weapKey) : null
      let iconH = 0
      if (icon) {
        iconH = 13
        const iw = iconH * (icon.naturalWidth / icon.naturalHeight || 1)
        ctx.globalAlpha = alpha
        ctx.drawImage(icon, lx - iw / 2, ly - iconH - 4, iw, iconH)
        ctx.globalAlpha = 1
      }
      ctx.font = 'bold 11px system-ui, sans-serif'
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      ctx.fillText(String(playerNum[c.i]), lx, ly - iconH - 9)
      if (hasBomb) {
        const c4 = weaponIcon('c4')
        if (c4) {
          const c4H = 11
          const c4W = c4H * (c4.naturalWidth / c4.naturalHeight || 1.3)
          ctx.drawImage(c4, lx + 7, ly - iconH - 18, c4W, c4H)
        }
      }

      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(fx - 11, fy + 5, 22, 3)
      const hpr = hp > 50 ? '76,175,125' : hp > 25 ? '245,197,66' : '224,82,82'
      ctx.fillStyle = `rgba(${hpr},${alpha})`
      ctx.fillRect(fx - 11, fy + 5, 22 * Math.max(0, Math.min(100, hp)) / 100, 3)

      const vel = playerSpeedAt(replay, c.i, fi)
      if (onLevel && vel > 5) {
        const pb = Math.max(0, fi - 1) * n * FIELDS + c.i * FIELDS
        const dxv = replay.data[base] - replay.data[pb]
        const dyv = replay.data[base + 1] - replay.data[pb + 1]
        const vx = mx + CAPSULE_R * cam.zoom + 4
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.textAlign = 'left'
        ctx.font = '10px monospace'
        const numW = ctx.measureText(String(vel)).width
        ctx.fillText(String(vel), vx, my + 4)

        // "u/s" unit hint + a small movement-vector arrow directly above it (mirrors drawFrame 2D)
        ctx.font = '6px monospace'
        const ux = vx + numW + 2
        const uw = ctx.measureText('u/s').width
        ctx.fillText('u/s', ux, my + 4)

        // Screen-space movement direction projected from 3D world deltas
        const [p0x, p0y] = P(c.x, c.y, zMid)
        const [p1x, p1y] = P(c.x + dxv, c.y + dyv, zMid)
        const ang = Math.atan2(p1y - p0y, p1x - p0x)

        const acx = ux + uw / 2, acy = my - 3
        const alen = 5, hl = 2.5, ha = Math.PI / 6
        const tipX = acx + Math.cos(ang) * (alen / 2), tipY = acy + Math.sin(ang) * (alen / 2)
        const backX = acx - Math.cos(ang) * (alen / 2), backY = acy - Math.sin(ang) * (alen / 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(backX, backY); ctx.lineTo(tipX, tipY); ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(tipX, tipY)
        ctx.lineTo(tipX - hl * Math.cos(ang - ha), tipY - hl * Math.sin(ang - ha))
        ctx.moveTo(tipX, tipY)
        ctx.lineTo(tipX - hl * Math.cos(ang + ha), tipY - hl * Math.sin(ang + ha))
        ctx.stroke()
        ctx.textAlign = 'center'
      }
    }
  }

  // Active HE explosions (rendered over players/smokes as bright blast spheres)
  for (const he of activeHEs) {
    drawHEExplosion(ctx, he.cx, he.cy, he.rPx, he.progress, he.alphaMult)
  }

  // Active Flashbang flares (rendered on top as radiant billboard starbursts)
  for (const fl of activeFlashes) {
    drawFlashFlare(ctx, fl.cx, fl.cy, fl.progress, cam.zoom, fl.alphaMult)
  }

  // active bomb icon in 3D: centered above the flat glow at bomb.z + 6
  if (bomb) {
    const onLevel = zOnLevel(bomb.z, ov, level)
    const alpha = onLevel ? 0.95 : 0.35
    const isPlanted = bomb.state === 'planted'
    const [bx, by] = P(bomb.x, bomb.y, bomb.z + 6)
    const img = weaponIcon(isPlanted ? 'planted_c4' : 'c4')
    if (img) {
      const iconH = isPlanted ? 16 : 14
      const iconW = iconH * (img.naturalWidth / img.naturalHeight || 1.2)
      ctx.globalAlpha = alpha
      ctx.drawImage(img, bx - iconW / 2, by - iconH / 2, iconW, iconH)
      ctx.globalAlpha = 1
    } else {
      ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2)
      ctx.fillStyle = isPlanted ? `rgba(255,60,60,${alpha})` : `rgba(255,175,40,${alpha})`
      ctx.fill()
    }
  }
}
