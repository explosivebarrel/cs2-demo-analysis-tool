import { MapOverview, ReplayData } from '../../api'
import { worldToCanvas, zOnLevel } from '../../lib/coords'
import { F_ALIVE, F_FLAGS, F_HP, F_TEAM, F_WID, F_X, F_Y, F_YAW, TEAM_COLORS, Transform, fieldsOf } from '../../lib/replay'

// ── grenade zone visuals ─────────────────────────────────────────────────────
const NADE_COLORS: Record<string, string> = {
  sm: 'rgba(150,200,150,0.65)', fd: 'rgba(255,240,80,0.8)',
  hd: 'rgba(255,160,40,0.8)',  fr: 'rgba(255,80,30,0.65)',
}
const NADE_EDGE: Record<string, string> = {
  sm: 'rgba(150,200,150,0.25)', fd: 'rgba(255,240,80,0.25)',
  hd: 'rgba(255,160,40,0.25)', fr: 'rgba(255,80,30,0.25)',
}
const NADE_RADIUS: Record<string, number> = { sm: 26, fd: 10, hd: 12, fr: 20 }

// trail colours: smoke, HE, flash, fire/molotov, decoy (NADE_TYPE g indices 0-4)
export const TRAIL_COLORS = ['#88bb88', '#ff9930', '#ffec50', '#ff5020', '#aaaaaa']
export const TRAIL_LABELS = ['sm', 'he', 'flash', 'molotov', 'decoy']

export type NadeTrailMode = 'trail' | 'path'

