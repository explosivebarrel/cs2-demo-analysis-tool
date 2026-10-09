// 3D replay scene: players as team-colored boxes, grenade trails as 3D arcs,
// shot rays, smoke/fire zones and the planted bomb on the ground plane.
// Element selection mirrors drawFrame.ts (2D) — same time windows and fade
// rules — so both views stay consistent. Camera/projection come from scene3d.
import { MapOverview, ReplayData } from '../../api'
import { zOnLevel } from '../../lib/coords'
import { F_ALIVE, F_TEAM, F_YAW, fieldsOf, TEAM_COLORS } from '../../lib/replay'
import { TRAIL_COLORS } from '../replay/drawFrame'
import { Cam, camBasis, depth, drawBox3D, drawGroundDisc, drawPolyline3D, project } from './scene3d'

const ZONE_COLORS: Record<string, string> = {
  sm: '100,200,150', fr: '255,100,30', fd: '255,240,80', hd: '255,160,80',
}
// world-unit radii (2D uses screen px on the map square; 3D works in world)
const ZONE_RADIUS: Record<string, number> = { sm: 170, fr: 130, fd: 60, hd: 75 }
const BOX_HALF = 16
const BOX_TALL = 72
const EYE = 48
const RAY_LEN = 300

function hexRgb(hex: string): string {
  const v = hex.replace('#', '')
  const n = parseInt(v.length === 3 ? v.split('').map(c => c + c).join('') : v, 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

export interface Replay3DOpts {
  ov: MapOverview
  level?: string
  nadeFilter?: Set<number> | null
  groundZ: number
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

  // smoke / fire zones + recent flash/HE detonations as ground discs
  const zones: { ty: string; x: number; y: number; a: number }[] = []
  for (const ev of replay.events) {
    const e = ev as Record<string, unknown>
    const ty = e.ty as string
    if (ty === 'sm' || ty === 'fr') {
      const t0 = e.t as number
      if (t0 > curTick || t0 < roundStartT) continue
      const expTy = ty === 'sm' ? 'sx' : 'fx'
      const expire = replay.events.find(e2 => {
        const q = e2 as Record<string, unknown>
        return q.ty === expTy && (q.t as number) > t0 &&
          Math.abs((q.x as number) - (e.x as number)) < 50 &&
          Math.abs((q.y as number) - (e.y as number)) < 50
      })
      const expT = expire ? (expire as Record<string, unknown>).t as number : t0 + 18 * replay.tickrate
      if (curTick <= expT) zones.push({ ty, x: e.x as number, y: e.y as number, a: 0.35 })
    } else if (ty === 'fd' || ty === 'hd') {
      if (Math.abs((e.t as number) - curTick) < replay.tickrate * 0.35)
        zones.push({ ty, x: e.x as number, y: e.y as number, a: 0.45 })
    }
  }
  for (const z of zones) {
    drawGroundDisc(ctx, z.x, z.y, ZONE_RADIUS[z.ty] ?? 60, gz, cam, w, h, ZONE_COLORS[z.ty] ?? '200,200,200', z.a)
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
    const trailSegs = Math.ceil(TRAIL_FADE_TICKS / ticksPerSeg)
    const startPt = Math.max(0, visiblePts - trailSegs)
    const endPt = Math.min(nPts, visiblePts)
    if (endPt - startPt < 2) continue

    const pts: [number, number, number][] = []
    for (let pi = startPt; pi < endPt; pi++) pts.push([tr[pi * 3], tr[pi * 3 + 1], tr[pi * 3 + 2]])
    drawPolyline3D(ctx, pts, cam, w, h, rgb, (0.55 + 0.4 * detFade) * 0.9, 2)
    const head = pts[pts.length - 1]
    const [hx, hy] = P(head[0], head[1], head[2])
    ctx.beginPath()
    ctx.arc(hx, hy, 4, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${rgb},${detFade})`
    ctx.fill()
  }

  // shot rays: origin from the shooter's interpolated position at eye height
  const tracerWindow = replay.tickrate * 0.25
  const hurtMap = new Map<string, { hx: number; hy: number }>()
  for (const ev of replay.events) {
    const e = ev as Record<string, unknown>
    if (e.ty !== 'hi') continue
    if ((e.t as number) > curTick || curTick - (e.t as number) > tracerWindow) continue
    const key = `${e.t}:${e.a}`
    if (!hurtMap.has(key)) hurtMap.set(key, { hx: e.x as number, hy: e.y as number })
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
    const [, , pz] = playerPos(pidx)
    const teamByte = replay.data[frameBase + pidx * FIELDS + F_TEAM] ?? 0
    const rgb = hexRgb(TEAM_COLORS[teamByte] ?? '#ffffff')
    const fade = 1 - (curTick - stTick) / tracerWindow
    const ox = sx + Math.cos(syaw) * 12, oy = sy + Math.sin(syaw) * 12
    drawPolyline3D(ctx, [
      [ox, oy, pz + EYE],
      [ox + Math.cos(syaw) * RAY_LEN, oy + Math.sin(syaw) * RAY_LEN, pz + EYE],
    ], cam, w, h, rgb, fade * 0.8, 1.5)
    let hitPt: { hx: number; hy: number } | null = null
    for (let dt = 0; dt <= 3 && !hitPt; dt++) hitPt = hurtMap.get(`${stTick + dt}:${pidx}`) ?? null
    if (hitPt) {
      const [ex, ey] = P(hitPt.hx, hitPt.hy, gz)
      const cs = 4
      ctx.beginPath()
      ctx.moveTo(ex - cs, ey - cs); ctx.lineTo(ex + cs, ey + cs)
      ctx.moveTo(ex + cs, ey - cs); ctx.lineTo(ex - cs, ey + cs)
      ctx.strokeStyle = `rgba(255,255,255,${fade})`
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }

  // planted bomb: pulsing disc at the plant spot until defused/exploded
  let planted: { x: number; y: number } | null = null
  {
    const bombEv: { ty: string; t: number; x: number; y: number }[] = []
    for (const ev of replay.events) {
      const e = ev as Record<string, unknown>
      if (e.ty === 'bp' || e.ty === 'bf' || e.ty === 'bx')
        bombEv.push({ ty: e.ty as string, t: e.t as number, x: (e.x as number) ?? 0, y: (e.y as number) ?? 0 })
    }
    bombEv.sort((p, q) => p.t - q.t)
    let plantedTick = 0
    for (const ev of bombEv) {
      if (ev.t > curTick) break
      if (ev.ty === 'bp') { planted = { x: ev.x, y: ev.y }; plantedTick = ev.t }
      else { planted = null; plantedTick = 0 }
    }
    if (planted && (plantedTick < roundStartT || curTick > roundEndActual)) planted = null
  }
  if (planted) {
    const pulse = 0.3 + 0.15 * Math.sin(performance.now() / 160)
    drawGroundDisc(ctx, planted.x, planted.y, 26, gz, cam, w, h, '255,80,80', pulse)
  }

  // players: team-colored boxes with a yaw notch, numbered labels + hp bars
  const teamCount: Record<number, number> = {}
  const playerNum: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const team = replay.players[i]?.team ?? 0
    teamCount[team] = (teamCount[team] ?? 0) + 1
    playerNum[i] = teamCount[team]
  }

  const boxes: { i: number; x: number; y: number; z: number; d: number }[] = []
  for (let i = 0; i < n; i++) {
    const base = frameBase + i * FIELDS
    if (!aliveAt(base)) continue
    const [x, y, z] = playerPos(i)
    boxes.push({ i, x, y, z, d: depth([x, y, z], cam, b) })
  }
  boxes.sort((p, q) => q.d - p.d)  // far first

  ctx.textAlign = 'center'
  for (const bx of boxes) {
    const base = frameBase + bx.i * FIELDS
    const bn = nextBaseAll < 0 ? -1 : nextBaseAll + bx.i * FIELDS
    const teamByte = replay.data[base + F_TEAM] ?? 0
    const rgb = hexRgb(TEAM_COLORS[teamByte] ?? '#ffffff')
    const yaw0 = replay.data[base + F_YAW] ?? 0
    const yaw1 = bn >= 0 ? (replay.data[bn + F_YAW] ?? yaw0) : yaw0
    const yaw = yaw0 + (((yaw1 - yaw0 + 540) % 360) - 180) * frac
    const onLevel = zOnLevel(bx.z, ov, level)
    const alpha = (onLevel ? 0.9 : 0.25)
    const hasBomb = ((replay.data[base + 8] ?? 0) & 1) === 1
    drawBox3D(ctx,
      bx.x - BOX_HALF, bx.y - BOX_HALF, bx.z, bx.x + BOX_HALF, bx.y + BOX_HALF, bx.z + BOX_TALL,
      cam, w, h, rgb, alpha, hasBomb ? '255,255,255' : undefined)

    // yaw notch on the top face (forward = (cos yaw, sin yaw) in world)
    const rad = (yaw * Math.PI) / 180
    const fx = Math.cos(rad), fy = Math.sin(rad)
    const px = -fy, py = fx
    const tipX = bx.x + fx * (BOX_HALF + 4), tipY = bx.y + fy * (BOX_HALF + 4)
    const notch: [number, number, number][] = [
      [tipX, tipY, bx.z + BOX_TALL + 1],
      [bx.x - px * 7, bx.y - py * 7, bx.z + BOX_TALL + 1],
      [bx.x + px * 7, bx.y + py * 7, bx.z + BOX_TALL + 1],
    ]
    drawPolyline3D(ctx, [notch[0], notch[1], notch[2], notch[0]], cam, w, h, '255,255,255', alpha, 1.5)

    // label: team number + hp bar, screen-space above the box
    const [lx, ly] = P(bx.x, bx.y, bx.z + BOX_TALL + 30)
    if (lx > -40 && lx < w + 40 && ly > -40 && ly < h + 40) {
      const hp = replay.data[base + 4] ?? 0
      ctx.font = 'bold 11px system-ui, sans-serif'
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      ctx.fillText(String(playerNum[bx.i]), lx, ly)
      ctx.fillStyle = `rgba(0,0,0,0.5)`
      ctx.fillRect(lx - 11, ly + 4, 22, 3)
      const hpr = hp > 50 ? '76,175,125' : hp > 25 ? '245,197,66' : '224,82,82'
      ctx.fillStyle = `rgba(${hpr},${alpha})`
      ctx.fillRect(lx - 11, ly + 4, 22 * Math.max(0, Math.min(100, hp)) / 100, 3)
    }
  }
}
