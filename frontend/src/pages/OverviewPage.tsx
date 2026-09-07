import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, AnalysisData, PlayerData, RoundData } from '../api'
import { t } from '../i18n'
import { useLang } from '../App'
import MatchNav from '../components/MatchNav'
import WeaponIcon from '../components/WeaponIcon'

function ScoreBoard({ data, id }: { data: AnalysisData; id: string }) {
  useLang()
  const nav = useNavigate()
  const { teams, players, meta } = data
  const t0 = teams[0], t1 = teams[1]
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{t0.name}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>{t0.score > t1.score ? '🏆' : ''}</div>
        </div>
        <div style={{ textAlign: 'center', padding: '0 32px' }}>
          <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1 }}>
            <span style={{ color: t0.score >= t1.score ? 'var(--green)' : 'var(--red)' }}>{t0.score}</span>
            <span style={{ color: 'var(--text2)', margin: '0 8px' }}>:</span>
            <span style={{ color: t1.score >= t0.score ? 'var(--green)' : 'var(--red)' }}>{t1.score}</span>
          </div>
          <div style={{ color: 'var(--text2)', fontSize: 12, marginTop: 4 }}>{meta.map}</div>
        </div>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{t1.name}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>{t1.score > t0.score ? '🏆' : ''}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
        {([
          ['adr', t('adr')],
          ['kast', t('kast')],
          ['rating', t('rating')],
          ['hsPct', t('hs')],
          ['utilDmg', t('utilDmg')],
          ['pistolRoundsWon', t('pistolRounds')],
          ['firstKills', t('firstKills')],
          ['clutchesWon', t('clutchesWon')],
        ] as [string, string][]).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between" style={{ gridColumn: '1/-1', display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}>
            <span style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>{t0[k as keyof typeof t0]}</span>
            <span style={{ padding: '0 12px', color: 'var(--text2)', fontSize: 11 }}>{label}</span>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t1[k as keyof typeof t1]}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        {t('tickrate')}: {meta.tickrate} · {t('duration')}: {Math.floor(meta.durationSec / 60)}:{String(Math.floor(meta.durationSec % 60)).padStart(2, '0')} · {t('rounds')}: {meta.rounds}
      </div>
    </div>
  )
}

