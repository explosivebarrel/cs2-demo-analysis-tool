import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MapEvent, MapOverview } from '../../api'
import { worldToCanvas } from '../../lib/coords'
import { t } from '../../i18n'

interface Props {
  mapEvents: MapEvent[]
  mapName: string
  lang: 'ru' | 'en'
}

export default function PlayerMap({ mapEvents, mapName }: Props) {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bgRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [overview, setOverview] = useState<MapOverview | null>(null)
  const [radarUrl, setRadarUrl] = useState('')
  const [filter, setFilter] = useState<'all' | 'kill' | 'death'>('all')
  const [hoveredDot, setHoveredDot] = useState<MapEvent | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  // pan / zoom state
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { offsetRef.current = offset }, [offset])

  useEffect(() => {
    if (!mapName) return
    fetch(`/api/maps/${mapName}/overview`)
      .then(r => r.ok ? r.json() : null)
      .then(ov => { if (ov) setOverview(ov) })
      .catch(() => {})
    setRadarUrl(`/api/maps/${mapName}/radar`)
  }, [mapName])

  // draw radar background
  useEffect(() => {
    const cv = bgRef.current
    if (!cv || !radarUrl) return
    const img = new Image()
    img.onload = () => {
      const ctx = cv.getContext('2d')
      if (ctx) ctx.drawImage(img, 0, 0, cv.width, cv.height)
    }
    img.src = radarUrl
  }, [radarUrl])

  // draw dots + hover line on main canvas — runs whenever any relevant state changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !overview) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const visible = mapEvents.filter(ev => filter === 'all' || ev.type === filter)

    for (const ev of visible) {
      const [cx, cy] = worldToCanvas(ev.x, ev.y, overview, W, H)
      const killColor = '#50c878'
      const deathColor = '#dc5050'
      const color = ev.type === 'kill' ? killColor : deathColor

      if (ev.headshot) {
        const r = 7
        ctx.beginPath()
        ctx.moveTo(cx, cy - r)
        ctx.lineTo(cx + r, cy)
        ctx.lineTo(cx, cy + r)
        ctx.lineTo(cx - r, cy)
        ctx.closePath()
        ctx.fillStyle = color + 'cc'
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.stroke()
      } else {
        const r = ev.type === 'kill' ? 5 : 4
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = color + 'aa'
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }

    // draw hover line — only when a dot is hovered and has victim coords
    if (hoveredDot && hoveredDot.vx !== undefined && hoveredDot.vy !== undefined) {
      const [ax, ay] = worldToCanvas(hoveredDot.x, hoveredDot.y, overview, W, H)
      const [bx, by] = worldToCanvas(hoveredDot.vx, hoveredDot.vy, overview, W, H)
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [overview, mapEvents, filter, hoveredDot])

  // pan/zoom wheel handler — passive:false needed for preventDefault
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const size = rect.width
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.12 : 0.9
      const cur = scaleRef.current
      const sc = Math.max(1, Math.min(8, cur * factor))
      const ox = mx - (mx - offsetRef.current.x) * (sc / cur)
      const oy = my - (my - offsetRef.current.y) * (sc / cur)
      const maxOff = size * (sc - 1)
      const cox = Math.max(-maxOff, Math.min(0, ox))
      const coy = Math.max(-maxOff, Math.min(0, oy))
      setScale(sc)
      setOffset({ x: cox, y: coy })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function clamp(s: number, ox: number, oy: number, size: number) {
    const sc = Math.max(1, Math.min(8, s))
    const maxOff = size * (sc - 1)
    return { scale: sc, ox: Math.max(-maxOff, Math.min(0, ox)), oy: Math.max(-maxOff, Math.min(0, oy)) }
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y }
  }

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (dragRef.current) {
      const rect = containerRef.current!.getBoundingClientRect()
      const c = clamp(scaleRef.current, dragRef.current.ox + e.clientX - dragRef.current.sx, dragRef.current.oy + e.clientY - dragRef.current.sy, rect.width)
      setOffset({ x: c.ox, y: c.oy })
      return
    }

    // hit test for tooltip
    const canvas = canvasRef.current
    if (!canvas || !overview) return
    const rect = canvas.getBoundingClientRect()
    // map mouse position back to canvas coords (accounting for pan/zoom)
    const containerRect = containerRef.current!.getBoundingClientRect()
    const rawX = e.clientX - containerRect.left
    const rawY = e.clientY - containerRect.top
    // unproject through pan/zoom
    const canvasScreenX = (rawX - offsetRef.current.x) / scaleRef.current
    const canvasScreenY = (rawY - offsetRef.current.y) / scaleRef.current
    const mx = canvasScreenX * (canvas.width / (containerRect.width / scaleRef.current * scaleRef.current / scaleRef.current))
    const my = canvasScreenY * (canvas.height / (containerRect.width / scaleRef.current * scaleRef.current / scaleRef.current))

    // simpler: use canvas bounding rect relative to container at scale=1
    const W = canvas.width, H = canvas.height

    for (const ev of mapEvents) {
      if (filter !== 'all' && ev.type !== filter) continue
      const [cx, cy] = worldToCanvas(ev.x, ev.y, overview, W, H)
      const dx = canvasScreenX * (W / containerRect.width) - cx
      const dy = canvasScreenY * (H / containerRect.width) - cy
      if (dx * dx + dy * dy < 100) {
        setHoveredDot(ev)
        setTooltipPos({ x: rawX, y: rawY })
        return
      }
    }
    setHoveredDot(null)
    setTooltipPos(null)
  }

  function onMouseUp() { dragRef.current = null }

  function onMouseLeave() {
    dragRef.current = null
    setHoveredDot(null)
    setTooltipPos(null)
  }

  const btnStyle = (active: boolean, color?: string) => ({
    background: active ? (color ?? 'var(--accent)') : 'var(--bg3)',
    color: active ? '#fff' : 'var(--text2)',
    border: 'none', borderRadius: 4, padding: '4px 10px',
    cursor: 'pointer', fontSize: 11,
  })

  const kills  = mapEvents.filter(e => e.type === 'kill').length
  const deaths = mapEvents.filter(e => e.type === 'death').length
  const hs     = mapEvents.filter(e => e.headshot).length
  const diff   = kills - deaths
  const SIZE   = 512
  const cursorStyle = scale > 1 ? 'grab' : (dragRef.current ? 'grabbing' : 'crosshair')

  return (
    <div>
      {/* header stats */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { label: t('player:map.kills'),  value: kills,  color: 'var(--green)' },
          { label: t('player:map.deaths'), value: deaths, color: 'var(--red)' },
          { label: t('player:map.diff'),
            value: (diff > 0 ? '+' : '') + diff,
            color: diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--text2)' },
          { label: t('player:map.hsPct'), value: kills > 0 ? Math.round(hs / kills * 100) + '%' : '—', color: 'var(--accent2)' },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
            <div style={{ fontWeight: 800, fontSize: 18, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* filter buttons + legend */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={btnStyle(filter === 'all')} onClick={() => setFilter('all')}>
          {t('player:map.filterAll')} ({mapEvents.length})
        </button>
        <button style={btnStyle(filter === 'kill', 'var(--green)')} onClick={() => setFilter('kill')}>
          {t('player:map.filterKills')} ({kills})
        </button>
        <button style={btnStyle(filter === 'death', 'var(--red)')} onClick={() => setFilter('death')}>
          {t('player:map.filterDeaths')} ({deaths})
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text2)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span><span style={{ color: 'var(--green)', fontWeight: 700 }}>●</span> {t('player:map.legendKill')}</span>
          <span><span style={{ color: 'var(--green)', fontWeight: 700 }}>◆</span> {t('player:map.headshotShort')}</span>
          <span><span style={{ color: 'var(--red)', fontWeight: 700 }}>●</span> {t('player:map.legendDeath')}</span>
          <span style={{ color: 'var(--text2)' }}>— {t('player:map.legendLine')}</span>
        </div>
      </div>

      {/* map canvas with pan/zoom */}
      <div style={{ position: 'relative', width: '100%', maxWidth: SIZE }}>
        <div
          ref={containerRef}
          style={{ position: 'relative', width: SIZE, height: SIZE, cursor: cursorStyle, userSelect: 'none', overflow: 'hidden', borderRadius: 8, background: 'var(--bg3)' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        >
          <div style={{ transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`, transformOrigin: '0 0', width: SIZE, height: SIZE }}>
            <canvas ref={bgRef} width={SIZE} height={SIZE} style={{ position: 'absolute', top: 0, left: 0, borderRadius: 8 }} />
            <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{ position: 'absolute', top: 0, left: 0, borderRadius: 8 }} />
          </div>

          {/* controls hint */}
          <div style={{
            position: 'absolute', bottom: 8, left: 8,
            background: 'rgba(0,0,0,.65)', borderRadius: 4,
            padding: '3px 8px', fontSize: 10, color: 'rgba(255,255,255,.7)',
            pointerEvents: 'none', lineHeight: 1.6,
          }}>
            {scale > 1
              ? t('player:map.hintZooming', { scale: scale.toFixed(1) })
              : t('player:map.hintIdle')}
          </div>

          {/* loading overlay */}
          {!overview && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              color: 'var(--text2)', fontSize: 13, pointerEvents: 'none',
            }}>
              {t('player:map.loading')}
            </div>
          )}

          {/* idle hint when no dot hovered */}
          {!hoveredDot && overview && mapEvents.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 32, left: 8,
              background: 'rgba(0,0,0,.5)', borderRadius: 4,
              padding: '2px 7px', fontSize: 10, color: 'rgba(255,255,255,.5)',
              pointerEvents: 'none',
            }}>
              {t('player:map.hoverHint')}
            </div>
          )}
        </div>

        {/* tooltip — outside the zoom container so it doesn't scale */}
        {hoveredDot && tooltipPos && (
          <div style={{
            position: 'absolute',
            left: tooltipPos.x + 14, top: tooltipPos.y - 4,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '6px 12px', fontSize: 12,
            pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
            boxShadow: '0 2px 8px rgba(0,0,0,.4)',
          }}>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: hoveredDot.type === 'kill' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                {hoveredDot.type === 'kill' ? t('player:map.tooltipKill') : t('player:map.tooltipDeath')}
              </span>
              {hoveredDot.headshot && (
                <span style={{ fontSize: 10, background: 'var(--accent2)', color: '#fff', borderRadius: 3, padding: '1px 5px', marginLeft: 6 }}>{t('player:map.headshotShort')}</span>
              )}
            </div>
            <div style={{ color: 'var(--text2)', fontSize: 11, marginBottom: 4 }}>
              R{hoveredDot.round} · {hoveredDot.weapon}
            </div>
            {id && (
              <button
                onClick={() => navigate(`/match/${id}/replay?round=${hoveredDot.round}`)}
                style={{
                  background: 'none', border: '1px solid var(--border)',
                  color: 'var(--accent)', borderRadius: 4, padding: '3px 8px',
                  cursor: 'pointer', fontSize: 11, width: '100%',
                }}
              >
                {t('player:map.openRound', { round: hoveredDot.round })}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
