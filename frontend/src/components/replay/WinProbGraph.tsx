import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { RoundData } from '../../api'
import { findRoundForTick } from '../../lib/replay'
import { t } from '../../i18n'

interface KnifeRound { startTick: number; freezeEndTick?: number | null; endTick: number; winner: string }

export interface MomentHighlight { startFi: number; endFi: number }

/** SVG balance-of-power graph that acts as a timeline scrubber for the current round. */
export default function WinProbGraph({
  winprob, ticks, rounds, frameIdx, onScrub, height = 60, knifeRound, matchStartTick, highlight,
}: {
  winprob: number[]
  ticks: number[]
  rounds: RoundData[]
  frameIdx: number
  onScrub: (fi: number) => void
  height?: number
  knifeRound?: KnifeRound | null
  matchStartTick?: number
  highlight?: MomentHighlight | null
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const total = winprob.length
  const W = 1000

  // yellow moment highlight: solid for a while, then fades out
  const [hl, setHl] = useState<{ x0: number; x1: number; fading: boolean } | null>(null)
  useEffect(() => {
    if (!highlight) return
    const x0 = fi2x(highlight.startFi)
    const x1 = fi2x(highlight.endFi)
    setHl({ x0, x1, fading: false })
    const t1 = window.setTimeout(() => setHl(h => (h ? { ...h, fading: true } : h)), 3500)
    const t2 = window.setTimeout(() => setHl(null), 5000)
    return () => { window.clearTimeout(t1); window.clearTimeout(t2) }
  }, [highlight])

  // compute current round frame bounds — include freeze time + ±10s neighbours
  const curTick = ticks[Math.floor(frameIdx)] ?? 0
  const knife = knifeRound && knifeRound.endTick > 0 ? knifeRound : null
  const inKnife = !!knife && curTick >= knife.startTick && curTick < knife.endTick
  const curRound = inKnife ? null : findRoundForTick(rounds, curTick)

  const curRoundIdx = curRound ? rounds.findIndex(r => r.n === curRound.n) : -1
  const prevRound = curRoundIdx > 0 ? rounds[curRoundIdx - 1] : null

  const NEIGHBOUR_TICKS = 10 * 64  // ~10s at 64tick

  // core window:
  //  - knife round: from its start to its end (freeze marker via freezeEndTick)
  //  - round 1: from match start (after the knife-round restart) to its end,
  //    so the knife-round tail stays in the left neighbour hatch
  //  - later rounds: from the previous round's end (their freeze time)
  const windowStart = inKnife
    ? knife.startTick
    : curRound
      ? (prevRound ? prevRound.endTick + 1
                    : matchStartTick && matchStartTick > (knife?.endTick ?? 0)
                      ? matchStartTick
                      : knife ? knife.endTick : Math.max(0, curRound.freezeEndTick - 960))
      : 0
  const windowEnd = inKnife ? knife.endTick : curRound?.endTick ?? 0

  // extended window with neighbours; hatch on the left shows the tail of
  // whatever came before (the knife-round tail for round 1)
  const extStartTick = inKnife
    ? windowStart
    : Math.max(0, windowStart - NEIGHBOUR_TICKS)
  const extEndTick   = windowEnd + NEIGHBOUR_TICKS

  function tickToFi(tick: number): number {
    const i = ticks.findIndex(tk => tk >= tick)
    return i < 0 ? total - 1 : Math.max(0, i)
  }

  const rStartFi     = tickToFi(extStartTick)
  const rCoreStartFi = tickToFi(windowStart)
  const freezeFi = inKnife
    ? (knife.freezeEndTick ? tickToFi(knife.freezeEndTick) : -1)
    : curRound ? tickToFi(curRound.freezeEndTick) : -1
  const rCoreEndFi   = tickToFi(windowEnd)
  const rEndFi       = Math.min(total - 1, tickToFi(extEndTick))
  const rLen         = Math.max(1, rEndFi - rStartFi)

  function fi2x(fi: number): number { return ((fi - rStartFi) / rLen) * W }

  const freezeMarkerX = freezeFi >= 0 ? fi2x(freezeFi) : -1
  const coreStartX    = fi2x(rCoreStartFi)
  const coreEndX      = fi2x(rCoreEndFi)

  function fiFromClientX(clientX: number): number {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rLen < 2) return rStartFi
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(rStartFi + pct * rLen)
  }

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault(); dragging.current = true
    onScrub(fiFromClientX(e.clientX))
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return
    onScrub(fiFromClientX(e.clientX))
  }
  function onMouseUp() { dragging.current = false }

  if (total < 2) return null

  const H = height
  const slice = winprob.slice(rStartFi, rEndFi + 1)

  const cursorX = fi2x(frameIdx).toFixed(1)
  const midY = H / 2

  const curvePts = slice.map((p, i) => [fi2x(rStartFi + i), (1 - p) * H] as [number, number])
  const curveStr = curvePts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

  const firstX = curvePts[0]?.[0] ?? 0
  const lastX  = curvePts[curvePts.length - 1]?.[0] ?? W
  const fillPath = `M ${firstX.toFixed(1)},${midY} ` +
    curvePts.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
    ` L ${lastX.toFixed(1)},${midY} Z`

  const curVal = winprob[Math.floor(frameIdx)] ?? 0.5
  const ctPct  = Math.round(curVal * 100)
  const tPct   = 100 - ctPct

  const hatchId = 'nbHatch'
  const momentHatchId = 'momHatch'

  // HTML chips instead of SVG text: preserveAspectRatio="none" would stretch glyphs
  const chipStyle = (color: string): CSSProperties => ({
    position: 'absolute', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold',
    color, pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,.9)', lineHeight: 1,
  })

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block', cursor: 'crosshair', userSelect: 'none' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
      <defs>
        <clipPath id="clipCT">
          <rect x="0" y="0" width={W} height={midY} />
        </clipPath>
        <clipPath id="clipT">
          <rect x="0" y={midY} width={W} height={midY} />
        </clipPath>
        <linearGradient id="ctFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#4a9eda" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#4a9eda" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="tFill" x1="0" x2="0" y1="1" y2="0">
          <stop offset="0%" stopColor="#e4882a" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#e4882a" stopOpacity="0.08" />
        </linearGradient>
        <pattern id={hatchId} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(120,120,120,0.35)" strokeWidth="3" />
        </pattern>
        <pattern id={momentHatchId} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,200,40,0.6)" strokeWidth="3" />
        </pattern>
      </defs>

      <rect width={W} height={H} fill="var(--bg2, #1a1c20)" />

      <path d={fillPath} fill="url(#ctFill)" clipPath="url(#clipCT)" />
      <path d={fillPath} fill="url(#tFill)" clipPath="url(#clipT)" />

      <line x1="0" y1={midY} x2={W} y2={midY} stroke="#555" strokeWidth="0.8" strokeDasharray="6,4" />

      <polyline points={curveStr} fill="none" stroke="#4a9eda" strokeWidth="1.8" strokeLinejoin="round" />

      {coreStartX > 0 && (
        <rect x="0" y="0" width={coreStartX.toFixed(1)} height={H} fill={`url(#${hatchId})`} />
      )}
      {coreEndX < W && (
        <rect x={coreEndX.toFixed(1)} y="0" width={(W - coreEndX).toFixed(1)} height={H} fill={`url(#${hatchId})`} />
      )}

      {freezeMarkerX > coreStartX && (
        <rect x={coreStartX.toFixed(1)} y="0"
          width={(freezeMarkerX - coreStartX).toFixed(1)} height={H}
          fill="rgba(255,255,255,0.04)" />
      )}

      {freezeMarkerX >= 0 && (
        <line
          x1={freezeMarkerX.toFixed(1)} y1="0"
          x2={freezeMarkerX.toFixed(1)} y2={H}
          stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeDasharray="3,3"
        />
      )}

      {coreStartX > 0 && (
        <line x1={coreStartX.toFixed(1)} y1="0" x2={coreStartX.toFixed(1)} y2={H}
          stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      )}
      {coreEndX < W && (
        <line x1={coreEndX.toFixed(1)} y1="0" x2={coreEndX.toFixed(1)} y2={H}
          stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      )}

      <line x1={cursorX} y1="0" x2={cursorX} y2={H} stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />

      {hl && (
        <rect
          x={Math.max(0, hl.x0).toFixed(1)} y="0"
          width={Math.max(2, Math.min(W, hl.x1) - Math.max(0, hl.x0)).toFixed(1)}
          height={H} fill={`url(#${momentHatchId})`}
          style={{ opacity: hl.fading ? 0 : 1, transition: 'opacity 1.4s' }}
        />
      )}
      </svg>
      <div style={{ ...chipStyle('#4a9eda'), top: 4, left: 8 }}>{t('replay:side.ct')} {ctPct}%</div>
      <div style={{ ...chipStyle('#e4882a'), bottom: 4, right: 8 }}>{t('replay:side.t')} {tPct}%</div>
    </div>
  )
}
