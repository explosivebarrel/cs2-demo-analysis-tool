import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, PlayerHistoryEntry } from '../../api'
import { t } from '../../i18n'

function RatingPlot({ entries }: { entries: PlayerHistoryEntry[] }) {
  const w = 560
  const h = 120
  const pad = 24
  if (entries.length < 2) return null
  const vals = entries.map(e => e.rating)
  const lo = Math.min(...vals) - 0.05
  const hi = Math.max(...vals) + 0.05
  const x = (i: number) => pad + (i / (entries.length - 1)) * (w - pad * 2)
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2)
  const line = entries.map((e, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)},${y(e.rating).toFixed(1)}`).join(' ')
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: 640 }}>
      <line x1={pad} y1={y(avg)} x2={w - pad} y2={y(avg)}
        stroke="var(--text2)" strokeDasharray="4 4" strokeWidth={1} opacity={0.6} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {entries.map((e, i) => (
        <circle key={i} cx={x(i)} cy={y(e.rating)} r={4}
          fill={e.won ? '#4caf7d' : '#e05252'}>
          <title>{`${e.map}: ${e.rating.toFixed(2)}`}</title>
        </circle>
      ))}
    </svg>
  )
}

export default function PlayerHistory({ steamid, currentDemoId }: {
  steamid: string
  currentDemoId?: string
}) {
  const nav = useNavigate()
  const [entries, setEntries] = useState<PlayerHistoryEntry[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.playerHistory(steamid)
      .then(setEntries)
      .catch(e => setErr(String(e)))
  }, [steamid])

  if (err) return <div className="tag tag-red">{err}</div>
  if (!entries) return <div className="skeleton" style={{ height: 200, borderRadius: 8 }} />
  if (!entries.length) return <div style={{ color: 'var(--text2)' }}>{t('player:history.empty')}</div>

  const desc = [...entries].reverse()  // oldest first for the plot
  const wins = entries.filter(e => e.won).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
          {t('player:history.ratingPlot')} · {entries.length}
        </div>
        <RatingPlot entries={desc} />
      </div>

      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text2)', textAlign: 'left' }}>
            <th style={{ padding: '4px 8px' }}>{t('player:history.match')}</th>
            <th style={{ padding: '4px 8px' }}>{t('player:history.result')}</th>
            <th style={{ padding: '4px 8px' }}>{t('score')}</th>
            <th style={{ padding: '4px 8px' }}>{t('kills')}</th>
            <th style={{ padding: '4px 8px' }}>{t('deaths')}</th>
            <th style={{ padding: '4px 8px' }}>{t('adr')}</th>
            <th style={{ padding: '4px 8px' }}>{t('kast')}</th>
            <th style={{ padding: '4px 8px' }}>{t('rating')}</th>
          </tr>
        </thead>
        <tbody>
          {[...entries].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(e => (
            <tr key={e.demoId} style={{ borderTop: '1px solid var(--border)' }}
              onClick={() => nav(`/match/${e.demoId}/player/${steamid}`)}
              className="row-link">
              <td style={{ padding: '6px 8px' }}>
                {e.demoId === currentDemoId ? <strong>{e.map}</strong> : e.map}
                <span style={{ color: 'var(--text2)', marginLeft: 8, fontSize: 11 }}>
                  {(e.date || '').slice(0, 10)}
                </span>
              </td>
              <td style={{ padding: '6px 8px', color: e.won ? '#4caf7d' : '#e05252' }}>
                {e.won ? t('player:history.win') : t('player:history.loss')}
              </td>
              <td style={{ padding: '6px 8px' }}>
                {e.teamNames?.[e.team] ?? '?'} {e.score?.[e.team]}:{e.score?.[1 - e.team]}
              </td>
              <td style={{ padding: '6px 8px' }}>{e.kills}</td>
              <td style={{ padding: '6px 8px' }}>{e.deaths}</td>
              <td style={{ padding: '6px 8px' }}>{e.adr}</td>
              <td style={{ padding: '6px 8px' }}>{e.kast}%</td>
              <td style={{ padding: '6px 8px', color: 'var(--accent)' }}>{e.rating.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: 'var(--text2)' }}>
        {wins} / {entries.length} {t('player:history.win').toLowerCase()}
      </div>
    </div>
  )
}
