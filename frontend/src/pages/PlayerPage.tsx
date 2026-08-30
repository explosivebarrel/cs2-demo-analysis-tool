import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, AnalysisData, PlayerData, PlayerAnalyticsData } from '../api'
import { t } from '../i18n'
import { useLang } from '../App'
import MatchNav from '../components/MatchNav'
import PlayerOverview from '../components/player/PlayerOverview'
import PlayerImpact from '../components/player/PlayerImpact'
import PlayerDuels from '../components/player/PlayerDuels'
import PlayerWeapons from '../components/player/PlayerWeapons'
import PlayerMap from '../components/player/PlayerMap'
import PlayerRounds from '../components/player/PlayerRounds'

// ------------------------------------------------------------------ tab types
type Tab = 'overview' | 'impact' | 'duels' | 'weapons' | 'map' | 'rounds'

const TABS: { key: Tab; ru: string; en: string }[] = [
  { key: 'overview', ru: 'Обзор',   en: 'Overview' },
  { key: 'impact',   ru: 'Импакт',  en: 'Impact'   },
  { key: 'duels',    ru: 'Дуэли',   en: 'Duels'    },
  { key: 'weapons',  ru: 'Оружие',  en: 'Weapons'  },
  { key: 'map',      ru: 'Карта',   en: 'Map'       },
  { key: 'rounds',   ru: 'Раунды',  en: 'Rounds'   },
]

// ------------------------------------------------------------------ small helpers
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
    <div className="card">
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

