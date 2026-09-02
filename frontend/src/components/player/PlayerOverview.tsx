import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { PlayerMetrics, DuelEpisode } from '../../api'
import { useBenchmarks } from '../../App'
import { getTier, TIER_COLORS, TIER_LABELS, formatTierTooltip } from '../../benchmarkUtils'
import EpisodeDrillDown from './EpisodeDrillDown'

const ERROR_LABELS: Record<string, { ru: string; en: string; color: string; icon: string }> = {
  shift_peek:   { ru: 'Пик на шифте',         en: 'Shift peek',       color: 'var(--accent2)', icon: '🚶' },
  moving_shot:  { ru: 'Движение при стрельбе', en: 'Moving shot',      color: 'var(--red)',     icon: '🏃' },
  isolated:     { ru: 'Игра в изоляции',       en: 'Playing isolated', color: 'var(--accent)',  icon: '🔇' },
  flashed:      { ru: 'Вышел на флеше',        en: 'Entered flashed',  color: 'var(--accent2)', icon: '🌟' },
  strong_duel:  { ru: 'Сильная дуэль',         en: 'Strong duel',      color: 'var(--green)',   icon: '💪' },
}

interface BenchmarkBadgeProps {
  metricKey: string
  value: number | null | undefined
  lang: 'ru' | 'en'
  higherIsBetter?: boolean
}

function BenchmarkBadge({ metricKey, value, lang, higherIsBetter = true }: BenchmarkBadgeProps) {
  const benchmarks = useBenchmarks()
  const [showTip, setShowTip] = useState(false)
  if (value == null) return null
  const tier = getTier(benchmarks, metricKey, value, higherIsBetter)
  if (!tier) return null
  const color = TIER_COLORS[tier]
  const label = TIER_LABELS[tier][lang]
  const tiers = benchmarks[metricKey]
  const tip = tiers ? formatTierTooltip(tiers, value, lang, higherIsBetter) : label
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <span style={{
        fontSize: 10, fontWeight: 700, color, background: `${color}22`,
        borderRadius: 4, padding: '2px 6px', cursor: 'default', letterSpacing: '.04em',
      }}>
        {label}
      </span>
      {showTip && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '6px 10px', fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap',
          zIndex: 100, marginBottom: 4, boxShadow: '0 4px 12px rgba(0,0,0,.5)',
          lineHeight: 1.6,
        }}>
          {tip.split(' · ').map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </span>
  )
}

interface MetricCardProps {
  label: string
  value: string
  sub?: string
  rating?: { text: string; color: string }
  benchmarkKey?: string
  benchmarkValue?: number | null
  lang?: 'ru' | 'en'
  color?: string
  onClick?: () => void
  higherIsBetter?: boolean
}

function MetricCard({ label, value, sub, rating, benchmarkKey, benchmarkValue, lang = 'ru', color, onClick, higherIsBetter = true }: MetricCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 4,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background .15s',
        border: '1px solid transparent',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent' }}
    >
      <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? 'var(--text)', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {benchmarkKey != null && benchmarkValue != null
          ? <BenchmarkBadge metricKey={benchmarkKey} value={benchmarkValue} lang={lang} higherIsBetter={higherIsBetter} />
          : rating && (
            <span style={{ fontSize: 10, fontWeight: 700, color: rating.color }}>
              {rating.text}
            </span>
          )
        }
        {sub && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{sub}</div>}
      </div>
    </div>
  )
}

function ProbBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 700, color }}>{value.toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, value)}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .3s' }} />
      </div>
    </div>
  )
}

interface Props {
  metrics: PlayerMetrics
  duels: DuelEpisode[]
  playerNames: Record<string, string>
  lang: 'ru' | 'en'
}

