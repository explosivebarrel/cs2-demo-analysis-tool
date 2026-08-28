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

const F_X = 0, F_Y = 1, F_Z = 2, F_YAW = 3, F_HP = 4, F_ARMOR = 5
const F_ALIVE = 6, F_WID = 7, F_TEAM = 8, F_FLAGS = 9
const FIELDS = 10

const TEAM_COLORS = ['#e4882a', '#4a9eda']
const SIZE = 600

interface Transform { scale: number; ox: number; oy: number }

function worldToCanvas(wx: number, wy: number, ov: MapOverview): [number, number] {
  const px = (wx - ov.pos_x) / ov.scale
  const py = (ov.pos_y - wy) / ov.scale
  const ratio = SIZE / 1024
  return [px * ratio, py * ratio]
}

// apply pan/zoom transform to a canvas-space point
function applyTx(x: number, y: number, tx: Transform): [number, number] {
  return [x * tx.scale + tx.ox, y * tx.scale + tx.oy]
}

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
  tx: Transform,
) {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)

  // visual scale factor for player dots — shrink as zoom increases (sqrt keeps it gentle)
  const dotScale = 1 / Math.sqrt(tx.scale)

  ctx.save()
  ctx.translate(tx.ox, tx.oy)
  ctx.scale(tx.scale, tx.scale)

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

  const roundEvents = replay.events.filter(ev => (ev as Record<string, unknown>).ty === 'r')
  let roundStartT = 0
  for (const rev of roundEvents) {
    const rt = (rev as Record<string, unknown>).t as number
    if (rt <= curTick) roundStartT = rt
  }

  const activeZones: { ty: string; x: number; y: number }[] = []
  for (const ev of replay.events) {
    const evTy = (ev as Record<string, unknown>).ty as string
    if (evTy !== 'sm' && evTy !== 'fr') continue
    const evT = (ev as Record<string, unknown>).t as number
    if (evT > curTick) continue
    if (evT < roundStartT) continue
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

  const recentDet: { ty: string; x: number; y: number }[] = []
  for (const ev of replay.events) {
    const evTy = (ev as Record<string, unknown>).ty as string
    if (evTy !== 'fd' && evTy !== 'hd') continue
    const evT = (ev as Record<string, unknown>).t as number
    if (Math.abs(evT - curTick) < replay.tickrate * 0.35) {
      recentDet.push({ ty: evTy, x: (ev as Record<string, unknown>).x as number, y: (ev as Record<string, unknown>).y as number })
    }
  }

  for (const z of [...activeZones, ...recentDet]) {
    const [cx, cy] = worldToCanvas(z.x, z.y, ov)
    const r = NADE_RADIUS[z.ty] ?? 10
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, NADE_COLORS[z.ty] ?? 'rgba(200,200,200,0.6)')
    grad.addColorStop(1, NADE_EDGE[z.ty] ?? 'rgba(200,200,200,0.15)')
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = grad; ctx.fill()
  }

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

  const n = replay.players.length
  const frameBase = frameIdx * n * FIELDS
  if (frameBase + n * FIELDS > replay.data.length) { ctx.restore(); return }

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
    const r = 8 * dotScale

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = color + 'cc'
    ctx.fill()
    ctx.strokeStyle = hasBomb ? '#fff' : color
    ctx.lineWidth = (hasBomb ? 2.5 : 1.5) * dotScale
    ctx.stroke()

    const name = replay.players[i]?.name ?? ''
    ctx.font = `${Math.round(10 * dotScale)}px monospace`
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.fillText(name.slice(0, 8), cx, cy - r - 2 * dotScale)

    const yaw = replay.data[base + F_YAW]
    const rad = (yaw * Math.PI) / 180
    const arrowLen = 14 * dotScale
    const ax = cx + Math.cos(rad) * arrowLen
    const ay = cy - Math.sin(rad) * arrowLen
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(ax, ay)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5 * dotScale
    ctx.stroke()
    const headLen = 4 * dotScale
    const headAngle = Math.PI / 6
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - headLen * Math.cos(rad - headAngle), ay + headLen * Math.sin(rad - headAngle))
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - headLen * Math.cos(rad + headAngle), ay + headLen * Math.sin(rad + headAngle))
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5 * dotScale
    ctx.stroke()

    const bw = 20 * dotScale, bh = 3 * dotScale
    const bx = cx - bw / 2, by = cy + r + 2 * dotScale
    ctx.fillStyle = '#333'
    ctx.fillRect(bx, by, bw, bh)
    ctx.fillStyle = hp > 50 ? '#4caf7d' : hp > 25 ? '#f5c542' : '#e05252'
    ctx.fillRect(bx, by, bw * hp / 100, bh)
  }

  ctx.restore()
}

