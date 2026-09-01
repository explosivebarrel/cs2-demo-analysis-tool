import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, PlayerAnalyticsData, DuelEpisode, AnalysisData, FirstBulletShot } from '../api'
import { useLang, useBenchmarks } from '../App'
import { getTier, TIER_COLORS, TIER_LABELS, formatTierTooltip } from '../benchmarkUtils'
import EpisodeDrillDown from '../components/player/EpisodeDrillDown'

type RoundOutcome = 'kill' | 'death' | 'draw' | 'none'

const WEAPON_NAMES: Record<string, { en: string; ru: string }> = {
  weapon_ak47:          { en: 'AK-47',         ru: 'АК-47' },
  weapon_m4a1:          { en: 'M4A1-S',        ru: 'M4A1-S' },
  weapon_m4a1_silencer: { en: 'M4A1-S',        ru: 'M4A1-S' },
  weapon_m4a4:          { en: 'M4A4',          ru: 'M4A4' },
  weapon_awp:           { en: 'AWP',           ru: 'AWP' },
  weapon_ssg08:         { en: 'SSG 08',        ru: 'Скаут' },
  weapon_sg553:         { en: 'SG 553',        ru: 'SG 553' },
  weapon_aug:           { en: 'AUG',           ru: 'AUG' },
  weapon_famas:         { en: 'FAMAS',         ru: 'FAMAS' },
  weapon_galil:         { en: 'Galil AR',      ru: 'Galil AR' },
  weapon_galilar:       { en: 'Galil AR',      ru: 'Galil AR' },
  weapon_p250:          { en: 'P250',          ru: 'P250' },
  weapon_usp_silencer:  { en: 'USP-S',         ru: 'USP-S' },
  weapon_glock:         { en: 'Glock-18',      ru: 'Глок' },
  weapon_hkp2000:       { en: 'P2000',         ru: 'P2000' },
  weapon_tec9:          { en: 'Tec-9',         ru: 'Tec-9' },
  weapon_cz75a:         { en: 'CZ75-Auto',     ru: 'CZ75' },
  weapon_deagle:        { en: 'Desert Eagle',  ru: 'Дигл' },
  weapon_revolver:      { en: 'R8 Revolver',   ru: 'R8' },
  weapon_elite:         { en: 'Dual Berettas', ru: 'Беретты' },
  weapon_fiveseven:     { en: 'Five-SeveN',    ru: 'Five-SeveN' },
  weapon_mp5sd:         { en: 'MP5-SD',        ru: 'MP5-SD' },
  weapon_mp7:           { en: 'MP7',           ru: 'MP7' },
  weapon_mp9:           { en: 'MP9',           ru: 'MP9' },
  weapon_mac10:         { en: 'MAC-10',        ru: 'MAC-10' },
  weapon_ump45:         { en: 'UMP-45',        ru: 'UMP-45' },
  weapon_p90:           { en: 'P90',           ru: 'P90' },
  weapon_bizon:         { en: 'PP-Bizon',      ru: 'Бизон' },
  weapon_nova:          { en: 'Nova',          ru: 'Nova' },
  weapon_sawedoff:      { en: 'Sawed-Off',     ru: 'Обрез' },
  weapon_xm1014:        { en: 'XM1014',        ru: 'XM1014' },
  weapon_mag7:          { en: 'MAG-7',         ru: 'MAG-7' },
  weapon_m249:          { en: 'M249',          ru: 'M249' },
  weapon_negev:         { en: 'Negev',         ru: 'Negev' },
  weapon_g3sg1:         { en: 'G3SG1',        ru: 'G3SG1' },
  weapon_scar20:        { en: 'SCAR-20',       ru: 'SCAR-20' },
}

function prettyWeapon(raw: string, lang: 'ru' | 'en'): string {
  const entry = WEAPON_NAMES[raw] ?? WEAPON_NAMES['weapon_' + raw]
  if (entry) return lang === 'ru' ? entry.ru : entry.en
  return raw.replace(/^weapon_/, '').replace(/_/g, ' ')
}

