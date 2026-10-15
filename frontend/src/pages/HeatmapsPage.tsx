import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, NavLink } from 'react-router-dom'
import { api, AnalysisData, HeatmapData, Map3DData, MapOverview } from '../api'
import { worldToCanvas, zOnLevel, lowerLevelNames } from '../lib/coords'
import { decodePoint, LAYER_COLORS } from '../lib/heatmapLayers'
import { t } from '../i18n'
import { useLang } from '../App'
import MatchNav from '../components/MatchNav'
import Heatmap3DCanvas from '../components/map3d/Heatmap3DCanvas'

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
// (decoder moved to lib/heatmapLayers.ts — shared with the 3D view)

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

const LIST_WIDTH = 280

/** Full-viewport heatmaps screen: map cell flexes, layer list scrolls independently. */
export default function HeatmapsPage() {
  const { id } = useParams<{ id: string }>()
  useLang()

  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null)
  const [overview, setOverview] = useState<MapOverview | null>(null)
  const [layer, setLayer] = useState('kills')
  const [level, setLevel] = useState('default')
  const [selectedPlayers, setSelectedPlayers] = useState<Set<number>>(new Set())
  const [pointAlpha, setPointAlpha] = useState(0.75)
  const [error, setError] = useState('')
  const [view3d, setView3d] = useState(false)
  const [hm3d, setHm3d] = useState<Map3DData | null>(null)
  const [hm3dMissing, setHm3dMissing] = useState(false)
  const [resShift, setResShift] = useState(1)  // merge factor 0/1/2 -> 32/64/128 u cells
  const [ground, setGround] = useState(true)
  const [mapAlpha, setMapAlpha] = useState(0.35)
  const [contrast, setContrast] = useState(true)
  const [shadesNum, setShadesNum] = useState<number | null>(null)  // null = artifact default
  const view3dRef = useRef(false)
  useEffect(() => { view3dRef.current = view3d }, [view3d])

  function enable3d() {
    setView3d(true)
    if (!hm3d && !hm3dMissing && id) {
      api.heatmap3d(id).then(setHm3d).catch(() => setHm3dMissing(true))
    }
  }

  // pan/zoom
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // map cell measurement → square canvas fits the cell (letterboxed)
  const [cell, setCell] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCell({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setCell({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
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

  const SIZE = Math.max(1, Math.floor(Math.min(cell.w, cell.h)))

  useEffect(() => {
    const cv = bgRef.current
    if (!cv || !analysis || !overview || SIZE < 2) return
    const img = new Image()
    img.onload = () => { cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height) }
    img.src = api.radarUrl(analysis.meta.map, level)
    // view3d in deps: canvases unmount while 3D is on, so 2D needs a redraw on return
  }, [analysis, overview, SIZE, level, view3d])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !heatmap || !overview || SIZE < 2) return
    const raw = (heatmap.layers[layer] ?? []) as unknown as number[][]
    // layer pIdx values follow heatmap.players order; translate the selected
    // analysis.players indices into that space (legacy artifacts have no
    // players header — fall back to raw indices)
    let playerFilter: Set<number> | null = null
    if (selectedPlayers.size > 0) {
      const selSids = new Set([...selectedPlayers].map(i => analysis?.players[i]?.steamid))
      playerFilter = heatmap.players
        ? new Set(heatmap.players.flatMap((sid, i) => (selSids.has(sid) ? [i] : [])))
        : new Set(selectedPlayers)
    }
    drawHeatmap(cv, raw, layer, overview, playerFilter, pointAlpha, level)
  }, [heatmap, layer, overview, selectedPlayers, pointAlpha, SIZE, level, analysis, view3d])

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

  // passive:false required to preventDefault() on wheel; zoom anchors on the cursor
  // relative to the centered map square
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (view3dRef.current) return
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const b = Math.min(rect.width, rect.height)
      const mx = e.clientX - rect.left - (rect.width - b) / 2
      const my = e.clientY - rect.top - (rect.height - b) / 2
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const cur = scaleRef.current
      const sc = Math.max(1, Math.min(8, cur * factor))
      const ox = mx - (mx - offsetRef.current.x) * (sc / cur)
      const oy = my - (my - offsetRef.current.y) * (sc / cur)
      const maxOff = b * (sc - 1)
      setScale(sc)
      setOffset({ x: Math.max(-maxOff, Math.min(0, ox)), y: Math.max(-maxOff, Math.min(0, oy)) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (view3d || e.button !== 0) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y }
  }
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (view3d || !dragRef.current) return
    const rect = containerRef.current!.getBoundingClientRect()
    const b = Math.min(rect.width, rect.height)
    const c = clamp(scaleRef.current, dragRef.current.ox + e.clientX - dragRef.current.sx, dragRef.current.oy + e.clientY - dragRef.current.sy, b)
    setOffset({ x: c.ox, y: c.oy })
  }
  function onMouseUp() { dragRef.current = null }

  if (error) return <div className="page"><div className="text-muted">{error}</div></div>

  const loading = !analysis || !heatmap || !overview

  return (
    // same horizontal bounds and top padding as .page so switching screens
    // doesn't shift the layout; the content itself stays viewport-fit
    <div style={{ height: 'calc(100vh - 48px)', maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', padding: '24px 20px', gap: 8, overflow: 'hidden', boxSizing: 'border-box' }}>
      <div style={{ flexShrink: 0 }}>
        {!loading && <MatchNav id={id!} players={analysis?.players} />}
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `1fr ${LIST_WIDTH}px`, gap: 8, minHeight: 0 }}>
        <div className="card" style={{ padding: 8, position: 'relative', overflow: 'hidden', boxSizing: 'border-box', minHeight: 0 }}>
          <div
            ref={containerRef}
            style={{ position: 'absolute', inset: 8, cursor: view3d ? 'default' : scale > 1 ? 'grab' : 'default', userSelect: 'none' }}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
          >
            {loading && <div className="skeleton" style={{ position: 'absolute', inset: 0, borderRadius: 4 }} />}
            {!loading && view3d && (
              hm3dMissing ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text2)', fontSize: 13 }}>
                  {t('heatmaps:map3dNeedReanalyze')}
                  <button className="btn-primary" style={{ fontSize: 12, padding: '6px 14px' }}
                    onClick={() => id && api.analyze(id)}>
                    {t('reAnalyze')}
                  </button>
                </div>
              ) : hm3d && overview && analysis ? (
                <Heatmap3DCanvas heatmap={heatmap} hm3d={hm3d} layer={layer} overview={overview}
                  map={analysis.meta.map} players={analysis.players}
                  selected={selectedPlayers.size > 0 ? selectedPlayers : null}
                  alpha={pointAlpha} mapAlpha={mapAlpha} contrast={contrast}
                  shades={shadesNum ?? hm3d.shades ?? 8}
                  shift={resShift} showGround={ground} level={level}
                  width={cell.w} height={cell.h} />
              ) : (
                <div className="skeleton" style={{ position: 'absolute', inset: 0, borderRadius: 4 }} />
              )
            )}
            {!loading && !view3d && (
              <div style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: '0 0',
                position: 'absolute', width: SIZE, height: SIZE,
                left: (cell.w - SIZE) / 2, top: (cell.h - SIZE) / 2,
              }}>
                <canvas ref={bgRef} width={SIZE} height={SIZE}
                  style={{ position: 'absolute', top: 0, left: 0, borderRadius: 4 }} />
                <canvas ref={canvasRef} width={SIZE} height={SIZE}
                  style={{ position: 'absolute', top: 0, left: 0, borderRadius: 4 }} />
              </div>
            )}
          </div>
          {!loading && !view3d && (
            <div style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(0,0,0,.6)', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: 'var(--text2)', pointerEvents: 'none' }}>
              {scale > 1
                ? `${scale.toFixed(1)}× · ${t('zoomReset')}`
                : t('zoomHint')}
            </div>
          )}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, minHeight: 0, overflowY: 'auto' }}>
          {loading ? (
            <>
              {/* mirrors the real controls: level toggle, layer list, opacity slider, players */}
              <div className="skeleton" style={{ height: 27, borderRadius: 4 }} />
              <div>
                <div className="skeleton" style={{ height: 10, width: 90, borderRadius: 4, marginBottom: 8 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="skeleton" style={{ height: 27, borderRadius: 4 }} />
                  ))}
                </div>
              </div>
              <div>
                <div className="skeleton" style={{ height: 10, width: 70, borderRadius: 4, marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 14, borderRadius: 4 }} />
              </div>
              <div>
                <div className="skeleton" style={{ height: 10, width: 110, borderRadius: 4, marginBottom: 8 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="skeleton" style={{ height: 25, borderRadius: 4 }} />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {(() => {
                const layers = Object.keys(heatmap.layers).filter(k => (heatmap.layers[k] as unknown as number[][]).length > 0)
                const lowerLevels = lowerLevelNames(overview)
                const hasLevels = lowerLevels.length > 0
                const seg = (active: boolean): React.CSSProperties => ({
                  flex: 1,
                  background: active ? 'var(--accent)' : 'var(--bg3)',
                  color: active ? '#fff' : 'var(--text)',
                  border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontSize: 12,
                })
                return (
                  <>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => setView3d(false)} style={seg(!view3d)}>{t('heatmaps:view2d')}</button>
                      <button onClick={enable3d} style={seg(view3d)}>{t('heatmaps:view3d')}</button>
                    </div>
                    {hasLevels && (
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>{t('mapLevel')}</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => setLevel('default')} style={seg(level === 'default')}>{t('levelUpper')}</button>
                          {lowerLevels.map(sec => (
                            <button key={sec} onClick={() => setLevel(sec)} style={seg(level === sec)}>{t('levelLower')}</button>
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
                    {view3d && (
                      <>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>{t('heatmaps:map3dDetail')}</div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {(() => {
                              const baseCell = hm3d?.cell ?? 16
                              const targets = [16, 32, 64, 128].filter(u => u >= baseCell)
                              return targets.map(target => {
                                const s = Math.max(0, Math.round(Math.log2(target / baseCell)))
                                return (
                                  <button key={target} onClick={() => setResShift(s)} style={seg(resShift === s)}>
                                    {target} u
                                  </button>
                                )
                              })
                            })()}
                          </div>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                          <input type="checkbox" checked={ground} onChange={e => setGround(e.target.checked)} />
                          {t('heatmaps:map3dGround')}
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                          <input type="checkbox" checked={contrast} onChange={e => setContrast(e.target.checked)} />
                          {t('heatmaps:map3dContrast')}
                        </label>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>
                            {t('heatmaps:map3dShades')}
                            <span style={{ float: 'right', fontVariantNumeric: 'tabular-nums' }}>{shadesNum ?? hm3d?.shades ?? 8}</span>
                          </div>
                          <input type="range" min={1} max={32} step={1}
                            value={shadesNum ?? hm3d?.shades ?? 8}
                            onChange={e => setShadesNum(Number(e.target.value))}
                            style={{ width: '100%', accentColor: 'var(--accent)' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>
                            {t('heatmaps:map3dMapOpacity')}
                            <span style={{ float: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(mapAlpha * 100)}%</span>
                          </div>
                          <input type="range" min={5} max={100} step={5}
                            value={Math.round(mapAlpha * 100)}
                            onChange={e => setMapAlpha(Number(e.target.value) / 100)}
                            style={{ width: '100%', accentColor: 'var(--accent)' }} />
                        </div>
                      </>
                    )}

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
                  </>
                )
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
