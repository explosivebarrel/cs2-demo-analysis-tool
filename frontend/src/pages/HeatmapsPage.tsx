import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, NavLink } from 'react-router-dom'
import { api, AnalysisData, HeatmapData, MapOverview } from '../api'
import { worldToCanvas, zOnLevel, lowerLevelNames } from '../lib/coords'
import { t } from '../i18n'
import { useLang } from '../App'
import MatchNav from '../components/MatchNav'

const LAYER_COLORS: Record<string, string> = {
  kills: '255,80,80', deaths: '80,160,255', damage: '255,160,40',
  damage_taken: '200,80,255', shots: '200,200,200', flash_throws: '255,240,80',
  flash_hits: '255,200,20', smokes: '100,200,150', molotovs: '255,100,30',
  hes: '200,255,80', plants: '255,120,30', defuses: '80,255,200',
  opening_duels: '255,80,200', clutches: '255,200,80', holds: '100,180,255',
  positions: '150,150,255',
}

function layerLabel(key: string): string {
  const map: Record<string, string> = {
    kills: t('layerKills'), deaths: t('layerDeaths'), damage: t('layerDmg'),
    damage_taken: t('layerDmgTaken'), shots: t('layerShots'),
    flash_throws: t('layerFlashThrows'), flash_hits: t('layerFlashHits'),
    smokes: t('layerSmokes'), molotovs: t('layerMolotovs'),
    hes: t('layerHEs'), plants: t('layerPlants'), defuses: t('layerDefuses'),
    opening_duels: t('layerOpeningDuels'), clutches: t('layerClutches'),
    holds: t('layerHolds'), positions: t('layerPositions'),
  }
  return map[key] ?? key
}

// Decode compact array → {x, y, v?, dur?, pIdx, tick}
// Schema docs in backend/app/pipeline/heatmaps.py
function decodePoint(layer: string, arr: number[]): { x: number; y: number; z?: number; v?: number; dur?: number; pIdx: number; tick: number } {
  switch (layer) {
    case 'kills': case 'deaths': case 'opening_duels':
      // [ax, ay, vx, vy, pIdx, tick, flags]
      return { x: arr[0], y: arr[1], pIdx: arr[4], tick: arr[5] }
    case 'damage': case 'damage_taken':
      // [x, y, dmg, pIdx, tick]
      return { x: arr[0], y: arr[1], v: arr[2], pIdx: arr[3], tick: arr[4] }
    case 'flash_hits':
      // [x, y, blindSec, throwerIdx, tick]
      return { x: arr[0], y: arr[1], v: arr[2], pIdx: arr[3], tick: arr[4] }
    case 'holds':
      // [x, y, durSec, pIdx, roundStartTick, round]
      return { x: arr[0], y: arr[1], dur: arr[2], pIdx: arr[3], tick: arr[4] }
    case 'clutches':
      // [x, y, enemies, pIdx, tick, won]
      return { x: arr[0], y: arr[1], v: arr[2], pIdx: arr[3], tick: arr[4] }
    case 'positions':
      // [x, y, z, round, pIdx]
      return { x: arr[0], y: arr[1], z: arr[2], pIdx: arr[4], tick: 0 }
    default:
      // shots, flash_throws, smokes, hes, molotovs, plants, defuses: [x, y, pIdx, tick]
      return { x: arr[0], y: arr[1], pIdx: arr[2], tick: arr[3] }
  }
}

function drawHeatmap(
  canvas: HTMLCanvasElement,
  rawPoints: number[][],
  layer: string,
  ov: MapOverview,
  playerIdxSet: Set<number> | null,
  pointAlpha: number,
  level: string,
) {
  const size = canvas.width
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, size, size)

  const color = LAYER_COLORS[layer] ?? '255,255,255'
  const radius = Math.max(8, size / 80)

  for (const arr of rawPoints) {
    if (!arr || arr.length < 2) continue
    const pt = decodePoint(layer, arr)

    if (playerIdxSet !== null && !playerIdxSet.has(pt.pIdx)) continue
    // z-aware layers (positions) are filtered by the selected map level
    if (pt.z !== undefined && !zOnLevel(pt.z, ov, level)) continue

    const [cx, cy] = worldToCanvas(pt.x, pt.y, ov, size, size)
    if (!isFinite(cx) || !isFinite(cy)) continue
    if (cx < -radius || cx > size + radius || cy < -radius || cy > size + radius) continue

    // pointAlpha replaces the old hardcoded intensity — lower alpha → only dense areas stay visible
    const alpha = pointAlpha
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    grad.addColorStop(0, `rgba(${color},${alpha})`)
    grad.addColorStop(1, `rgba(${color},0)`)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
  }
}

