import { useState } from 'react'
import { PlayerMetrics, DuelEpisode } from '../../api'
import EpisodeDrillDown from './EpisodeDrillDown'

const ERROR_LABELS: Record<string, { ru: string; en: string; color: string; icon: string }> = {
  shift_peek:   { ru: 'Пик на шифте',         en: 'Shift peek',       color: 'var(--accent2)', icon: '🚶' },
  moving_shot:  { ru: 'Движение при стрельбе', en: 'Moving shot',      color: 'var(--red)',     icon: '🏃' },
  isolated:     { ru: 'Игра в изоляции',       en: 'Playing isolated', color: 'var(--accent)',  icon: '🔇' },
  flashed:      { ru: 'Вышел на флеше',        en: 'Entered flashed',  color: 'var(--accent2)', icon: '🌟' },
  strong_duel:  { ru: 'Сильная дуэль',         en: 'Strong duel',      color: 'var(--green)',   icon: '💪' },
}

function ratingLabel(value: number, goodAbove: number, lang: 'ru' | 'en'): { text: string; color: string } {
  if (value >= goodAbove * 1.2) return { text: lang === 'ru' ? 'ОТЛИЧНО' : 'GREAT',  color: 'var(--green)' }
  if (value >= goodAbove)       return { text: lang === 'ru' ? 'ХОРОШО' : 'GOOD',   color: '#7ec8e3' }
  if (value >= goodAbove * 0.6) return { text: lang === 'ru' ? 'СРЕДНЕЕ' : 'AVG',   color: 'var(--text2)' }
  return                               { text: lang === 'ru' ? 'СЛАБО'  : 'WEAK',   color: 'var(--red)' }
}

interface MetricCardProps {
  label: string
  value: string
  sub?: string
  rating?: { text: string; color: string }
  color?: string
  onClick?: () => void
}

function MetricCard({ label, value, sub, rating, color, onClick }: MetricCardProps) {
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
        {rating && (
          <span style={{ fontSize: 10, fontWeight: 700, color: rating.color }}>
            {rating.text}
          </span>
        )}
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
  const [drillDownDuels, setDrillDownDuels] = useState<DuelEpisode[] | null>(null)
  const [drillDownTitle, setDrillDownTitle] = useState('')
  const [drillIdx, setDrillIdx] = useState(0)

  const mp = metrics.mainProblem
  const mpInfo = mp ? ERROR_LABELS[mp] : null

  // count error types for "Дуэли" sub-section
  const movingShotPct = (() => {
    const won = duels.filter(d => d.won)
    if (!won.length) return 0
    return Math.round(won.filter(d => d.errors.includes('moving_shot')).length / won.length * 100)
  })()

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
            rating={ratingLabel(metrics.openingWinPct, 50, lang)}
            color={metrics.openingWinPct >= 50 ? 'var(--green)' : 'var(--red)'}
            onClick={() => openDrill('won', lang === 'ru' ? 'Выигранные дуэли' : 'Won duels')}
          />
          <MetricCard
            label={lang === 'ru' ? 'Трейд-килы' : 'Trade Kills'}
            value={metrics.tradeKillPct.toFixed(1) + '%'}
            sub={lang === 'ru' ? '% убийств — трейд' : '% of kills are trades'}
            rating={ratingLabel(metrics.tradeKillPct, 20, lang)}
          />
          <MetricCard
            label={lang === 'ru' ? 'Трейд-смерти' : 'Traded Deaths'}
            value={metrics.tradedDeathPct.toFixed(1) + '%'}
            sub={lang === 'ru' ? '% смертей отомщены' : '% deaths avenged'}
            rating={ratingLabel(metrics.tradedDeathPct, 25, lang)}
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
            rating={ratingLabel(metrics.clutchWinPct, 30, lang)}
            color={metrics.clutchWinPct >= 30 ? 'var(--accent2)' : undefined}
          />
          <MetricCard
            label={lang === 'ru' ? 'Эфф. флешек' : 'Flash Efficiency'}
            value={metrics.flashEfficiency.toFixed(1) + '%'}
            sub={lang === 'ru' ? '% флешек эффективны' : '% flashes effective'}
            rating={ratingLabel(metrics.flashEfficiency, 40, lang)}
            color={metrics.flashEfficiency >= 40 ? 'var(--green)' : undefined}
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
            { key: 'shift_peek',  pct: metrics.shiftPeekPct },
            { key: 'isolated',    pct: metrics.isolatedPct },
            { key: 'moving_shot', pct: movingShotPct },
          ].filter(({ pct }) => pct > 0).map(({ key }) => {
            const m = ERROR_LABELS[key]
            return (
              <button
                key={key}
                onClick={() => openDrill(key, lang === 'ru' ? m.ru : m.en)}
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