export default function PlayerOverview({ metrics, duels, playerNames, lang }: Props) {
  const { id, steamid } = useParams<{ id: string; steamid: string }>()
  const nav = useNavigate()
  const [drillDownDuels, setDrillDownDuels] = useState<DuelEpisode[] | null>(null)
  const [drillDownTitle, setDrillDownTitle] = useState('')
  const [drillIdx, setDrillIdx] = useState(0)

  const mp = metrics.mainProblem
  const mpInfo = mp ? ERROR_LABELS[mp] : null

  const movingShotPct = (() => {
    const won = duels.filter(d => d.won)
    if (!won.length) return 0
    return Math.round(won.filter(d => d.errors.includes('moving_shot')).length / won.length * 100)
  })()

  function goMetric(key: string) {
    nav(`/match/${id}/player/${steamid}/metrics/${key}`)
  }

  function openDrill(filter: string, title: string) {
    const filtered = filter === 'won'
      ? duels.filter(d => d.won)
      : filter === 'lost'
        ? duels.filter(d => !d.won)
        : duels.filter(d => d.errors.includes(filter))
    if (filtered.length) {
      setDrillDownDuels(filtered)
      setDrillDownTitle(title)
      setDrillIdx(0)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* main problem banner */}
      {mpInfo && (
        <div style={{
          background: 'var(--bg3)', border: `2px solid ${mpInfo.color}`,
          borderRadius: 8, padding: '12px 18px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 22 }}>{mpInfo.icon}</span>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>
              {lang === 'ru' ? 'Главная проблема' : 'Main issue'}
            </div>
            <div style={{ fontWeight: 800, fontSize: 15, color: mpInfo.color }}>
              {lang === 'ru' ? mpInfo.ru : mpInfo.en}
            </div>
          </div>
        </div>
      )}

      {/* ── Group: Открывашки & Трейды ── */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
          {lang === 'ru' ? 'Открывашки & Трейды' : 'Opening & Trades'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
          <MetricCard
            label={lang === 'ru' ? 'Открывашки Win%' : 'Opening Win%'}
            value={metrics.openingWinPct.toFixed(1) + '%'}
            benchmarkKey="openingWinPct" benchmarkValue={metrics.openingWinPct} lang={lang}
            color={metrics.openingWinPct >= 50 ? 'var(--green)' : 'var(--red)'}
            onClick={() => goMetric('openingWinPct')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Трейд-килы' : 'Trade Kills'}
            value={metrics.tradeKillPct.toFixed(1) + '%'}
            sub={lang === 'ru' ? '% убийств — трейд' : '% of kills are trades'}
            benchmarkKey="tradeKillPct" benchmarkValue={metrics.tradeKillPct} lang={lang}
            onClick={() => goMetric('tradeKillPct')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Трейд-смерти' : 'Traded Deaths'}
            value={metrics.tradedDeathPct.toFixed(1) + '%'}
            sub={lang === 'ru' ? '% смертей отомщены' : '% deaths avenged'}
            benchmarkKey="tradedDeathPct" benchmarkValue={metrics.tradedDeathPct} lang={lang}
            onClick={() => goMetric('tradedDeathPct')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Проигранные дуэли' : 'Lost Duels'}
            value={String(duels.filter(d => !d.won).length)}
            sub={lang === 'ru' ? 'смертей в дуэлях' : 'deaths in duels'}
            onClick={() => goMetric('lostDuels')}
          />
        </div>
      </div>

      {/* ── Group: Клатчи & Утилита ── */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
          {lang === 'ru' ? 'Клатчи & Утилита' : 'Clutches & Utility'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
          <MetricCard
            label={lang === 'ru' ? 'Клатч Win%' : 'Clutch Win%'}
            value={metrics.clutchWinPct.toFixed(1) + '%'}
            benchmarkKey="clutchWinPct" benchmarkValue={metrics.clutchWinPct} lang={lang}
            color={metrics.clutchWinPct >= 30 ? 'var(--accent2)' : undefined}
            onClick={() => goMetric('clutchWinPct')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Эфф. флешек' : 'Flash Efficiency'}
            value={metrics.flashEfficiency.toFixed(1) + '%'}
            sub={lang === 'ru' ? '% флешек эффективны' : '% flashes effective'}
            benchmarkKey="flashEfficiency" benchmarkValue={metrics.flashEfficiency} lang={lang}
            color={metrics.flashEfficiency >= 40 ? 'var(--green)' : undefined}
            onClick={() => goMetric('flashEfficiency')}
          />
        </div>
      </div>

      {/* ── Group: Механика дуэли и аим ── */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
          {lang === 'ru' ? 'Механика дуэли и аим' : 'Duel mechanics & aim'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
          <MetricCard
            label={lang === 'ru' ? 'Ошибки контрстрейфа' : 'Counter-strafe errors'}
            value={String(metrics.counterStrafeErrors ?? 0)}
            sub={lang === 'ru' ? 'выстрелов в движении' : 'shots while moving'}
            benchmarkKey="counterStrafeErrors" benchmarkValue={metrics.counterStrafeErrors ?? 0} lang={lang}
            higherIsBetter={false}
            onClick={() => goMetric('counterStrafeErrors')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Идеальные стрейфы' : 'Ideal strafes'}
            value={(metrics.idealStrafePct ?? 0).toFixed(1) + '%'}
            sub={lang === 'ru' ? '% килов на стопе' : '% kills while stopped'}
            benchmarkKey="idealStrafePct" benchmarkValue={metrics.idealStrafePct} lang={lang}
            color={(metrics.idealStrafePct ?? 0) >= 60 ? 'var(--green)' : undefined}
            onClick={() => goMetric('idealStrafePct')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Точность первой пули' : 'First bullet acc'}
            value={(metrics.firstBulletAcc ?? 0).toFixed(1) + '%'}
            sub={lang === 'ru' ? '% первых выстрелов — попадание' : '% first shots hit'}
            benchmarkKey="firstBulletAcc" benchmarkValue={metrics.firstBulletAcc} lang={lang}
            color={(metrics.firstBulletAcc ?? 0) >= 40 ? 'var(--green)' : undefined}
            onClick={() => goMetric('firstBulletAcc')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Время до фрага' : 'Time to kill'}
            value={(metrics.ttk_ms ?? 0) > 0 ? (metrics.ttk_ms ?? 0).toFixed(0) + ' мс' : '—'}
            sub={lang === 'ru' ? 'ср. мс от выстрела до кила' : 'avg ms first shot to kill'}
            benchmarkKey="ttk_ms" benchmarkValue={(metrics.ttk_ms ?? 0) > 0 ? metrics.ttk_ms : null} lang={lang}
            higherIsBetter={false}
            onClick={() => goMetric('ttk_ms')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Контроль угла' : 'Angle control'}
            value={String(metrics.angleControlCount ?? 0)}
            sub={lang === 'ru' ? 'позиций удержано ≥2с' : 'positions held ≥2s'}
            benchmarkKey="angleControlCount" benchmarkValue={metrics.angleControlCount ?? 0} lang={lang}
            color={(metrics.angleControlCount ?? 0) >= 3 ? 'var(--green)' : undefined}
            onClick={() => goMetric('angleControlCount')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Перезарядки' : 'Reload errors'}
            value={String(metrics.reloadErrors ?? 0)}
            sub={lang === 'ru' ? 'перезарядок с патронами' : 'reloads with bullets left'}
            benchmarkKey="reloadErrors" benchmarkValue={metrics.reloadErrors ?? 0} lang={lang}
            higherIsBetter={false}
            onClick={() => goMetric('reloadErrors')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Время реакции' : 'Reaction time'}
            value={(metrics.reactionTimeMs ?? 0) > 0 ? (metrics.reactionTimeMs ?? 0).toFixed(0) + ' мс' : '—'}
            sub={lang === 'ru' ? 'ср. мс от появления врага до выстрела' : 'avg ms enemy in FOV to first shot'}
            benchmarkKey="reactionTimeMs" benchmarkValue={(metrics.reactionTimeMs ?? 0) > 0 ? metrics.reactionTimeMs : null} lang={lang}
            higherIsBetter={false}
            onClick={() => goMetric('reactionTimeMs')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Реакция в попаданиях' : 'Reaction on hits'}
            value={(metrics.successfulReactionTimeMs ?? 0) > 0 ? (metrics.successfulReactionTimeMs ?? 0).toFixed(0) + ' мс' : '—'}
            sub={lang === 'ru' ? 'мс реакции только когда первая пуля попала' : 'reaction ms only when first bullet hit'}
            benchmarkKey="reactionTimeMs" benchmarkValue={(metrics.successfulReactionTimeMs ?? 0) > 0 ? metrics.successfulReactionTimeMs : null} lang={lang}
            higherIsBetter={false}
            onClick={() => goMetric('successfulReactionTimeMs')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Промахи прицела' : 'Overshoot count'}
            value={String(metrics.overshootCount ?? 0)}
            sub={lang === 'ru' ? 'раз перевёл прицел мимо' : 'times aim crossed past enemy'}
            benchmarkKey="overshootCount" benchmarkValue={metrics.overshootCount ?? 0} lang={lang}
            higherIsBetter={false}
            onClick={() => goMetric('overshootCount')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Качественные контакты' : 'Excellent contacts'}
            value={String((metrics as any).excellentContacts ?? 0)}
            sub={lang === 'ru' ? 'килов: стоял + первая пуля попала' : 'kills: stopped + first bullet hit'}
            benchmarkKey="excellentContacts" benchmarkValue={(metrics as any).excellentContacts ?? 0} lang={lang}
            color={((metrics as any).excellentContacts ?? 0) >= 3 ? 'var(--green)' : undefined}
            onClick={() => goMetric('excellentContacts')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Прицел на голове' : 'Crosshair placement'}
            value={(metrics.crosshairPlacementPct ?? 0).toFixed(1) + '%'}
            sub={lang === 'ru' ? '% первых попаданий — в голову' : '% first-bullet hits to head'}
            benchmarkKey="crosshairPlacementPct" benchmarkValue={metrics.crosshairPlacementPct ?? 0} lang={lang}
            color={(metrics.crosshairPlacementPct ?? 0) >= 50 ? 'var(--green)' : undefined}
            onClick={() => goMetric('crosshairPlacementPct')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Неточный 1-й выстрел' : 'Missed 1st shot'}
            value={(() => {
              const wonDuels = duels.filter(d => d.won)
              const missed = wonDuels.filter(d => d.errors.includes('missed_first'))
              return wonDuels.length > 0 ? Math.round(missed.length / wonDuels.length * 100) + '%' : '—'
            })()}
            sub={lang === 'ru' ? '% побед без точного 1-го выстрела' : '% wins w/o accurate 1st shot'}
            lang={lang}
            higherIsBetter={false}
            onClick={() => goMetric('missedFirst')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Пассивный угол' : 'Passive angle'}
            value={String(metrics.passiveAngleCount ?? 0)}
            sub={lang === 'ru' ? 'раз стоял без движения перед выстрелом' : 'times stood still before shooting'}
            lang={lang}
            higherIsBetter={false}
            onClick={() => goMetric('passiveAngle')}
          />
        </div>
      </div>

      {/* ── Group: Дисциплина в дуэлях ── */}
      <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.06em', marginBottom: 14 }}>
          {lang === 'ru' ? 'Дисциплина в дуэлях' : 'Duel discipline'}
        </div>
        <ProbBar
          label={lang === 'ru' ? 'Шифт-пики' : 'Shift peeks'}
          value={metrics.shiftPeekPct}
          color={metrics.shiftPeekPct > 30 ? 'var(--accent2)' : 'var(--green)'}
        />
        <ProbBar
          label={lang === 'ru' ? 'Игра в изоляции' : 'Isolated plays'}
          value={metrics.isolatedPct}
          color={metrics.isolatedPct > 30 ? 'var(--red)' : 'var(--green)'}
        />
        <ProbBar
          label={lang === 'ru' ? 'Движение при стрельбе' : 'Shot while moving'}
          value={movingShotPct}
          color={movingShotPct > 30 ? 'var(--red)' : 'var(--green)'}
        />

        {/* clickable drill-down chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {[
            { key: 'shift_peek',  metricKey: 'shiftPeekPct',  pct: metrics.shiftPeekPct },
            { key: 'isolated',    metricKey: 'isolatedPct',    pct: metrics.isolatedPct },
            { key: 'moving_shot', metricKey: 'counterStrafeErrors', pct: movingShotPct },
          ].filter(({ pct }) => pct > 0).map(({ key, metricKey }) => {
            const m = ERROR_LABELS[key]
            return (
              <button
                key={key}
                onClick={() => goMetric(metricKey)}
                style={{
                  background: 'var(--bg2)', border: `1px solid ${m.color}`,
                  color: m.color, borderRadius: 4, padding: '3px 10px',
                  cursor: 'pointer', fontSize: 11,
                }}
              >
                {m.icon} {lang === 'ru' ? m.ru : m.en}
              </button>
            )
          })}
        </div>
      </div>

      {/* drill-down modal — cycles through filtered duels */}
      {drillDownDuels && drillDownDuels.length > 0 && (
        <div>
          {/* mini header showing N of M */}
          <div style={{
            position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1001, background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 20, padding: '6px 16px', fontSize: 12, color: 'var(--text2)',
            display: 'flex', gap: 12, alignItems: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,.5)',
          }}>
            <button
              onClick={() => setDrillIdx(i => Math.max(0, i - 1))}
              disabled={drillIdx === 0}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 16, opacity: drillIdx === 0 ? 0.3 : 1 }}
            >‹</button>
            <span>{drillIdx + 1} / {drillDownDuels.length} · {drillDownTitle}</span>
            <button
              onClick={() => setDrillIdx(i => Math.min(drillDownDuels.length - 1, i + 1))}
              disabled={drillIdx === drillDownDuels.length - 1}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 16, opacity: drillIdx === drillDownDuels.length - 1 ? 0.3 : 1 }}
            >›</button>
          </div>
          <EpisodeDrillDown
            duel={drillDownDuels[drillIdx]}
            playerNames={playerNames}
            lang={lang}
            onClose={() => setDrillDownDuels(null)}
          />
        </div>
      )}
    </div>
  )
}
