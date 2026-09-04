import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DuelEpisode, DuelFrame, MapOverview, ReplayData } from '../../api'
import { api } from '../../api'
import { t, getLang } from '../../i18n'
import { F_ALIVE, F_X, F_Y, fieldsOf } from '../../lib/replay'
import drawFrame from '../replay/drawFrame'
import WeaponIcon from '../WeaponIcon'

const ERROR_META: Record<string, { key: string; color: string; icon: string }> = {
  shift_peek:    { key: 'player:duels.errorShiftPeek',   color: 'var(--accent2)', icon: '🚶' },
  moving_shot:   { key: 'player:duels.errorMovingShot',  color: 'var(--red)',     icon: '🏃' },
  isolated:      { key: 'player:duels.errorIsolated',    color: 'var(--accent)',  icon: '🔇' },
  flashed:       { key: 'player:duels.errorFlashed',     color: 'var(--accent2)', icon: '🌟' },
  strong_duel:   { key: 'player:duels.errorStrongDuel',  color: 'var(--green)',   icon: '💪' },
  overshoot:     { key: 'player:duels.errorOvershoot',   color: 'var(--red)',     icon: '→' },
  undershoot:    { key: 'player:duels.errorUndershoot',  color: 'var(--accent2)', icon: '←' },
  missed_first:  { key: 'player:duels.errorMissedFirst', color: 'var(--accent)',  icon: '✗' },
  passive_angle: { key: 'player:duels.errorPassiveAngle', color: 'var(--text2)',  icon: '⏸' },
  moving:        { key: 'player:duels.errorMoving',      color: 'var(--text2)',   icon: '🏃' },
  outnumbered:   { key: 'player:duels.errorOutnumbered', color: 'var(--text2)',   icon: '⚠️' },
}

type KeyField = 'w' | 'a' | 's' | 'd' | 'jump' | 'walk' | 'duck'

const KEY_ROWS: { key: KeyField; label: string; color: string }[] = [
  { key: 'w', label: 'W', color: '#64b5f6' },
  { key: 'a', label: 'A', color: '#ba68c8' },
  { key: 's', label: 'S', color: '#e57373' },
  { key: 'd', label: 'D', color: '#81c784' },
  { key: 'jump', label: 'Space', color: '#aed581' },
  { key: 'walk', label: 'Shift', color: '#ce93d8' },
  { key: 'duck', label: 'Ctrl', color: '#ffb74d' },
]

function fmtTime(ts: number): string {
  const m = Math.floor(ts / 60)
  const s = Math.floor(ts % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fmtOffset(ms: number): string {
  const s = ms / 1000
  return `${s > 0 ? '+' : ''}${s.toFixed(1)}s`
}

interface Props {
  duel: DuelEpisode
  playerNames: Record<string, string>
  lang?: 'ru' | 'en'
  onClose: () => void
}

/** Merge per-frame key booleans into [startMs, endMs] intervals. */
function keyIntervals(frames: DuelFrame[], key: KeyField): [number, number][] {
  if (!frames.length) return []
  const gap = frames.length > 1 ? frames[1].t - frames[0].t : 125
  const res: [number, number][] = []
  let start: number | null = null
  for (const f of frames) {
    const active = Boolean(f[key])
    if (active && start === null) start = f.t
    if (!active && start !== null) { res.push([start, f.t]); start = null }
  }
  if (start !== null) res.push([start, frames[frames.length - 1].t + gap])
  return res
}

/** Fractional frame index for an arbitrary tick (positions are interpolated by drawFrame). */
function frameFloatForTick(replay: ReplayData, tick: number): number {
  const ts = replay.ticks
  if (!ts.length) return 0
  if (tick <= ts[0]) return 0
  if (tick >= ts[ts.length - 1]) return ts.length - 1
  let lo = 0, hi = ts.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (ts[mid] <= tick) lo = mid
    else hi = mid
  }
  return lo + (tick - ts[lo]) / Math.max(1, ts[hi] - ts[lo])
}

// ── episode minimap: zoomed radar, camera on the duel participants' barycenter ──
function EpisodeMap({ replay, ov, radarImg, duel, tMs, tLoTick, tHiTick, size }: {
  replay: ReplayData
  ov: MapOverview
  radarImg: HTMLImageElement | null
  duel: DuelEpisode
  tMs: number
  tLoTick: number
  tHiTick: number
  size: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // camera fits both participants over the whole episode (world bbox → base px)
  const cam = useMemo(() => {
    const fields = fieldsOf(replay)
    const n = replay.players.length
    const iA = replay.players.findIndex(p => p.steamid === duel.attacker)
    const iV = replay.players.findIndex(p => p.steamid === duel.victim)
    if (iA < 0 && iV < 0) return null
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
    for (let fi = 0; fi < replay.ticks.length; fi++) {
      const tk = replay.ticks[fi]
      if (tk < tLoTick || tk > tHiTick) continue
      for (const pi of [iA, iV]) {
        if (pi < 0) continue
        const base = fi * n * fields + pi * fields
        if (!replay.data[base + F_ALIVE]) continue
        const x = replay.data[base + F_X], y = replay.data[base + F_Y]
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
      }
    }
    if (!isFinite(minx)) return null
    const pad = 140
    minx -= pad; maxx += pad; miny -= pad; maxy += pad
    const k = 1 / ov.scale / 1024 * size
    const halfSpan = Math.max(maxx - minx, maxy - miny) * k / 2
    const Z = Math.max(0.8, Math.min(8, size / 2 / Math.max(8, halfSpan)))
    const bx = ((minx + maxx) / 2 - ov.pos_x) * k
    const by = (ov.pos_y - (miny + maxy) / 2) * k
    return { scale: Z, ox: size / 2 - bx * Z, oy: size / 2 - by * Z }
  }, [replay, ov, duel, size, tLoTick, tHiTick])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !cam) return
    const tick = duel.tick + tMs / 1000 * replay.tickrate
    drawFrame(cv, frameFloatForTick(replay, tick), replay, ov, radarImg, cam)
  }, [tMs, cam, radarImg, ov, replay, duel])

  if (!cam) return <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 12 }}>—</div>
  return <canvas ref={canvasRef} width={size} height={size} style={{ display: 'block', borderRadius: 8, background: '#1a1c20' }} />
}

