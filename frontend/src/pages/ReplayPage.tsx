import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, NavLink } from 'react-router-dom'
import { api, ReplayData, MapOverview, AnalysisData } from '../api'
import { t, getLang } from '../i18n'
import { useLang } from '../App'

function MatchNav({ id }: { id: string }) {
  useLang()
  const base = `/match/${id}`
  const s = (active: boolean) => ({
    color: active ? 'var(--accent)' : 'var(--text2)',
    fontWeight: active ? 700 : 400, textDecoration: 'none', fontSize: 13,
  })
  return (
    <div className="flex gap-16 items-center" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 20 }}>
      <NavLink to={base} end style={({ isActive }) => s(isActive)}>{t('overview')}</NavLink>
      <NavLink to={`${base}/heatmaps`} style={({ isActive }) => s(isActive)}>{t('heatmaps')}</NavLink>
      <NavLink to={`${base}/replay`} style={({ isActive }) => s(isActive)}>{t('replay')}</NavLink>
    </div>
  )
}

// frame data layout per player (10 values):
// 0:x 1:y 2:z 3:yaw 4:hp 5:armor 6:alive 7:weaponId 8:team 9:flags
const F_X = 0, F_Y = 1, F_Z = 2, F_YAW = 3, F_HP = 4, F_ARMOR = 5
const F_ALIVE = 6, F_WID = 7, F_TEAM = 8, F_FLAGS = 9
const FIELDS = 10

const TEAM_COLORS = ['#e4882a', '#4a9eda']
const SIZE = 600

function worldToCanvas(wx: number, wy: number, ov: MapOverview): [number, number] {
  const px = (wx - ov.pos_x) / ov.scale
  const py = (ov.pos_y - wy) / ov.scale
  const ratio = SIZE / 1024
  return [px * ratio, py * ratio]
}

// ty codes from backend/app/pipeline/events.py
const NADE_COLORS: Record<string, string> = {
  sm: 'rgba(150,200,150,0.65)',
  fd: 'rgba(255,240,80,0.8)',
  hd: 'rgba(255,160,40,0.8)',
  fr: 'rgba(255,80,30,0.65)',
}
const NADE_EDGE: Record<string, string> = {
  sm: 'rgba(150,200,150,0.25)',
  fd: 'rgba(255,240,80,0.25)',
  hd: 'rgba(255,160,40,0.25)',
  fr: 'rgba(255,80,30,0.25)',
}
const NADE_RADIUS: Record<string, number> = { sm: 26, fd: 10, hd: 12, fr: 20 }

