import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, PlayerHistoryEntry } from '../../api'
import { t } from '../../i18n'

const PAGE = 10

type SeriesKey = 'rating' | 'kast' | 'rws' | 'imp'
const SERIES: { key: SeriesKey; label: string; color: string; fmt: (v: number) => string }[] = [
  { key: 'rating', label: 'Rating', color: '#f0a830', fmt: v => v.toFixed(2) },
  { key: 'kast', label: 'KAST %', color: '#4caf7d', fmt: v => `${Math.round(v)}%` },
  { key: 'rws', label: 'RWS', color: '#4a9eda', fmt: v => v.toFixed(1) },
  { key: 'imp', label: 'IMP', color: '#b48ead', fmt: v => v.toFixed(2) },
]

// one SVG, one normalized Y scale per series (different metrics, same picture);
// hover a dot for date/map/value
function TrendPlot({ entries }: { entries: PlayerHistoryEntry[] }) {
  const w = 680
  const h = 190
  const padL = 16, padR = 16, padT = 12, padB = 22
  const active = SERIES.filter(s => entries.some(e => e[s.key] != null))
  if (entries.length < 2 || !active.length) return null

  const x = (i: number) => padL + (i / (entries.length - 1)) * (w - padL - padR)
  const bounds = active.map(s => {
    const vals = entries
      .map(e => e[s.key])
      .filter((v): v is number => v != null)
    const lo = Math.min(...vals), hi = Math.max(...vals)
    const pad = (hi - lo) * 0.18 || Math.abs(hi) * 0.12 || 0.5
    return { lo: lo - pad, hi: hi + pad }
  })
  const y = (v: number, si: number) =>
    padT + (1 - (v - bounds[si].lo) / (bounds[si].hi - bounds[si].lo)) * (h - padT - padB)

  const first = entries[0], last = entries[entries.length - 1]
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: 760 }}>
      {/* horizontal grid */}
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={padL} x2={w - padR}
          y1={padT + f * (h - padT - padB)} y2={padT + f * (h - padT - padB)}
          stroke="var(--border)" strokeWidth={1} opacity={0.5} />
      ))}
      {active.map((s, si) => {
        const pts = entries
          .map((e, i) => ({ i, v: e[s.key] }))
          .filter((p): p is { i: number; v: number } => p.v != null)
        const line = pts.map((p, k) => `${k ? 'L' : 'M'} ${x(p.i).toFixed(1)},${y(p.v, si).toFixed(1)}`).join(' ')
        return (
          <g key={s.key}>
            <path d={line} fill="none" stroke={s.color} strokeWidth={2} opacity={0.9} />
            {pts.map(p => (
              <circle key={p.i} cx={x(p.i)} cy={y(p.v, si)} r={3.2} fill={s.color}>
                <title>{`${(entries[p.i].date || '').slice(0, 10)} · ${entries[p.i].map} — ${s.label}: ${s.fmt(p.v)} (${entries[p.i].won ? t('player:history.win') : t('player:history.loss')})`}</title>
              </circle>
            ))}
          </g>
        )
      })}
      {/* x labels: first/last date */}
      <text x={padL} y={h - 6} fontSize={10} fill="var(--text2)">{(first.date || '').slice(0, 10)}</text>
      <text x={w - padR} y={h - 6} fontSize={10} fill="var(--text2)" textAnchor="end">{(last.date || '').slice(0, 10)}</text>
    </svg>
  )
}

function Legend({ entries }: { entries: PlayerHistoryEntry[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11, color: 'var(--text2)' }}>
      {SERIES.map(s => {
        const vals = entries.map(e => e[s.key]).filter((v): v is number => v != null)
        if (!vals.length) return null
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length
        return (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.label}: {s.fmt(vals[vals.length - 1])} → avg {s.fmt(avg)}
          </span>
        )
      })}
    </div>
  )
}