// ── velocity graph with all episode shots + synced cursor ────────────────────
function VelocityGraph({ frames, duel, tMs, onSeek }: {
  frames: DuelFrame[]
  duel: DuelEpisode
  tMs: number
  onSeek: (t: number) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  if (!frames.length) return null

  const W = 760, H = 104, PAD_L = 34, PAD_R = 10, PAD_T = 8, PAD_B = 16
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  const maxVel = Math.max(220, ...frames.map(f => f.vel))
  const tMin = frames[0].t
  const tMax = frames[frames.length - 1].t
  const tRange = tMax - tMin || 1

  const toX = (ms: number) => PAD_L + ((ms - tMin) / tRange) * innerW
  const toY = (v: number) => PAD_T + innerH - (v / maxVel) * innerH

  const pts = frames.map(f => `${toX(f.t).toFixed(1)},${toY(f.vel).toFixed(1)}`).join(' ')
  const killX = toX(0)
  const curX = toX(tMs)

  const attName = duel.attacker
  const shots = duel.shots ?? []

  function seekFromClient(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = (clientX - rect.left) / rect.width * W
    const ms = tMin + (px - PAD_L) / innerW * tRange
    onSeek(Math.max(tMin, Math.min(tMax, ms)))
  }

  return (
    <div style={{ overflow: 'hidden' }}>
      <svg
        ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair', userSelect: 'none' }}
        onMouseDown={e => { dragging.current = true; seekFromClient(e.clientX) }}
        onMouseMove={e => { if (dragging.current) seekFromClient(e.clientX) }}
        onMouseUp={() => { dragging.current = false }}
        onMouseLeave={() => { dragging.current = false }}
      >
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="var(--border)" strokeWidth={1} />
        <line x1={PAD_L} y1={PAD_T + innerH} x2={PAD_L + innerW} y2={PAD_T + innerH} stroke="var(--border)" strokeWidth={1} />
        {/* 50 u/s walk threshold */}
        <line x1={PAD_L} y1={toY(50)} x2={PAD_L + innerW} y2={toY(50)}
          stroke="#ffb74d" strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
        {/* kill moment */}
        {killX >= PAD_L && killX <= PAD_L + innerW && (
          <line x1={killX} y1={PAD_T} x2={killX} y2={PAD_T + innerH}
            stroke="var(--red)" strokeWidth={1.2} strokeDasharray="4 2" opacity={0.9} />
        )}
        {/* every shot in the episode as a vertical line; hits get a white cap */}
        {shots.map((s, i) => {
          const x = toX(s.t)
          if (x < PAD_L || x > PAD_L + innerW) return null
          const own = s.sid === attName
          const color = own ? '#4a9eda' : '#e4882a'
          return (
            <g key={i}>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + innerH}
                stroke={color} strokeWidth={s.hit ? 1.6 : 1} opacity={s.hit ? 0.95 : 0.4} />
              {s.hit && <line x1={x - 3} y1={PAD_T + 1} x2={x + 3} y2={PAD_T + 1} stroke="#fff" strokeWidth={1.6} />}
            </g>
          )
        })}
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinejoin="round" />
        {/* synced cursor */}
        <line x1={curX} y1={PAD_T} x2={curX} y2={PAD_T + innerH} stroke="rgba(255,255,255,0.85)" strokeWidth={1.2} />
        {[tMin, 0, tMax].filter((v, i, a) => a.indexOf(v) === i).map(tv => (
          <text key={tv} x={toX(tv)} y={H - 3} fontSize={9} fill="var(--text2)" textAnchor="middle">
            {fmtOffset(tv)}
          </text>
        ))}
        <text x={PAD_L - 3} y={PAD_T + 4} fontSize={9} fill="var(--text2)" textAnchor="end">{Math.round(maxVel)}</text>
        <text x={PAD_L - 3} y={PAD_T + innerH + 3} fontSize={9} fill="var(--text2)" textAnchor="end">0</text>
      </svg>
    </div>
  )
}

