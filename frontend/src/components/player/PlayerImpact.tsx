import { useState } from 'react'
import { PlayerImpact as PlayerImpactData, SeriesPoint, DuelEpisode, PlayerData, DecisionEntry } from '../../api'
import EpisodeDrillDown from './EpisodeDrillDown'

const ERROR_META: Record<string, { ru: string; en: string; color: string; icon: string }> = {
  shift_peek:    { ru: 'Пик на шифте',             en: 'Shift peek',           color: 'var(--accent2)', icon: '🚶' },
  moving_shot:   { ru: 'Движение при стрельбе',    en: 'Moving shot',          color: 'var(--red)',     icon: '🏃' },
  isolated:      { ru: 'Игра в изоляции',          en: 'Playing isolated',     color: 'var(--accent)',  icon: '🔇' },
  flashed:       { ru: 'Вышел на флеше',           en: 'Entered flashed',      color: 'var(--accent2)', icon: '🌟' },
  strong_duel:   { ru: 'Сильная дуэль',            en: 'Strong duel',          color: 'var(--green)',   icon: '💪' },
  overshoot:     { ru: 'Перелёт прицела',          en: 'Aim overshoot',        color: 'var(--red)',     icon: '→' },
  undershoot:    { ru: 'Недолёт прицела',          en: 'Aim undershoot',       color: 'var(--accent2)', icon: '←' },
  missed_first:  { ru: 'Неточный первый выстрел',  en: 'Inaccurate 1st shot',  color: 'var(--accent)',  icon: '✗' },
  passive_angle: { ru: 'Пассивный угол',           en: 'Passive angle',        color: 'var(--text2)',   icon: '⏸' },
  moving:        { ru: 'Движение (жертва)',         en: 'Moving (victim)',      color: 'var(--text2)',   icon: '🏃' },
  outnumbered:   { ru: 'В меньшинстве',            en: 'Outnumbered',          color: 'var(--text2)',   icon: '⚠️' },
}

function ImpRound({ n, imp, positive }: { n: number; imp: number; positive: boolean }) {
  const color = positive ? 'var(--green)' : 'var(--red)'
  return (
    <div style={{
      background: 'var(--bg3)', borderRadius: 6, padding: '6px 12px',
      display: 'flex', alignItems: 'center', gap: 8, minWidth: 110,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text2)' }}>R{n}</div>
      <div style={{ fontWeight: 800, color, fontSize: 15 }}>
        {imp > 0 ? '+' : ''}{imp.toFixed(1)}
      </div>
    </div>
  )
}

function ImpBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.abs(value) / max * 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 700, color }}>{value > 0 ? '+' : ''}{value.toFixed(2)}</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .3s' }} />
      </div>
    </div>
  )
}

function UtilMetricCard({
  label, value, rating, color,
}: {
  label: string; value: string; rating: string; color: string
}) {
  return (
    <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color }}>{rating}</div>
    </div>
  )
}

interface Props {
  impact: PlayerImpactData
  series: SeriesPoint[]
  duels: DuelEpisode[]
  decisionsCost: DecisionEntry[]
  playerNames: Record<string, string>
  lang: 'ru' | 'en'
  allPlayers?: PlayerData[]
  playerData?: PlayerData
  currentSteamid?: string
}

function ratingLabel(value: number, goodAbove: number, lang: 'ru' | 'en'): { text: string; color: string } {
  if (value >= goodAbove * 1.3) return { text: lang === 'ru' ? 'ОТЛИЧНО' : 'GREAT',  color: 'var(--green)' }
  if (value >= goodAbove)       return { text: lang === 'ru' ? 'ХОРОШО'  : 'GOOD',   color: '#7ec8e3' }
  if (value >= goodAbove * 0.6) return { text: lang === 'ru' ? 'СРЕДНЕЕ' : 'AVG',    color: 'var(--text2)' }
  return                               { text: lang === 'ru' ? 'СЛАБО'   : 'WEAK',   color: 'var(--red)' }
}