export default function PlayerHistory({ steamid, currentDemoId }: {
  steamid: string
  currentDemoId?: string
}) {
  const nav = useNavigate()
  const [entries, setEntries] = useState<PlayerHistoryEntry[] | null>(null)
  const [err, setErr] = useState('')
  const [mapFilter, setMapFilter] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    api.playerHistory(steamid)
      .then(setEntries)
      .catch(e => setErr(String(e)))
  }, [steamid])

  const maps = useMemo(() => {
    if (!entries) return []
    return [...new Set(entries.map(e => e.map))].sort()
  }, [entries])

  if (err) return <div className="tag tag-red">{err}</div>
  if (!entries) return <div className="skeleton" style={{ height: 200, borderRadius: 8 }} />
  if (!entries.length) return <div style={{ color: 'var(--text2)' }}>{t('player:history.empty')}</div>

  const filtered = mapFilter ? entries.filter(e => e.map === mapFilter) : entries
  const desc = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const oldestFirst = [...desc].reverse()  // oldest first for the plot
  const wins = filtered.filter(e => e.won).length
  const visible = expanded ? desc : desc.slice(0, PAGE)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
          {t('player:history.trend', { n: filtered.length })}
        </div>
        <TrendPlot entries={oldestFirst} />
        <div style={{ marginTop: 4 }}>
          <Legend entries={filtered} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('player:history.mapFilter')}:</span>
        <select value={mapFilter} onChange={e => setMapFilter(e.target.value)}
          style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '4px 8px' }}>
          <option value="">{t('player:history.mapAll')}</option>
          {maps.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          {filtered.length ? (expanded || desc.length <= PAGE ? `${desc.length}` : t('player:history.limit', { n: PAGE })) : ''}
        </span>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg3)', fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left' }}>{t('player:history.match')}</th>
              <th style={{ padding: '8px 10px', textAlign: 'left' }}>{t('player:history.result')}</th>
              <th style={{ padding: '8px 10px' }}>{t('score')}</th>
              <th style={{ padding: '8px 10px' }}>{t('kills')}</th>
              <th style={{ padding: '8px 10px' }}>{t('deaths')}</th>
              <th style={{ padding: '8px 10px' }}>{t('adr')}</th>
              <th style={{ padding: '8px 10px' }}>{t('kast')}</th>
              {filtered.some(e => e.rws != null) && <th style={{ padding: '8px 10px' }}>RWS</th>}
              {filtered.some(e => e.imp != null) && <th style={{ padding: '8px 10px' }}>IMP</th>}
              <th style={{ padding: '8px 10px' }}>{t('rating')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(e => (
              <tr key={e.demoId} className="row-link"
                title={t('player:history.openHint')}
                onClick={() => nav(`/match/${e.demoId}/player/${steamid}`)}>
                <td style={{ padding: '8px 10px' }}>
                  {e.demoId === currentDemoId ? <strong>{e.map}</strong> : e.map}
                  <span style={{ color: 'var(--text2)', marginLeft: 8, fontSize: 11 }}>
                    {(e.date || '').slice(0, 10)}
                  </span>
                </td>
                <td style={{ padding: '8px 10px', color: e.won ? '#4caf7d' : '#e05252' }}>
                  {e.won ? t('player:history.win') : t('player:history.loss')}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {e.teamNames?.[e.team] ?? '?'} {e.score?.[e.team]}:{e.score?.[1 - e.team]}
                </td>
                <td style={{ textAlign: 'center' }}>{e.kills}</td>
                <td style={{ textAlign: 'center' }}>{e.deaths}</td>
                <td style={{ textAlign: 'center' }}>{e.adr}</td>
                <td style={{ textAlign: 'center' }}>{e.kast}%</td>
                {filtered.some(x => x.rws != null) && <td style={{ textAlign: 'center' }}>{e.rws?.toFixed(1) ?? '—'}</td>}
                {filtered.some(x => x.imp != null) && <td style={{ textAlign: 'center' }}>{e.imp?.toFixed(2) ?? '—'}</td>}
                <td style={{ textAlign: 'center', color: 'var(--accent)' }}>{e.rating.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {desc.length > PAGE && (
        <button className="btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 12 }} onClick={() => setExpanded(v => !v)}>
          {expanded ? t('player:history.showLess') : t('player:history.showAll')}
        </button>
      )}
      <div style={{ fontSize: 11, color: 'var(--text2)' }}>
        {wins} / {filtered.length} {t('player:history.win').toLowerCase()}
      </div>
    </div>
  )
}
