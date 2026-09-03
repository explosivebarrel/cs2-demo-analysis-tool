import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SeriesPoint, RoundData } from '../../api'
import { t } from '../../i18n'

function ImpBadge({ imp }: { imp: number }) {
  const color = imp > 0 ? 'var(--green)' : imp < 0 ? 'var(--red)' : 'var(--text2)'
  return (
    <span style={{ fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', minWidth: 40, display: 'inline-block', textAlign: 'right' }}>
      {imp > 0 ? '+' : ''}{imp.toFixed(1)}
    </span>
  )
}

function EcoBar({ spendCt, spendT, sideTeam0 }: { spendCt: number; spendT: number; sideTeam0: string }) {
  // which team is CT?
  const ctSpend = sideTeam0 === 'CT' ? spendCt : spendT
  const tSpend  = sideTeam0 === 'CT' ? spendT  : spendCt
  const total   = ctSpend + tSpend || 1
  const ctPct   = ctSpend / total * 100
  const fmt     = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 1 }}>
        <div style={{ width: `${ctPct}%`, background: '#4a9eda', borderRadius: '3px 0 0 3px' }} />
        <div style={{ flex: 1, background: '#e4882a', borderRadius: '0 3px 3px 0' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text2)', marginTop: 2 }}>
        <span style={{ color: '#4a9eda' }}>{fmt(ctSpend)}</span>
        <span style={{ color: '#e4882a' }}>{fmt(tSpend)}</span>
      </div>
    </div>
  )
}

const WIN_CONDITION_KEYS: Record<string, string> = {
  elimination:     'player:rounds.winElimination',
  bomb:            'player:rounds.winBombExploded',
  defuse:          'player:rounds.winBombDefused',
  time:            'player:rounds.winTime',
  ct_win:          'player:rounds.winCtEliminated',
  t_win:           'player:rounds.winTEliminated',
  bomb_defused:    'player:rounds.winBombDefused',
  bomb_exploded:   'player:rounds.winBombExploded',
  target_bombed:   'player:rounds.winBombExploded',
  target_saved:    'player:rounds.winTime',
  hostage_rescued: 'player:rounds.winHostage',
}

function winConditionLabel(reason: string, winnerTeam: number, sideTeam0: string): string {
  // map winnerTeam → side label
  const winnerSide = winnerTeam === 0 ? sideTeam0 : (sideTeam0 === 'CT' ? 'T' : 'CT')
  const key = WIN_CONDITION_KEYS[reason]
  if (!key) return winnerSide
  return t(key)
}

interface Props {
  series: SeriesPoint[]
  rounds: RoundData[]
  lang: 'ru' | 'en'
}

