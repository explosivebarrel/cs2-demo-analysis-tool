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

  const tabLabel = (tk: Tab) => {
    const found = TABS.find(t => t.key === tk)
    return found ? (lang === 'ru' ? found.ru : found.en) : tk
  }

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
          const needsAnalytics = ['overview', 'impact', 'duels', 'map'].includes(tb.key)
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
        {tab === 'overview' && analytics && (
          <PlayerOverview metrics={analytics.metrics} duels={analytics.duels} playerNames={playerNames} lang={lang} />
        )}
        {tab === 'overview' && !analytics && !analyticsErr && (
          <div className="text-muted"><span className="spinner" style={{ marginRight: 8 }} />{t('loading')}</div>
        )}

        {tab === 'impact' && analytics && (
          <PlayerImpact impact={analytics.impact} series={p.series} duels={analytics.duels} playerNames={playerNames} lang={lang} allPlayers={data.players} playerData={p} currentSteamid={steamid} />
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