// ------------------------------------------------------------------ MetricHero

function MetricHero({ title, subtitle, value, metricKey, lang, higherIsBetter = true }: {
  title: string; subtitle?: string; value: string; metricKey: string; lang: 'ru' | 'en'; higherIsBetter?: boolean
}) {
  const benchmarks = useBenchmarks()
  const [showTip, setShowTip] = useState(false)
  const rawNum = parseFloat(value)
  const tier = isNaN(rawNum) ? null : getTier(benchmarks, metricKey, rawNum, higherIsBetter)
  const tiers = benchmarks[metricKey]
  const tip = tiers && !isNaN(rawNum) ? formatTierTooltip(tiers, rawNum, lang, higherIsBetter) : null
  const color = tier ? TIER_COLORS[tier] : 'var(--text)'
  const label = tier ? TIER_LABELS[tier][lang] : null
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: subtitle ? 8 : 0 }}>
        <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1, color }}>{value}</div>
        {label && (
          <span
            style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
          >
            <span style={{
              fontSize: 12, fontWeight: 700, color,
              background: `${color}22`, borderRadius: 4,
              padding: '3px 8px', cursor: 'default', letterSpacing: '.04em',
            }}>{label}</span>
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
      {subtitle && <div style={{ fontSize: 13, color: 'var(--text2)' }}>{subtitle}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ SectionHeading

function SectionHeading({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: 'var(--text2)',
      textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 12, marginTop: 4,
    }}>{label}</div>
  )
}

// ------------------------------------------------------------------ FilterBar

function FilterBar<T extends string>({ options, active, onChange }: {
  options: { key: T; label: string; color?: string }[]
  active: T; onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} style={{
          background: active === o.key ? (o.color ?? 'var(--accent)') : 'var(--bg3)',
          color: active === o.key ? '#fff' : 'var(--text2)',
          border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
        }}>{o.label}</button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ DuelRow

const ERROR_LABELS: Record<string, { ru: string; en: string }> = {
  shift_peek:  { ru: 'шифт-пик',      en: 'shift peek' },
  moving_shot: { ru: 'на ходу',       en: 'moving' },
  isolated:    { ru: 'изоляция',      en: 'isolated' },
  flashed:     { ru: 'флеш',          en: 'flashed' },
  outnumbered: { ru: 'в меньшинстве', en: 'outnumbered' },
  moving:      { ru: 'в движении',    en: 'moving' },
}

function DuelRow({ duel, playerNames, idx, selected, onClick, lang }: {
  duel: DuelEpisode; playerNames: Record<string, string>
  idx: number; selected: boolean; onClick: () => void; lang: 'ru' | 'en'
}) {
  const attName = playerNames[duel.attacker] ?? duel.attacker.slice(-6)
  const vicName = playerNames[duel.victim] ?? duel.victim.slice(-6)
  const bg = selected ? 'var(--bg3)' : duel.won ? 'rgba(80,200,120,0.05)' : 'rgba(220,80,80,0.05)'
  const borderColor = selected ? 'var(--accent)' : duel.won ? 'var(--green)' : 'var(--red)'
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: bg, border: `1px solid ${borderColor}`,
      borderRadius: 6, padding: '8px 12px', cursor: 'pointer', transition: 'background .1s',
    }}>
      <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 28 }}>R{duel.round}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: duel.won ? 'var(--green)' : 'var(--red)', minWidth: 50 }}>
        {duel.won ? '✓ Win' : '✗ Loss'}
      </span>
      <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {attName} → {vicName}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text2)' }}>{prettyWeapon(duel.weapon, lang)}</span>
      {duel.headshot && <span style={{ fontSize: 10, color: 'var(--accent2)', fontWeight: 700 }}>HS</span>}
      {duel.errors.filter(e => e !== 'strong_duel').map(e => (
        <span key={e} style={{ fontSize: 10, color: 'var(--red)', background: 'rgba(220,80,80,.15)', borderRadius: 3, padding: '1px 5px' }}>
          {ERROR_LABELS[e]?.[lang] ?? e}
        </span>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ StatBar

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

// ------------------------------------------------------------------ EpisodeList

function EpisodeList({ duels, playerNames, lang }: {
  duels: DuelEpisode[]; playerNames: Record<string, string>; lang: 'ru' | 'en'
}) {
  const [sel, setSel] = useState(0)
  const [drill, setDrill] = useState(false)
  if (!duels.length) return (
    <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
      {lang === 'ru' ? 'Нет эпизодов' : 'No episodes'}
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 400, overflowY: 'auto' }}>
        {duels.map((d, i) => (
          <DuelRow
            key={i} duel={d} playerNames={playerNames} idx={i} lang={lang}
            selected={i === sel}
            onClick={() => { setSel(i); setDrill(true) }}
          />
        ))}
      </div>
      <div>
        {drill
          ? <EpisodeDrillDown duel={duels[sel]} playerNames={playerNames} lang={lang} onClose={() => setDrill(false)} />
          : <div style={{ color: 'var(--text2)', fontSize: 12, paddingTop: 8 }}>
              {lang === 'ru' ? 'Нажми на строку для просмотра эпизода' : 'Click a row to view episode'}
            </div>
        }
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ RoundGrid

function RoundGrid({ totalRounds, roundOutcomes, lang }: {
  totalRounds: number
  roundOutcomes: Record<number, RoundOutcome>
  lang: 'ru' | 'en'
}) {
  const DOT_COLORS: Record<RoundOutcome, string> = {
    kill: 'var(--green)', death: 'var(--red)', draw: 'var(--accent2)', none: 'var(--bg3)',
  }
  const DOT_LABELS: Record<RoundOutcome, { ru: string; en: string }> = {
    kill:  { ru: 'убил',   en: 'kill' },
    death: { ru: 'умер',   en: 'died' },
    draw:  { ru: 'размен', en: 'draw' },
    none:  { ru: '—',      en: '—' },
  }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Array.from({ length: totalRounds }, (_, i) => i + 1).map(n => {
          const outcome = roundOutcomes[n] ?? 'none'
          const color = DOT_COLORS[outcome]
          return (
            <div key={n} title={`R${n}: ${DOT_LABELS[outcome][lang]}`} style={{
              width: 26, height: 26, borderRadius: 4,
              background: outcome === 'none' ? 'var(--bg3)' : `${color}33`,
              border: `1px solid ${color}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: outcome === 'none' ? 'var(--text3)' : color,
              fontWeight: 600, cursor: 'default',
            }}>{n}</div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--text2)' }}>
        <span><span style={{ color: 'var(--green)' }}>■</span> {lang === 'ru' ? 'убил' : 'kill'}</span>
        <span><span style={{ color: 'var(--red)' }}>■</span> {lang === 'ru' ? 'умер' : 'died'}</span>
        <span><span style={{ color: 'var(--accent2)' }}>■</span> {lang === 'ru' ? 'размен' : 'draw'}</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ WinRateComparison

function WinRateComparison({ cleanCount, cleanWins, otherCount, otherWins, lang }: {
  cleanCount: number; cleanWins: number
  otherCount: number; otherWins: number
  lang: 'ru' | 'en'
}) {
  const ru = lang === 'ru'
  const cleanPct = cleanCount > 0 ? (cleanWins / cleanCount * 100) : 0
  const otherPct = otherCount > 0 ? (otherWins / otherCount * 100) : 0
  const delta = cleanPct - otherPct
  const deltaColor = delta >= 5 ? 'var(--green)' : delta <= -5 ? 'var(--red)' : 'var(--text2)'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
      {[
        { label: ru ? 'Когда механика чистая' : 'With clean mechanics', pct: cleanPct, n: cleanCount, good: true },
        { label: ru ? 'Во всех остальных' : 'All other duels', pct: otherPct, n: otherCount, good: false },
      ].map(({ label, pct, n, good }) => (
        <div key={label} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: good ? 'var(--green)' : 'var(--text)', lineHeight: 1, marginBottom: 4 }}>
            {pct.toFixed(1)}%
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>{ru ? `${n} дуэлей` : `${n} duels`}</div>
        </div>
      ))}
      {cleanCount > 0 && otherCount > 0 && (
        <div style={{ gridColumn: '1 / -1', fontSize: 12, color: deltaColor, fontWeight: 700, textAlign: 'center', paddingTop: 2 }}>
          {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% {ru ? 'к победе' : 'to win rate'}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ metric pages

function OpeningWinPctPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>
  lang: 'ru' | 'en'; totalRounds: number
}) {
  const duels = analytics.duels
  const won = duels.filter(d => d.won)
  const lost = duels.filter(d => !d.won)
  const pct = analytics.metrics.openingWinPct
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all')
  const shown = filter === 'won' ? won : filter === 'lost' ? lost : duels
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of duels) roundOutcomes[d.round] = d.won ? 'kill' : 'death'
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Открывашки Win%' : 'Opening Win%'}
        subtitle={ru ? `${won.length} выигранных · ${lost.length} проигранных` : `${won.length} won · ${lost.length} lost`}
        value={pct.toFixed(1) + '%'} metricKey="openingWinPct" lang={lang}
      />
      <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
      <FilterBar
        options={[
          { key: 'all'  as const, label: ru ? `Все (${duels.length})` : `All (${duels.length})` },
          { key: 'won'  as const, label: ru ? `Выигранные (${won.length})` : `Won (${won.length})`, color: 'var(--green)' },
          { key: 'lost' as const, label: ru ? `Проигранные (${lost.length})` : `Lost (${lost.length})`, color: 'var(--red)' },
        ]}
        active={filter} onChange={setFilter}
      />
      <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

function IdealStrafePctPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>
  lang: 'ru' | 'en'; totalRounds: number
}) {
  const pct = analytics.metrics.idealStrafePct
  const allDuels = analytics.duels
  const won = allDuels.filter(d => d.won)
  const lost = allDuels.filter(d => !d.won)
  const ideal = won.filter(d => !d.errors.includes('moving_shot'))
  const moving = won.filter(d => d.errors.includes('moving_shot'))
  // clean = stopped shot duels (won + lost); other = moving shot duels (won + lost)
  const cleanAll = allDuels.filter(d => !d.errors.includes('moving_shot'))
  const movingAll = allDuels.filter(d => d.errors.includes('moving_shot'))
  const cleanWins = cleanAll.filter(d => d.won).length
  const movingWins = movingAll.filter(d => d.won).length
  const [filter, setFilter] = useState<'ideal' | 'moving'>('moving')
  const shown = filter === 'ideal' ? ideal : moving
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of won) roundOutcomes[d.round] = d.errors.includes('moving_shot') ? 'death' : 'kill'
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Идеальные стрейфы' : 'Ideal strafes'}
        subtitle={ru ? `${ideal.length} на стопе · ${moving.length} в движении (из ${won.length} побед)` : `${ideal.length} stopped · ${moving.length} moving (of ${won.length} wins)`}
        value={pct.toFixed(1) + '%'} metricKey="idealStrafePct" lang={lang}
      />
      <SectionHeading label={ru ? 'Влияние на результат' : 'Impact on outcome'} />
      <WinRateComparison
        cleanCount={cleanAll.length} cleanWins={cleanWins}
        otherCount={movingAll.length} otherWins={movingWins}
        lang={lang}
      />
      <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
      <FilterBar
        options={[
          { key: 'ideal'  as const, label: ru ? `На стопе (${ideal.length})` : `Stopped (${ideal.length})`, color: 'var(--green)' },
          { key: 'moving' as const, label: ru ? `В движении (${moving.length})` : `Moving (${moving.length})`, color: 'var(--red)' },
        ]}
        active={filter} onChange={setFilter}
      />
      <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

function FirstBulletAccPage({ analytics, lang }: {
  analytics: PlayerAnalyticsData; lang: 'ru' | 'en'
}) {
  const shots: FirstBulletShot[] = analytics.metrics.firstBulletShots ?? []
  const pct = analytics.metrics.firstBulletAcc
  const hits = shots.filter(s => s.hit)
  const misses = shots.filter(s => !s.hit)
  const [filter, setFilter] = useState<'all' | 'hit' | 'miss'>('all')
  const shown = filter === 'hit' ? hits : filter === 'miss' ? misses : shots
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Точность первой пули' : 'First bullet accuracy'}
        subtitle={ru ? `${hits.length} попаданий · ${misses.length} промахов` : `${hits.length} hits · ${misses.length} misses`}
        value={pct.toFixed(1) + '%'} metricKey="firstBulletAcc" lang={lang}
      />
      <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
      <FilterBar
        options={[
          { key: 'all'  as const, label: ru ? `Все (${shots.length})` : `All (${shots.length})` },
          { key: 'hit'  as const, label: ru ? `Попадания (${hits.length})` : `Hits (${hits.length})`, color: 'var(--green)' },
          { key: 'miss' as const, label: ru ? `Промахи (${misses.length})` : `Misses (${misses.length})`, color: 'var(--red)' },
        ]}
        active={filter} onChange={setFilter}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 400, overflowY: 'auto' }}>
        {shown.map((s, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: s.hit ? 'rgba(80,200,120,0.05)' : 'rgba(220,80,80,0.05)',
            border: `1px solid ${s.hit ? 'var(--green)' : 'var(--red)'}`,
            borderRadius: 6, padding: '7px 12px',
          }}>
            <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 28 }}>R{s.round}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: s.hit ? 'var(--green)' : 'var(--red)', minWidth: 60 }}>
              {s.hit ? (ru ? '✓ Попал' : '✓ Hit') : (ru ? '✗ Промах' : '✗ Miss')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>{prettyWeapon(s.weapon, lang)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TradeKillsPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const rounds = analytics.metrics.tradeKillRounds ?? []
  const ticks = analytics.metrics.tradeKillTicks ?? []
  const pct = analytics.metrics.tradeKillPct
  const TICK_WINDOW = 64
  const episodes = ticks.length > 0
    ? analytics.duels.filter(d => d.won && ticks.some(t => Math.abs(d.tick - t) <= TICK_WINDOW))
    : analytics.duels.filter(d => d.won && rounds.includes(d.round))
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const r of rounds) roundOutcomes[r] = 'kill'
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Трейд-килы' : 'Trade kills'}
        subtitle={ru ? `${rounds.length} трейд-килов в раундах: ${rounds.join(', ') || '—'}` : `${rounds.length} trade kills in rounds: ${rounds.join(', ') || '—'}`}
        value={pct.toFixed(1) + '%'} metricKey="tradeKillPct" lang={lang}
      />
      <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
      <EpisodeList duels={episodes} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

function TradedDeathsPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const rounds = analytics.metrics.tradedDeathRounds ?? []
  const ticks = analytics.metrics.tradedDeathTicks ?? []
  const pct = analytics.metrics.tradedDeathPct
  const TICK_WINDOW = 64
  const episodes = ticks.length > 0
    ? analytics.duels.filter(d => !d.won && ticks.some(t => Math.abs(d.tick - t) <= TICK_WINDOW))
    : analytics.duels.filter(d => !d.won && rounds.includes(d.round))
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const r of rounds) roundOutcomes[r] = 'draw'
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Трейд-смерти' : 'Traded deaths'}
        subtitle={ru ? `${rounds.length} трейд-смертей в раундах: ${rounds.join(', ') || '—'}` : `${rounds.length} traded deaths in rounds: ${rounds.join(', ') || '—'}`}
        value={pct.toFixed(1) + '%'} metricKey="tradedDeathPct" lang={lang}
      />
      <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
      <EpisodeList duels={episodes} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
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
  const shown = filter === 'flashed' ? flashed : filter === 'moving' ? moving
    : filter === 'outnumbered' ? outnumbered : filter === 'clean' ? clean : lost
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Проигранные дуэли' : 'Lost duels'}
        subtitle={ru ? `${lost.length} смертей` : `${lost.length} deaths`}
        value={String(lost.length)} metricKey="lostDuels" lang={lang}
      />
      <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
      <FilterBar
        options={[
          { key: 'all'        as const, label: ru ? `Все (${lost.length})` : `All (${lost.length})` },
          { key: 'flashed'    as const, label: ru ? `Флеш (${flashed.length})` : `Flashed (${flashed.length})`, color: 'var(--accent2)' },
          { key: 'moving'     as const, label: ru ? `В движении (${moving.length})` : `Moving (${moving.length})`, color: 'var(--accent)' },
          { key: 'outnumbered'as const, label: ru ? `В меньшинстве (${outnumbered.length})` : `Outnumbered (${outnumbered.length})`, color: 'var(--red)' },
          { key: 'clean'      as const, label: ru ? `Чистые (${clean.length})` : `Clean (${clean.length})` },
        ]}
        active={filter} onChange={setFilter}
      />
      <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
    </div>
  )
}

function CounterStrafeErrorsPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const allDuels = analytics.duels
  const movingDuels = allDuels.filter(d => d.errors.includes('moving_shot'))
  const cleanDuels = allDuels.filter(d => !d.errors.includes('moving_shot'))
  const movingWins = movingDuels.filter(d => d.won).length
  const cleanWins = cleanDuels.filter(d => d.won).length
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all')
  const shown = filter === 'won' ? movingDuels.filter(d => d.won) : filter === 'lost' ? movingDuels.filter(d => !d.won) : movingDuels
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of movingDuels) roundOutcomes[d.round] = d.won ? 'kill' : 'death'
  const ru = lang === 'ru'
  const errCount = m.counterStrafeErrors ?? 0
  return (
    <div>
      <MetricHero
        title={ru ? 'Ошибки контрстрейфа' : 'Counter-strafe errors'}
        subtitle={ru ? 'Выстрелов сделано в движении (нет остановки перед выстрелом)' : 'Shots fired while moving (no stop before shooting)'}
        value={String(errCount)} metricKey="counterStrafeErrors" lang={lang} higherIsBetter={false}
      />
      <SectionHeading label={ru ? 'Влияние на результат' : 'Impact on outcome'} />
      <WinRateComparison
        cleanCount={cleanDuels.length} cleanWins={cleanWins}
        otherCount={movingDuels.length} otherWins={movingWins}
        lang={lang}
      />
      <SectionHeading label={ru ? 'Дуэли с выстрелами в движении' : 'Duels with moving shots'} />
      {movingDuels.length > 0 ? (
        <>
          <FilterBar
            options={[
              { key: 'all'  as const, label: ru ? `Все (${movingDuels.length})` : `All (${movingDuels.length})` },
              { key: 'won'  as const, label: ru ? `Выигранные (${movingWins})` : `Won (${movingWins})`, color: 'var(--green)' },
              { key: 'lost' as const, label: ru ? `Проигранные (${movingDuels.length - movingWins})` : `Lost (${movingDuels.length - movingWins})`, color: 'var(--red)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
          <div style={{ marginTop: 24 }}>
            <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
            <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
          </div>
        </>
      ) : (
        <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
          {ru ? 'Нет дуэлей с выстрелами в движении' : 'No duels with moving shots'}
        </div>
      )}
    </div>
  )
}

function DisciplinePage({ analytics, playerNames, lang }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'
}) {
  const m = analytics.metrics
  const shiftDuels = analytics.duels.filter(d => d.errors.includes('shift_peek'))
  const isoDuels = analytics.duels.filter(d => d.errors.includes('isolated'))
  const [filter, setFilter] = useState<'shift_peek' | 'isolated'>('shift_peek')
  const shown = filter === 'shift_peek' ? shiftDuels : isoDuels
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Дисциплина в дуэлях' : 'Duel discipline'}
        value="—" metricKey="shiftPeekPct" lang={lang}
      />
      <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
        <StatBar label={ru ? 'Шифт-пики' : 'Shift peeks'} value={m.shiftPeekPct} max={100} color={m.shiftPeekPct > 30 ? 'var(--accent2)' : 'var(--green)'} />
        <StatBar label={ru ? 'Игра в изоляции' : 'Isolated plays'} value={m.isolatedPct} max={100} color={m.isolatedPct > 30 ? 'var(--red)' : 'var(--green)'} />
      </div>
      <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
      <FilterBar
        options={[
          { key: 'shift_peek' as const, label: ru ? `Шифт-пики (${shiftDuels.length})` : `Shift peeks (${shiftDuels.length})`, color: 'var(--accent2)' },
          { key: 'isolated'   as const, label: ru ? `Изоляция (${isoDuels.length})` : `Isolated (${isoDuels.length})`, color: 'var(--red)' },
        ]}
        active={filter} onChange={setFilter}
      />
      <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
    </div>
  )
}

function TtkPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const won = analytics.duels.filter(d => d.won)
  const [filter, setFilter] = useState<'all' | 'stopped' | 'moving'>('all')
  const stopped = won.filter(d => !d.errors.includes('moving_shot'))
  const moving = won.filter(d => d.errors.includes('moving_shot'))
  const shown = filter === 'stopped' ? stopped : filter === 'moving' ? moving : won
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of won) roundOutcomes[d.round] = 'kill'
  const ru = lang === 'ru'
  const val = (m.ttk_ms ?? 0) > 0 ? m.ttk_ms.toFixed(0) + (ru ? ' мс' : ' ms') : '—'
  return (
    <div>
      <MetricHero
        title={ru ? 'Время до фрага' : 'Time to kill'}
        subtitle={ru ? 'Среднее время от первого выстрела до кила' : 'Avg ms from first shot to kill'}
        value={val} metricKey="ttk_ms" lang={lang} higherIsBetter={false}
      />
      <SectionHeading label={ru ? 'Победные дуэли' : 'Won duels'} />
      <FilterBar
        options={[
          { key: 'all'     as const, label: ru ? `Все (${won.length})` : `All (${won.length})` },
          { key: 'stopped' as const, label: ru ? `На стопе (${stopped.length})` : `Stopped (${stopped.length})`, color: 'var(--green)' },
          { key: 'moving'  as const, label: ru ? `В движении (${moving.length})` : `Moving (${moving.length})`, color: 'var(--red)' },
        ]}
        active={filter} onChange={setFilter}
      />
      <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

function ClutchWinPctPage({ analytics, playerNames, lang }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'
}) {
  const m = analytics.metrics
  const clutchDuels = analytics.duels.filter(d => d.context.aliveEnemies > 1)
  const won = clutchDuels.filter(d => d.won)
  const lost = clutchDuels.filter(d => !d.won)
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all')
  const shown = filter === 'won' ? won : filter === 'lost' ? lost : clutchDuels
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Клатч Win%' : 'Clutch Win%'}
        subtitle={ru ? `${won.length} выигранных · ${lost.length} проигранных клатчей` : `${won.length} won · ${lost.length} lost clutches`}
        value={m.clutchWinPct.toFixed(1) + '%'} metricKey="clutchWinPct" lang={lang}
      />
      <SectionHeading label={ru ? 'Дуэли в меньшинстве' : 'Outnumbered duels'} />
      <FilterBar
        options={[
          { key: 'all'  as const, label: ru ? `Все (${clutchDuels.length})` : `All (${clutchDuels.length})` },
          { key: 'won'  as const, label: ru ? `Выигранные (${won.length})` : `Won (${won.length})`, color: 'var(--green)' },
          { key: 'lost' as const, label: ru ? `Проигранные (${lost.length})` : `Lost (${lost.length})`, color: 'var(--red)' },
        ]}
        active={filter} onChange={setFilter}
      />
      <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
    </div>
  )
}

function FlashEfficiencyPage({ analytics, playerNames, lang }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'
}) {
  const m = analytics.metrics
  const flashedDuels = analytics.duels.filter(d => d.errors.includes('flashed'))
  const won = analytics.duels.filter(d => d.won && d.context.flashDur > 0)
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Эффективность флешек' : 'Flash efficiency'}
        subtitle={ru ? `% флешек, которые ослепили противника` : `% of flashes that blinded an enemy`}
        value={m.flashEfficiency.toFixed(1) + '%'} metricKey="flashEfficiency" lang={lang}
      />
      {flashedDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Дуэли, где тебя ослепили' : 'Duels where you were flashed'} />
          <EpisodeList duels={flashedDuels} playerNames={playerNames} lang={lang} />
        </>
      )}
      {won.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionHeading label={ru ? 'Победные дуэли после флешки' : 'Wins after flash assist'} />
          <EpisodeList duels={won} playerNames={playerNames} lang={lang} />
        </div>
      )}
      {flashedDuels.length === 0 && won.length === 0 && (
        <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
          {ru ? 'Нет эпизодов с флешками' : 'No flash episodes'}
        </div>
      )}
    </div>
  )
}

function ReloadErrorsPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const reloadDuels = analytics.duels.filter(d => d.errors.includes('reload'))
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of reloadDuels) roundOutcomes[d.round] = d.won ? 'kill' : 'death'
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Перезарядки' : 'Reload errors'}
        subtitle={ru ? 'Перезарядок с патронами в магазине' : 'Reloads with bullets still in magazine'}
        value={String(m.reloadErrors ?? 0)} metricKey="reloadErrors" lang={lang} higherIsBetter={false}
      />
      <SectionHeading label={ru ? 'Дуэли с перезарядкой' : 'Duels with reload'} />
      {reloadDuels.length > 0 ? (
        <>
          <EpisodeList duels={reloadDuels} playerNames={playerNames} lang={lang} />
          <div style={{ marginTop: 24 }}>
            <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
            <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
          </div>
        </>
      ) : (
        <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
          {ru ? 'Нет эпизодов с перезарядками' : 'No reload episodes'}
        </div>
      )}
    </div>
  )
}

function AngleControlPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const won = analytics.duels.filter(d => d.won)
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of won) roundOutcomes[d.round] = 'kill'
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Контроль угла' : 'Angle control'}
        subtitle={ru ? 'Позиций удержано ≥2 секунды' : 'Positions held for ≥2 seconds'}
        value={String(m.angleControlCount ?? 0)} metricKey="angleControlCount" lang={lang}
      />
      <SectionHeading label={ru ? 'Победные дуэли (удержание позиции)' : 'Won duels (position held)'} />
      <EpisodeList duels={won} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
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

  const totalRounds = data.rounds.length

  function renderContent() {
    if (!analytics || !key) return null
    switch (key) {
      case 'openingWinPct':
        return <OpeningWinPctPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'idealStrafePct':
        return <IdealStrafePctPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'firstBulletAcc':
        return <FirstBulletAccPage analytics={analytics} lang={lang} />
      case 'tradeKillPct':
        return <TradeKillsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'tradedDeathPct':
        return <TradedDeathsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'lostDuels':
        return <LostDuelsPage analytics={analytics} playerNames={playerNames} lang={lang} />
      case 'shiftPeekPct':
      case 'isolatedPct':
        return <DisciplinePage analytics={analytics} playerNames={playerNames} lang={lang} />
      case 'counterStrafeErrors':
        return <CounterStrafeErrorsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'ttk_ms':
        return <TtkPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'clutchWinPct':
        return <ClutchWinPctPage analytics={analytics} playerNames={playerNames} lang={lang} />
      case 'flashEfficiency':
        return <FlashEfficiencyPage analytics={analytics} playerNames={playerNames} lang={lang} />
      case 'reloadErrors':
        return <ReloadErrorsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'angleControlCount':
        return <AngleControlPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      default:
        return (
          <div style={{ color: 'var(--text2)', fontSize: 13 }}>
            {lang === 'ru' ? `Страница метрики «${key}» не найдена.` : `Metric page "${key}" not found.`}
          </div>
        )
    }
  }

  return (
    <div className="page">
      <div style={{ marginBottom: 20 }}>
        <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => nav(`/match/${id}/player/${steamid}`)}>
          ← {p.name}
        </button>
      </div>
      <div className="card">
        {renderContent()}
      </div>
    </div>
  )
}