// ------------------------------------------------------------------ header
function HeaderCard({ p, lang }: { p: PlayerData; lang: 'ru' | 'en' }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="flex items-center justify-between wrap gap-12">
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{p.name}</div>
          {p.clan && <div style={{ color: 'var(--text2)', fontSize: 13 }}>[{p.clan}]</div>}
        </div>
        <div className="flex gap-16 wrap" style={{ fontSize: 13 }}>
          {[
            { l: t('rating'), v: p.rating.toFixed(2), accent: true },
            { l: 'RWS', v: p.rws?.toFixed(1) ?? '—' },
            { l: t('impLabel'), v: p.imp != null ? (p.imp > 0 ? '+' : '') + p.imp.toFixed(2) : '—' },
            { l: t('kd'), v: p.kd.toFixed(2) },
            { l: t('adr'), v: p.adr.toFixed(1) },
            { l: t('kast'), v: p.kast.toFixed(1) + '%' },
          ].map(({ l, v, accent }) => (
            <div key={l} className="kv">
              <span className="kv-label">{l}</span>
              <span className="kv-value" style={accent ? { color: 'var(--accent)' } : {}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ main page
export default function PlayerPage() {
  const { lang } = useLang()
  const { id, steamid } = useParams<{ id: string; steamid: string }>()
  const nav = useNavigate()

  const [data, setData] = useState<AnalysisData | null>(null)
  const [analytics, setAnalytics] = useState<PlayerAnalyticsData | null>(null)
  const [analyticsErr, setAnalyticsErr] = useState('')
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    if (!id) return
    api.analysis(id).then(setData).catch(e => setErr(e.message))
  }, [id])

  useEffect(() => {
    if (!id || !steamid) return
    setAnalytics(null)
    setAnalyticsErr('')
    api.playerAnalytics(id, steamid)
      .then(setAnalytics)
      .catch(e => setAnalyticsErr(e.message))
  }, [id, steamid])

  if (err) return <div className="page"><div className="tag tag-red">{err}</div></div>
  if (!data) return (
    <div className="page">
      <span className="spinner" />
      <span className="text-muted" style={{ marginLeft: 8 }}>{t('loading')}</span>
    </div>
  )

  const p = data.players.find(x => x.steamid === steamid)
  if (!p) return <div className="page"><div className="tag tag-red">Player not found</div></div>

  // name lookup for duels
  const playerNames: Record<string, string> = {}
  for (const pl of data.players) playerNames[pl.steamid] = pl.name

  return (
    <div className="page">
      <MatchNav id={id!} players={data.players} currentSteamid={steamid} />

      {/* player selector */}
      <div className="flex items-center gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
        <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => nav(`/match/${id}`)}>
          ← {t('overview')}
        </button>
        {data.players.map(pl => (
          <button
            key={pl.steamid}
            className={pl.steamid === steamid ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => { nav(`/match/${id}/player/${pl.steamid}`); setTab('overview') }}
          >
            {pl.name}
          </button>
        ))}
      </div>

      <HeaderCard p={p} lang={lang} />

      {/* analytics not ready banner */}
      {analyticsErr && (
        <div className="tag tag-red" style={{ marginBottom: 14, display: 'block' }}>
          {lang === 'ru'
            ? 'Глубокая аналитика недоступна — переанализируйте демо'
            : 'Deep analytics unavailable — re-analyze the demo'}
        </div>
      )}

      {/* tab nav */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(tb => {
          // disable analytics-only tabs if data missing
          const needsAnalytics = ['impact', 'duels', 'map'].includes(tb.key)
          const disabled = needsAnalytics && !!analyticsErr && !analytics
          return (
            <button
              key={tb.key}
              onClick={() => !disabled && setTab(tb.key)}
              style={{
                background: 'none', border: 'none',
                borderBottom: tab === tb.key ? '2px solid var(--accent)' : '2px solid transparent',
                color: tab === tb.key ? 'var(--accent)' : disabled ? 'var(--text2)' : 'var(--text)',
                fontWeight: tab === tb.key ? 700 : 400,
                fontSize: 13, padding: '8px 14px',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.4 : 1,
              }}
            >
              {lang === 'ru' ? tb.ru : tb.en}
            </button>
          )
        })}
      </div>

      {/* tab content */}
      <div>
        {tab === 'overview' && (() => {
          const totalHG = Object.values(p.hitgroups).reduce((a, b) => a + b, 0) || 1
          const hgLabels: Record<string, string> = {
            head: t('head'), chest: t('chest'), stomach: t('stomach'),
            arms: t('arms'), legs: t('legs'),
            left_arm: t('left_arm'), right_arm: t('right_arm'),
            left_leg: t('left_leg'), right_leg: t('right_leg'),
            generic: t('generic'), neck: t('neck'),
          }
          return (
            <div>
              {/* base stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 12 }}>
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

                <Section title={t('economy')}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                    <Kv label={t('avgSpend')} value={'$' + p.eco.avgSpend.toLocaleString()} />
                    <Kv label={t('totalSpend')} value={'$' + p.eco.totalSpend.toLocaleString()} />
                  </div>
                </Section>

                <Section title={t('movement')}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    <Kv label={t('distKm')} value={p.movement.distanceKm.toFixed(2)} />
                    <Kv label="Alive/R (s)" value={p.movement.aliveSecPerRound.toFixed(1)} />
                    <Kv label={t('survival')} value={p.movement.survivalPct.toFixed(1) + '%'} />
                    <Kv label={t('saves')} value={p.movement.saves} />
                  </div>
                </Section>

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

              {/* deep analytics below base stats */}
              {analytics && (
                <div style={{ marginTop: 12 }}>
                  <PlayerOverview metrics={analytics.metrics} duels={analytics.duels} playerNames={playerNames} lang={lang} />
                </div>
              )}
              {!analytics && !analyticsErr && (
                <div className="text-muted" style={{ marginTop: 16 }}>
                  <span className="spinner" style={{ marginRight: 8 }} />{t('loading')}
                </div>
              )}
            </div>
          )
        })()}

        {tab === 'impact' && analytics && (
          <PlayerImpact impact={analytics.impact} series={p.series} duels={analytics.duels} decisionsCost={analytics.decisionsCost ?? []} playerNames={playerNames} lang={lang} allPlayers={data.players} playerData={p} currentSteamid={steamid} />
        )}
        {tab === 'impact' && !analytics && !analyticsErr && (
          <div className="text-muted"><span className="spinner" style={{ marginRight: 8 }} />{t('loading')}</div>
        )}

        {tab === 'duels' && analytics && (
          <PlayerDuels duels={analytics.duels} playerNames={playerNames} lang={lang} />
        )}
        {tab === 'duels' && !analytics && !analyticsErr && (
          <div className="text-muted"><span className="spinner" style={{ marginRight: 8 }} />{t('loading')}</div>
        )}

        {tab === 'weapons' && (
          <PlayerWeapons weapons={p.weapons} lang={lang} />
        )}

        {tab === 'map' && analytics && (
          <PlayerMap mapEvents={analytics.mapEvents} mapName={data.meta.map} lang={lang} />
        )}
        {tab === 'map' && !analytics && !analyticsErr && (
          <div className="text-muted"><span className="spinner" style={{ marginRight: 8 }} />{t('loading')}</div>
        )}

        {tab === 'rounds' && (
          <PlayerRounds series={p.series} rounds={data.rounds} lang={lang} />
        )}
      </div>
    </div>
  )
}