// ── per-key timeline rows (W/A/S/D/Space/Shift/Ctrl), synced cursor ──────────
function KeyTimeline({ frames, tMs, onSeek }: {
  frames: DuelFrame[]
  tMs: number
  onSeek: (t: number) => void
}) {
  if (!frames.length) return null
  const tMin = frames[0].t
  const tMax = frames[frames.length - 1].t
  const tRange = tMax - tMin || 1
  const pct = (ms: number) => ((ms - tMin) / tRange) * 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 10 }}>
      {KEY_ROWS.map(({ key, label, color }) => {
        const intervals = keyIntervals(frames, key)
        const active = intervals.some(([a, b]) => tMs >= a && tMs <= b)
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 42, textAlign: 'center', fontSize: 10, fontWeight: 700,
              background: active ? color : 'var(--bg3)', borderRadius: 4, padding: '2px 0',
              color: active ? '#101216' : 'var(--text2)', flexShrink: 0, transition: 'background .1s',
            }}>{label}</div>
            <div style={{ flex: 1, height: 12, background: 'var(--bg3)', borderRadius: 3, position: 'relative', cursor: 'crosshair', overflow: 'hidden' }}
              onMouseDown={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                const p = (e.clientX - rect.left) / rect.width
                onSeek(tMin + p * tRange)
              }}>
              {intervals.map(([a, b], i) => {
                const l = Math.max(0, Math.min(100, pct(a)))
                const r = Math.max(l, Math.min(100, pct(b)))
                return (
                  <div key={i} style={{
                    position: 'absolute', top: 1, bottom: 1,
                    left: `${l}%`, width: `${Math.max(0.6, r - l)}%`,
                    background: color, borderRadius: 2, opacity: 0.85,
                  }} />
                )
              })}
              <div style={{
                position: 'absolute', top: -2, bottom: -2, left: `${pct(tMs)}%`,
                width: 1.5, background: 'rgba(255,255,255,0.85)', pointerEvents: 'none',
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function EpisodeDrillDown({ duel, playerNames, onClose }: Props) {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const frames = duel.frames ?? []
  const tMin = frames.length ? frames[0].t : 0
  const tMax = frames.length ? frames[frames.length - 1].t : 0

  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [ov, setOv] = useState<MapOverview | null>(null)
  const [radarImg, setRadarImg] = useState<HTMLImageElement | null>(null)
  const [mapName, setMapName] = useState('')
  const [tMs, setTMs] = useState(Math.min(0, tMax))

  // replay + overview load lazily on first drilldown (both are client-cached)
  useEffect(() => {
    if (!id) return
    api.replay(id).then(setReplay).catch(() => {})
    api.analysis(id)
      .then(a => { setMapName(a.meta.map); return api.mapOverview(a.meta.map) })
      .then(setOv)
      .catch(() => {})
  }, [id])

  useEffect(() => {
    if (!mapName) return
    const img = new Image()
    img.onload = () => setRadarImg(img)
    img.src = api.radarUrl(mapName)
  }, [mapName])

  const seek = (v: number) => setTMs(Math.max(tMin, Math.min(tMax, v)))

  const errMeta = duel.errors.map(e => ERROR_META[e]).filter(Boolean)
  const primaryErr = errMeta[0]
  const attName = playerNames[duel.attacker] ?? duel.attacker.slice(-6)
  const vicName = playerNames[duel.victim] ?? duel.victim.slice(-6)

  const headerColor = duel.won
    ? (primaryErr ? primaryErr.color : 'var(--green)')
    : 'var(--red)'

  const diagLines: string[] = []
  const { context: kc } = duel
  if (duel.won) {
    if (kc.aliveAllies === 0)
      diagLines.push(t('player:drilldown.diagFullIsolation'))
    else if (kc.nearAllyDist !== null && kc.nearAllyDist > 800)
      diagLines.push(t('player:drilldown.diagNearestAlly', { dist: Math.round(kc.nearAllyDist) }))
    if (kc.flashDur > 1.5)
      diagLines.push(t('player:drilldown.diagEnemyFlashed', { dur: kc.flashDur.toFixed(1) }))
    if (kc.attackerVel > 50)
      diagLines.push(t('player:drilldown.diagShootingMoving', { vel: Math.round(kc.attackerVel) }))
    if (kc.attackerWalking)
      diagLines.push(t('player:drilldown.diagShiftPeek'))
  } else {
    if (kc.flashDur > 1.5)
      diagLines.push(t('player:drilldown.diagVictimFlashed', { dur: kc.flashDur.toFixed(1) }))
    if (kc.attackerVel > 100)
      diagLines.push(t('player:drilldown.diagAttackerMoving', { vel: Math.round(kc.attackerVel) }))
  }

  function goToRound() {
    if (id) navigate(`/match/${id}/replay?round=${duel.round}`)
  }

  // episode log: kills, bomb, grenades of the participants inside the window
  const lang = getLang()
  const tLoTick = duel.tick + tMin / 1000 * (replay?.tickrate ?? 64)
  const tHiTick = duel.tick + tMax / 1000 * (replay?.tickrate ?? 64)
  const logEntries = useMemo(() => {
    if (!replay) return []
    const bombLabels: Record<string, string> = {
      bp: t('replay:bomb.planted'), bu: t('replay:bomb.picked'), bo: t('replay:bomb.dropped'),
      bz: t('replay:bomb.defuseStart'), bf: t('replay:bomb.defused'), bx: t('replay:bomb.exploded'),
    }
    const out: { ms: number; tick: number; text: string; color: string }[] = []
    for (const ev of replay.events) {
      const e = ev as Record<string, unknown>
      const tick = e.t as number
      if (tick < tLoTick || tick > tHiTick) continue
      const ty = e.ty as string
      const ms = Math.round((tick - duel.tick) / replay.tickrate * 1000)
      if (ty === 'k') {
        const ai = e.a as number, vi = e.v as number
        const an = replay.players[ai]?.name ?? '?'
        const vn = replay.players[vi]?.name ?? '?'
        out.push({ ms, tick, text: `${an} → ${vn}`, color: 'var(--red)' })
      } else if (bombLabels[ty]) {
        out.push({ ms, tick, text: bombLabels[ty], color: 'var(--accent2)' })
      } else if (ty === 'g') {
        const pi = e.p as number
        const nm = replay.players[pi]?.name ?? ''
        if (nm) out.push({ ms, tick, text: `${nm} 💣`, color: 'var(--text2)' })
      }
    }
    return out.sort((a, b) => a.ms - b.ms)
  }, [replay, tLoTick, tHiTick, duel])

  const MAP_SIZE = 380

  return (
    /* backdrop */
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      {/* modal panel */}
      <div
        style={{
          background: 'var(--bg2)', borderRadius: 12, width: '100%', maxWidth: 1000,
          border: `1px solid ${headerColor}`, overflow: 'hidden',
          maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div style={{ background: 'var(--bg3)', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>{primaryErr?.icon ?? (duel.won ? '✅' : '❌')}</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: headerColor }}>
                  {primaryErr
                    ? t(primaryErr.key)
                    : (duel.won
                      ? t('player:drilldown.duelWon')
                      : t('player:drilldown.duelLost'))}
                </div>
                {diagLines[0] && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{diagLines[0]}</div>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
            >×</button>
          </div>
        </div>

        {/* body */}
        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1 }}>
          {/* participants */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, fontSize: 13 }}>
            <span style={{ fontWeight: 700, color: duel.won ? 'var(--green)' : 'var(--red)' }}>
              {attName}
            </span>
            <span style={{ fontSize: 16 }}>→</span>
            <span style={{ color: 'var(--text2)' }}>{vicName}</span>
            {duel.headshot && (
              <img src="/icons/weapons/icon_headshot.svg" alt="HS" title="HS" width={14} height={14} />
            )}
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text2)', fontSize: 12 }}>
              <WeaponIcon id={duel.weapon.replace(/^weapon_/, '')} name={duel.weapon} size={14} />
              {duel.weapon}
            </span>
            <span style={{ color: 'var(--text2)', fontSize: 12 }}>R{duel.round} · {fmtTime(duel.timestamp)}</span>
          </div>

          {/* top row: episode minimap + slider | event log */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ flexShrink: 0 }}>
              {replay && ov ? (
                <EpisodeMap replay={replay} ov={ov} radarImg={radarImg}
                  duel={duel} tMs={tMs} tLoTick={tLoTick} tHiTick={tHiTick} size={MAP_SIZE} />
              ) : (
                <div className="skeleton" style={{ width: MAP_SIZE, height: MAP_SIZE, borderRadius: 8 }} />
              )}
              <input type="range" min={tMin} max={Math.max(tMin + 1, tMax)} value={tMs}
                onChange={e => seek(Number(e.target.value))}
                style={{ width: '100%', marginTop: 8, accentColor: 'var(--accent)' }} />
              <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                {fmtOffset(tMs)} · {fmtOffset(tMin)} … {fmtOffset(tMax)}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>
                {t('player:drilldown.log')}
              </div>
              <div style={{ flex: 1, minHeight: 100, maxHeight: MAP_SIZE + 34, overflowY: 'auto', background: 'var(--bg3)', borderRadius: 8, padding: '4px 0' }}>
                {logEntries.length === 0 && (
                  <div style={{ padding: 12, fontSize: 12, color: 'var(--text2)' }}>—</div>
                )}
                {logEntries.map((en, i) => {
                  const near = Math.abs(en.ms - tMs) < 300
                  return (
                    <div key={i} onClick={() => seek(en.ms)} style={{
                      display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px',
                      borderBottom: '1px solid var(--border)', cursor: 'pointer',
                      background: near ? 'rgba(255,255,255,0.05)' : 'transparent',
                    }}>
                      <span style={{ fontSize: 10, color: 'var(--text2)', minWidth: 44, fontVariantNumeric: 'tabular-nums' }}>{fmtOffset(en.ms)}</span>
                      <span style={{ fontSize: 12, color: en.color }}>{en.text}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* context grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
            {[
              { label: t('player:drilldown.atkVel'), value: `${kc.attackerVel} u/s`, warn: kc.attackerVel > 50 },
              { label: t('player:drilldown.vicVel'), value: `${kc.victimVel} u/s` },
              { label: t('player:drilldown.flashVictim'), value: `${kc.flashDur.toFixed(2)}s`, warn: kc.flashDur > 1.5 },
              { label: t('player:drilldown.nearestAlly'),
                value: kc.nearAllyDist != null ? `${Math.round(kc.nearAllyDist)}u` : '—',
                warn: kc.nearAllyDist !== null && kc.nearAllyDist > 800 },
              { label: t('player:drilldown.alliesAlive'), value: String(kc.aliveAllies), warn: kc.aliveAllies === 0 },
              { label: t('player:drilldown.enemiesAlive'), value: String(kc.aliveEnemies) },
            ].map(({ label, value, warn }) => (
              <div key={label} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
                <div style={{ fontWeight: 700, color: warn ? 'var(--red)' : 'var(--text)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* velocity graph (with all shots) + key timeline, synced cursor */}
          {frames.length > 0 && (
            <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>
                {t('player:drilldown.velocityTitle')}
              </div>
              <VelocityGraph frames={frames} duel={duel} tMs={tMs} onSeek={seek} />
              <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', margin: '10px 0 2px', fontWeight: 600 }}>
                {t('player:drilldown.keyPresses')}
              </div>
              <KeyTimeline frames={frames} tMs={tMs} onSeek={seek} />
            </div>
          )}

          {/* error badges */}
          {errMeta.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {errMeta.map(m => (
                <span key={m.key} style={{
                  background: 'var(--bg3)', border: `1px solid ${m.color}`,
                  color: m.color, borderRadius: 4, padding: '3px 10px', fontSize: 12,
                }}>
                  {m.icon} {t(m.key)}
                </span>
              ))}
            </div>
          )}

          {/* extra diag lines */}
          {diagLines.slice(1).map((d, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 4 }}>⚠ {d}</div>
          ))}

          {/* go to round */}
          <button
            onClick={goToRound}
            style={{
              marginTop: 8, width: '100%',
              background: 'var(--bg3)', border: '1px solid var(--border)',
              color: 'var(--text)', borderRadius: 6, padding: '9px 0',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            {t('player:drilldown.watchRound', { round: duel.round })}
          </button>
        </div>
      </div>
    </div>
  )
}