export default function drawFrame(
  canvas: HTMLCanvasElement,
  frameIdx: number,
  replay: ReplayData,
  ov: MapOverview,
  radarImg: HTMLImageElement | null,
  tx: Transform,
  nadeTrailMode: NadeTrailMode = 'trail',
  level = 'default',
  nadeFilter: Set<number> | null = null,
) {
  const FIELDS = fieldsOf(replay)
  const ctx = canvas.getContext('2d')!
  const SZ = canvas.width
  ctx.clearRect(0, 0, SZ, SZ)
  const dotScale = 1 / Math.sqrt(tx.scale)

  ctx.save()
  ctx.translate(tx.ox, tx.oy)
  ctx.scale(tx.scale, tx.scale)

  if (radarImg?.complete && radarImg.naturalWidth > 0) {
    ctx.drawImage(radarImg, 0, 0, SZ, SZ)
  } else {
    ctx.fillStyle = '#1a1c20'
    ctx.fillRect(0, 0, SZ, SZ)
    ctx.strokeStyle = '#2a2d35'; ctx.lineWidth = 1
    for (let i = 0; i <= SZ; i += 40) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, SZ); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(SZ, i); ctx.stroke()
    }
  }

  const curTick = replay.ticks[frameIdx] ?? 0

  // find current round start tick
  const roundEvents = replay.events.filter(ev => (ev as Record<string, unknown>).ty === 'r')
  let roundStartT = 0
  for (const rev of roundEvents) {
    const rt = (rev as Record<string, unknown>).t as number
    if (rt <= curTick) roundStartT = rt
  }

  // active smoke/fire zones
  const activeZones: { ty: string; x: number; y: number }[] = []
  for (const ev of replay.events) {
    const evTy = (ev as Record<string, unknown>).ty as string
    if (evTy !== 'sm' && evTy !== 'fr') continue
    const evT = (ev as Record<string, unknown>).t as number
    if (evT > curTick || evT < roundStartT) continue
    const expTy = evTy === 'sm' ? 'sx' : 'fx'
    const expire = replay.events.find(e2 => {
      const t2 = e2 as Record<string, unknown>
      return t2.ty === expTy && (t2.t as number) > evT &&
        Math.abs((t2.x as number) - ((ev as Record<string, unknown>).x as number)) < 50 &&
        Math.abs((t2.y as number) - ((ev as Record<string, unknown>).y as number)) < 50
    })
    const expT = expire ? (expire as Record<string, unknown>).t as number : evT + 18 * replay.tickrate
    if (curTick <= expT) activeZones.push({ ty: evTy, x: (ev as Record<string, unknown>).x as number, y: (ev as Record<string, unknown>).y as number })
  }

  // recent flash/HE detonations
  const recentDet: { ty: string; x: number; y: number }[] = []
  for (const ev of replay.events) {
    const evTy = (ev as Record<string, unknown>).ty as string
    if (evTy !== 'fd' && evTy !== 'hd') continue
    const evT = (ev as Record<string, unknown>).t as number
    if (Math.abs(evT - curTick) < replay.tickrate * 0.35)
      recentDet.push({ ty: evTy, x: (ev as Record<string, unknown>).x as number, y: (ev as Record<string, unknown>).y as number })
  }

  for (const z of [...activeZones, ...recentDet]) {
    const [cx, cy] = worldToCanvas(z.x, z.y, ov, SZ, SZ)
    const r = NADE_RADIUS[z.ty] ?? 10
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, NADE_COLORS[z.ty] ?? 'rgba(200,200,200,0.6)')
    grad.addColorStop(1, NADE_EDGE[z.ty] ?? 'rgba(200,200,200,0.15)')
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = grad; ctx.fill()
  }

  // shot lines + hit markers
  const tracerWindow = replay.tickrate * 0.25
  const hurtMap = new Map<string, { hx: number; hy: number }>()
  for (const ev of replay.events) {
    const e = ev as Record<string, unknown>
    if (e.ty !== 'hi') continue
    const htick = e.t as number
    const ha = e.a as number
    if (htick > curTick || curTick - htick > tracerWindow) continue
    const key = `${htick}:${ha}`
    if (!hurtMap.has(key)) hurtMap.set(key, { hx: e.x as number, hy: e.y as number })
  }

  for (const shot of replay.shots) {
    const [stTick, pidx, sx, sy] = shot
    if (stTick > curTick || curTick - stTick > tracerWindow) continue
    const syaw = shot[4]
    const [scx, scy] = worldToCanvas(sx, sy, ov, SZ, SZ)
    const rad = (syaw * Math.PI) / 180
    const fade = 1 - (curTick - stTick) / tracerWindow
    const playerColor = TEAM_COLORS[replay.data[frameIdx * replay.players.length * FIELDS + pidx * FIELDS + F_TEAM] ?? 0] ?? '#fff'
    const alphaFull = Math.round(fade * 0xcc)
    const alphaHex  = alphaFull.toString(16).padStart(2, '0')
    const alphaHalf = Math.round(fade * 0x66).toString(16).padStart(2, '0')

    const pr = 8 * dotScale
    const chevTipX = scx + Math.cos(rad) * pr * 2
    const chevTipY = scy - Math.sin(rad) * pr * 2
    const chevLen  = 6 * dotScale
    const chevAngle = Math.PI / 5
    const chv1x = chevTipX + Math.cos(rad + Math.PI - chevAngle) * chevLen
    const chv1y = chevTipY - Math.sin(rad + Math.PI - chevAngle) * chevLen
    const chv2x = chevTipX + Math.cos(rad + Math.PI + chevAngle) * chevLen
    const chv2y = chevTipY - Math.sin(rad + Math.PI + chevAngle) * chevLen
    ctx.beginPath()
    ctx.moveTo(chv1x, chv1y); ctx.lineTo(chevTipX, chevTipY); ctx.lineTo(chv2x, chv2y)
    ctx.strokeStyle = playerColor + alphaHex
    ctx.lineWidth = 1.5 * dotScale; ctx.stroke()

    const shotLW = Math.max(0.4, 1.0 / Math.sqrt(tx.scale))

    let hitPt: { hx: number; hy: number } | null = null
    for (let dt = 0; dt <= 3 && !hitPt; dt++) {
      hitPt = hurtMap.get(`${stTick + dt}:${pidx}`) ?? null
    }

    if (hitPt) {
      const [ecx, ecy] = worldToCanvas(hitPt.hx, hitPt.hy, ov, SZ, SZ)
      ctx.beginPath()
      ctx.moveTo(chevTipX, chevTipY); ctx.lineTo(ecx, ecy)
      ctx.strokeStyle = playerColor + alphaHex
      ctx.lineWidth = shotLW; ctx.stroke()
      const cs = 4 * dotScale
      ctx.beginPath()
      ctx.moveTo(ecx - cs, ecy - cs); ctx.lineTo(ecx + cs, ecy + cs)
      ctx.moveTo(ecx + cs, ecy - cs); ctx.lineTo(ecx - cs, ecy + cs)
      ctx.strokeStyle = '#ffffff' + alphaHex
      ctx.lineWidth = shotLW * 1.2; ctx.stroke()
    } else {
      // miss: 300 world units ≈ typical room width, stays readable at any zoom
      const missWorldLen = 300
      const missCanvasLen = missWorldLen / ov.scale * (SZ / 1024) * (1 / tx.scale)
      const ex = chevTipX + Math.cos(rad) * missCanvasLen
      const ey = chevTipY - Math.sin(rad) * missCanvasLen
      ctx.beginPath()
      ctx.moveTo(chevTipX, chevTipY); ctx.lineTo(ex, ey)
      ctx.strokeStyle = playerColor + alphaHalf
      ctx.lineWidth = shotLW; ctx.stroke()
      ctx.beginPath()
      ctx.arc(ex, ey, 2 * dotScale, 0, Math.PI * 2)
      ctx.fillStyle = playerColor + alphaHalf
      ctx.fill()
    }
  }

  // grenade trails
  // Each trail event: { ty:"g", t: throwTick, g: nadeType(0-4), p: pidx, tr: [x,y,z, x,y,z,...] }
  // tr is downsampled at ~4 pts/sec, so each segment ≈ tickrate/4 ticks
  const TRAIL_FADE_TICKS = replay.tickrate * 2.5
  for (const ev of replay.events) {
    const e = ev as Record<string, unknown>
    if (e.ty !== 'g') continue
    const throwTick = e.t as number
    if (throwTick > curTick || throwTick < roundStartT) continue

    const tr = e.tr as number[]
    const gtype = (e.g as number) ?? 4
    if (nadeFilter && !nadeFilter.has(gtype)) continue
    const color = TRAIL_COLORS[gtype] ?? '#aaaaaa'
    if (!tr || tr.length < 6) continue

    const nPts = Math.floor(tr.length / 3)
    const ticksPerSeg = replay.tickrate / 4

    // find detonate tick: look for matching fd/sm/hd/fr event near end position
    const endX = tr[tr.length - 3], endY = tr[tr.length - 2]
    const detTypes: Record<number, string[]> = { 0: ['sm'], 1: ['hd'], 2: ['fd'], 3: ['fr'], 4: [] }
    let detonateTick = throwTick + nPts * ticksPerSeg
    let bestDetDist = Infinity
    for (const ev2 of replay.events) {
      const e2 = ev2 as Record<string, unknown>
      const detTys = detTypes[gtype] ?? []
      if (!detTys.includes(e2.ty as string)) continue
      if ((e2.t as number) < throwTick) continue
      const ex = e2.x as number, ey = e2.y as number
      const dx = ex - endX, dy = ey - endY
      const d2 = dx * dx + dy * dy
      if (d2 < 90000 && d2 < bestDetDist) {
        bestDetDist = d2
        detonateTick = e2.t as number
      }
    }

    if (curTick < throwTick || curTick > detonateTick + replay.tickrate * 0.5) continue

    const flightDur = Math.max(1, detonateTick - throwTick)
    const progressTick = Math.min(curTick, detonateTick) - throwTick
    const progress = progressTick / flightDur
    const visiblePts = Math.max(2, Math.ceil(progress * nPts + 1))

    const trailSegs = Math.ceil(TRAIL_FADE_TICKS / ticksPerSeg)
    const startPt = nadeTrailMode === 'trail' ? Math.max(0, visiblePts - trailSegs) : 0
    const endPt = Math.min(nPts, visiblePts)

    if (endPt - startPt < 2) continue

    ctx.save()
    for (let pi = startPt; pi < endPt - 1; pi++) {
      const x0 = tr[pi * 3], y0 = tr[pi * 3 + 1]
      const x1 = tr[(pi + 1) * 3], y1 = tr[(pi + 1) * 3 + 1]
      const [cx0, cy0] = worldToCanvas(x0, y0, ov, SZ, SZ)
      const [cx1, cy1] = worldToCanvas(x1, y1, ov, SZ, SZ)
      const segFrac = (pi - startPt) / Math.max(1, endPt - startPt - 1)
      const alpha = nadeTrailMode === 'trail' ? 0.2 + segFrac * 0.7 : 0.5
      ctx.beginPath()
      ctx.moveTo(cx0, cy0)
      ctx.lineTo(cx1, cy1)
      ctx.strokeStyle = color + Math.round(alpha * 0xff).toString(16).padStart(2, '0')
      ctx.lineWidth = 2 * dotScale
      ctx.stroke()
    }
    const headPt = Math.min(endPt - 1, nPts - 1)
    const hx = tr[headPt * 3], hy = tr[headPt * 3 + 1]
    const [hcx, hcy] = worldToCanvas(hx, hy, ov, SZ, SZ)
    ctx.beginPath()
    ctx.arc(hcx, hcy, 4 * dotScale, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.restore()
  }

  // players
  const n = replay.players.length
  const frameBase = frameIdx * n * FIELDS
  if (frameBase + n * FIELDS > replay.data.length) { ctx.restore(); return }

  // per-team numbers 1..5 by index order within each team
  const teamCount: Record<number, number> = {}
  const playerNum: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const team = replay.players[i]?.team ?? 0
    teamCount[team] = (teamCount[team] ?? 0) + 1
    playerNum[i] = teamCount[team]
  }

  const prevFrameBase = Math.max(0, frameIdx - 1) * n * FIELDS
  const velScale = replay.tickrate / Math.max(1, replay.frameStep)

  const NADE_ICONS: Record<string, string> = {
    smokegrenade: '💨', hegrenade: '💥', flashbang: '⚡',
    molotov: '🔥', incgrenade: '🔥', decoy: '🔊', c4: '💣',
  }
  const WEAP_SHORT: Record<string, string> = {
    ak47: 'AK', m4a1_silencer: 'M4S', m4a4: 'M4A4', m4a1: 'M4',
    awp: 'AWP', ssg08: 'Scout', deagle: 'DEagle', revolver: 'R8',
    galilar: 'Galil', famas: 'FAMAS', aug: 'AUG', sg556: 'SG556',
    mp9: 'MP9', mac10: 'MAC10', mp7: 'MP7', ump45: 'UMP', p90: 'P90',
    bizon: 'Bizon', mp5sd: 'MP5',
    nova: 'Nova', xm1014: 'XM', mag7: 'MAG7', sawedoff: 'Sawed',
    m249: 'M249', negev: 'Negev',
    usp_silencer: 'USP-S', hkp2000: 'P2000', glock: 'Glock',
    p250: 'P250', fiveseven: '57', cz75a: 'CZ', tec9: 'Tec9', elite: 'Elites',
    knife: '🔪', knife_t: '🔪', knife_karambit: '🔪',
  }

  for (let i = 0; i < n; i++) {
    const base = frameBase + i * FIELDS
    const alive = replay.data[base + F_ALIVE]
    if (!alive) continue
    const x = replay.data[base + F_X], y = replay.data[base + F_Y]
    const z = replay.data[base + 2]
    const hp = replay.data[base + F_HP]
    const team = replay.data[base + F_TEAM]
    const flags = replay.data[base + F_FLAGS]
    // players on another map level are dimmed instead of hidden
    const onLevel = zOnLevel(z, ov, level)
    const [cx, cy] = worldToCanvas(x, y, ov, SZ, SZ)
    const hasBomb = (flags & 1) !== 0
    const color = TEAM_COLORS[team] ?? '#ccc'
    const r = 8 * dotScale

    ctx.globalAlpha = onLevel ? 1 : 0.25
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = color + 'cc'; ctx.fill()
    ctx.strokeStyle = hasBomb ? '#fff' : color
    ctx.lineWidth = (hasBomb ? 2.5 : 1.5) * dotScale; ctx.stroke()

    const numFontSize = Math.round(r * 1.5)
    ctx.font = `bold ${numFontSize}px sans-serif`
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(playerNum[i]), cx, cy)
    ctx.textBaseline = 'alphabetic'

    // weapon label above dot
    const wid = replay.data[base + F_WID] ?? 0
    const weapRaw = replay.weapons[wid]?.raw ?? ''
    const weapKey = weapRaw.replace(/^weapon_/, '').toLowerCase()
    const nadIcon = NADE_ICONS[weapKey]
    const weapShort = nadIcon ?? WEAP_SHORT[weapKey] ?? weapKey.slice(0, 6)
    const isEmoji = !!nadIcon
    ctx.font = isEmoji
      ? `${Math.round(11 * dotScale)}px sans-serif`
      : `${Math.round(10 * dotScale)}px monospace`
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
    ctx.fillText(weapShort, cx, cy - r - 2 * dotScale)

    // velocity: units/sec from prev frame
    const prevBase = prevFrameBase + i * FIELDS
    const prevAlive = replay.data[prevBase + F_ALIVE] ?? 0
    if (prevAlive) {
      const px = replay.data[prevBase + F_X], py = replay.data[prevBase + F_Y]
      const dx = x - px, dy = y - py
      const vel = Math.round(Math.sqrt(dx * dx + dy * dy) * velScale)
      if (vel > 5) {
        ctx.font = `${Math.round(9 * dotScale)}px monospace`
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.textAlign = 'left'
        ctx.fillText(`${vel}`, cx + r + 3 * dotScale, cy + 4 * dotScale)
      }
    }

    const yaw = replay.data[base + F_YAW]
    const rad = (yaw * Math.PI) / 180
    const arrowLen = 6 * dotScale
    const arrowStartX = cx + Math.cos(rad) * r
    const arrowStartY = cy - Math.sin(rad) * r
    const ax = cx + Math.cos(rad) * (r + arrowLen), ay = cy - Math.sin(rad) * (r + arrowLen)
    ctx.beginPath(); ctx.moveTo(arrowStartX, arrowStartY); ctx.lineTo(ax, ay)
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dotScale; ctx.stroke()
    const headLen = 4 * dotScale, headAngle = Math.PI / 6
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - headLen * Math.cos(rad - headAngle), ay + headLen * Math.sin(rad - headAngle))
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - headLen * Math.cos(rad + headAngle), ay + headLen * Math.sin(rad + headAngle))
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dotScale; ctx.stroke()

    const bw = 20 * dotScale, bh = 3 * dotScale
    const bx = cx - bw / 2, by = cy + r + 2 * dotScale
    ctx.fillStyle = '#333'; ctx.fillRect(bx, by, bw, bh)
    ctx.fillStyle = hp > 50 ? '#4caf7d' : hp > 25 ? '#f5c542' : '#e05252'
    ctx.fillRect(bx, by, bw * hp / 100, bh)
    ctx.globalAlpha = 1
  }

  ctx.restore()
}