export default function HeatmapsPage() {
  const { id } = useParams<{ id: string }>()
  useLang()

  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null)
  const [overview, setOverview] = useState<MapOverview | null>(null)
  const [layer, setLayer] = useState('kills')
  const [level, setLevel] = useState('default')
  const [selectedPlayers, setSelectedPlayers] = useState<Set<number>>(new Set())
  const [pointAlpha, setPointAlpha] = useState(0.35)
  const [error, setError] = useState('')

  // pan/zoom
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // resizer
  const [leftWidth, setLeftWidth] = useState(600)
  const resizerRef = useRef<{ startX: number; startW: number } | null>(null)
  function onResizerMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    resizerRef.current = { startX: e.clientX, startW: leftWidth }
  }
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizerRef.current) return
      setLeftWidth(Math.max(300, Math.min(900, resizerRef.current.startW + e.clientX - resizerRef.current.startX)))
    }
    function onUp() { resizerRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { offsetRef.current = offset }, [offset])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bgRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([api.analysis(id), api.heatmap(id)])
      .then(([a, h]) => { setAnalysis(a); setHeatmap(h); return api.mapOverview(a.meta.map) })
      .then(ov => setOverview(ov))
      .catch(e => setError(String(e)))
  }, [id])

  useEffect(() => {
    const cv = bgRef.current
    if (!cv || !analysis || !overview) return
    const img = new Image()
    img.onload = () => { cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height) }
    img.src = api.radarUrl(analysis.meta.map, level)
  }, [analysis, overview, leftWidth, level])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !heatmap || !overview) return
    const raw = (heatmap.layers[layer] ?? []) as unknown as number[][]
    const playerFilter = selectedPlayers.size > 0 ? selectedPlayers : null
    drawHeatmap(cv, raw, layer, overview, playerFilter, pointAlpha, level)
  }, [heatmap, layer, overview, selectedPlayers, pointAlpha, leftWidth, level])

  const togglePlayer = useCallback((idx: number) => {
    setSelectedPlayers(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }, [])

  function clamp(s: number, ox: number, oy: number, size: number) {
    // clamp scale first, then compute bounds to avoid drift at boundaries
    const sc = Math.max(1, Math.min(8, s))
    const maxOff = size * (sc - 1)
    return { scale: sc, ox: Math.max(-maxOff, Math.min(0, ox)), oy: Math.max(-maxOff, Math.min(0, oy)) }
  }

  // passive:false required to preventDefault() on wheel
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const size = rect.width
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const cur = scaleRef.current
      const sc = Math.max(1, Math.min(8, cur * factor))
      const ox = mx - (mx - offsetRef.current.x) * (sc / cur)
      const oy = my - (my - offsetRef.current.y) * (sc / cur)
      const maxOff = size * (sc - 1)
      setScale(sc)
      setOffset({ x: Math.max(-maxOff, Math.min(0, ox)), y: Math.max(-maxOff, Math.min(0, oy)) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [containerRef.current])

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y }
  }
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const rect = containerRef.current!.getBoundingClientRect()
    const c = clamp(scaleRef.current, dragRef.current.ox + e.clientX - dragRef.current.sx, dragRef.current.oy + e.clientY - dragRef.current.sy, rect.width)
    setOffset({ x: c.ox, y: c.oy })
  }
  function onMouseUp() { dragRef.current = null }

  if (error) return <div className="page"><div className="text-muted">{error}</div></div>
  if (!analysis || !heatmap || !overview) return (
    <div className="page">
      <div className="skeleton" style={{ height: 36, borderRadius: 8, marginBottom: 20 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '600px 8px 1fr', gap: 0, alignItems: 'start' }}>
        <div className="skeleton" style={{ height: 600, borderRadius: 8 }} />
        <div />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 32, borderRadius: 6 }} />
          ))}
        </div>
      </div>
    </div>
  )

  const layers = Object.keys(heatmap.layers).filter(k => (heatmap.layers[k] as unknown as number[][]).length > 0)
  const lowerLevels = lowerLevelNames(overview)
  const hasLevels = lowerLevels.length > 0
  const SIZE = leftWidth
  const cur = scale > 1 ? 'grab' : 'default'

  return (
    <div className="page">
      <MatchNav id={id!} players={analysis?.players} />
      <div style={{ display: 'grid', gridTemplateColumns: `${leftWidth}px 8px 1fr`, gap: 0, alignItems: 'start' }}>
        <div className="card" style={{ padding: 8, position: 'relative', overflow: 'hidden', boxSizing: 'border-box', width: '100%' }}>
          <div
            ref={containerRef}
            style={{ position: 'relative', width: SIZE, height: SIZE, cursor: cur, userSelect: 'none', margin: '0 auto' }}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
          >
            <div style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: '0 0', width: SIZE, height: SIZE }}>
              <canvas ref={bgRef} width={SIZE} height={SIZE}
                style={{ position: 'absolute', top: 0, left: 0, borderRadius: 4 }} />
              <canvas ref={canvasRef} width={SIZE} height={SIZE}
                style={{ position: 'absolute', top: 0, left: 0, borderRadius: 4 }} />
            </div>
          </div>
          <div style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(0,0,0,.6)', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: 'var(--text2)', pointerEvents: 'none' }}>
            {scale > 1
              ? `${scale.toFixed(1)}× · ${t('zoomReset')}`
              : t('zoomHint')}
          </div>
        </div>

        {/* resizer */}
        <div
          onMouseDown={onResizerMouseDown}
          style={{ cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', minHeight: 400, userSelect: 'none', padding: '0 2px' }}
        >
          <div style={{ width: 4, height: '100%', background: 'var(--border)', borderRadius: 2, transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--border)')}
          />
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 220, padding: 16 }}>
          {hasLevels && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>{t('mapLevel')}</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => setLevel('default')} style={{
                  flex: 1,
                  background: level === 'default' ? 'var(--accent)' : 'var(--bg3)',
                  color: level === 'default' ? '#fff' : 'var(--text)',
                  border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontSize: 12,
                }}>{t('levelUpper')}</button>
                {lowerLevels.map(sec => (
                  <button key={sec} onClick={() => setLevel(sec)} style={{
                    flex: 1,
                    background: level === sec ? 'var(--accent)' : 'var(--bg3)',
                    color: level === sec ? '#fff' : 'var(--text)',
                    border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontSize: 12,
                  }}>{t('levelLower')}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>{t('layer')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {layers.map(l => (
                <button key={l} onClick={() => setLayer(l)} style={{
                  background: layer === l ? 'var(--accent)' : 'var(--bg3)',
                  color: layer === l ? '#fff' : 'var(--text)',
                  border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', textAlign: 'left', fontSize: 12,
                }}>
                  {layerLabel(l)}
                  <span style={{ float: 'right', opacity: 0.6, fontSize: 11 }}>{(heatmap.layers[l] as unknown as number[][]).length}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>
              {t('opacity')}
              <span style={{ float: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(pointAlpha * 100)}%</span>
            </div>
            <input type="range" min={5} max={100} step={5}
              value={Math.round(pointAlpha * 100)}
              onChange={e => setPointAlpha(Number(e.target.value) / 100)}
              style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>{t('allPlayers')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {analysis.players.map((p, idx) => {
                const active = selectedPlayers.has(idx)
                return (
                  <button key={p.steamid} onClick={() => togglePlayer(idx)} style={{
                    background: active ? 'var(--accent)' : 'var(--bg3)',
                    color: active ? '#fff' : 'var(--text)',
                    border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', textAlign: 'left', fontSize: 12,
                  }}>
                    {p.name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
