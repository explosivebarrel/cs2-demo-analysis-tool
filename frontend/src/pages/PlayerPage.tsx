import { useState, useEffect } from 'react'
import { useParams, useNavigate, NavLink } from 'react-router-dom'
import { api, AnalysisData, PlayerData } from '../api'
import { t } from '../i18n'
import { useLang } from '../App'

function MatchNav({ id }: { id: string }) {
  useLang()
  const base = `/match/${id}`
  const s = (active: boolean) => ({ color: active ? 'var(--accent)' : 'var(--text2)', fontWeight: active ? 700 : 400, textDecoration: 'none', fontSize: 13 })
  return (
    <div className="flex gap-16 items-center" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 20 }}>
      <NavLink to={base} end style={({ isActive }) => s(isActive)}>{t('overview')}</NavLink>
      <NavLink to={`${base}/heatmaps`} style={({ isActive }) => s(isActive)}>{t('heatmaps')}</NavLink>
      <NavLink to={`${base}/replay`} style={({ isActive }) => s(isActive)}>{t('replay')}</NavLink>
    </div>
  )
}

function Kv({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="kv">
      <span className="kv-label">{label}</span>
      <span className="kv-value" style={accent ? { color: 'var(--accent)' } : {}}>{value ?? '—'}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mt-12">
      <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--text2)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</div>
      {children}
    </div>
  )
}

function RatingSub({ parts }: { parts: Record<string, number> }) {
  const keys = Object.keys(parts)
  if (!keys.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
      {keys.map(k => (
        <div key={k} style={{ minWidth: 80 }}>
          <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase' }}>{k}</div>
          <div style={{ fontWeight: 700, color: 'var(--accent2)' }}>{typeof parts[k] === 'number' ? parts[k].toFixed(2) : parts[k]}</div>
        </div>
      ))}
    </div>
  )
}

function SeriesChart({ series }: { series: PlayerData['series'] }) {
  if (!series.length) return null
  const maxDmg = Math.max(...series.map(s => s.dmg), 1)
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 80 }}>
        {series.map(s => {
          const h = Math.max(4, (s.dmg / maxDmg) * 72)
          const color = s.won ? (s.k > s.d ? 'var(--green)' : 'var(--accent2)') : 'var(--red)'
          return (
            <div key={s.n} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}
              title={`R${s.n}: K${s.k} D${s.d} DMG${s.dmg}${s.pistol ? ' [P]' : ''}${s.mvp ? ' ★' : ''}`}>
              <div style={{ width: '100%', height: h, background: color, borderRadius: '2px 2px 0 0', opacity: s.kast ? 1 : 0.4 }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 1, marginTop: 3 }}>
        {series.map(s => {
          const label = s.mvp ? '★' : s.pistol ? 'P' : String(s.n)
          const labelColor = s.mvp ? 'var(--accent2)' : s.pistol ? 'var(--accent)' : 'var(--text2)'
          return (
            <div key={s.n} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: labelColor, fontWeight: s.mvp || s.pistol ? 700 : 400, lineHeight: 1.2, overflow: 'hidden' }}>
              {label}
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 4 }}>
        {t('seriesLegend')} · ★ MVP · P {t('pistolRound')}
      </div>
    </div>
  )
}

