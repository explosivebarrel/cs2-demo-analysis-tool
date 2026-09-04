import { useState } from 'react'
import { DuelEpisode } from '../../api'
import { t } from '../../i18n'
import EpisodeDrillDown from './EpisodeDrillDown'

const ERROR_META: Record<string, { key: string; color: string; icon: string }> = {
  shift_peek:    { key: 'player:duels.errorShiftPeek',   color: 'var(--accent2)', icon: '🚶' },
  moving_shot:   { key: 'player:duels.errorMovingShot',  color: 'var(--red)',     icon: '🏃' },
  isolated:      { key: 'player:duels.errorIsolated',    color: 'var(--accent)',  icon: '🔇' },
  flashed:       { key: 'player:duels.errorFlashed',     color: 'var(--accent2)', icon: '🌟' },
  strong_duel:   { key: 'player:duels.errorStrongDuel',  color: 'var(--green)',   icon: '💪' },
  overshoot:     { key: 'player:duels.errorOvershoot',   color: 'var(--red)',     icon: '→' },
  undershoot:    { key: 'player:duels.errorUndershoot',  color: 'var(--accent2)', icon: '←' },
  missed_first:  { key: 'player:duels.errorMissedFirst', color: 'var(--accent)',  icon: '✗' },
  passive_angle: { key: 'player:duels.errorPassiveAngle', color: 'var(--text2)',  icon: '⏸' },
  moving:        { key: 'player:duels.errorMoving',      color: 'var(--text2)',   icon: '🏃' },
  outnumbered:   { key: 'player:duels.errorOutnumbered', color: 'var(--text2)',   icon: '⚠️' },
}

// pseudo-groups for "no errors" bucket
const GROUP_NO_ERR = '__clean'

function fmtTime(ts: number): string {
  const m = Math.floor(ts / 60)
  const s = Math.floor(ts % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface EpisodeRowProps {
  d: DuelEpisode
  playerNames: Record<string, string>
  onOpen: () => void
}

function EpisodeRow({ d, playerNames, onOpen }: EpisodeRowProps) {
  const attName = playerNames[d.attacker] ?? d.attacker.slice(-6)
  const vicName  = playerNames[d.victim]   ?? d.victim.slice(-6)
  const errMeta  = d.errors.map(e => ERROR_META[e]).filter(Boolean)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
      borderBottom: '1px solid var(--border)', fontSize: 12, flexWrap: 'wrap',
    }}>
      <span style={{ color: 'var(--text2)', minWidth: 28, fontVariantNumeric: 'tabular-nums' }}>R{d.round}</span>
      <span style={{ color: 'var(--text2)', minWidth: 32 }}>{fmtTime(d.timestamp)}</span>
      <span style={{ fontWeight: 700, color: d.won ? 'var(--green)' : 'var(--red)', minWidth: 12 }}>
        {d.won ? '▲' : '▼'}
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ fontWeight: 700 }}>{attName}</span>
        <span style={{ color: 'var(--text2)', margin: '0 5px' }}>→</span>
        <span>{vicName}</span>
      </span>
      <span style={{ color: 'var(--text2)', fontSize: 11 }}>{d.weapon}</span>
      {d.headshot && <span style={{ fontSize: 10, color: 'var(--accent2)', fontWeight: 700 }}>HS</span>}
      {errMeta.map(m => (
        <span key={m.key} title={t(m.key)} style={{ fontSize: 13 }}>{m.icon}</span>
      ))}
      <button
        onClick={onOpen}
        style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: 4,
          color: 'var(--accent)', padding: '2px 8px', cursor: 'pointer', fontSize: 11,
        }}
      >
        {t('player:duels.view')}
      </button>
    </div>
  )
}

interface GroupAccordionProps {
  groupKey: string
  duels: DuelEpisode[]
  isMain: boolean
  playerNames: Record<string, string>
  onOpenDrillDown: (d: DuelEpisode) => void
}