export default function PlayerImpact({ impact, series, duels, decisionsCost, playerNames, lang, allPlayers, playerData, currentSteamid }: Props) {
  const [drillDuel, setDrillDuel] = useState<DuelEpisode | null>(null)

  const totalImp = series.length
    ? series.reduce((s, r) => s + r.imp, 0) / series.length
    : 0
  const impPerRound = series.map(r => r.imp)
  const maxAbs = Math.max(...impPerRound.map(Math.abs), 1)

  const posCount = impPerRound.filter(v => v > 0).length
  const negCount = impPerRound.filter(v => v < 0).length
  const posSum   = impPerRound.filter(v => v > 0).reduce((a, b) => a + b, 0)
  const negSum   = impPerRound.filter(v => v < 0).reduce((a, b) => a + b, 0)

  // ── ЦЕНА РЕШЕНИЙ: error pattern breakdown ──────────────────────────
  const wonDuels = duels.filter(d => d.won)
  const errorGroups: Record<string, DuelEpisode[]> = {}
  for (const d of wonDuels) {
    for (const e of d.errors) {
      if (e === 'strong_duel') continue
      if (!errorGroups[e]) errorGroups[e] = []
      errorGroups[e].push(d)
    }
  }
  const totalErrors = Object.values(errorGroups).reduce((s, g) => s + g.length, 0)
  const sortedErrors = Object.entries(errorGroups).sort((a, b) => b[1].length - a[1].length)
  const mainHabit = sortedErrors[0]

  // ── КАЧЕСТВО ДУЭЛЕЙ: utility metrics from duels ────────────────────
  const totalWon  = duels.filter(d => d.won).length
  const totalLost = duels.filter(d => !d.won).length

  const shiftPeekPct = wonDuels.length
    ? Math.round(wonDuels.filter(d => d.errors.includes('shift_peek')).length / wonDuels.length * 100)
    : 0
  const isolatedPct = wonDuels.length
    ? Math.round(wonDuels.filter(d => d.errors.includes('isolated')).length / wonDuels.length * 100)
    : 0
  const movingPct = wonDuels.length
    ? Math.round(wonDuels.filter(d => d.errors.includes('moving_shot')).length / wonDuels.length * 100)
    : 0
  const flashedPct = wonDuels.length
    ? Math.round(wonDuels.filter(d => d.errors.includes('flashed')).length / wonDuels.length * 100)
    : 0

  // В КАКИЕ ДУЭЛИ ПОПАДАЕШЬ — win% context when entering duels (all duels)
  const duelsWithProb = duels.filter(d => d.winProb != null)
  const avgProbEntering = duelsWithProb.length > 0
    ? duelsWithProb.reduce((s, d) => s + d.winProb!, 0) / duelsWithProb.length
    : null
  // КАК ИХ РЕАЛИЗУЕШЬ — actual win rate vs expected
  const actualWinRate = duels.length > 0 ? totalWon / duels.length : null

  // lost without any trade context = "dangerous losses"
  const lostDuels = duels.filter(d => !d.won)
  // prefer win-prob based; fallback to isolation filter if no prob data
  const hasDuelProbs = duels.some(d => d.winProb != null)
  const lostNoChance = hasDuelProbs
    ? lostDuels.filter(d => d.winProb != null && d.winProb < 0.35)
    : lostDuels.filter(d => d.context.aliveAllies === 0 || (d.context.nearAllyDist !== null && d.context.nearAllyDist > 800))
  const wonUnfavorable = hasDuelProbs
    ? wonDuels.filter(d => d.winProb != null && d.winProb < 0.40)
    : []
  const wonClean = wonDuels.filter(d => d.errors.length === 0 || d.errors[0] === 'strong_duel')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── ВКЛАД В ПОБЕДУ ── */}
      <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '14px 18px' }}>
        <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.06em', marginBottom: 12 }}>
          {lang === 'ru' ? 'Вклад в победу' : 'Impact contribution'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 2 }}>
              {lang === 'ru' ? 'Средний IMP' : 'Avg IMP'}
            </div>
            <div style={{
              fontSize: 36, fontWeight: 900, lineHeight: 1,
              color: totalImp > 0 ? 'var(--green)' : totalImp < 0 ? 'var(--red)' : 'var(--text2)',
            }}>
              {totalImp > 0 ? '+' : ''}{totalImp.toFixed(2)}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <div>
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>{posCount}</span>
              <span style={{ color: 'var(--text2)' }}> {lang === 'ru' ? 'положит. раундов' : 'positive rounds'}</span>
            </div>
            <div>
              <span style={{ color: 'var(--red)', fontWeight: 700 }}>{negCount}</span>
              <span style={{ color: 'var(--text2)' }}> {lang === 'ru' ? 'отрицат. раундов' : 'negative rounds'}</span>
            </div>
          </div>
        </div>
        <ImpBar
          label={lang === 'ru' ? 'Сумма положительного IMP' : 'Positive IMP total'}
          value={posSum} max={maxAbs * series.length} color="var(--green)"
        />
        <ImpBar
          label={lang === 'ru' ? 'Сумма отрицательного IMP' : 'Negative IMP total'}
          value={negSum} max={maxAbs * series.length} color="var(--red)"
        />
      </div>

      {/* ── IMP sparkline ── */}
      {series.length > 0 && (
        <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 10 }}>
            {lang === 'ru' ? 'IMP по раундам' : 'IMP by round'}
          </div>
          <svg width="100%" height={60} style={{ overflow: 'visible' }}>
            {series.map((s, i) => {
              const x = (i / (series.length - 1 || 1)) * 100
              const barH = Math.min(28, Math.abs(s.imp) / (maxAbs || 1) * 28)
              const color = s.imp > 0 ? 'var(--green)' : s.imp < 0 ? 'var(--red)' : 'var(--text2)'
              const y = s.imp >= 0 ? 30 - barH : 30
              return (
                <rect key={s.n} x={`${x - 0.4}%`} y={y} width="0.8%" height={barH || 2}
                  fill={color} opacity={0.85}>
                  <title>R{s.n}: {s.imp > 0 ? '+' : ''}{s.imp.toFixed(2)}</title>
                </rect>
              )
            })}
            <line x1="0" y1={30} x2="100%" y2={30} stroke="var(--border)" strokeWidth={1} />
          </svg>
        </div>
      )}

      {/* ── top/bottom rounds ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--green)', marginBottom: 8 }}>
            {lang === 'ru' ? '🔥 Лучшие раунды' : '🔥 Best rounds'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {impact.topRoundsPositive.length
              ? impact.topRoundsPositive.map(r => <ImpRound key={r.n} n={r.n} imp={r.imp} positive />)
              : <span style={{ fontSize: 12, color: 'var(--text2)' }}>—</span>}
          </div>
        </div>
        <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>
            {lang === 'ru' ? '❌ Худшие раунды' : '❌ Worst rounds'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {impact.topRoundsNegative.length
              ? impact.topRoundsNegative.map(r => <ImpRound key={r.n} n={r.n} imp={r.imp} positive={false} />)
              : <span style={{ fontSize: 12, color: 'var(--text2)' }}>—</span>}
          </div>
        </div>
      </div>

      {/* ── ЦЕНА РЕШЕНИЙ ── */}
      {(decisionsCost.length > 0 || sortedErrors.length > 0) && (
        <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.06em', marginBottom: 12 }}>
            {lang === 'ru' ? 'Цена решений' : 'Decision cost'}
          </div>

          {/* WinProb delta cards */}
          {decisionsCost.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {mainHabit && (
                <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 8 }}>
                  {lang === 'ru'
                    ? `Главная привычка: «${ERROR_META[mainHabit[0]]?.ru ?? mainHabit[0]}» — ${Math.round(mainHabit[1].length / totalErrors * 100)}% дорогих ошибок`
                    : `Main habit: "${ERROR_META[mainHabit[0]]?.en ?? mainHabit[0]}" — ${Math.round(mainHabit[1].length / totalErrors * 100)}% of costly errors`}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {decisionsCost.map((entry, i) => {
                  const beforePct = Math.round(entry.probBefore * 100)
                  const afterPct = Math.round(entry.probAfter * 100)
                  const drop = Math.round(entry.drop * 100)
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: 'var(--bg2)', borderRadius: 6, padding: '7px 10px',
                    }}>
                      <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 52 }}>
                        {lang === 'ru' ? 'Раунд' : 'Round'} {entry.round}
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--green)', fontSize: 13, minWidth: 36 }}>
                        {beforePct}%
                      </span>
                      <span style={{ color: 'var(--text2)', fontSize: 12 }}>→</span>
                      <span style={{ fontWeight: 700, color: 'var(--red)', fontSize: 13, minWidth: 36 }}>
                        {afterPct}%
                      </span>
                      <div style={{ flex: 1, height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(drop * 2, 100)}%`, height: '100%', background: 'var(--red)', borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--red)', minWidth: 36, textAlign: 'right' }}>
                        −{drop}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* error pattern breakdown */}
          {sortedErrors.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sortedErrors.map(([key, grpDuels]) => {
                const m = ERROR_META[key]
                if (!m) return null
                const pct = totalErrors > 0 ? Math.round(grpDuels.length / totalErrors * 100) : 0
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                    onClick={() => setDrillDuel(grpDuels[0])}>
                    <span style={{ fontSize: 14 }}>{m.icon}</span>
                    <span style={{ flex: 1, fontSize: 12, color: m.color }}>{lang === 'ru' ? m.ru : m.en}</span>
                    <span style={{ fontSize: 11, color: 'var(--text2)' }}>{grpDuels.length}×</span>
                    <div style={{ width: 80, height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: m.color, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 11, color: m.color, minWidth: 32, textAlign: 'right' }}>{pct}%</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── КАЧЕСТВО ДУЭЛЕЙ ── */}
      <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.06em', marginBottom: 12 }}>
          {lang === 'ru' ? 'Качество дуэлей' : 'Duel quality'}
        </div>
        {/* В КАКИЕ ДУЭЛИ ПОПАДАЕШЬ / КАК ИХ РЕАЛИЗУЕШЬ */}
        {avgProbEntering != null && actualWinRate != null && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div style={{ background: 'var(--bg2)', borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                {lang === 'ru' ? 'В какие дуэли попадаешь' : 'Duels you enter'}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text1)' }}>
                {Math.round(avgProbEntering * 100)}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                {lang === 'ru' ? `средний шанс победы (${duelsWithProb.length} дуэлей)` : `avg win chance (${duelsWithProb.length} duels)`}
              </div>
            </div>
            <div style={{ background: 'var(--bg2)', borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                {lang === 'ru' ? 'Как их реализуешь' : 'How you convert'}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: actualWinRate >= avgProbEntering ? 'var(--green)' : 'var(--red)' }}>
                {totalWon}/{duels.length}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                {Math.round(actualWinRate * 100)}%{' '}
                <span style={{ color: actualWinRate >= avgProbEntering ? 'var(--green)' : 'var(--red)' }}>
                  ({actualWinRate >= avgProbEntering ? '+' : ''}{Math.round((actualWinRate - avgProbEntering) * 100)}% {lang === 'ru' ? 'от ожидаемого' : 'vs expected'})
                </span>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: 14 }}>
          {(() => {
            const r1 = ratingLabel(totalWon / (duels.length || 1) * 100, 50, lang)
            const r2 = ratingLabel(100 - shiftPeekPct, 70, lang)
            const r3 = ratingLabel(100 - isolatedPct, 70, lang)
            const r4 = ratingLabel(100 - movingPct, 70, lang)
            const items: { label: string; value: string; r: { text: string; color: string } }[] = [
              { label: lang === 'ru' ? 'Выиграно дуэлей' : 'Duels won', value: `${totalWon}/${duels.length}`, r: r1 },
              { label: lang === 'ru' ? 'Без шифт-пика'   : 'No shift-peek', value: `${100 - shiftPeekPct}%`, r: r2 },
              { label: lang === 'ru' ? 'Не изолирован'   : 'Not isolated',  value: `${100 - isolatedPct}%`,  r: r3 },
              { label: lang === 'ru' ? 'Стоя при стрельбе' : 'Still when shooting', value: `${100 - movingPct}%`, r: r4 },
            ]
            return items.map(({ label, value, r }) => (
              <UtilMetricCard key={label} label={label} value={value} rating={r.text} color={r.color} />
            ))
          })()}
        </div>

        {/* ПРОИГРАЛ БЕЗ ШАНСОВ */}
        {lostNoChance.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, marginBottom: 6 }}>
              {lang === 'ru' ? '❌ Проиграл без шансов' : '❌ Lost without a chance'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {lostNoChance.slice(0, 8).map((d, i) => (
                <button key={i} onClick={() => setDrillDuel(d)}
                  style={{ background: 'var(--bg2)', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}>
                  R{d.round}{d.winProb != null ? ` [${Math.round(d.winProb * 100)}%]` : ''}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ВЫТАЩИЛ НЕВЫГОДНЫЕ */}
        {wonUnfavorable.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--accent2)', fontWeight: 700, marginBottom: 6 }}>
              {lang === 'ru' ? '🏆 Вытащил невыгодные' : '🏆 Won despite bad odds'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {wonUnfavorable.slice(0, 8).map((d, i) => (
                <button key={i} onClick={() => setDrillDuel(d)}
                  style={{ background: 'var(--bg2)', border: '1px solid var(--accent2)', color: 'var(--accent2)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}>
                  R{d.round}{d.winProb != null ? ` [${Math.round(d.winProb * 100)}%]` : ''}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ВЫТАЩИЛ ЧИСТЫЕ */}
        {wonClean.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, marginBottom: 6 }}>
              {lang === 'ru' ? '✅ Чистые победы' : '✅ Clean wins'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {wonClean.slice(0, 6).map((d, i) => (
                <button key={i} onClick={() => setDrillDuel(d)}
                  style={{ background: 'var(--bg2)', border: '1px solid var(--green)', color: 'var(--green)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}>
                  R{d.round}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── ЛОББИ-ТАБЛИЦА ── */}
      {allPlayers && allPlayers.length > 0 && (() => {
        const sorted = [...allPlayers].sort((a, b) => b.imp - a.imp)
        const maxImpAbs = Math.max(...sorted.map(p => Math.abs(p.imp)), 0.01)
        return (
          <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.06em', marginBottom: 12 }}>
              {lang === 'ru' ? 'Игроки лобби по IMP' : 'Lobby players by IMP'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sorted.map((pl, i) => {
                const isCurrent = pl.steamid === currentSteamid
                const barPct = Math.abs(pl.imp) / maxImpAbs * 100
                const color = pl.imp >= 0 ? 'var(--green)' : 'var(--red)'
                return (
                  <div key={pl.steamid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 5, background: isCurrent ? 'rgba(100,180,255,0.08)' : 'transparent' }}>
                    <span style={{ fontSize: 10, color: 'var(--text2)', minWidth: 14, textAlign: 'right' }}>{i + 1}</span>
                    <span style={{ fontSize: 12, flex: 1, fontWeight: isCurrent ? 700 : 400, color: isCurrent ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }}>
                      {pl.name}
                    </span>
                    <div style={{ flex: 2, height: 6, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${barPct}%`, height: '100%', background: color, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {pl.imp > 0 ? '+' : ''}{pl.imp.toFixed(2)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── УТИЛИТА ── */}
      {playerData && (() => {
        const pd = playerData
        const kills  = pd.kills  || 1
        const deaths = pd.deaths || 1
        const thrown = pd.flashes.thrown || 1

        const tradeKillPct   = Math.round(pd.trades.tradeKills  / kills  * 100)
        const tradedDeathPct = Math.round(pd.trades.tradedDeaths / deaths * 100)
        const openingWinPct  = pd.opening.attempts > 0
          ? Math.round((pd.opening.kills / pd.opening.attempts) * 100) : 0
        const flashHitPct    = Math.round(pd.flashes.enemiesFlashed / thrown * 100)

        function grade(value: number, goodAbove: number): { text: string; color: string } {
          if (value >= goodAbove * 1.3) return { text: lang === 'ru' ? 'ОТЛИЧНО' : 'GREAT',  color: 'var(--green)' }
          if (value >= goodAbove)       return { text: lang === 'ru' ? 'ХОРОШО'  : 'GOOD',   color: '#7ec8e3' }
          if (value >= goodAbove * 0.6) return { text: lang === 'ru' ? 'СРЕДНЕЕ' : 'AVG',    color: 'var(--text2)' }
          return                               { text: lang === 'ru' ? 'СЛАБО'   : 'WEAK',   color: 'var(--red)' }
        }

        const cards = [
          { label: lang === 'ru' ? 'Трейд-киллы'   : 'Trade kills',    value: `${tradeKillPct}%`,   g: grade(tradeKillPct, 20) },
          { label: lang === 'ru' ? 'Смерти с трейд' : 'Traded deaths',  value: `${tradedDeathPct}%`, g: grade(tradedDeathPct, 20) },
          { label: lang === 'ru' ? 'Win% открывашки' : 'Opening win%',  value: `${openingWinPct}%`,  g: grade(openingWinPct, 50) },
          { label: lang === 'ru' ? 'Урон утилитой'  : 'Util damage',    value: `${pd.utilDmg}`,      g: grade(pd.utilDmg, 80) },
          { label: lang === 'ru' ? 'Flash попадания' : 'Flash hit%',     value: `${flashHitPct}%`,    g: grade(flashHitPct, 40) },
        ]

        return (
          <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.06em', marginBottom: 12 }}>
              {lang === 'ru' ? 'Утилита и открывашки' : 'Utility & opening'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
              {cards.map(({ label, value, g }) => (
                <UtilMetricCard key={label} label={label} value={value} rating={g.text} color={g.color} />
              ))}
            </div>
          </div>
        )
      })()}

      {/* drill-down modal */}
      {drillDuel && (
        <EpisodeDrillDown
          duel={drillDuel}
          playerNames={playerNames}
          lang={lang}
          onClose={() => setDrillDuel(null)}
        />
      )}
    </div>
  )
}
