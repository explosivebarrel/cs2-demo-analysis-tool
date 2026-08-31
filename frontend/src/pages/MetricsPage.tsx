import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, PlayerAnalyticsData, DuelEpisode, AnalysisData } from '../api'
import { useLang, useBenchmarks } from '../App'
import { getTier, TIER_COLORS, TIER_LABELS, formatTierTooltip } from '../benchmarkUtils'
import EpisodeDrillDown from '../components/player/EpisodeDrillDown'

// ------------------------------------------------------------------ helpers

function MetricHeader({ title, value, metricKey, lang }: {
  title: string; value: string; metricKey: string; lang: 'ru' | 'en'
}) {
  const benchmarks = useBenchmarks()
  const [showTip, setShowTip] = useState(false)
  const rawNum = parseFloat(value)
  const tier = isNaN(rawNum) ? null : getTier(benchmarks, metricKey, rawNum)
  const tiers = benchmarks[metricKey]
  const tip = tiers && !isNaN(rawNum) ? formatTierTooltip(tiers, rawNum, lang) : null
  const color = tier ? TIER_COLORS[tier] : 'var(--text)'
  const label = tier ? TIER_LABELS[tier][lang] : null
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20 }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, color }}>
          {value}
        </div>
      </div>
      {label && (
        <span
          style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >
          <span style={{
            fontSize: 12, fontWeight: 700, color, background: `${color}22`,
            borderRadius: 4, padding: '3px 8px', cursor: 'default', letterSpacing: '.04em',
          }}>
            {label}
          </span>
          {showTip && tip && (
            <div style={{
              position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
              padding: '6px 10px', fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap',
              zIndex: 100, marginBottom: 4, boxShadow: '0 4px 12px rgba(0,0,0,.5)', lineHeight: 1.6,
            }}>
              {tip.split(' · ').map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </span>
      )}
    </div>
  )
}

const ERROR_LABELS_MAP: Record<string, string> = {
  shift_peek: 'shift peek', moving_shot: 'moving shot', isolated: 'isolated',
  flashed: 'flashed', strong_duel: 'clean', moving: 'was moving', outnumbered: 'outnumbered',
}

function DuelRow({ duel, playerNames, idx, selected, onClick }: {
  duel: DuelEpisode; playerNames: Record<string, string>; idx: number
  selected: boolean; onClick: () => void
}) {
  const attName = playerNames[duel.attacker] ?? duel.attacker.slice(-6)
  const vicName = playerNames[duel.victim] ?? duel.victim.slice(-6)
  const bg = selected ? 'var(--bg3)' : duel.won ? 'rgba(80,200,120,0.05)' : 'rgba(220,80,80,0.05)'
  const borderColor = selected ? 'var(--accent)' : duel.won ? 'var(--green)' : 'var(--red)'
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: bg, border: `1px solid ${borderColor}`,
        borderRadius: 6, padding: '8px 12px', cursor: 'pointer',
        transition: 'background .1s',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 28 }}>R{duel.round}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: duel.won ? 'var(--green)' : 'var(--red)', minWidth: 50 }}>
        {duel.won ? '✓ Win' : '✗ Loss'}
      </span>
      <span style={{ fontSize: 12 }}>{attName} → {vicName}</span>
      <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 'auto' }}>{duel.weapon}</span>
      {duel.headshot && <span style={{ fontSize: 11, color: 'var(--accent2)' }}>HS</span>}
      {duel.errors.filter(e => e !== 'strong_duel').map(e => (
        <span key={e} style={{ fontSize: 10, color: 'var(--red)', background: 'rgba(220,80,80,.15)', borderRadius: 3, padding: '1px 5px' }}>
          {ERROR_LABELS_MAP[e] ?? e}
        </span>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ metric page content
function OpeningWinPctPage({ analytics, playerNames, steamid, lang }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; steamid: string; lang: 'ru' | 'en'
}) {
  const duels = analytics.duels
  const won = duels.filter(d => d.won)
  const lost = duels.filter(d => !d.won)
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all')
  const shown = filter === 'won' ? won : filter === 'lost' ? lost : duels
  const pct = analytics.metrics.openingWinPct
  return (
    <div>
      <MetricHeader
        title={lang === 'ru' ? 'Открывашки Win%' : 'Opening Win%'}
        value={pct.toFixed(1) + '%'}
        metricKey="openingWinPct"
        lang={lang}
      />
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text2)' }}>
        {lang === 'ru'
          ? `${won.length} выигранных · ${lost.length} проигранных · ${duels.length} всего`
          : `${won.length} won · ${lost.length} lost · ${duels.length} total`}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['all', 'won', 'lost'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? 'var(--accent)' : 'var(--bg3)',
            color: filter === f ? '#fff' : 'var(--text2)',
            border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
          }}>
            {f === 'all' ? (lang === 'ru' ? 'Все' : 'All') : f === 'won' ? (lang === 'ru' ? 'Выигранные' : 'Won') : (lang === 'ru' ? 'Проигранные' : 'Lost')}
          </button>
        ))}
      </div>
      <DuelListPanel duels={shown} playerNames={playerNames} lang={lang} title="" />
    </div>
  )
}