export default function PlayerRounds({ series, rounds }: Props) {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [showAll, setShowAll] = useState(false)
  const INITIAL = 8

  if (!series.length) {
    return <div style={{ color: 'var(--text2)', fontSize: 13 }}>{t('player:rounds.noData')}</div>
  }

  // build round map for quick lookup
  const roundMap: Record<number, RoundData> = {}
  for (const r of rounds) roundMap[r.n] = r

  const visible = showAll ? series : series.slice(0, INITIAL)

  function goToReplay(rn: number) {
    if (id) navigate(`/match/${id}/replay?round=${rn}`)
  }

  return (
    <div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg3)', fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left' }}>{t('player:rounds.colRound')}</th>
              <th style={{ padding: '8px 10px', textAlign: 'left' }}>{t('player:rounds.colResult')}</th>
              <th style={{ padding: '8px 10px', textAlign: 'left' }}>{t('player:rounds.colCondition')}</th>
              <th style={{ padding: '8px 10px' }}>{t('player:rounds.colScore')}</th>
              <th style={{ padding: '8px 10px' }}>{t('player:rounds.colTime')}</th>
              <th style={{ padding: '8px 10px', minWidth: 130 }}>{t('player:rounds.colEconomy')}</th>
              <th style={{ padding: '8px 10px' }}>K</th>
              <th style={{ padding: '8px 10px' }}>D</th>
              <th style={{ padding: '8px 10px' }}>{t('player:rounds.colDmg')}</th>
              <th style={{ padding: '8px 10px' }} title={t('player:rounds.colNadesTitle')}>🔴</th>
              <th style={{ padding: '8px 10px' }}>IMP</th>
              <th style={{ padding: '8px 6px' }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(s => {
              const r = roundMap[s.n]
              const rowBg = s.won ? 'rgba(80,200,120,0.05)' : 'rgba(220,80,80,0.05)'
              const resultColor = s.won ? 'var(--green)' : 'var(--red)'

              const side = r?.sideTeam0 === 'CT'
                ? (s.won ? t('player:rounds.sideCt') : t('player:rounds.sideT'))
                : (s.won ? t('player:rounds.sideT') : t('player:rounds.sideCt'))

              return (
                <tr key={s.n} style={{ background: rowBg, borderBottom: '1px solid var(--border)' }}>
                  {/* round number */}
                  <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>
                    {s.mvp ? (
                      <span style={{ color: 'var(--accent2)', fontWeight: 700 }}>★{s.n}</span>
                    ) : s.pistol ? (
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>P{s.n}</span>
                    ) : s.n}
                  </td>

                  {/* result */}
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ fontWeight: 700, color: resultColor }}>
                      {s.won ? 'W' : 'L'}
                    </span>
                    {' '}
                    <span style={{ color: 'var(--text2)', fontSize: 11 }}>
                      {side}
                    </span>
                  </td>

                  {/* win condition */}
                  <td style={{ padding: '8px 10px', color: 'var(--text2)', fontSize: 11 }}>
                    {r ? winConditionLabel(r.reason, r.winnerTeam, r.sideTeam0) : '—'}
                  </td>

                  {/* score */}
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                    {r ? `${r.scoreTeam0}:${r.scoreTeam1}` : '—'}
                  </td>

                  {/* duration */}
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)', fontSize: 11 }}>
                    {r ? `${r.durSec.toFixed(0)}s` : '—'}
                  </td>

                  {/* economy bars */}
                  <td style={{ padding: '8px 10px' }}>
                    {r ? (
                      <EcoBar
                        spendCt={r.sideTeam0 === 'CT' ? r.spendTeam0 : r.spendTeam1}
                        spendT={r.sideTeam0 === 'CT' ? r.spendTeam1 : r.spendTeam0}
                        sideTeam0={r.sideTeam0}
                      />
                    ) : '—'}
                  </td>

                  {/* kills */}
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: s.k >= 3 ? 700 : 400, color: s.k >= 3 ? 'var(--accent2)' : undefined }}>
                    {s.k}
                  </td>

                  {/* deaths */}
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{s.d}</td>

                  {/* damage */}
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: s.dmg >= 100 ? 700 : 400 }}>
                    {s.dmg}
                  </td>

                  {/* grenades */}
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: (s.nades ?? 0) > 0 ? 'var(--accent2)' : 'var(--text2)', fontWeight: (s.nades ?? 0) > 0 ? 700 : 400 }}>
                    {s.nades ?? 0}
                  </td>

                  {/* IMP */}
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <ImpBadge imp={s.imp} />
                  </td>

                  {/* go to replay */}
                  <td style={{ padding: '8px 6px' }}>
                    <button
                      onClick={() => goToReplay(s.n)}
                      title={t('player:rounds.watchInReplay')}
                      style={{
                        background: 'none', border: '1px solid var(--border)',
                        borderRadius: 4, color: 'var(--text2)', padding: '2px 6px',
                        cursor: 'pointer', fontSize: 11,
                      }}
                    >›</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {series.length > INITIAL && (
        <button
          onClick={() => setShowAll(v => !v)}
          style={{
            marginTop: 8, width: '100%',
            background: 'var(--bg3)', border: '1px solid var(--border)',
            color: 'var(--accent)', borderRadius: 6, padding: '8px 0',
            cursor: 'pointer', fontSize: 12,
          }}
        >
          {showAll
            ? t('player:rounds.showLess')
            : t('player:rounds.showAll', { count: series.length - INITIAL })}
        </button>
      )}
    </div>
  )
}
