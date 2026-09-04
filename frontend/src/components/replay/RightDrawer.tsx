import { useMemo, useState } from 'react'
import { AnalysisData, ReplayData } from '../../api'
import {
  F_ALIVE, F_AMMO, F_ARMOR, F_EQUIP, F_FLAGS, F_HP, F_MONEY, F_WID,
  FLAG_DEFUSER, FLAG_HELMET, TEAM_COLORS, buildInvIndex, fieldsOf, invAt, playerSpeedAt, teamColorAtFrame,
} from '../../lib/replay'
import { t, getLang } from '../../i18n'

interface InvInfo { en: string; ru: string; cls: string }

function invLabel(replay: ReplayData, id: string): string {
  const info: InvInfo | undefined = replay.invWeapons?.[id]
  if (!info) return id
  return getLang() === 'ru' ? info.ru : info.en
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, padding: '1px 0' }}>
      <span style={{ color: 'var(--text2)', flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

/** Right drawer: both teams with per-player rows and expandable detail cards. */
export default function RightDrawer({
  replay, analysis, frameIdx,
}: {
  replay: ReplayData
  analysis: AnalysisData | null
  frameIdx: number
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const lang = getLang()
  const FIELDS = fieldsOf(replay)
  const hasV2 = FIELDS === 13

  const invIndex = useMemo(() => buildInvIndex(replay), [replay])

  const teams: { idx: number; label: string; color: string; players: typeof replay.players }[] = [1, 0].map(idx => {
    const color = teamColorAtFrame(replay, frameIdx, idx)
    const label = color === TEAM_COLORS[2] ? t('replay:side.t') : t('replay:side.ct')
    return { idx, label, color, players: replay.players.filter(p => p.team === idx) }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0 }}>
      {teams.map(team => {
        const teamName = analysis?.teams[team.idx === 1 ? 0 : 1]?.name ?? team.label
        return (
          <div key={team.label} className="card" style={{ padding: '8px 10px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, borderBottom: `2px solid ${team.color}`, paddingBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: team.color }}>{team.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamName}</span>
            </div>
            {team.players.map((pl, teamLocalIdx) => {
              const globalIdx = replay.players.findIndex(p => p.steamid === pl.steamid)
              const base = frameIdx * replay.players.length * FIELDS + globalIdx * FIELDS
              const alive = replay.data[base + F_ALIVE] ?? 0
              const hp = replay.data[base + F_HP] ?? 0
              const armor = replay.data[base + F_ARMOR] ?? 0
              const helmet = ((replay.data[base + F_FLAGS] ?? 0) & FLAG_HELMET) !== 0
              const hasKit = ((replay.data[base + F_FLAGS] ?? 0) & FLAG_DEFUSER) !== 0
              const money = hasV2 ? (replay.data[base + F_MONEY] ?? 0) : 0
              const ammo = hasV2 ? (replay.data[base + F_AMMO] ?? 0) : 0
              const wid = replay.data[base + F_WID] ?? 0
              const equip = replay.data[base + F_EQUIP] ?? 0
              const weapInfo = replay.weapons[wid]
              const weapName = weapInfo ? (lang === 'ru' ? weapInfo.ru : weapInfo.en) : ''
              const speed = playerSpeedAt(replay, globalIdx, frameIdx)
              const ids = invAt(invIndex, globalIdx, frameIdx)
              const byId = (id: string) => replay.invWeapons?.[id]?.cls ?? 'other'
              const primary = ids.filter(id => ['rifle', 'sniper', 'smg', 'heavy'].includes(byId(id)))
              const secondary = ids.filter(id => byId(id) === 'pistol')
              const nades = ids.filter(id => byId(id) === 'grenade')
              const knife = ids.filter(id => byId(id) === 'knife')
              const isOpen = expanded === pl.steamid
              return (
                <div key={pl.steamid} style={{ borderBottom: '1px solid var(--border)' }}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : pl.steamid)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', opacity: alive ? 1 : 0.35, cursor: 'pointer' }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: alive ? team.color : '#555', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{teamLocalIdx + 1}</span>
                    </div>
                    <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {((replay.data[base + F_FLAGS] ?? 0) & 1) ? '💣 ' : ''}{pl.name}
                    </span>
                    {hasV2 && <span style={{ fontSize: 10, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>${money}</span>}
                    <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }}>{weapName}</span>
                    <div style={{ width: 30, height: 4, background: '#333', borderRadius: 2, flexShrink: 0 }}>
                      <div style={{ width: `${hp}%`, height: '100%', borderRadius: 2, background: hp > 50 ? '#4caf7d' : hp > 25 ? '#f5c542' : '#e05252' }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, minWidth: 22, textAlign: 'right', color: alive ? (hp > 50 ? 'var(--green)' : hp > 25 ? 'var(--accent2)' : 'var(--red)') : 'var(--text2)' }}>
                      {alive ? hp : '☠'}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text2)', width: 8, textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: '4px 0 8px 22px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {!hasV2 && (
                        <div style={{ fontSize: 10, color: 'var(--text2)', fontStyle: 'italic', marginBottom: 4 }}>
                          {t('replay:card.noData')}
                        </div>
                      )}
                      <Row label={t('replay:card.armor')} value={armor > 0 ? <>{armor}{helmet ? ' 🪖' : ''}</> : '—'} />
                      {hasV2 && <Row label={t('replay:card.money')} value={`$${money}`} />}
                      <Row label={t('replay:card.weapon')} value={weapName || '—'} />
                      {hasV2 && ammo > 0 && <Row label={t('replay:card.ammo')} value={ammo} />}
                      <Row label={t('replay:card.speed')} value={alive ? `${speed} u/s` : '—'} />
                      {hasV2 && <Row label={t('replay:card.primary')} value={primary.length ? primary.map(id => invLabel(replay, id)).join(', ') : '—'} />}
                      {hasV2 && <Row label={t('replay:card.secondary')} value={secondary.length ? secondary.map(id => invLabel(replay, id)).join(', ') : '—'} />}
                      {hasV2 && <Row label={t('replay:card.nades')} value={nades.length ? nades.map(id => invLabel(replay, id)).join(', ') : '—'} />}
                      {hasV2 && (knife.length > 0 || hasKit) && (
                        <Row label={t('replay:card.gear')} value={[
                          knife.length ? invLabel(replay, knife[0]) : null,
                          hasKit ? t('replay:card.kit') : null,
                        ].filter(Boolean).join(', ') || '—'} />
                      )}
                      {!hasV2 && equip > 0 && <Row label="$" value={equip} />}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