function IdealStrafePctPage({ analytics, playerNames, lang }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'
}) {
  const pct = analytics.metrics.idealStrafePct
  const won = analytics.duels.filter(d => d.won)
  const ideal = won.filter(d => !d.errors.includes('moving_shot'))
  const moving = won.filter(d => d.errors.includes('moving_shot'))
  const [filter, setFilter] = useState<'ideal' | 'moving'>('moving')
  const shown = filter === 'ideal' ? ideal : moving
  return (
    <div>
      <MetricHeader
        title={lang === 'ru' ? 'Идеальные стрейфы' : 'Ideal strafes'}
        value={pct.toFixed(1) + '%'}
        metricKey="idealStrafePct"
        lang={lang}
      />
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text2)' }}>
        {lang === 'ru'
          ? `${ideal.length} убийств на стопе · ${moving.length} убийств в движении (из ${won.length} побед)`
          : `${ideal.length} kills while stopped · ${moving.length} kills while moving (of ${won.length} wins)`}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button onClick={() => setFilter('ideal')} style={{
          background: filter === 'ideal' ? 'var(--green)' : 'var(--bg3)',
          color: filter === 'ideal' ? '#fff' : 'var(--text2)',
          border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
        }}>{lang === 'ru' ? `На стопе (${ideal.length})` : `Stopped (${ideal.length})`}</button>
        <button onClick={() => setFilter('moving')} style={{
          background: filter === 'moving' ? 'var(--red)' : 'var(--bg3)',
          color: filter === 'moving' ? '#fff' : 'var(--text2)',
          border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
        }}>{lang === 'ru' ? `В движении (${moving.length})` : `Moving (${moving.length})`}</button>
      </div>
      <DuelListPanel duels={shown} playerNames={playerNames} lang={lang} title="" />
    </div>
  )
}

function CounterStrafeErrorsPage({ analytics, playerNames, lang }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'
}) {
  const count = analytics.metrics.counterStrafeErrors ?? 0
  const duels = analytics.duels.filter(d => d.errors.includes('moving_shot'))
  return (
    <div>
      <MetricHeader
        title={lang === 'ru' ? 'Ошибки контрстрейфа' : 'Counter-strafe errors'}
        value={String(count)}
        metricKey="counterStrafeErrors"
        lang={lang}
      />
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text2)' }}>
        {lang === 'ru'
          ? `Дуэли, где ты стрелял на ходу: ${duels.length}`
          : `Duels where you shot while moving: ${duels.length}`}
      </div>
      <DuelListPanel duels={duels} playerNames={playerNames} lang={lang} title="" />
    </div>
  )
}

function DisciplinePage({ analytics, playerNames, lang }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'
}) {
  const m = analytics.metrics
  const shiftDuels = analytics.duels.filter(d => d.errors.includes('shift_peek'))
  const isosDuels = analytics.duels.filter(d => d.errors.includes('isolated'))
  const [filter, setFilter] = useState<'shift_peek' | 'isolated'>('shift_peek')
  const shown = filter === 'shift_peek' ? shiftDuels : isosDuels
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
        {lang === 'ru' ? 'Дисциплина в дуэлях' : 'Duel discipline'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 20 }}>
        <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 16px' }}>
          <StatBar label={lang === 'ru' ? 'Шифт-пики' : 'Shift peeks'} value={m.shiftPeekPct} max={100} color={m.shiftPeekPct > 30 ? 'var(--accent2)' : 'var(--green)'} />
          <StatBar label={lang === 'ru' ? 'Игра в изоляции' : 'Isolated plays'} value={m.isolatedPct} max={100} color={m.isolatedPct > 30 ? 'var(--red)' : 'var(--green)'} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button onClick={() => setFilter('shift_peek')} style={{
          background: filter === 'shift_peek' ? 'var(--accent2)' : 'var(--bg3)',
          color: filter === 'shift_peek' ? '#fff' : 'var(--text2)',
          border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
        }}>{lang === 'ru' ? `Шифт-пики (${shiftDuels.length})` : `Shift peeks (${shiftDuels.length})`}</button>
        <button onClick={() => setFilter('isolated')} style={{
          background: filter === 'isolated' ? 'var(--red)' : 'var(--bg3)',
          color: filter === 'isolated' ? '#fff' : 'var(--text2)',
          border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
        }}>{lang === 'ru' ? `Изоляция (${isosDuels.length})` : `Isolated (${isosDuels.length})`}</button>
      </div>
      <DuelListPanel duels={shown} playerNames={playerNames} lang={lang} title="" />
    </div>
  )
}

