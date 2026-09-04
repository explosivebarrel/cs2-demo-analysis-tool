import { useMemo, useState } from 'react'
import type { Moment, ReplayData } from '../../api'
import { t } from '../../i18n'

export type MomentFilter = 'all' | Moment['type']

const TYPE_LABEL_KEY: Record<Moment['type'], string> = {
  clutch: 'replay:moments.clutch',
  multikill: 'replay:moments.multikill',
  mistake: 'replay:moments.mistake',
  openingDeath: 'replay:moments.openingDeath',
  swing: 'replay:moments.swing',
}

const TYPE_ICON: Record<Moment['type'], string> = {
  clutch: '🛡️', multikill: '💥', mistake: '⚠️', openingDeath: '💀', swing: '📈',
}

export function labelForMoment(m: Moment, replay: ReplayData): string {
  const name = replay.players.find(p => p.steamid === m.steamid)?.name
  switch (m.type) {
    case 'clutch':
      return `${name ?? ''} 1v${(m.count ?? 2) - 1}${m.won ? ' ✓' : ' ✗'}`
    case 'multikill':
      return `${name ?? ''} ×${m.count ?? 3}`
    case 'mistake':
      return `${name ?? ''} · ${(m.detail ?? '').replace(/_/g, ' ')}`
    case 'openingDeath':
      return `${name ?? ''}`
    case 'swing':
      return `${m.detail ?? ''}`
  }
}

export default function MomentsPanel(
  { moments, replay, onJump }: {
    moments: Moment[]
    replay: ReplayData
    onJump: (m: Moment) => void
  },
) {
  const [filter, setFilter] = useState<MomentFilter>('all')

  const filtered = useMemo(
    () => (filter === 'all' ? moments : moments.filter(m => m.type === filter)),
    [moments, filter],
  )

  const chips: MomentFilter[] = ['all', 'clutch', 'multikill', 'mistake', 'openingDeath', 'swing']

  if (!moments.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase' }}>
        {t('replay:moments.title')} · {moments.length}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {chips.map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{
            background: filter === c ? 'var(--accent)' : 'var(--bg3)',
            color: filter === c ? '#fff' : 'var(--text)',
            border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11,
          }}>
            {t(TYPE_LABEL_KEY[c as Moment['type']] ?? 'replay:moments.all')}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('replay:moments.empty')}</div>
        )}
        {filtered.map((m, i) => (
          <button key={`${m.type}-${m.tick}-${i}`} onClick={() => onJump(m)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--bg3)', border: 'none', borderRadius: 4,
            padding: '4px 8px', cursor: 'pointer', fontSize: 12, textAlign: 'left', color: 'var(--text)',
          }}>
            <span>{TYPE_ICON[m.type]}</span>
            <span style={{ color: 'var(--text2)', fontSize: 11, minWidth: 34 }}>
              R{m.round}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {labelForMoment(m, replay)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Jump to `seconds` before the given tick (clamped to 0)
export function frameForTickMinus(replay: ReplayData, tick: number, seconds: number): number {
  const target = Math.max(0, tick - Math.round(replay.tickrate * seconds))
  let lo = 0, hi = replay.ticks.length - 1, res = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (replay.ticks[mid] <= target) { res = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return res
}

export function momentsAround(moments: Moment[], curTick: number, tickrate: number): {
  prev: Moment | null; next: Moment | null
} {
  let prev: Moment | null = null
  let next: Moment | null = null
  const lookahead = Math.round(tickrate * 1)  // current position counts as "at" the moment
  for (const m of moments) {
    if (m.tick <= curTick + lookahead) prev = m
    else if (!next) { next = m; break }
  }
  return { prev, next }
}
