import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, NavLink } from 'react-router-dom'
import { api, AnalysisData, HeatmapData, MapOverview } from '../api'
import { t } from '../i18n'
import { useLang } from '../App'

function MatchNav({ id }: { id: string }) {
  useLang()
  const base = `/match/${id}`
  const s = (active: boolean) => ({ color: active ? 'var(--accent)' : 'var(--text2)', fontWeight: active ? 700 : 400, textDecoration: 'none', fontSize: 13 })
  return (
    <div className="flex gap-16 items-center" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 20 }}>
      <NavLink to={base} end style={({ isActive }) => s(isActive)}>{t('overview')}</NavLink>
      <NavLink to={`${base}/heatmaps`} style={({ isActive }) => s(isActive)}>{t('heatmaps')}</NavLink>
      <NavLink to={`${base}/replay`} style={({ isActive }) => s(isActive)}>{t('replay')}</NavLink>
    </div>
  )
}

const LAYER_COLORS: Record<string, string> = {
  kills: '255,80,80', deaths: '80,160,255', damage: '255,160,40',
  damage_taken: '200,80,255', shots: '200,200,200', flash_throws: '255,240,80',
  flash_hits: '255,200,20', smokes: '100,200,150', molotovs: '255,100,30',
  hes: '200,255,80', plants: '255,120,30', defuses: '80,255,200',
  opening_duels: '255,80,200', clutches: '255,200,80', holds: '100,180,255',
  positions: '150,150,255',
}

const LAYER_LABELS: Record<string, string> = {
  kills: 'Убийства', deaths: 'Смерти', damage: 'Урон нанесённый',
  damage_taken: 'Урон полученный', shots: 'Выстрелы',
  flash_throws: 'Броски флешки', flash_hits: 'Ослепления',
  smokes: 'Смоки', molotovs: 'Молотовы/Зажигательные',
  hes: 'HE гранаты', plants: 'Закладки', defuses: 'Разминирования',
  opening_duels: 'Первые дуэли', clutches: 'Клатчи',
  holds: 'Долгие позиции', positions: 'Позиции',
}

// Decode compact array → {x, y, v?, dur?, pIdx, tick}
// Schema docs in backend/app/pipeline/heatmaps.py
function decodePoint(layer: string, arr: number[]): { x: number; y: number; v?: number; dur?: number; pIdx: number; tick: number } {
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
      return { x: arr[0], y: arr[1], pIdx: arr[4], tick: 0 }
    default:
      // shots, flash_throws, smokes, hes, molotovs, plants, defuses: [x, y, pIdx, tick]
      return { x: arr[0], y: arr[1], pIdx: arr[2], tick: arr[3] }
  }
}

function worldToCanvas(wx: number, wy: number, ov: MapOverview, size: number) {
  const px = (wx - ov.pos_x) / ov.scale
  const py = (ov.pos_y - wy) / ov.scale
  const ratio = size / 1024
  return [px * ratio, py * ratio] as [number, number]
}

function drawHeatmap(
  canvas: HTMLCanvasElement,
  rawPoints: number[][],
  layer: string,
  ov: MapOverview,
  playerIdxSet: Set<number> | null,
  pointAlpha: number,
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

    const [cx, cy] = worldToCanvas(pt.x, pt.y, ov, size)
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
  const [selectedPlayers, setSelectedPlayers] = useState<Set<number>>(new Set())
  const [pointAlpha, setPointAlpha] = useState(0.35)
  const [error, setError] = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bgRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([api.analysis(id), api.heatmap(id)])
      .then(([a, h]) => {
        setAnalysis(a)
        setHeatmap(h)
        return api.mapOverview(a.meta.map)
      })
      .then(ov => setOverview(ov))
      .catch(e => setError(String(e)))
  }, [id])

  // draw map background
  useEffect(() => {
    const cv = bgRef.current
    if (!cv || !analysis || !overview) return
    const img = new Image()
    img.onload = () => {
      const ctx = cv.getContext('2d')!
      ctx.drawImage(img, 0, 0, cv.width, cv.height)
    }
    img.src = api.radarUrl(analysis.meta.map)
  }, [analysis, overview])

  // draw heatmap points
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !heatmap || !overview) return
    const raw = (heatmap.layers[layer] ?? []) as unknown as number[][]
    const playerFilter = selectedPlayers.size > 0 ? selectedPlayers : null
    drawHeatmap(cv, raw, layer, overview, playerFilter, pointAlpha)
  }, [heatmap, layer, overview, selectedPlayers, pointAlpha])

  const togglePlayer = useCallback((idx: number) => {
    setSelectedPlayers(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }, [])

  if (error) return <div className="page"><div className="text-muted">{error}</div></div>
  if (!analysis || !heatmap || !overview) return <div className="page"><div className="text-muted">{t('loading')}</div></div>

  const layers = Object.keys(heatmap.layers).filter(k => (heatmap.layers[k] as unknown as number[][]).length > 0)
  const SIZE = 512

  return (
    <div className="page">
      <MatchNav id={id!} />

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* canvas stack */}
        <div className="card" style={{ padding: 8, flexShrink: 0 }}>
          <div style={{ position: 'relative', width: SIZE, height: SIZE }}>
            <canvas ref={bgRef} width={SIZE} height={SIZE}
              style={{ position: 'absolute', top: 0, left: 0, borderRadius: 4 }} />
            <canvas ref={canvasRef} width={SIZE} height={SIZE}
              style={{ position: 'absolute', top: 0, left: 0, borderRadius: 4 }} />
          </div>
        </div>

        {/* controls */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 220, flex: 1, padding: 16 }}>
          {/* layer selector */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>{t('layer')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {layers.map(l => (
                <button key={l}
                  onClick={() => setLayer(l)}
                  style={{
                    background: layer === l ? 'var(--accent)' : 'var(--bg3)',
                    color: layer === l ? '#fff' : 'var(--text)',
                    border: 'none', borderRadius: 4, padding: '5px 10px',
                    cursor: 'pointer', textAlign: 'left', fontSize: 12,
                  }}>
                  {LAYER_LABELS[l] ?? l}
                  <span style={{ float: 'right', opacity: 0.6, fontSize: 11 }}>
                    {(heatmap.layers[l] as unknown as number[][]).length}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* opacity slider */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>
              Прозрачность точек
              <span style={{ float: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(pointAlpha * 100)}%</span>
            </div>
            <input
              type="range" min={5} max={100} step={5}
              value={Math.round(pointAlpha * 100)}
              onChange={e => setPointAlpha(Number(e.target.value) / 100)}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>

          {/* player filter */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase' }}>{t('allPlayers')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {analysis.players.map((p, idx) => {
                const active = selectedPlayers.has(idx)
                return (
                  <button key={p.steamid}
                    onClick={() => togglePlayer(idx)}
                    style={{
                      background: active ? 'var(--accent)' : 'var(--bg3)',
                      color: active ? '#fff' : 'var(--text)',
                      border: 'none', borderRadius: 4, padding: '4px 8px',
                      cursor: 'pointer', textAlign: 'left', fontSize: 12,
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