function SeriesTable({ series }: { series: PlayerData['series'] }) {
  if (!series.length) return null
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>{t('colRound')}</th>
            <th>{t('colResult')}</th>
            <th>{t('kills')}</th>
            <th>{t('deaths')}</th>
            <th>{t('assists')}</th>
            <th>{t('dmg')}</th>
            <th>KAST</th>
            <th>{t('colOpening')}</th>
            <th>{t('colImp')}</th>
            <th>MVP</th>
          </tr>
        </thead>
        <tbody>
          {series.map(s => {
            const rowColor = s.won ? 'rgba(80,200,120,0.07)' : 'rgba(220,80,80,0.07)'
            const resultColor = s.won ? 'var(--green)' : 'var(--red)'
            const impColor = s.imp > 0 ? 'var(--green)' : s.imp < 0 ? 'var(--red)' : 'var(--text2)'
            return (
              <tr key={s.n} style={{ background: rowColor }}>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {s.mvp ? <span style={{ color: 'var(--accent2)', fontWeight: 700 }}>★{s.n}</span>
                    : s.pistol ? <span style={{ color: 'var(--accent)', fontWeight: 700 }}>P{s.n}</span>
                    : s.n}
                </td>
                <td style={{ fontWeight: 700, color: resultColor }}>{s.won ? t('resultWon') : t('resultLost')}</td>
                <td style={{ fontWeight: s.k >= 3 ? 700 : 400, color: s.k >= 3 ? 'var(--accent2)' : undefined }}>{s.k}</td>
                <td>{s.d}</td>
                <td style={{ color: s.a > 0 ? 'var(--text)' : 'var(--text2)' }}>{s.a}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: s.dmg >= 100 ? 700 : 400 }}>{s.dmg}</td>
                <td style={{ color: s.kast ? 'var(--green)' : 'var(--text2)' }}>{s.kast ? '✓' : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--text2)' }}>{s.opening ?? '—'}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: impColor }}>{s.imp > 0 ? '+' : ''}{s.imp}</td>
                <td>{s.mvp ? '★' : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


function SeriesView({ series }: { series: PlayerData['series'] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => setView('chart')} style={{
          background: view === 'chart' ? 'var(--accent)' : 'var(--bg3)',
          color: view === 'chart' ? '#fff' : 'var(--text2)',
          border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
        }}>{t('viewChart')}</button>
        <button onClick={() => setView('table')} style={{
          background: view === 'table' ? 'var(--accent)' : 'var(--bg3)',
          color: view === 'table' ? '#fff' : 'var(--text2)',
          border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
        }}>{t('viewTable')}</button>
      </div>
      {view === 'chart' ? <SeriesChart series={series} /> : <SeriesTable series={series} />}
    </div>
  )
}

export default function PlayerPage() {
  useLang()
  const { id, steamid } = useParams<{ id: string; steamid: string }>()
  const nav = useNavigate()
  const [data, setData] = useState<AnalysisData | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!id) return
    api.analysis(id).then(setData).catch(e => setErr(e.message))
  }, [id])

  if (err) return <div className="page"><div className="tag tag-red">{err}</div></div>
  if (!data) return <div className="page"><span className="spinner" /> <span className="text-muted" style={{ marginLeft: 8 }}>{t('loading')}</span></div>

  const p = data.players.find(x => x.steamid === steamid)
  if (!p) return <div className="page"><div className="tag tag-red">Player not found</div></div>

  const totalHG = Object.values(p.hitgroups).reduce((a, b) => a + b, 0) || 1
  const hgLabels: Record<string, string> = {
    head: t('head'), chest: t('chest'), stomach: t('stomach'),
    arms: t('arms'), legs: t('legs'),
    left_arm: t('left_arm'), right_arm: t('right_arm'),
    left_leg: t('left_leg'), right_leg: t('right_leg'),
    generic: t('generic'), neck: t('neck'),
  }

  return (
    <div className="page">
      <MatchNav id={id!} />

      {/* player selector */}
      <div className="flex items-center gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
        <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => nav(`/match/${id}`)}>← {t('overview')}</button>
        {data.players.map(pl => (
          <button key={pl.steamid}
            className={pl.steamid === steamid ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => nav(`/match/${id}/player/${pl.steamid}`)}>
            {pl.name}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {/* header card */}
        <div className="card" style={{ gridColumn: '1/-1' }}>
          <div className="flex items-center justify-between wrap gap-12">
            <div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{p.name}</div>
              {p.clan && <div style={{ color: 'var(--text2)', fontSize: 13 }}>[{p.clan}]</div>}
            </div>
            <div className="flex gap-16 wrap">
              <Kv label={t('rating')} value={p.rating.toFixed(2)} accent />
              <Kv label="RWS" value={p.rws?.toFixed(1) ?? '—'} />
              <Kv label={t('impLabel')} value={p.imp != null ? (p.imp > 0 ? '+' : '') + p.imp.toFixed(2) : '—'} />
              <Kv label={t('kd')} value={p.kd.toFixed(2)} />
              <Kv label={t('adr')} value={p.adr.toFixed(1)} />
              <Kv label={t('kast')} value={p.kast.toFixed(1) + '%'} />
              <Kv label={t('hs')} value={p.hsPct !== null ? p.hsPct.toFixed(1) + '%' : '—'} />
            </div>
          </div>
          <RatingSub parts={p.ratingParts} />
        </div>

        {/* base stats */}
        <Section title={t('kills') + ' / ' + t('deaths') + ' / ' + t('assists')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Kv label={t('kills')} value={p.kills} />
            <Kv label={t('deaths')} value={p.deaths} />
            <Kv label={t('assists')} value={p.assists} />
            <Kv label="FA" value={p.flashAssists} />
            <Kv label={t('kpr')} value={p.kpr.toFixed(2)} />
            <Kv label={t('dpr')} value={p.dpr.toFixed(2)} />
            <Kv label="APR" value={p.apr.toFixed(2)} />
            <Kv label="ADR" value={p.adr.toFixed(1)} />
          </div>
        </Section>

        {/* opening */}
        <Section title={t('opening')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Kv label={t('kills')} value={p.opening.kills} />
            <Kv label={t('deaths')} value={p.opening.deaths} />
            <Kv label="Win%" value={p.opening.success !== null ? p.opening.success.toFixed(1) + '%' : '—'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 12 }}>
            <Kv label={t('tradeKills')} value={p.trades.tradeKills} />
            <Kv label={t('tradedDeaths')} value={p.trades.tradedDeaths} />
          </div>
        </Section>

        {/* multikills & clutches */}
        <Section title={t('multiKills')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {(['2k', '3k', '4k', '5k'] as const).map(k => (
              <Kv key={k} label={k.toUpperCase()} value={p.multiKills[k]} />
            ))}
            <Kv label={t('roundsCount')} value={p.multiKills.rounds} />
          </div>
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('clutches')}</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(p.clutches.byX).map(([k, v]) => (
                <div key={k} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '6px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>1v{k}</div>
                  <div style={{ fontWeight: 700 }}>{v.won}/{v.played}</div>
                </div>
              ))}
              {p.clutches.played === 0 && <span className="text-muted">{t('noData')}</span>}
            </div>
          </div>
        </Section>

        {/* utility */}
        <Section title={t('utility')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Kv label={t('flashThrown')} value={p.flashes.thrown} />
            <Kv label={t('enemiesFlashed')} value={p.flashes.enemiesFlashed} />
            <Kv label={t('blindSec')} value={p.flashes.blindSec.toFixed(1)} />
            <Kv label={t('effectiveFlash')} value={p.flashes.effective} />
            <Kv label="FF" value={p.flashes.friendly} />
            <Kv label="Smokes" value={p.grenades.smokes} />
            <Kv label="HE" value={p.grenades.he} />
            <Kv label="Fire" value={p.grenades.fire} />
            <Kv label="Decoy" value={p.grenades.decoys} />
          </div>
        </Section>

        <Section title="Bomb">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Kv label={t('plants')} value={p.bomb.plants} />
            <Kv label={t('defuses')} value={p.bomb.defuses} />
            <Kv label="Attempts" value={p.bomb.defuseAttempts} />
            <Kv label="Kit" value={p.bomb.kits} />
          </div>
        </Section>

        {/* economy */}
        <Section title={t('economy')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <Kv label={t('avgSpend')} value={'$' + p.eco.avgSpend.toLocaleString()} />
            <Kv label={t('totalSpend')} value={'$' + p.eco.totalSpend.toLocaleString()} />
          </div>
        </Section>

        {/* movement */}
        <Section title={t('movement')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Kv label={t('distKm')} value={p.movement.distanceKm.toFixed(2)} />
            <Kv label="Alive/R (s)" value={p.movement.aliveSecPerRound.toFixed(1)} />
            <Kv label={t('survival')} value={p.movement.survivalPct.toFixed(1) + '%'} />
            <Kv label={t('saves')} value={p.movement.saves} />
          </div>
        </Section>

        {/* by side */}
        <Section title={t('bySide')}>
          {(['T', 'CT'] as const).map(side => {
            const s = p.bySide[side]
            return (
              <div key={side} style={{ marginBottom: 12 }}>
                <span className={`tag tag-${side}`} style={{ marginBottom: 8, display: 'inline-block' }}>{side} ({s.rounds} {t('roundsCount')})</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                  <Kv label={t('kills')} value={s.kills} />
                  <Kv label={t('deaths')} value={s.deaths} />
                  <Kv label={t('kd')} value={s.kd.toFixed(2)} />
                  <Kv label={t('adr')} value={s.adr.toFixed(1)} />
                  <Kv label={t('assists')} value={s.assists} />
                </div>
              </div>
            )
          })}
        </Section>

        {/* hitgroups */}
        <Section title={t('hitgroups')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(p.hitgroups).map(([hg, cnt]) => (
              <div key={hg} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '6px 12px', textAlign: 'center', minWidth: 64 }}>
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>{hgLabels[hg] ?? hg}</div>
                <div style={{ fontWeight: 700 }}>{cnt}</div>
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>{(cnt / totalHG * 100).toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title={t('seriesTitle')}>
        <SeriesView series={p.series} />
      </Section>

      {/* weapons */}
      <Section title={t('weapons')}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: 'auto', minWidth: '100%', whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 120 }}>{t('weaponCol')}</th>
                <th>{t('kills')}</th>
                <th>HS%</th>
                <th>{t('shots')}</th>
                <th>{t('hits')}</th>
                <th>{t('accuracy')}</th>
                <th>{t('dmg')}</th>
              </tr>
            </thead>
            <tbody>
              {p.weapons.map(w => (
                <tr key={w.raw}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 11, color: 'var(--text2)', marginRight: 6 }}>{w.cls}</span>
                    {w.ru || w.en}
                  </td>
                  <td style={{ fontWeight: 700 }}>{w.kills}</td>
                  <td>{w.hsPct !== null ? w.hsPct.toFixed(1) + '%' : '—'}</td>
                  <td>{w.shots}</td>
                  <td>{w.hits}</td>
                  <td>{w.acc !== null ? w.acc.toFixed(1) + '%' : '—'}</td>
                  <td>{w.dmg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
