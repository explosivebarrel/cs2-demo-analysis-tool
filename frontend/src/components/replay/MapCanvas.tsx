import { useEffect, useRef, useState } from 'react'
import { api, AnalysisData, MapOverview, ReplayData, RoundData } from '../../api'
import { lowerLevelNames } from '../../lib/coords'
import { findRoundForTick, Transform } from '../../lib/replay'
import { t } from '../../i18n'
import drawFrame, { NadeTrailMode } from './drawFrame'

const MIN_SCALE = 0.1
const MAX_SCALE = 10

/**
 * Central map player: radar canvas with free zoom (0.1x..10x), pan, pinch, overlays.
 * The canvas fills its container at any aspect ratio; the map itself is drawn in a
 * centered square (base = min(w, h)) so scale=1 always means "the whole map fits".
 */
export default function MapCanvas({
  replay, analysis, overview, frameIdx, tx, setTx,
  nadeTrailMode, nadeFilter, level, setLevel,
}: {
  replay: ReplayData
  analysis: AnalysisData | null
  overview: MapOverview
  frameIdx: number
  tx: Transform
  setTx: (t: Transform) => void
  nadeTrailMode: NadeTrailMode
  nadeFilter: Set<number> | null
  level: string
  setLevel: (l: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const radarRef = useRef<HTMLImageElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const txRef = useRef(tx)
  const dragRef = useRef<{ startX: number; startY: number; startOx: number; startOy: number } | null>(null)
  const touchRef = useRef<{ dist: number; cx: number; cy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => { txRef.current = tx }, [tx])

  // measure the container; this component only mounts after all payloads arrive
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const cw = Math.max(1, Math.floor(size.w))
  const ch = Math.max(1, Math.floor(size.h))
  const base = Math.min(cw, ch)

  const lowerLevels = lowerLevelNames(overview)
  const curTick = replay.ticks[frameIdx] ?? 0
  const knifeRound = analysis?.knifeRound ?? null
  const knife = knifeRound && knifeRound.endTick > 0 ? knifeRound : null
  // restart + freeze of round 1 belongs to R1, knife round ends at its own endTick
  const inKnife = !!knife && curTick >= knife.startTick && curTick < knife.endTick
  const currentRound = inKnife ? null : analysis?.rounds ? findRoundForTick(analysis.rounds as RoundData[], curTick) : null
  const winprob = replay.winprob ?? []

  // keep the transform consistent with the current map square
  function clamp(t: Transform): Transform {
    const sc = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale))
    const sz = base || 600
    if (sc <= 1) return { scale: sc, ox: sz * (1 - sc) / 2, oy: sz * (1 - sc) / 2 }
    const maxOff = sz * (sc - 1)
    return { scale: sc, ox: Math.max(-maxOff, Math.min(0, t.ox)), oy: Math.max(-maxOff, Math.min(0, t.oy)) }
  }

  // canvas coords → map-square coords (letterbox centering offsets)
  function squarePoint(cv: HTMLCanvasElement, px: number, py: number): [number, number] {
    return [px - (cv.width - base) / 2, py - (cv.height - base) / 2]
  }

  useEffect(() => {
    if (!canvasRef.current || cw < 2 || ch < 2) return
    drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current, tx, nadeTrailMode, level, nadeFilter)
  }, [frameIdx, replay, overview, tx, cw, ch, nadeTrailMode, nadeFilter, level])

  // re-clamp zoom when the canvas is resized
  useEffect(() => { if (base > 1) setTx(clamp(txRef.current)) }, [cw, ch])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const cv = el!
      const rect = cv.getBoundingClientRect()
      const [mx, my] = squarePoint(cv, e.clientX - rect.left, e.clientY - rect.top)
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const cur = txRef.current
      const sc = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cur.scale * factor))
      const ox = mx - (mx - cur.ox) * (sc / cur.scale)
      const oy = my - (my - cur.oy) * (sc / cur.scale)
      setTx(clamp({ scale: sc, ox, oy }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOx: txRef.current.ox, startOy: txRef.current.oy }
    setDragging(true)
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX, dy = e.clientY - dragRef.current.startY
    setTx(clamp({ scale: txRef.current.scale, ox: dragRef.current.startOx + dx, oy: dragRef.current.startOy + dy }))
  }
  function onMouseUp() { dragRef.current = null; setDragging(false) }

  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY
      touchRef.current = { dist: Math.sqrt(dx * dx + dy * dy), cx: (e.touches[0].clientX + e.touches[1].clientX) / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 }
    } else if (e.touches.length === 1) {
      dragRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, startOx: txRef.current.ox, startOy: txRef.current.oy }
    }
  }
  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const cv = canvasRef.current!
    if (e.touches.length === 2 && touchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const rect = cv.getBoundingClientRect()
      const [mx, my] = squarePoint(cv, touchRef.current.cx - rect.left, touchRef.current.cy - rect.top)
      const factor = dist / touchRef.current.dist
      const cur = txRef.current; const ns = cur.scale * factor
      setTx(clamp({ scale: ns, ox: mx - (mx - cur.ox) * (ns / cur.scale), oy: my - (my - cur.oy) * (ns / cur.scale) }))
      touchRef.current.dist = dist
    } else if (e.touches.length === 1 && dragRef.current) {
      const dx = e.touches[0].clientX - dragRef.current.startX, dy = e.touches[0].clientY - dragRef.current.startY
      setTx(clamp({ scale: txRef.current.scale, ox: dragRef.current.startOx + dx, oy: dragRef.current.startOy + dy }))
    }
  }
  function onTouchEnd() { dragRef.current = null; touchRef.current = null }

  const cursor = dragging ? 'grabbing' : tx.scale > 1 ? 'grab' : 'default'

  return (
    <div ref={rootRef} className="card" style={{ padding: 0, position: 'relative', overflow: 'hidden', width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
      <img ref={radarRef} src={api.radarUrl(analysis?.meta.map ?? '', level)} alt="" style={{ display: 'none' }}
        onLoad={() => { if (canvasRef.current) drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current, txRef.current, nadeTrailMode, level, nadeFilter) }} />
      <canvas
        ref={canvasRef} width={cw} height={ch}
        style={{ display: 'block', cursor, width: '100%', height: '100%' }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onDoubleClick={() => setTx(clamp({ scale: 1, ox: 0, oy: 0 }))}
      />
      {(currentRound || inKnife) && (
        <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,.7)', padding: '3px 10px', borderRadius: 4, fontSize: 12 }}>
          {inKnife ? t('replay:rounds.knife') : <>{t('replay:roundShort')}{currentRound!.n} · {currentRound!.scoreTeam0}:{currentRound!.scoreTeam1}
            {currentRound!.bombPlanted && <img src="/icons/weapons/bomb_c4.svg" alt="C4" width={11} height={11} style={{ marginLeft: 8, verticalAlign: 'middle' }} />}</>}
        </div>
      )}
      {winprob.length > 0 && !inKnife && (
        <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,.7)', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: '#4a9eda' }}>
          {t('replay:side.ct')} {Math.round((winprob[frameIdx] ?? 0.5) * 100)}%
        </div>
      )}
      {lowerLevels.length > 0 && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4 }}>
          <button onClick={() => setLevel('default')} style={{
            background: level === 'default' ? 'var(--accent)' : 'rgba(0,0,0,.7)',
            color: level === 'default' ? '#fff' : 'var(--text2)',
            border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11,
          }}>{t('levelUpper')}</button>
          {lowerLevels.map(sec => (
            <button key={sec} onClick={() => setLevel(sec)} style={{
              background: level === sec ? 'var(--accent)' : 'rgba(0,0,0,.7)',
              color: level === sec ? '#fff' : 'var(--text2)',
              border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11,
            }}>{t('levelLower')}</button>
          ))}
        </div>
      )}
      {(tx.scale > 1.01 || tx.scale < 0.99) && (
        <div style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(0,0,0,.6)', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: 'var(--text2)' }}>
          {tx.scale.toFixed(1)}x · [0] {t('zoomReset')}
        </div>
      )}
    </div>
  )
}