function LostDuelsPage({ analytics, playerNames, lang }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'
}) {
  const lost = analytics.duels.filter(d => !d.won)
  const flashed = lost.filter(d => d.errors.includes('flashed'))
  const moving = lost.filter(d => d.errors.includes('moving'))
  const outnumbered = lost.filter(d => d.errors.includes('outnumbered'))
  const clean = lost.filter(d => d.errors.length === 0)
  const [filter, setFilter] = useState<'all' | 'flashed' | 'moving' | 'outnumbered' | 'clean'>('all')
  const shown = filter === 'flashed' ? flashed
    : filter === 'moving' ? moving
    : filter === 'outnumbered' ? outnumbered
    : filter === 'clean' ? clean
    : lost

  const btnData = [
    { key: 'all' as const,         label: lang === 'ru' ? `Все (${lost.length})` : `All (${lost.length})` },
    { key: 'flashed' as const,     label: lang === 'ru' ? `Флеш (${flashed.length})` : `Flashed (${flashed.length})` },
    { key: 'moving' as const,      label: lang === 'ru' ? `В движении (${moving.length})` : `Moving (${moving.length})` },
    { key: 'outnumbered' as const, label: lang === 'ru' ? `Числе (${outnumbered.length})` : `Outnumbered (${outnumbered.length})` },
    { key: 'clean' as const,       label: lang === 'ru' ? `Чистые (${clean.length})` : `Clean (${clean.length})` },
  ]

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
        {lang === 'ru' ? 'Проигранные дуэли' : 'Lost duels'}
      </div>
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text2)' }}>
        {lang === 'ru' ? `${lost.length} смертей` : `${lost.length} deaths`}
        {flashed.length > 0 && ` · ${lang === 'ru' ? `${flashed.length} на флеше` : `${flashed.length} flashed`}`}
        {moving.length > 0 && ` · ${lang === 'ru' ? `${moving.length} в движении` : `${moving.length} moving`}`}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {btnData.map(b => (
          <button key={b.key} onClick={() => setFilter(b.key)} style={{
            background: filter === b.key ? 'var(--accent)' : 'var(--bg3)',
            color: filter === b.key ? '#fff' : 'var(--text2)',
            border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
          }}>{b.label}</button>
        ))}
      </div>
      <DuelListPanel duels={shown} playerNames={playerNames} lang={lang} title="" />
    </div>
  )
}


