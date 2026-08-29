import { useRef, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MapEvent, MapOverview } from '../../api'

interface Props {
  mapEvents: MapEvent[]
  mapName: string
  lang: 'ru' | 'en'
}

function worldToCanvas(
  x: number, y: number,
  ov: MapOverview,
  w: number, h: number,
): [number, number] {
  const cx = (x - ov.pos_x) / ov.scale
  const cy = (ov.pos_y - y) / ov.scale
  return [cx / 1024 * w, cy / 1024 * h]
}

export default function PlayerMap({ mapEvents, mapName, lang }: Props) {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [overview, setOverview] = useState<MapOverview | null>(null)
  const [radarUrl, setRadarUrl] = useState('')
  const [filter, setFilter] = useState<'all' | 'kill' | 'death'>('all')
  const [tooltip, setTooltip] = useState<{
    x: number; y: number
    ev: MapEvent
  } | null>(null)

  useEffect(() => {
    if (!mapName) return
    fetch(`/api/maps/${mapName}/overview`)
      .then(r => r.ok ? r.json() : null)
      .then(ov => { if (ov) setOverview(ov) })
      .catch(() => {})
    setRadarUrl(`/api/maps/${mapName}/radar`)
  }, [mapName])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !overview) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height

    function drawDots() {
      if (!ctx || !overview) return
      ctx.clearRect(0, 0, W, H)
      const visible = mapEvents.filter(ev => filter === 'all' || ev.type === filter)

      for (const ev of visible) {
        const [cx, cy] = worldToCanvas(ev.x, ev.y, overview, W, H)
        const killColor = '#50c878'
        const deathColor = '#dc5050'
        const color = ev.type === 'kill' ? killColor : deathColor

        if (ev.headshot) {
          // diamond for headshots
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
          // circle for normal kills/deaths
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
    }

    ctx.clearRect(0, 0, W, H)
    if (radarUrl) {
      const img = new Image()
      img.onload = () => { ctx.drawImage(img, 0, 0, W, H); drawDots() }
      img.onerror = drawDots
      img.src = radarUrl
    } else {
      drawDots()
    }
  }, [overview, radarUrl, mapEvents, filter])

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas || !overview) return
    const rect = canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width)
    const my = (e.clientY - rect.top) * (canvas.height / rect.height)
    const W = canvas.width, H = canvas.height

    for (const ev of mapEvents) {
      if (filter !== 'all' && ev.type !== filter) continue
      const [cx, cy] = worldToCanvas(ev.x, ev.y, overview, W, H)
      const dx = mx - cx, dy = my - cy
      if (dx * dx + dy * dy < 100) {
        setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, ev })
        return
      }
    }
    setTooltip(null)
  }

  function handleMouseLeave() { setTooltip(null) }

  // draw hover line on tooltip change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !overview) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height

    if (!tooltip) return
    const ev = tooltip.ev
    if (ev.vx === undefined || ev.vy === undefined) return

    const [ax, ay] = worldToCanvas(ev.x, ev.y, overview, W, H)
    const [bx, by] = worldToCanvas(ev.vx, ev.vy, overview, W, H)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.stroke()
    ctx.setLineDash([])
  }, [tooltip, overview])

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

  return (
    <div>
      {/* header stats */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { label: lang === 'ru' ? 'УБИЙСТВА' : 'KILLS',  value: kills,  color: 'var(--green)' },
          { label: lang === 'ru' ? 'СМЕРТИ'   : 'DEATHS', value: deaths, color: 'var(--red)' },
          { label: lang === 'ru' ? 'ЧЁТ'      : 'DIFF',
            value: (diff > 0 ? '+' : '') + diff,
            color: diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--text2)' },
          { label: 'НС %', value: kills > 0 ? Math.round(hs / kills * 100) + '%' : '—', color: 'var(--accent2)' },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
            <div style={{ fontWeight: 800, fontSize: 18, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* filter buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <button style={btnStyle(filter === 'all')} onClick={() => setFilter('all')}>
          {lang === 'ru' ? 'Все' : 'All'} ({mapEvents.length})
        </button>
        <button style={btnStyle(filter === 'kill', 'var(--green)')} onClick={() => setFilter('kill')}>
          {lang === 'ru' ? 'Убийства' : 'Kills'} ({kills})
        </button>
        <button style={btnStyle(filter === 'death', 'var(--red)')} onClick={() => setFilter('death')}>
          {lang === 'ru' ? 'Смерти' : 'Deaths'} ({deaths})
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text2)' }}>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>●</span>{' '}
          {lang === 'ru' ? 'убийство' : 'kill'}{' '}
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>◆</span>{' '}НС{' '}
          <span style={{ color: 'var(--red)', fontWeight: 700 }}>●</span>{' '}
          {lang === 'ru' ? 'смерть' : 'death'}
        </div>
      </div>

      {/* canvas */}
      <div style={{ position: 'relative', display: 'inline-block', width: '100%', maxWidth: 520 }}>
        <canvas
          ref={canvasRef}
          width={512} height={512}
          style={{ width: '100%', height: 'auto', borderRadius: 8, background: 'var(--bg3)', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {!overview && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--text2)', fontSize: 13,
          }}>
            {lang === 'ru' ? 'Загрузка карты...' : 'Loading map...'}
          </div>
        )}
        {tooltip && (
          <div style={{
            position: 'absolute',
            left: tooltip.x + 14, top: tooltip.y - 4,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '6px 12px', fontSize: 12,
            pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
            boxShadow: '0 2px 8px rgba(0,0,0,.4)',
          }}>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: tooltip.ev.type === 'kill' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                {tooltip.ev.type === 'kill' ? (lang === 'ru' ? '💀 УБИЙСТВО' : '💀 KILL') : (lang === 'ru' ? '🪦 СМЕРТЬ' : '🪦 DEATH')}
              </span>
              {tooltip.ev.headshot && (
                <span style={{ fontSize: 10, background: 'var(--accent2)', color: '#fff', borderRadius: 3, padding: '1px 5px', marginLeft: 6 }}>НС</span>
              )}
            </div>
            <div style={{ color: 'var(--text2)', fontSize: 11, marginBottom: 4 }}>
              R{tooltip.ev.round} · {tooltip.ev.weapon}
            </div>
            {id && (
              <button
                onClick={() => navigate(`/match/${id}/replay?round=${tooltip.ev.round}`)}
                style={{
                  background: 'none', border: '1px solid var(--border)',
                  color: 'var(--accent)', borderRadius: 4, padding: '3px 8px',
                  cursor: 'pointer', fontSize: 11, width: '100%',
                }}
              >
                → {lang === 'ru' ? `Открыть раунд R${tooltip.ev.round}` : `Open round R${tooltip.ev.round}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