function drawFrame(
  canvas: HTMLCanvasElement,
  frameIdx: number,
  replay: ReplayData,
  ov: MapOverview,
  radarImg: HTMLImageElement | null,
) {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)

  if (radarImg?.complete && radarImg.naturalWidth > 0) {
    ctx.drawImage(radarImg, 0, 0, SIZE, SIZE)
  } else {
    ctx.fillStyle = '#1a1c20'
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.strokeStyle = '#2a2d35'
    ctx.lineWidth = 1
    for (let i = 0; i <= SIZE; i += 40) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, SIZE); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(SIZE, i); ctx.stroke()
    }
  }

  const curTick = replay.ticks[frameIdx] ?? 0

  // find round start tick for current tick (grenades from previous rounds must not bleed through)
  const roundEvents = replay.events.filter(ev => (ev as Record<string, unknown>).ty === 'r')
  let roundStartT = 0
  for (const rev of roundEvents) {
    const rt = (rev as Record<string, unknown>).t as number
    if (rt <= curTick) roundStartT = rt
  }

  // active grenade zones (sm/fr active between detonate and expire event)
  const activeZones: { ty: string; x: number; y: number }[] = []
  for (const ev of replay.events) {
    const evTy = (ev as Record<string, unknown>).ty as string
    if (evTy !== 'sm' && evTy !== 'fr') continue
    const evT = (ev as Record<string, unknown>).t as number
    if (evT > curTick) continue
    // must belong to current round (detonate after round start)
    if (evT < roundStartT) continue
    // find corresponding expire (sx for smoke, fx for fire)
    const expTy = evTy === 'sm' ? 'sx' : 'fx'
    const expire = replay.events.find(e2 => {
      const t2 = (e2 as Record<string, unknown>)
      return t2.ty === expTy &&
        (t2.t as number) > evT &&
        Math.abs((t2.x as number) - ((ev as Record<string, unknown>).x as number)) < 50 &&
        Math.abs((t2.y as number) - ((ev as Record<string, unknown>).y as number)) < 50
    })
    const expT = expire ? (expire as Record<string, unknown>).t as number : evT + 18 * replay.tickrate
    if (curTick <= expT) {
      activeZones.push({ ty: evTy, x: (ev as Record<string, unknown>).x as number, y: (ev as Record<string, unknown>).y as number })
    }
  }

  // flash/HE detonations visible for ~0.3s
  const recentDet: { ty: string; x: number; y: number }[] = []
  for (const ev of replay.events) {
    const evTy = (ev as Record<string, unknown>).ty as string
    if (evTy !== 'fd' && evTy !== 'hd') continue
    const evT = (ev as Record<string, unknown>).t as number
    if (Math.abs(evT - curTick) < replay.tickrate * 0.35) {
      recentDet.push({ ty: evTy, x: (ev as Record<string, unknown>).x as number, y: (ev as Record<string, unknown>).y as number })
    }
  }

  // draw zones
  for (const z of [...activeZones, ...recentDet]) {
    const [cx, cy] = worldToCanvas(z.x, z.y, ov)
    const r = NADE_RADIUS[z.ty] ?? 10
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, NADE_COLORS[z.ty] ?? 'rgba(200,200,200,0.6)')
    grad.addColorStop(1, NADE_EDGE[z.ty] ?? 'rgba(200,200,200,0.15)')
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = grad; ctx.fill()
  }

  // shot tracers: visible for ~0.25s after the shot tick
  const tracerWindow = replay.tickrate * 0.25
  for (const shot of replay.shots) {
    const [stTick, pidx, sx, sy] = shot
    if (stTick > curTick || curTick - stTick > tracerWindow) continue
    const syaw = shot[4]
    const [scx, scy] = worldToCanvas(sx, sy, ov)
    const rad = (syaw * Math.PI) / 180
    const tracerLen = 40
    const fade = 1 - (curTick - stTick) / tracerWindow
    const playerColor = TEAM_COLORS[replay.data[frameIdx * replay.players.length * FIELDS + pidx * FIELDS + F_TEAM] ?? 0] ?? '#fff'
    ctx.beginPath()
    ctx.moveTo(scx, scy)
    ctx.lineTo(scx + Math.cos(rad) * tracerLen, scy - Math.sin(rad) * tracerLen)
    ctx.strokeStyle = playerColor + Math.round(fade * 0xcc).toString(16).padStart(2, '0')
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // players
  const n = replay.players.length
  const frameBase = frameIdx * n * FIELDS
  if (frameBase + n * FIELDS > replay.data.length) return

  for (let i = 0; i < n; i++) {
    const base = frameBase + i * FIELDS
    const alive = replay.data[base + F_ALIVE]
    if (!alive) continue
    const x = replay.data[base + F_X], y = replay.data[base + F_Y]
    const hp = replay.data[base + F_HP]
    const team = replay.data[base + F_TEAM]
    const flags = replay.data[base + F_FLAGS]
    const [cx, cy] = worldToCanvas(x, y, ov)
    const hasBomb = (flags & 1) !== 0
    const color = TEAM_COLORS[team] ?? '#ccc'
    const r = 8

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = color + 'cc'
    ctx.fill()
    ctx.strokeStyle = hasBomb ? '#fff' : color
    ctx.lineWidth = hasBomb ? 2.5 : 1.5
    ctx.stroke()

    const name = replay.players[i]?.name ?? ''
    ctx.font = '10px monospace'
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.fillText(name.slice(0, 8), cx, cy - r - 2)

    // aim direction arrow (canvas Y is flipped vs world Y, so negate sin)
    const yaw = replay.data[base + F_YAW]
    const rad = (yaw * Math.PI) / 180
    const arrowLen = 14
    const ax = cx + Math.cos(rad) * arrowLen
    const ay = cy - Math.sin(rad) * arrowLen
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(ax, ay)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.stroke()
    // arrowhead
    const headLen = 4
    const headAngle = Math.PI / 6
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - headLen * Math.cos(rad - headAngle), ay + headLen * Math.sin(rad - headAngle))
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - headLen * Math.cos(rad + headAngle), ay + headLen * Math.sin(rad + headAngle))
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.stroke()

    const bw = 20, bh = 3
    const bx = cx - bw / 2, by = cy + r + 2
    ctx.fillStyle = '#333'
    ctx.fillRect(bx, by, bw, bh)
    ctx.fillStyle = hp > 50 ? '#4caf7d' : hp > 25 ? '#f5c542' : '#e05252'
    ctx.fillRect(bx, by, bw * hp / 100, bh)
  }
}