const SPEEDS = [0.5, 1, 2, 4, 8]

function getHotkeys() {
  return [
    { key: 'Space', label: 'Space', desc: t('hotPause') },
    { key: ',', label: ',', desc: t('slowDown') },
    { key: '.', label: '.', desc: t('speedUp') },
    { key: '0', label: '0', desc: t('zoomReset') },
    { key: 'Scroll', label: 'Scroll', desc: t('hotZoom') },
    { key: 'Drag', label: 'Drag', desc: t('hotPan') },
  ]
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
  const [speedIdx, setSpeedIdx] = useState(1)
  const [err, setErr] = useState('')
  const [tx, setTx] = useState<Transform>({ scale: 1, ox: 0, oy: 0 })
  const txRef = useRef<Transform>({ scale: 1, ox: 0, oy: 0 })
  const dragRef = useRef<{ startX: number; startY: number; startOx: number; startOy: number } | null>(null)
  const touchRef = useRef<{ dist: number; cx: number; cy: number } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const radarRef = useRef<HTMLImageElement>(null)
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  const frameIdxRef = useRef(0)
  const replayRef = useRef<ReplayData | null>(null)

  useEffect(() => { frameIdxRef.current = frameIdx }, [frameIdx])
  useEffect(() => { txRef.current = tx }, [tx])
  useEffect(() => { replayRef.current = replay }, [replay])

  useEffect(() => {
    if (!id) return
    Promise.all([api.replay(id), api.analysis(id)])
      .then(([r, a]) => { setReplay(r); setAnalysis(a); return api.mapOverview(a.meta.map) })
      .then(setOverview)
      .catch(e => setErr(e.message))
  }, [id])

  const totalFrames = replay?.ticks.length ?? 0

  useEffect(() => {
    if (!canvasRef.current || !replay || !overview) return
    drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current, tx)
  }, [frameIdx, replay, overview, tx])

  useEffect(() => {
    if (!playing || !replay) return
    const frameMs = (replay.frameStep / replay.tickrate) * 1000 / speed
    function tick(now: number) {
      if (now - lastTimeRef.current >= frameMs) {
        lastTimeRef.current = now
        setFrameIdx(prev => {
          const next = prev + 1
          if (next >= (replayRef.current?.ticks.length ?? 0)) { setPlaying(false); return prev }
          return next
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, replay, speed])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      if (e.key === ',') setSpeedIdx(i => { const ni = Math.max(0, i - 1); setSpeed(SPEEDS[ni]); return ni })
      if (e.key === '.') setSpeedIdx(i => { const ni = Math.min(SPEEDS.length - 1, i + 1); setSpeed(SPEEDS[ni]); return ni })
      if (e.key === '0') setTx({ scale: 1, ox: 0, oy: 0 })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const clampTx = useCallback((t: Transform): Transform => {
    // clamp scale first, then compute bounds from the clamped scale
    const sc = Math.max(1, Math.min(8, t.scale))
    const maxOff = SIZE * (sc - 1)
    return { scale: sc, ox: Math.max(-maxOff, Math.min(0, t.ox)), oy: Math.max(-maxOff, Math.min(0, t.oy)) }
  }, [])

  // passive:false is required to allow preventDefault() on wheel — React's synthetic onWheel can't do this
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const cur = txRef.current
      // clamp the new scale before computing offset to avoid drift at boundaries
      const rawScale = cur.scale * factor
      const sc = Math.max(1, Math.min(8, rawScale))
      const ox = mx - (mx - cur.ox) * (sc / cur.scale)
      const oy = my - (my - cur.oy) * (sc / cur.scale)
      const maxOff = SIZE * (sc - 1)
      setTx({ scale: sc, ox: Math.max(-maxOff, Math.min(0, ox)), oy: Math.max(-maxOff, Math.min(0, oy)) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [canvasRef.current])

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOx: txRef.current.ox, startOy: txRef.current.oy }
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX, dy = e.clientY - dragRef.current.startY
    setTx(clampTx({ scale: txRef.current.scale, ox: dragRef.current.startOx + dx, oy: dragRef.current.startOy + dy }))
  }
  function onMouseUp() { dragRef.current = null }

  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY
      touchRef.current = { dist: Math.sqrt(dx*dx+dy*dy), cx: (e.touches[0].clientX+e.touches[1].clientX)/2, cy: (e.touches[0].clientY+e.touches[1].clientY)/2 }
    } else if (e.touches.length === 1) {
      dragRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, startOx: txRef.current.ox, startOy: txRef.current.oy }
    }
  }
  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (e.touches.length === 2 && touchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx*dx+dy*dy)
      const rect = canvasRef.current!.getBoundingClientRect()
      const mx = touchRef.current.cx - rect.left, my = touchRef.current.cy - rect.top
      const factor = dist / touchRef.current.dist
      const cur = txRef.current; const ns = cur.scale * factor
      setTx(clampTx({ scale: ns, ox: mx-(mx-cur.ox)*(ns/cur.scale), oy: my-(my-cur.oy)*(ns/cur.scale) }))
      touchRef.current.dist = dist
    } else if (e.touches.length === 1 && dragRef.current) {
      const dx = e.touches[0].clientX - dragRef.current.startX, dy = e.touches[0].clientY - dragRef.current.startY
      setTx(clampTx({ scale: txRef.current.scale, ox: dragRef.current.startOx+dx, oy: dragRef.current.startOy+dy }))
    }
  }
  function onTouchEnd() { dragRef.current = null; touchRef.current = null }

  function scrub(e: React.ChangeEvent<HTMLInputElement>) { setFrameIdx(Number(e.target.value)); setPlaying(false) }

  function fmtTime(fi: number) {
    if (!replay) return '0:00'
    const sec = (replay.ticks[fi] ?? 0) / replay.tickrate
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }

  const currentRound = analysis?.rounds.find(r =>
    replay && r.freezeEndTick <= (replay.ticks[frameIdx] ?? 0) && (replay.ticks[frameIdx] ?? 0) <= r.endTick
  )
  const curTick = replay?.ticks[frameIdx] ?? 0
  const killFeed = replay?.events.filter(ev => {
    const e = ev as Record<string, unknown>
    return e.ty === 'k' && Math.abs((e.t as number) - curTick) < replay.tickrate * 3
  }).slice(-5) ?? []

  if (err) return <div className="page"><div className="tag tag-red">{err}</div></div>
  if (!replay || !overview) return <div className="page"><span className="spinner" /><span className="text-muted" style={{ marginLeft: 8 }}>{t('loading')}</span></div>

  const mapName = analysis?.meta.map ?? ''
  const cursor = dragRef.current ? 'grabbing' : tx.scale > 1 ? 'grab' : 'default'

  return (
    <div className="page">
      <MatchNav id={id!} />
      <div style={{ display: 'grid', gridTemplateColumns: `${SIZE}px 1fr`, gap: 16, alignItems: 'start' }}>
        <div>
          <div className="card" style={{ padding: 8, position: 'relative' }}>
            <img ref={radarRef} src={api.radarUrl(mapName)} alt="" style={{ display: 'none' }}
              onLoad={() => { if (canvasRef.current && replay && overview) drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current, txRef.current) }} />
            <canvas
              ref={canvasRef} width={SIZE} height={SIZE}
              style={{ display: 'block', borderRadius: 4, cursor }}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
              onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
            />
            <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {killFeed.map((ev, i) => {
                const e = ev as Record<string, unknown>
                const attacker = replay.players[e.a as number]?.name ?? '?'
                const victim = replay.players[e.v as number]?.name ?? '?'
                const weapInfo = replay.weapons[e.w as number]
                const weapName = weapInfo ? (getLang() === 'ru' ? weapInfo.ru : weapInfo.en) : ''
                return (
                  <div key={i} style={{ background: 'rgba(0,0,0,.7)', padding: '3px 8px', borderRadius: 4, fontSize: 12, color: '#fff' }}>
                    {attacker}{e.h ? ' HS' : ''} → <span style={{ color: 'var(--red)' }}>{victim}</span>
                    {' '}<span style={{ color: 'var(--text2)', fontSize: 10 }}>{weapName}</span>
                  </div>
                )
              })}
            </div>
            {currentRound && (
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,.7)', padding: '3px 10px', borderRadius: 4, fontSize: 12 }}>
                R{currentRound.n} · {currentRound.scoreTeam0}:{currentRound.scoreTeam1}
              </div>
            )}
            {tx.scale > 1 && (
              <div style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(0,0,0,.6)', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: 'var(--text2)' }}>
                {tx.scale.toFixed(1)}x · [0] {t('zoomReset')}
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 8 }}>
            <div className="flex items-center gap-12" style={{ marginBottom: 8 }}>
              <button className="btn-primary" style={{ minWidth: 72 }} onClick={() => setPlaying(p => !p)}>
                {playing ? t('pause') : t('play')}
              </button>
              <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 40 }}>{fmtTime(frameIdx)}</span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>/ {fmtTime(totalFrames - 1)}</span>
              <div className="flex items-center gap-8" style={{ marginLeft: 'auto' }}>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('speed')}</span>
                {SPEEDS.map((s, si) => (
                  <button key={s} className={speed === s ? 'btn-primary' : 'btn-ghost'}
                    style={{ fontSize: 12, padding: '3px 8px' }}
                    onClick={() => { setSpeed(s); setSpeedIdx(si) }}>
                    {s}x
                  </button>
                ))}
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <input type="range" min={0} max={Math.max(0, totalFrames - 1)} value={frameIdx}
                onChange={scrub} style={{ width: '100%', accentColor: 'var(--accent)' }} />
              {analysis?.rounds.map(r => {
                const fi = replay.ticks.findIndex(tick => tick >= r.freezeEndTick)
                if (fi < 0) return null
                const pct = fi / (totalFrames - 1) * 100
                return (
                  <div key={r.n} title={`R${r.n}`}
                    style={{ position: 'absolute', top: 0, left: `${pct}%`, width: 2, height: 8, background: r.isPistol ? 'var(--accent2)' : 'var(--border)', transform: 'translateX(-50%)', pointerEvents: 'none' }} />
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              {getHotkeys().map(hk => (
                <div key={hk.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text2)' }}>
                  <kbd style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px', fontFamily: 'monospace', fontSize: 11 }}>{hk.label}</kbd>
                  <span>{hk.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--text2)' }}>{t('players')}</div>
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
                  <span style={{ fontSize: 12, fontWeight: 700, minWidth: 48, textAlign: 'right', color: hp > 50 ? 'var(--green)' : hp > 25 ? 'var(--accent2)' : 'var(--red)' }}>
                    {alive ? hp + ' HP' : '☠'}
                  </span>
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
                {currentRound.bombPlanted && <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 4 }}>💣 {t('bombPlantedSite')} {currentRound.bombSite}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