function GroupAccordion({ groupKey, duels, isMain, playerNames, onOpenDrillDown }: GroupAccordionProps) {
  const [open, setOpen] = useState(isMain)
  const [showAll, setShowAll] = useState(false)
  const INITIAL_SHOW = 3

  const meta = ERROR_META[groupKey]
  const isError = groupKey !== GROUP_NO_ERR && groupKey !== 'strong_duel'
  const statusIcon = meta
    ? (groupKey === 'strong_duel' ? '✅' : isError ? '❌' : '⚠️')
    : '✅'

  const label = meta
    ? t(meta.key)
    : (groupKey === GROUP_NO_ERR
      ? t('player:duels.cleanDuels')
      : groupKey)

  const color = meta?.color ?? 'var(--green)'
  const visible = showAll ? duels : duels.slice(0, INITIAL_SHOW)

  return (
    <div style={{ marginBottom: 10, border: `1px solid ${isMain ? color : 'var(--border)'}`, borderRadius: 8, overflow: 'hidden' }}>
      {/* group header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'var(--bg3)', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          textAlign: 'left', color: 'var(--text)',
        }}
      >
        <span style={{ fontSize: 16 }}>{statusIcon}</span>
        <span style={{ flex: 1, fontWeight: isMain ? 800 : 700, fontSize: 13, color }}>
          {label}
          {isMain && (
            <span style={{
              fontSize: 10, background: color, color: '#fff',
              borderRadius: 4, padding: '1px 6px', marginLeft: 8, verticalAlign: 'middle',
            }}>
              {t('player:duels.mainIssue')}
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text2)', marginRight: 6 }}>{duels.length}</span>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* episodes */}
      {open && (
        <div style={{ background: 'var(--bg2)' }}>
          {visible.map((d, i) => (
            <EpisodeRow
              key={i}
              d={d}
              playerNames={playerNames}
              onOpen={() => onOpenDrillDown(d)}
            />
          ))}
          {duels.length > INITIAL_SHOW && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              style={{
                width: '100%', background: 'none', border: 'none',
                color: 'var(--accent)', padding: '8px 14px', cursor: 'pointer', fontSize: 12,
                borderTop: '1px solid var(--border)',
              }}
            >
              {t('player:duels.showMore', { count: duels.length - INITIAL_SHOW })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function PlayerDuels({
  duels, playerNames,
}: {
  duels: DuelEpisode[]
  playerNames: Record<string, string>
  lang?: 'ru' | 'en'
}) {
  const [topFilter, setTopFilter] = useState<'all' | 'errors' | 'strong'>('all')
  const [drillDown, setDrillDown] = useState<DuelEpisode | null>(null)

  if (!duels.length) {
    return <div style={{ color: 'var(--text2)', fontSize: 13 }}>{t('player:duels.noDuels')}</div>
  }

  // group duels by primary error (first error, or GROUP_NO_ERR)
  const groups: Record<string, DuelEpisode[]> = {}
  for (const d of duels) {
    const key = d.won
      ? (d.errors[0] ?? GROUP_NO_ERR)
      : d.errors[0] ?? GROUP_NO_ERR
    if (!groups[key]) groups[key] = []
    groups[key].push(d)
  }

  // find main error group (highest count among error groups, not strong_duel or clean)
  const errorKeys = Object.keys(groups).filter(k => k !== GROUP_NO_ERR && k !== 'strong_duel')
  const mainKey = errorKeys.length
    ? errorKeys.reduce((a, b) => groups[a].length >= groups[b].length ? a : b)
    : null

  // sort: main error first, then errors by count desc, then strong_duel, then clean
  const sortedKeys = [
    ...(mainKey ? [mainKey] : []),
    ...errorKeys.filter(k => k !== mainKey).sort((a, b) => groups[b].length - groups[a].length),
    ...('strong_duel' in groups ? ['strong_duel'] : []),
    ...(GROUP_NO_ERR in groups ? [GROUP_NO_ERR] : []),
  ]

  const filteredKeys = sortedKeys.filter(k => {
    if (topFilter === 'errors') return k !== GROUP_NO_ERR && k !== 'strong_duel'
    if (topFilter === 'strong') return k === 'strong_duel' || k === GROUP_NO_ERR
    return true
  })

  const totalErrors = errorKeys.reduce((s, k) => s + groups[k].length, 0)
  const totalStrong = (groups['strong_duel']?.length ?? 0) + (groups[GROUP_NO_ERR]?.length ?? 0)

  const btnStyle = (active: boolean, color?: string) => ({
    background: active ? (color ?? 'var(--accent)') : 'var(--bg3)',
    color: active ? '#fff' : 'var(--text2)',
    border: 'none', borderRadius: 4, padding: '5px 12px',
    cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 400,
  })

  return (
    <div>
      {/* top-level filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button style={btnStyle(topFilter === 'all')} onClick={() => setTopFilter('all')}>
          {t('player:duels.filterAll')} ({duels.length})
        </button>
        <button style={btnStyle(topFilter === 'errors', 'var(--red)')} onClick={() => setTopFilter('errors')}>
          {t('player:duels.filterErrors')} ({totalErrors})
        </button>
        <button style={btnStyle(topFilter === 'strong', 'var(--green)')} onClick={() => setTopFilter('strong')}>
          {t('player:duels.filterStrong')} ({totalStrong})
        </button>
      </div>

      {/* accordion groups */}
      {filteredKeys.map(k => (
        <GroupAccordion
          key={k}
          groupKey={k}
          duels={groups[k]}
          isMain={k === mainKey}
          playerNames={playerNames}
          onOpenDrillDown={setDrillDown}
        />
      ))}

      {filteredKeys.length === 0 && (
        <div style={{ color: 'var(--text2)', fontSize: 13 }}>
          {t('player:duels.noDataForFilter')}
        </div>
      )}

      {/* drill-down modal */}
      {drillDown && (
        <EpisodeDrillDown
          duel={drillDown}
          playerNames={playerNames}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  )
}