export default function ReplayPage() {
  useLang()
  const { id } = useParams<{ id: string }>()
  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [overview, setOverview] = useState<MapOverview | null>(null)
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [err, setErr] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const radarRef = useRef<HTMLImageElement>(null)
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  const frameIdxRef = useRef(0)

  useEffect(() => { frameIdxRef.current = frameIdx }, [frameIdx])

  useEffect(() => {
    if (!id) return
    Promise.all([api.replay(id), api.analysis(id)])
      .then(([r, a]) => {
        setReplay(r)
        setAnalysis(a)
        return api.mapOverview(a.meta.map)
      })
      .then(setOverview)
      .catch(e => setErr(e.message))
  }, [id])

  const totalFrames = replay?.ticks.length ?? 0

  // render current frame when canvas/replay/overview ready
  useEffect(() => {
    if (!canvasRef.current || !replay || !overview) return
    drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current)
  }, [frameIdx, replay, overview])

  // animation loop
  useEffect(() => {
    if (!playing || !replay) return
    const frameMs = (replay.frameStep / replay.tickrate) * 1000 / speed

    function tick(now: number) {
      if (now - lastTimeRef.current >= frameMs) {
        lastTimeRef.current = now
        setFrameIdx(prev => {
          const next = prev + 1
          if (next >= (replay?.ticks.length ?? 0)) { setPlaying(false); return prev }
          return next
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, replay, speed])

  function scrub(e: React.ChangeEvent<HTMLInputElement>) {
    setFrameIdx(Number(e.target.value))
    setPlaying(false)
  }

  function fmtTime(fi: number) {
    if (!replay) return '0:00'
    const sec = (replay.ticks[fi] ?? 0) / replay.tickrate
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }

  // find round for current tick
  const currentRound = analysis?.rounds.find(r =>
    replay && r.freezeEndTick <= (replay.ticks[frameIdx] ?? 0) && (replay.ticks[frameIdx] ?? 0) <= r.endTick
  )

  // kill feed: kills near current tick (compact event keys: ty/t/a/v/w/h)
  const curTick = replay?.ticks[frameIdx] ?? 0
  const killFeed = replay?.events.filter(ev => {
    const e = ev as Record<string, unknown>
    return e.ty === 'k' && Math.abs((e.t as number) - curTick) < replay.tickrate * 3
  }).slice(-5) ?? []

  if (err) return <div className="page"><div className="tag tag-red">{err}</div></div>
  if (!replay || !overview) return <div className="page"><span className="spinner" /><span className="text-muted" style={{ marginLeft: 8 }}>{t('loading')}</span></div>

  const mapName = analysis?.meta.map ?? ''

  return (
    <div className="page">
      <MatchNav id={id!} />
      <div style={{ display: 'grid', gridTemplateColumns: `${SIZE}px 1fr`, gap: 16, alignItems: 'start' }}>
        {/* canvas */}
        <div>
          <div className="card" style={{ padding: 8, position: 'relative' }}>
            {/* hidden radar img for drawImage */}
            <img ref={radarRef} src={api.radarUrl(mapName)} alt="" style={{ display: 'none' }}
              onLoad={() => { if (canvasRef.current && replay && overview) drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current) }} />
            <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{ display: 'block', borderRadius: 4 }} />

            {/* kill feed overlay */}
            <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {killFeed.map((ev, i) => {
                const e = ev as Record<string, unknown>
                const attacker = replay.players[e.a as number]?.name ?? '?'
                const victim = replay.players[e.v as number]?.name ?? '?'
                const weapInfo = replay.weapons[e.w as number]
                const weapName = weapInfo ? (getLang() === 'ru' ? weapInfo.ru : weapInfo.en) : ''
                return (
                  <div key={i} style={{ background: 'rgba(0,0,0,.7)', padding: '3px 8px', borderRadius: 4, fontSize: 12, color: '#fff' }}>
                    {attacker}{e.h ? ' 🎯' : ''} →{' '}
                    <span style={{ color: 'var(--red)' }}>{victim}</span>
                    {' '}<span style={{ color: 'var(--text2)', fontSize: 10 }}>{weapName}</span>
                  </div>
                )
              })}
            </div>

            {/* round overlay */}
            {currentRound && (
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,.7)', padding: '3px 10px', borderRadius: 4, fontSize: 12 }}>
                R{currentRound.n} · {currentRound.scoreTeam0}:{currentRound.scoreTeam1}
              </div>
            )}
          </div>

          {/* controls */}
          <div className="card" style={{ marginTop: 8 }}>
            <div className="flex items-center gap-12" style={{ marginBottom: 8 }}>
              <button className="btn-primary" style={{ minWidth: 72 }} onClick={() => setPlaying(p => !p)}>
                {playing ? t('pause') : t('play')}
              </button>
              <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 40 }}>{fmtTime(frameIdx)}</span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>/ {fmtTime(totalFrames - 1)}</span>
              <div className="flex items-center gap-8" style={{ marginLeft: 'auto' }}>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('speed')}</span>
                {[0.5, 1, 2, 4, 8].map(s => (
                  <button key={s} className={speed === s ? 'btn-primary' : 'btn-ghost'}
                    style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => setSpeed(s)}>
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            {/* scrub bar with round markers */}
            <div style={{ position: 'relative' }}>
              <input type="range" min={0} max={Math.max(0, totalFrames - 1)} value={frameIdx}
                onChange={scrub}
                style={{ width: '100%', accentColor: 'var(--accent)' }} />
              {/* round start markers */}
              {analysis?.rounds.map(r => {
                const fi = replay.ticks.findIndex(t => t >= r.freezeEndTick)
                if (fi < 0) return null
                const pct = fi / (totalFrames - 1) * 100
                return (
                  <div key={r.n} title={`R${r.n}`}
                    style={{ position: 'absolute', top: 0, left: `${pct}%`, width: 2, height: 8, background: r.isPistol ? 'var(--accent2)' : 'var(--border)', transform: 'translateX(-50%)', pointerEvents: 'none' }} />
                )
              })}
            </div>
          </div>
        </div>

        {/* sidebar: player list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--text2)' }}>Игроки</div>
            {replay.players.map((pl, i) => {
              const base = frameIdx * replay.players.length * FIELDS + i * FIELDS
              const alive = replay.data[base + F_ALIVE] ?? 0
              const hp = replay.data[base + F_HP] ?? 0
              const wid = replay.data[base + F_WID] ?? 0
              const weapInfo = replay.weapons[wid]
              const weapName = weapInfo ? (getLang() === 'ru' ? weapInfo.ru : weapInfo.en) : ''
              const team = pl.team
              return (
                <div key={pl.steamid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)', opacity: alive ? 1 : 0.4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: TEAM_COLORS[team] ?? '#ccc', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13 }}>{pl.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 60 }}>{weapName}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 48 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: hp > 50 ? 'var(--green)' : hp > 25 ? 'var(--accent2)' : 'var(--red)' }}>
                      {alive ? hp + ' HP' : '☠'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {currentRound && (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 12, color: 'var(--text2)', textTransform: 'uppercase' }}>Раунд {currentRound.n}</div>
              <div style={{ fontSize: 13 }}>
                <div>Счёт: {currentRound.scoreTeam0}:{currentRound.scoreTeam1}</div>
                <div style={{ color: 'var(--text2)', fontSize: 12, marginTop: 4 }}>
                  {analysis?.teams[0].name}: <span className={`tag tag-${currentRound.sideTeam0}`}>{currentRound.sideTeam0}</span>
                </div>
                <div style={{ color: 'var(--text2)', fontSize: 12, marginTop: 2 }}>
                  {analysis?.teams[1].name}: <span className={`tag tag-${currentRound.sideTeam0 === 'T' ? 'CT' : 'T'}`}>{currentRound.sideTeam0 === 'T' ? 'CT' : 'T'}</span>
                </div>
                {currentRound.bombPlanted && <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 4 }}>💣 Бомба заложена · сайт {currentRound.bombSite}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