function Scoreboard({ data, id }: { data: AnalysisData; id: string }) {
  useLang()
  const nav = useNavigate()
  const [sortCol, setSortCol] = useState('rating')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  function sort(col: string) {
    if (col === sortCol) setSortDir(d => d === 1 ? -1 : 1)
    else { setSortCol(col); setSortDir(-1) }
  }

  const cols: { key: string; label: string }[] = [
    { key: 'name', label: t('player_') },
    { key: 'rating', label: t('rating') },
    { key: 'kills', label: t('kills') },
    { key: 'deaths', label: t('deaths') },
    { key: 'assists', label: t('assists') },
    { key: 'kd', label: t('kd') },
    { key: 'adr', label: t('adr') },
    { key: 'kast', label: t('kast') },
    { key: 'hsPct', label: t('hs') },
  ]

  const sorted = [...data.players].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortCol] ?? 0
    const bv = (b as unknown as Record<string, unknown>)[sortCol] ?? 0
    if (typeof av === 'string') return sortDir * av.localeCompare(bv as string)
    return sortDir * ((av as number) - (bv as number))
  })

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.key} style={{ cursor: 'pointer' }} onClick={() => sort(c.key)}>
                {c.label}{sortCol === c.key ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(p => (
            <tr key={p.steamid} style={{ cursor: 'pointer' }} onClick={() => nav(`/match/${id}/player/${p.steamid}`)}>
              <td>
                <span className={`tag tag-${p.firstSide}`} style={{ marginRight: 6 }}>{p.firstSide}</span>
                {p.name}
                {p.clan && <span className="text-muted text-sm" style={{ marginLeft: 6 }}>[{p.clan}]</span>}
              </td>
              <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{p.rating.toFixed(2)}</td>
              <td>{p.kills}</td>
              <td>{p.deaths}</td>
              <td>{p.assists}</td>
              <td>{p.kd.toFixed(2)}</td>
              <td>{p.adr.toFixed(1)}</td>
              <td>{p.kast.toFixed(1)}%</td>
              <td>{p.hsPct !== null ? p.hsPct.toFixed(1) + '%' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RoundsTable({ data }: { data: AnalysisData }) {
  useLang()
  const { rounds, teams, meta } = data
  const buyLabel = (b: string) => ({ pistol: t('pistol'), eco: t('eco'), force: t('force'), full: t('full') }[b] ?? b)
  const sideColor = (s: string) => s === 'T' ? 'var(--t-color)' : 'var(--ct-color)'

  // build round -> total nades map from all players' series
  const nadesPerRound: Record<number, number> = {}
  for (const p of data.players) {
    for (const s of p.series) {
      nadesPerRound[s.n] = (nadesPerRound[s.n] ?? 0) + (s.nades ?? 0)
    }
  }

  return (
    <div className="card" style={{ overflowX: 'auto', marginTop: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{t('round')}</div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>{t('score')}</th><th>{t('winner')}</th>
            <th>{t('reason')}</th><th>{t('buy')} {teams[0].name}</th>
            <th>{t('buy')} {teams[1].name}</th><th>{t('plant')}</th>
            <th>{t('grenades')}</th>
            <th>MVP</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map(r => {
            const wName = teams[r.winnerTeam]?.name ?? `T${r.winnerTeam}`
            const side0 = r.sideTeam0
            const side1 = side0 === 'T' ? 'CT' : 'T'
            const mvpPlayer = data.players.find(p => p.steamid === r.mvp)
            return (
              <tr key={r.n}>
                <td style={{ color: 'var(--text2)' }}>
                  {r.isPistol && <span className="tag tag-green" style={{ marginRight: 4, fontSize: 9 }}>P</span>}
                  {r.n}
                </td>
                <td>{r.scoreTeam0}:{r.scoreTeam1}</td>
                <td style={{ fontWeight: 600 }}>{wName}</td>
                <td style={{ color: 'var(--text2)' }}>{t('reasons.' + r.reason)}</td>
                <td>
                  <span style={{ color: sideColor(side0), fontSize: 11, marginRight: 4 }}>{side0}</span>
                  {buyLabel(r.buyTeam0)}
                </td>
                <td>
                  <span style={{ color: sideColor(side1), fontSize: 11, marginRight: 4 }}>{side1}</span>
                  {buyLabel(r.buyTeam1)}
                </td>
                <td>{r.bombPlanted ? (r.bombSite || '✓') : '—'}</td>
                <td style={{ textAlign: 'center', color: (nadesPerRound[r.n] ?? 0) > 0 ? 'var(--accent2)' : 'var(--text2)', fontWeight: (nadesPerRound[r.n] ?? 0) > 0 ? 700 : 400 }}>
                  {nadesPerRound[r.n] ?? 0}
                </td>
                <td style={{ color: 'var(--text2)', fontSize: 12 }}>{mvpPlayer?.name ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TeamKillsCard({ data }: { data: AnalysisData }) {
  useLang()
  const tks = data.teamKills ?? []
  if (!tks.length) return null
  const nameOf = (sid: string) =>
    data.players.find(p => p.steamid === sid)?.name ?? sid.slice(-6)
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>
        {t('teamKills')} <span style={{ color: '#e8a33d' }}>{tks.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tks.map((tk, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
            background: 'var(--bg3)', borderRadius: 6, padding: '6px 10px',
          }}>
            <span style={{ color: 'var(--text2)', minWidth: 28 }}>R{tk.round}</span>
            <span style={{ fontWeight: 600, color: '#e8a33d' }}>{nameOf(tk.attacker)}</span>
            <span style={{ color: 'var(--text2)' }}>→</span>
            <span>{nameOf(tk.victim)}</span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text2)' }}>
              <WeaponIcon id={tk.weapon.replace(/^weapon_/, '')} name={tk.weapon.replace(/^weapon_/, '')} size={13} />
              {tk.headshot && <img src="/icons/weapons/icon_headshot.svg" alt="HS" width={13} height={13} />}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function OverviewPage() {
  useLang()
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<AnalysisData | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!id) return
    api.analysis(id).then(setData).catch(e => setErr(e.message))
  }, [id])

  if (err) return <div className="page"><div className="tag tag-red">{err}</div></div>
  if (!data) return (
    <div className="page">
      <div className="skeleton" style={{ height: 36, borderRadius: 8, marginBottom: 20 }} />
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="skeleton" style={{ width: 120, height: 24 }} />
          <div className="skeleton" style={{ width: 80, height: 48 }} />
          <div className="skeleton" style={{ width: 120, height: 24 }} />
        </div>
        {[...Array(8)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 20, marginBottom: 8, borderRadius: 4 }} />
        ))}
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        {[...Array(11)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 36, marginBottom: 6, borderRadius: 4 }} />
        ))}
      </div>
    </div>
  )

  return (
    <div className="page">
      <MatchNav id={id!} players={data.players} />
      <ScoreBoard data={data} id={id!} />
      <Scoreboard data={data} id={id!} />
      <TeamKillsCard data={data} />
      <RoundsTable data={data} />
    </div>
  )
}
