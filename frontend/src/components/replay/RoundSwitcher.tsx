import { RoundData } from '../../api'
import { findRoundForTick } from '../../lib/replay'
import { t } from '../../i18n'

interface KnifeRound { startTick: number; freezeEndTick?: number | null; endTick: number; winner: string }

/** Numbered round buttons with a vertical scrubber line sliding across the active round. */
export default function RoundSwitcher({
  rounds, ticks, frameIdx, onJump, knifeRound, matchStartTick,
}: {
  rounds: RoundData[]
  ticks: number[]
  frameIdx: number
  onJump: (fi: number) => void
  knifeRound?: KnifeRound | null
  matchStartTick?: number
}) {
  const curTick = ticks[Math.floor(frameIdx)] ?? 0
  const tick0 = ticks[0] ?? 0

  // pre-match window: warmup, then (if detected) the knife round
  const firstRoundStart = rounds.length > 0 ? rounds[0].freezeEndTick : 0
  const knife = knifeRound && knifeRound.endTick > 0 ? knifeRound : null
  // if the demo starts right at the knife round, KR takes the whole window
  const knifeStart = knife ? Math.max(tick0, Math.min(knife.startTick, firstRoundStart)) : 0
  const hasWarmup = !knife || knifeStart > tick0
  // restart + freeze time of round 1 (between knife end and its freeze end)
  // belongs to round 1, not to the knife round
  const isWarmup = hasWarmup && curTick < knifeStart
  const isKnife = !!knife && curTick >= knifeStart && curTick < knife.endTick
  // no numbered round is active while in the pre-match window
  const activeRound = isKnife || isWarmup ? null : findRoundForTick(rounds, curTick)

  function scrubberPct(lo: number, hi: number): number | null {
    if (hi <= lo) return null
    return Math.min(1, Math.max(0, (curTick - lo) / (hi - lo)))
  }
  const wuPct = isWarmup ? scrubberPct(tick0, knifeStart) : null
  const knifePct = isKnife ? scrubberPct(knifeStart, knife.endTick) : null

  function jumpToTick(tick: number) {
    const fi = ticks.findIndex(tk => tk >= tick)
    if (fi >= 0) onJump(fi)
  }

  return (
    <div style={{ display: 'flex', width: '100%', border: '1px solid var(--border)', borderRadius: 0, overflow: 'visible' }}>
      {/* warmup button (hidden when the demo starts right at the knife round) */}
      {(isWarmup || !knife || knifeStart > tick0) && (
        <button
          onClick={() => jumpToTick(tick0)}
          title={t('replay:rounds.warmup')}
          style={{
            position: 'relative', flexShrink: 0,
            padding: '5px 8px', fontSize: 10, fontWeight: isWarmup ? 700 : 400,
            background: isWarmup ? 'rgba(100,100,200,0.25)' : 'var(--bg2)',
            color: isWarmup ? '#aac' : 'var(--text2)',
            border: 'none', borderRight: '1px solid var(--border)',
            cursor: 'pointer', textAlign: 'center', minWidth: 0, whiteSpace: 'nowrap',
          }}
        >
          {wuPct !== null && (
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${wuPct * 100}%`,
              width: 2, background: 'rgba(255,255,255,0.7)', transform: 'translateX(-50%)',
              pointerEvents: 'none', zIndex: 1,
            }} />
          )}
          WU
        </button>
      )}

      {/* knife round button */}
      {knife && (
        <button
          onClick={() => jumpToTick(knifeStart)}
          title={t('replay:rounds.knife')}
          style={{
            position: 'relative', flexShrink: 0,
            padding: '5px 8px', fontSize: 10, fontWeight: isKnife ? 700 : 400,
            background: isKnife ? 'rgba(255,180,50,0.14)' : 'var(--bg2)',
            color: isKnife ? 'var(--accent2)' : 'var(--text2)',
            border: 'none', borderRight: '1px solid var(--border)',
            cursor: 'pointer', textAlign: 'center', minWidth: 0, whiteSpace: 'nowrap',
          }}
        >
          {knifePct !== null && (
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${knifePct * 100}%`,
              width: 2, background: 'rgba(255,255,255,0.7)', transform: 'translateX(-50%)',
              pointerEvents: 'none', zIndex: 1,
            }} />
          )}
          KR
        </button>
      )}

      {rounds.map((r, ri) => {
        const isActive = activeRound?.n === r.n
        // scrubber spans freeze time + live part: it keeps moving through
        // the freeze, and a click still jumps past it (to freezeEnd)
        const prevRound = ri > 0 ? rounds[ri - 1] : null
        const windowStart = prevRound
          ? prevRound.endTick
          : matchStartTick && matchStartTick > (knife?.endTick ?? 0)
            ? matchStartTick
            : knife ? knife.endTick : 0
        const windowDur = r.endTick - windowStart
        const roundPct = isActive && windowDur > 0
          ? scrubberPct(windowStart, r.endTick)
          : null
        const startFi = ticks.findIndex(tk => tk >= r.freezeEndTick)
        return (
          <button
            key={r.n}
            onClick={() => startFi >= 0 && onJump(startFi)}
            title={`R${r.n}${r.isPistol ? ` ${t('replay:rounds.pistol')}` : ''}`}
            style={{
              position: 'relative', flex: 1,
              padding: '5px 2px', fontSize: 11, fontWeight: isActive ? 700 : 400,
              background: isActive ? 'rgba(74,120,220,0.18)' : r.isPistol ? 'rgba(255,180,50,0.06)' : 'var(--bg2)',
              color: isActive ? 'var(--accent)' : r.isPistol ? 'var(--accent2)' : 'var(--text2)',
              border: 'none',
              borderLeft: '1px solid var(--border)',
              cursor: 'pointer', textAlign: 'center', minWidth: 0,
              overflow: 'visible',
            }}
          >
            {roundPct !== null && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${roundPct * 100}%`,
                width: 2,
                background: 'rgba(255,255,255,0.7)',
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: 1,
              }} />
            )}
            {String(r.n).padStart(2, '0')}
          </button>
        )
      })}
    </div>
  )
}
