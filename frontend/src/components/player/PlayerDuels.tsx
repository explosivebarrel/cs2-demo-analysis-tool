import { useState } from 'react'
import { DuelEpisode } from '../../api'
import EpisodeDrillDown from './EpisodeDrillDown'

const ERROR_META: Record<string, { ru: string; en: string; color: string; icon: string }> = {
  shift_peek:  { ru: 'Пик на шифте',         en: 'Shift peek',       color: 'var(--accent2)', icon: '🚶' },
  moving_shot: { ru: 'Движение при стрельбе', en: 'Moving shot',      color: 'var(--red)',     icon: '🏃' },
  isolated:    { ru: 'Игра в изоляции',       en: 'Playing isolated', color: 'var(--accent)',  icon: '🔇' },
  flashed:     { ru: 'Вышел на флеше',        en: 'Entered flashed',  color: 'var(--accent2)', icon: '🌟' },
  strong_duel: { ru: 'Сильная дуэль',         en: 'Strong duel',      color: 'var(--green)',   icon: '💪' },
  overshoot:    { ru: 'Перелёт прицела',         en: 'Aim overshoot',      color: 'var(--red)',     icon: '→' },
  undershoot:   { ru: 'Недолёт прицела',         en: 'Aim undershoot',     color: 'var(--accent2)', icon: '←' },
  missed_first: { ru: 'Неточный первый выстрел', en: 'Inaccurate 1st shot', color: 'var(--accent)',  icon: '✗' },
  passive_angle: { ru: 'Пассивный угол',         en: 'Passive angle',       color: 'var(--text2)', icon: '⏸' },
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
  lang: 'ru' | 'en'
  onOpen: () => void
}

function EpisodeRow({ d, playerNames, lang, onOpen }: EpisodeRowProps) {
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
        <span key={m.ru} title={lang === 'ru' ? m.ru : m.en} style={{ fontSize: 13 }}>{m.icon}</span>
      ))}
      <button
        onClick={onOpen}
        style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: 4,
          color: 'var(--accent)', padding: '2px 8px', cursor: 'pointer', fontSize: 11,
        }}
      >
        {lang === 'ru' ? 'Смотреть →' : 'View →'}
      </button>
    </div>
  )
}

interface GroupAccordionProps {
  groupKey: string
  duels: DuelEpisode[]
  isMain: boolean
  playerNames: Record<string, string>
  lang: 'ru' | 'en'
  onOpenDrillDown: (d: DuelEpisode) => void
}

function GroupAccordion({ groupKey, duels, isMain, playerNames, lang, onOpenDrillDown }: GroupAccordionProps) {
  const [open, setOpen] = useState(isMain)
  const [showAll, setShowAll] = useState(false)
  const INITIAL_SHOW = 3

  const meta = ERROR_META[groupKey]
  const isError = groupKey !== GROUP_NO_ERR && groupKey !== 'strong_duel'
  const statusIcon = meta
    ? (groupKey === 'strong_duel' ? '✅' : isError ? '❌' : '⚠️')
    : '✅'

  const label = meta
    ? (lang === 'ru' ? meta.ru : meta.en)
    : (groupKey === GROUP_NO_ERR
      ? (lang === 'ru' ? 'Чистые дуэли' : 'Clean duels')
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
              {lang === 'ru' ? 'ГЛАВНАЯ ОШИБКА' : 'MAIN ISSUE'}
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
              lang={lang}
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
              {lang === 'ru'
                ? `Показать ещё (${duels.length - INITIAL_SHOW})`
                : `Show more (${duels.length - INITIAL_SHOW})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function PlayerDuels({
  duels, playerNames, lang,
}: {
  duels: DuelEpisode[]
  playerNames: Record<string, string>
  lang: 'ru' | 'en'
}) {
  const [topFilter, setTopFilter] = useState<'all' | 'errors' | 'strong'>('all')
  const [drillDown, setDrillDown] = useState<DuelEpisode | null>(null)

  if (!duels.length) {
    return <div style={{ color: 'var(--text2)', fontSize: 13 }}>{lang === 'ru' ? 'Нет дуэлей' : 'No duels'}</div>
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
          {lang === 'ru' ? 'Все' : 'All'} ({duels.length})
        </button>
        <button style={btnStyle(topFilter === 'errors', 'var(--red)')} onClick={() => setTopFilter('errors')}>
          {lang === 'ru' ? 'Ошибки' : 'Errors'} ({totalErrors})
        </button>
        <button style={btnStyle(topFilter === 'strong', 'var(--green)')} onClick={() => setTopFilter('strong')}>
          {lang === 'ru' ? 'Сильные' : 'Strong'} ({totalStrong})
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
          lang={lang}
          onOpenDrillDown={setDrillDown}
        />
      ))}

      {filteredKeys.length === 0 && (
        <div style={{ color: 'var(--text2)', fontSize: 13 }}>
          {lang === 'ru' ? 'Нет данных для выбранного фильтра' : 'No data for selected filter'}
        </div>
      )}

      {/* drill-down modal */}
      {drillDown && (
        <EpisodeDrillDown
          duel={drillDown}
          playerNames={playerNames}
          lang={lang}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  )
}