function GenericMetricPage({
  analytics, playerNames, metricKey, lang }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; metricKey: string; lang: 'ru' | 'en'
}) {
  const value = (analytics.metrics as unknown as Record<string, number>)[metricKey]
  const labels: Record<string, { ru: string; en: string }> = {
    tradeKillPct:   { ru: 'Трейд-килы', en: 'Trade kills' },
    tradedDeathPct: { ru: 'Трейд-смерти', en: 'Traded deaths' },
    flashEfficiency:{ ru: 'Эфф. флешек', en: 'Flash efficiency' },
    clutchWinPct:   { ru: 'Клатч Win%', en: 'Clutch Win%' },
    firstBulletAcc: { ru: 'Точность первой пули', en: 'First bullet acc' },
    ttk_ms:         { ru: 'Время до фрага', en: 'Time to kill' },
    reloadErrors:   { ru: 'Перезарядки', en: 'Reload errors' },
    angleControlCount: { ru: 'Контроль угла', en: 'Angle control' },
  }
  const info = labels[metricKey] ?? { ru: metricKey, en: metricKey }
  const displayValue = metricKey === 'ttk_ms'
    ? (value > 0 ? value.toFixed(0) + ' мс' : '—')
    : metricKey === 'angleControlCount' || metricKey === 'reloadErrors'
      ? String(Math.round(value))
      : value.toFixed(1) + '%'
  return (
    <div>
      <MetricHeader
        title={lang === 'ru' ? info.ru : info.en}
        value={displayValue}
        metricKey={metricKey}
        lang={lang}
      />
      <div style={{ color: 'var(--text2)', fontSize: 13 }}>
        {lang === 'ru' ? 'Детальные эпизоды для этой метрики скоро.' : 'Detailed episodes for this metric coming soon.'}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ stat bar
function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 700, color }}>{value.toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .3s' }} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ duel list panel
function DuelListPanel({ duels, playerNames, lang, title }: {
  duels: DuelEpisode[]; playerNames: Record<string, string>; lang: 'ru' | 'en'; title: string
}) {
  const [sel, setSel] = useState(0)
  const [drill, setDrill] = useState(false)
  if (!duels.length) return (
    <div style={{ color: 'var(--text2)', fontSize: 13, padding: 16 }}>
      {lang === 'ru' ? 'Нет эпизодов' : 'No episodes'}
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 480, overflowY: 'auto' }}>
        {duels.map((d, i) => (
          <DuelRow
            key={i} duel={d} playerNames={playerNames} idx={i}
            selected={i === sel}
            onClick={() => { setSel(i); setDrill(true) }}
          />
        ))}
      </div>
      <div>
        {drill && (
          <EpisodeDrillDown
            duel={duels[sel]}
            playerNames={playerNames}
            lang={lang}
            onClose={() => setDrill(false)}
          />
        )}
        {!drill && (
          <div style={{ color: 'var(--text2)', fontSize: 12, padding: 16 }}>
            {lang === 'ru' ? 'Нажми на строку, чтобы открыть эпизод' : 'Click a row to view episode'}
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ main page
export default function MetricsPage() {
  const { lang } = useLang()
  const { id, steamid, key } = useParams<{ id: string; steamid: string; key: string }>()
  const nav = useNavigate()

  const [data, setData] = useState<AnalysisData | null>(null)
  const [analytics, setAnalytics] = useState<PlayerAnalyticsData | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!id) return
    api.analysis(id).then(setData).catch(e => setErr(e.message))
  }, [id])

  useEffect(() => {
    if (!id || !steamid) return
    api.playerAnalytics(id, steamid).then(setAnalytics).catch(e => setErr(e.message))
  }, [id, steamid])

  if (err) return <div className="page"><div className="tag tag-red">{err}</div></div>
  if (!data || !analytics) return (
    <div className="page">
      <span className="spinner" />
      <span className="text-muted" style={{ marginLeft: 8 }}>{lang === 'ru' ? 'Загрузка…' : 'Loading…'}</span>
    </div>
  )

  const p = data.players.find(x => x.steamid === steamid)
  if (!p) return <div className="page"><div className="tag tag-red">Player not found</div></div>

  const playerNames: Record<string, string> = {}
  for (const pl of data.players) playerNames[pl.steamid] = pl.name

  function renderContent() {
    if (!analytics || !key) return null
    switch (key) {
      case 'openingWinPct':
        return <OpeningWinPctPage analytics={analytics} playerNames={playerNames} steamid={steamid!} lang={lang} />
      case 'idealStrafePct':
        return <IdealStrafePctPage analytics={analytics} playerNames={playerNames} lang={lang} />
      case 'counterStrafeErrors':
        return <CounterStrafeErrorsPage analytics={analytics} playerNames={playerNames} lang={lang} />
      case 'shiftPeekPct':
      case 'isolatedPct':
        return <DisciplinePage analytics={analytics} playerNames={playerNames} lang={lang} />
      case 'lostDuels':
        return <LostDuelsPage analytics={analytics} playerNames={playerNames} lang={lang} />
      default:
        return <GenericMetricPage analytics={analytics} playerNames={playerNames} metricKey={key} lang={lang} />
    }
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          className="btn-ghost"
          style={{ fontSize: 12 }}
          onClick={() => nav(`/match/${id}/player/${steamid}`)}
        >
          ← {p.name}
        </button>
      </div>
      <div className="card">
        {renderContent()}
      </div>
    </div>
  )
}
