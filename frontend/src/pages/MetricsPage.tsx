import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, PlayerAnalyticsData, DuelEpisode, AnalysisData, FirstBulletShot } from '../api'
import { useLang, useBenchmarks } from '../App'
import { getTier, TIER_COLORS, TIER_LABELS, formatTierTooltip } from '../benchmarkUtils'
import EpisodeDrillDown from '../components/player/EpisodeDrillDown'
import MatchNav from '../components/MatchNav'

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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
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

function WinRateComparison({ cleanCount, cleanWins, otherCount, otherWins, lang, cleanLabel, otherLabel }: {
  cleanCount: number; cleanWins: number
  otherCount: number; otherWins: number
  lang: 'ru' | 'en'
  cleanLabel?: string
  otherLabel?: string
}) {
  const ru = lang === 'ru'
  const cleanPct = cleanCount > 0 ? (cleanWins / cleanCount * 100) : 0
  const otherPct = otherCount > 0 ? (otherWins / otherCount * 100) : 0
  const delta = cleanPct - otherPct
  const deltaColor = delta >= 5 ? 'var(--green)' : delta <= -5 ? 'var(--red)' : 'var(--text2)'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 20 }}>
      {[
        { label: cleanLabel ?? (ru ? 'Когда механика чистая' : 'With clean mechanics'), pct: cleanPct, n: cleanCount, good: true },
        { label: otherLabel ?? (ru ? 'Во всех остальных' : 'All other duels'), pct: otherPct, n: otherCount, good: false },
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
  const openingDuels = analytics.duels.filter(d => d.opening)
  const won = openingDuels.filter(d => d.won)
  const lost = openingDuels.filter(d => !d.won)
  const pct = analytics.metrics.openingWinPct
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all')
  const shown = filter === 'won' ? won : filter === 'lost' ? lost : openingDuels
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of openingDuels) roundOutcomes[d.round] = d.won ? 'kill' : 'death'
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Открывашки Win%' : 'Opening Win%'}
        subtitle={ru ? `${won.length} выигранных · ${lost.length} проигранных открывашек` : `${won.length} won · ${lost.length} lost opening duels`}
        value={pct.toFixed(1) + '%'} metricKey="openingWinPct" lang={lang}
      />
      <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
      {openingDuels.length > 0 ? (
        <>
          <FilterBar
            options={[
              { key: 'all'  as const, label: ru ? `Все (${openingDuels.length})` : `All (${openingDuels.length})` },
              { key: 'won'  as const, label: ru ? `Выигранные (${won.length})` : `Won (${won.length})`, color: 'var(--green)' },
              { key: 'lost' as const, label: ru ? `Проигранные (${lost.length})` : `Lost (${lost.length})`, color: 'var(--red)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
        </>
      ) : (
        <div style={{ color: 'var(--text2)', fontSize: 13 }}>{ru ? 'Нет открывашек' : 'No opening duels'}</div>
      )}
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
  const cleanAll = allDuels.filter(d => !d.errors.includes('moving_shot'))
  const movingAll = allDuels.filter(d => d.errors.includes('moving_shot'))
  const cleanWins = cleanAll.filter(d => d.won).length
  const movingWins = movingAll.filter(d => d.won).length
  const [filter, setFilter] = useState<'stopped' | 'moving'>('stopped')
  const shown = filter === 'stopped' ? cleanAll : movingAll
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of allDuels) roundOutcomes[d.round] = d.errors.includes('moving_shot') ? 'death' : (d.won ? 'kill' : 'death')
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Идеальные стрейфы' : 'Ideal strafes'}
        subtitle={ru ? `${cleanAll.length} на стопе · ${movingAll.length} в движении (из ${allDuels.length} дуэлей)` : `${cleanAll.length} stopped · ${movingAll.length} moving (of ${allDuels.length} duels)`}
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
          { key: 'stopped' as const, label: ru ? `На стопе (${cleanAll.length})` : `Stopped (${cleanAll.length})`, color: 'var(--green)' },
          { key: 'moving'  as const, label: ru ? `В движении (${movingAll.length})` : `Moving (${movingAll.length})`, color: 'var(--red)' },
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

const WEAPON_CLASS: Record<string, 'rifle' | 'pistol' | 'smg' | 'sniper' | 'shotgun' | 'lmg'> = {
  weapon_ak47: 'rifle', weapon_m4a1: 'rifle', weapon_m4a1_silencer: 'rifle', weapon_m4a4: 'rifle',
  weapon_sg553: 'rifle', weapon_aug: 'rifle', weapon_famas: 'rifle', weapon_galil: 'rifle',
  weapon_galilar: 'rifle',
  weapon_awp: 'sniper', weapon_ssg08: 'sniper', weapon_g3sg1: 'sniper', weapon_scar20: 'sniper',
  weapon_usp_silencer: 'pistol', weapon_glock: 'pistol', weapon_p250: 'pistol',
  weapon_hkp2000: 'pistol', weapon_tec9: 'pistol', weapon_cz75a: 'pistol',
  weapon_deagle: 'pistol', weapon_revolver: 'pistol', weapon_elite: 'pistol',
  weapon_fiveseven: 'pistol',
  weapon_mp5sd: 'smg', weapon_mp7: 'smg', weapon_mp9: 'smg', weapon_mac10: 'smg',
  weapon_ump45: 'smg', weapon_p90: 'smg', weapon_bizon: 'smg',
  weapon_nova: 'shotgun', weapon_sawedoff: 'shotgun', weapon_xm1014: 'shotgun', weapon_mag7: 'shotgun',
  weapon_m249: 'lmg', weapon_negev: 'lmg',
}

function getWeaponClass(raw: string) {
  return WEAPON_CLASS[raw] ?? WEAPON_CLASS['weapon_' + raw] ?? 'other'
}

const CLASS_LABELS: Record<string, { ru: string; en: string }> = {
  rifle:   { ru: 'Винтовки', en: 'Rifles' },
  pistol:  { ru: 'Пистолеты', en: 'Pistols' },
  smg:     { ru: 'Пистолеты-пулемёты', en: 'SMGs' },
  sniper:  { ru: 'Снайперские', en: 'Snipers' },
  shotgun: { ru: 'Дробовики', en: 'Shotguns' },
  lmg:     { ru: 'Пулемёты', en: 'LMGs' },
  other:   { ru: 'Прочее', en: 'Other' },
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

  // win-rate comparison: hit vs miss — check corresponding duels
  const duels = analytics.duels
  const hitRounds = new Set(hits.map(s => s.round))
  const missRounds = new Set(misses.map(s => s.round))
  const hitDuels = duels.filter(d => hitRounds.has(d.round))
  const missDuels = duels.filter(d => missRounds.has(d.round))
  const hitWins = hitDuels.filter(d => d.won).length
  const missWins = missDuels.filter(d => d.won).length

  // weapon class breakdown
  const classCounts: Record<string, { total: number; hit: number }> = {}
  for (const s of shots) {
    const cls = getWeaponClass(s.weapon)
    if (!classCounts[cls]) classCounts[cls] = { total: 0, hit: 0 }
    classCounts[cls].total++
    if (s.hit) classCounts[cls].hit++
  }
  const classRows = Object.entries(classCounts)
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => b[1].total - a[1].total)

  return (
    <div>
      <MetricHero
        title={ru ? 'Точность первой пули' : 'First bullet accuracy'}
        subtitle={ru ? `${hits.length} попаданий · ${misses.length} промахов` : `${hits.length} hits · ${misses.length} misses`}
        value={pct.toFixed(1) + '%'} metricKey="firstBulletAcc" lang={lang}
      />

      {/* Win rate comparison */}
      {hitDuels.length > 0 && missDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Влияние на результат' : 'Impact on outcome'} />
          <WinRateComparison
            cleanCount={hitDuels.length} cleanWins={hitWins}
            otherCount={missDuels.length} otherWins={missWins}
            lang={lang}
          />
        </>
      )}

      {/* Weapon class breakdown */}
      {classRows.length > 0 && (
        <>
          <SectionHeading label={ru ? 'По классу оружия' : 'By weapon class'} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {classRows.map(([cls, { total, hit }]) => {
              const acc = total > 0 ? Math.round(hit / total * 100) : 0
              const color = acc >= 50 ? 'var(--green)' : acc >= 30 ? 'var(--accent2)' : 'var(--red)'
              return (
                <div key={cls} style={{
                  background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px',
                  minWidth: 110, flex: '1 1 110px',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                    {CLASS_LABELS[cls]?.[lang] ?? cls}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>
                    {acc}%
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                    {hit}/{total} {ru ? 'попаданий' : 'hits'}
                  </div>
                  <div style={{ marginTop: 6, height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${acc}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .3s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

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
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>
              {prettyWeapon(s.weapon, lang)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text2)', background: 'var(--bg3)', borderRadius: 3, padding: '1px 5px' }}>
              {CLASS_LABELS[getWeaponClass(s.weapon)]?.[lang] ?? getWeaponClass(s.weapon)}
            </span>
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
  const pct = analytics.metrics.tradeKillPct
  const episodes = analytics.duels.filter(d => d.isTradeKill)
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
  const pct = analytics.metrics.tradedDeathPct
  const episodes = analytics.duels.filter(d => d.isTradedDeath)
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
  const moving = lost.filter(d => d.errors.includes('moving_shot'))
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

function DisciplinePage({ analytics, playerNames, lang, activeKey }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>
  lang: 'ru' | 'en'; activeKey: 'shiftPeekPct' | 'isolatedPct'
}) {
  const m = analytics.metrics
  const shiftDuels = analytics.duels.filter(d => d.errors.includes('shift_peek'))
  const isoDuels = analytics.duels.filter(d => d.errors.includes('isolated'))
  const defaultFilter = activeKey === 'shiftPeekPct' ? 'shift_peek' : 'isolated'
  const [filter, setFilter] = useState<'shift_peek' | 'isolated'>(defaultFilter)
  const shown = filter === 'shift_peek' ? shiftDuels : isoDuels
  const ru = lang === 'ru'

  const isShift = activeKey === 'shiftPeekPct'
  const heroValue = isShift ? m.shiftPeekPct.toFixed(1) + '%' : m.isolatedPct.toFixed(1) + '%'
  const heroTitle = isShift ? (ru ? 'Шифт-пики' : 'Shift peeks') : (ru ? 'Игра в изоляции' : 'Isolated plays')
  const heroSub = isShift
    ? (ru ? '% дуэлей начато из шифта' : '% of duels started while walking')
    : (ru ? '% дуэлей без поддержки союзников' : '% of duels without nearby allies')

  return (
    <div>
      <MetricHero
        title={heroTitle} subtitle={heroSub}
        value={heroValue} metricKey={activeKey} lang={lang} higherIsBetter={false}
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

function ClutchWinPctPage({ analytics, playerData, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerData: import('../api').PlayerData
  playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const clutches = playerData.clutches
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all')
  const ru = lang === 'ru'

  const list = clutches.list ?? []
  const wonList = list.filter(c => c.won)
  const lostList = list.filter(c => !c.won)
  const shown = filter === 'won' ? wonList : filter === 'lost' ? lostList : list

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const c of list) roundOutcomes[c.round] = c.won ? 'kill' : 'death'

  const byX = clutches.byX ?? {}
  const sizes = Object.keys(byX).sort()

  return (
    <div>
      <MetricHero
        title={ru ? 'Клатч Win%' : 'Clutch Win%'}
        subtitle={ru ? `${clutches.won} выиграно · ${clutches.played} попыток` : `${clutches.won} won · ${clutches.played} attempted`}
        value={m.clutchWinPct.toFixed(1) + '%'} metricKey="clutchWinPct" lang={lang}
      />

      {sizes.length > 0 && (
        <>
          <SectionHeading label={ru ? 'По числу противников' : 'By enemy count'} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {sizes.map(k => {
              const s = byX[k]
              const pct = s.played > 0 ? ((s.won / s.played) * 100).toFixed(0) : '0'
              return (
                <div key={k} style={{
                  background: 'var(--bg2)', borderRadius: 8, padding: '10px 16px',
                  minWidth: 80, textAlign: 'center'
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>
                    {ru ? `1 vs ${k}` : `1v${k}`}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.won > 0 ? 'var(--green)' : 'var(--text)' }}>
                    {pct}%
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                    {s.won}/{s.played}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {list.length > 0 ? (
        <>
          <SectionHeading label={ru ? 'Клатч-раунды' : 'Clutch rounds'} />
          <FilterBar
            options={[
              { key: 'all'  as const, label: ru ? `Все (${list.length})` : `All (${list.length})` },
              { key: 'won'  as const, label: ru ? `Выигранные (${wonList.length})` : `Won (${wonList.length})`, color: 'var(--green)' },
              { key: 'lost' as const, label: ru ? `Проигранные (${lostList.length})` : `Lost (${lostList.length})`, color: 'var(--red)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {shown.map(c => (
              <div key={c.round} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--bg2)', borderRadius: 6, padding: '8px 12px',
                borderLeft: `3px solid ${c.won ? 'var(--green)' : 'var(--red)'}`
              }}>
                <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 60 }}>
                  {ru ? `Раунд ${c.round}` : `Round ${c.round}`}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {ru ? `1 vs ${c.enemies}` : `1v${c.enemies}`}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                  {c.kills > 0 ? `${c.kills} kill${c.kills > 1 ? 's' : ''}` : ''}
                </span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                  color: c.won ? 'var(--green)' : 'var(--red)'
                }}>
                  {c.won ? (ru ? 'ВЫИГРАЛ' : 'WON') : (ru ? 'ПРОИГРАЛ' : 'LOST')}
                </span>
              </div>
            ))}
          </div>
          <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
          <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
        </>
      ) : (
        <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
          {ru ? 'Клатч-раундов нет' : 'No clutch rounds'}
        </div>
      )}
    </div>
  )
}

function FlashEfficiencyPage({ analytics, playerNames, lang }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'
}) {
  const m = analytics.metrics
  const flashedDuels = analytics.duels.filter(d => d.errors.includes('flashed'))
  const flashedWon = flashedDuels.filter(d => d.won)
  const flashedLost = flashedDuels.filter(d => !d.won)
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all')
  const shown = filter === 'won' ? flashedWon : filter === 'lost' ? flashedLost : flashedDuels
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Эффективность флешек' : 'Flash efficiency'}
        subtitle={ru ? '% своих флешек, ослепивших противника' : '% of own flashes that blinded an enemy'}
        value={m.flashEfficiency.toFixed(1) + '%'} metricKey="flashEfficiency" lang={lang}
      />
      {flashedDuels.length > 0 ? (
        <>
          <SectionHeading label={ru ? 'Дуэли, где тебя ослепили' : 'Duels where you were flashed'} />
          <FilterBar
            options={[
              { key: 'all'  as const, label: ru ? `Все (${flashedDuels.length})` : `All (${flashedDuels.length})` },
              { key: 'won'  as const, label: ru ? `Выигранные (${flashedWon.length})` : `Won (${flashedWon.length})`, color: 'var(--green)' },
              { key: 'lost' as const, label: ru ? `Проигранные (${flashedLost.length})` : `Lost (${flashedLost.length})`, color: 'var(--red)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
        </>
      ) : (
        <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
          {ru ? 'Дуэлей под флешкой нет' : 'No duels while flashed'}
        </div>
      )}
    </div>
  )
}

function ReloadErrorsPage({ analytics, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const reloadErrors = m.reloadErrors ?? 0
  const totalDuels = analytics.duels.length
  const totalShots = analytics.metrics.firstBulletShots?.length ?? 0
  const per100 = totalShots > 0 ? Math.round(reloadErrors / totalShots * 100) : 0
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of analytics.duels) {
    if (!(d.round in roundOutcomes)) roundOutcomes[d.round] = d.won ? 'kill' : 'death'
  }
  const ru = lang === 'ru'
  return (
    <div>
      <MetricHero
        title={ru ? 'Перезарядки' : 'Reload errors'}
        subtitle={ru ? 'Перезарядок с патронами в магазине (>5 патронов)' : 'Reloads with bullets still in magazine (>5 bullets)'}
        value={String(reloadErrors)} metricKey="reloadErrors" lang={lang} higherIsBetter={false}
      />
      <SectionHeading label={ru ? 'Статистика' : 'Stats'} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { label: ru ? 'Потеряно перезарядок' : 'Early reloads', value: String(reloadErrors) },
          { label: ru ? 'Дуэлей сыграно' : 'Duels played', value: String(totalDuels) },
          { label: ru ? 'На 100 выстрелов' : 'Per 100 shots', value: totalShots > 0 ? String(per100) : '—' },
        ].map(({ label, value }) => (
          <div key={label} style={{
            flex: '1 1 140px', minWidth: 120,
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '14px 16px',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>
      <SectionHeading label={ru ? 'Что это значит' : 'What this means'} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 24,
      }}>
        {ru
          ? 'Перезарядка с патронами в магазине трактуется как ошибка, так как ты теряешь патроны и тратишь время в потенциально опасный момент. Идеально — перезаряжаться только когда магазин пуст или близок к пустому.'
          : 'Reloading with bullets still in the magazine wastes ammo and takes time at a potentially dangerous moment. Ideally, reload only when the magazine is empty or near-empty.'}
      </div>
      <div style={{ marginTop: 8 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

function AngleControlPage({ analytics, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const count = m.angleControlCount ?? 0
  const ru = lang === 'ru'

  // build per-round presence from duels (shows activity, not holds specifically)
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of analytics.duels) {
    if (!(d.round in roundOutcomes)) roundOutcomes[d.round] = d.won ? 'kill' : 'death'
  }

  return (
    <div>
      <MetricHero
        title={ru ? 'Контроль угла' : 'Angle control'}
        subtitle={ru ? 'Позиций удержано ≥2 секунды без движения' : 'Positions held ≥2 seconds without movement'}
        value={String(count)} metricKey="angleControlCount" lang={lang}
      />
      <SectionHeading label={ru ? 'Что это значит' : 'What this means'} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {ru
          ? `Контроль угла — количество уникальных позиций, где ты стоял неподвижно ≥2 секунды во время живых раундов. Высокое значение означает терпеливое удержание углов и ожидание врага. Норма — чем больше, тем лучше.`
          : `Angle control counts unique positions where you stood still for ≥2 seconds during live rounds. A higher value means patient angle holding and waiting for enemies. Higher is better.`}
      </div>
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ reaction time page

function ReactionTimePage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>
  lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const rt = (m as any).reactionTimeMs ?? 0
  const ru = lang === 'ru'
  const wonDuels = analytics.duels.filter(d => d.won)
  const deltas: number[] = (m as any).reactionDeltas ?? []

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of wonDuels) {
    if (!(d.round in roundOutcomes)) roundOutcomes[d.round] = 'kill'
  }

  const BUCKETS = [
    { lo: 0,   hi: 100,  label: '<100' },
    { lo: 100, hi: 200,  label: '100-200' },
    { lo: 200, hi: 300,  label: '200-300' },
    { lo: 300, hi: 400,  label: '300-400' },
    { lo: 400, hi: 500,  label: '400-500' },
    { lo: 500, hi: 9999, label: '>500' },
  ]
  const counts = BUCKETS.map(b => deltas.filter(v => v >= b.lo && v < b.hi).length)
  const maxCount = Math.max(1, ...counts)

  return (
    <div>
      <MetricHero
        title={ru ? 'Время реакции' : 'Reaction time'}
        subtitle={ru ? 'Ср. мс от начала движения врага до первого выстрела' : 'Avg ms from enemy peek onset to first shot'}
        value={rt > 0 ? rt.toFixed(0) + (ru ? ' мс' : ' ms') : '—'}
        metricKey="reactionTimeMs" lang={lang} higherIsBetter={false}
      />

      {deltas.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Распределение реакции' : 'Reaction time distribution'} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, marginBottom: 6, background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
            {BUCKETS.map((b, i) => {
              const h = Math.round(counts[i] / maxCount * 56)
              return (
                <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)' }}>{counts[i] || ''}</div>
                  <div style={{
                    width: '100%', height: h || 2, borderRadius: 3,
                    background: counts[i] ? 'var(--accent)' : 'var(--bg2)',
                    transition: 'height .3s',
                  }} />
                  <div style={{ fontSize: 9, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{b.label}</div>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 20 }}>
            {ru
              ? `${deltas.length} дуэлей · среднее ${rt.toFixed(0)} мс · мин ${Math.min(...deltas).toFixed(0)} мс · макс ${Math.max(...deltas).toFixed(0)} мс`
              : `${deltas.length} duels · avg ${rt.toFixed(0)} ms · min ${Math.min(...deltas).toFixed(0)} ms · max ${Math.max(...deltas).toFixed(0)} ms`}
          </div>
        </>
      )}

      <SectionHeading label={ru ? 'Что это значит' : 'What this means'} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {ru
          ? 'Время реакции — сколько мс прошло с момента, когда враг начал движение (пик), до первого выстрела в этой дуэли. Измеряется только по выигранным дуэлям, где враг двигался. Ниже = быстрее.'
          : 'Reaction time measures how many ms elapsed from when the enemy started moving (peek onset) until your first shot in the duel. Measured on winning duels where the enemy was in motion. Lower is better.'}
      </div>

      {wonDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Победные дуэли' : 'Winning duels'} />
          <EpisodeList duels={wonDuels} playerNames={playerNames} lang={lang} />
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ overshoot page

function OvershootPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>
  lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const ov = (m as any).overshootCount ?? 0
  const ru = lang === 'ru'
  const wonDuels = analytics.duels.filter(d => d.won)
  const overshootDuels = wonDuels.filter(d => d.errors.includes('overshoot'))
  const undershootDuels = wonDuels.filter(d => d.errors.includes('undershoot'))
  const cleanDuels = wonDuels.filter(d => !d.errors.includes('overshoot') && !d.errors.includes('undershoot'))

  const [filter, setFilter] = useState<'overshoot' | 'undershoot' | 'clean'>('overshoot')
  const shown = filter === 'overshoot' ? overshootDuels : filter === 'undershoot' ? undershootDuels : cleanDuels

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of wonDuels) {
    if (d.errors.includes('overshoot')) roundOutcomes[d.round] = 'death'
    else if (!(d.round in roundOutcomes)) roundOutcomes[d.round] = 'kill'
  }

  return (
    <div>
      <MetricHero
        title={ru ? 'Промахи прицела' : 'Overshoot count'}
        subtitle={ru
          ? `${overshootDuels.length} перелётов · ${undershootDuels.length} недолётов · ${cleanDuels.length} чистых (из ${wonDuels.length} побед)`
          : `${overshootDuels.length} overshoots · ${undershootDuels.length} undershoots · ${cleanDuels.length} clean (of ${wonDuels.length} wins)`}
        value={String(ov)}
        metricKey="overshootCount" lang={lang}
      />

      {/* split bar */}
      {wonDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Структура побед' : 'Win breakdown'} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
            {[
              { key: 'overshoot' as const, label: ru ? 'Перелёт' : 'Overshoot', count: overshootDuels.length, color: 'var(--red)' },
              { key: 'undershoot' as const, label: ru ? 'Недолёт' : 'Undershoot', count: undershootDuels.length, color: 'var(--accent2)' },
              { key: 'clean' as const, label: ru ? 'Чистые' : 'Clean', count: cleanDuels.length, color: 'var(--green)' },
            ].map(({ key, label, count, color }) => {
              const pct = wonDuels.length > 0 ? Math.round(count / wonDuels.length * 100) : 0
              return (
                <div key={key} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{count}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>{pct}% {ru ? 'от побед' : 'of wins'}</div>
                  <div style={{ height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .3s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <SectionHeading label={ru ? 'Что это значит' : 'What this means'} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {ru
          ? 'Перелёт — прицел пролетел через врага (знак угла изменился). Недолёт — прицел так и не дотянулся до врага (угол не обнулился). Чистые дуэли — ни того, ни другого.'
          : 'Overshoot — your aim crossed past the enemy (angle sign changed). Undershoot — aim never reached the enemy (angle never zeroed). Clean duels — neither.'}
      </div>

      {wonDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
          <FilterBar
            options={[
              { key: 'overshoot' as const, label: ru ? `Перелёт (${overshootDuels.length})` : `Overshoot (${overshootDuels.length})`, color: 'var(--red)' },
              { key: 'undershoot' as const, label: ru ? `Недолёт (${undershootDuels.length})` : `Undershoot (${undershootDuels.length})`, color: 'var(--accent2)' },
              { key: 'clean' as const, label: ru ? `Чистые (${cleanDuels.length})` : `Clean (${cleanDuels.length})`, color: 'var(--green)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ crosshair placement page

function CrosshairPlacementPage({ analytics, lang }: {
  analytics: PlayerAnalyticsData; lang: 'ru' | 'en'
}) {
  const m = analytics.metrics
  const pct = m.crosshairPlacementPct ?? 0
  const shots = m.firstBulletShots ?? []
  const ru = lang === 'ru'

  // Build per-weapon breakdown from firstBulletShots + hurt events
  // We use the shots list and pair hits with the hitgroup from duels
  // Pair by round: crosshair = % head hits among first-bullet HITS per weapon
  const duels = analytics.duels

  // Approximate: for first-bullet hits, check if the duel kill was a headshot
  const hitRoundWeaponMap: { round: number; weapon: string; headshot: boolean }[] = []
  for (const s of shots) {
    if (!s.hit) continue
    const duel = duels.find(d => d.round === s.round && d.won)
    if (duel) {
      hitRoundWeaponMap.push({ round: s.round, weapon: s.weapon, headshot: duel.headshot })
    }
  }

  // weapon breakdown
  const weaponStats: Record<string, { hits: number; headHits: number }> = {}
  for (const { weapon, headshot } of hitRoundWeaponMap) {
    if (!weaponStats[weapon]) weaponStats[weapon] = { hits: 0, headHits: 0 }
    weaponStats[weapon].hits++
    if (headshot) weaponStats[weapon].headHits++
  }
  const weaponRows = Object.entries(weaponStats)
    .filter(([, v]) => v.hits > 0)
    .sort((a, b) => b[1].hits - a[1].hits)

  const totalHits = shots.filter(s => s.hit).length
  const headHitsEst = hitRoundWeaponMap.filter(r => r.headshot).length

  return (
    <div>
      <MetricHero
        title={ru ? 'Прицел на голове' : 'Crosshair placement'}
        subtitle={ru
          ? `${headHitsEst} попаданий в голову из ${totalHits} первых пуль`
          : `${headHitsEst} head hits out of ${totalHits} first-bullet hits`}
        value={pct.toFixed(1) + '%'} metricKey="crosshairPlacementPct" lang={lang}
      />
      <SectionHeading label={ru ? 'Что это значит' : 'What this means'} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {ru
          ? 'Показывает, насколько точно ты держишь прицел на уровне головы до начала дуэли. Считается как % первых попаданий по врагу, которые пришлись в голову. Высокий показатель означает правильное пре-аимирование и snappy флики.'
          : 'Measures how accurately you pre-aim at head level before duels start. Calculated as % of first-bullet hits on an enemy that landed on the head. A high value means good pre-aim and snappy flicks.'}
      </div>

      {weaponRows.length > 0 && (
        <>
          <SectionHeading label={ru ? 'По оружию' : 'By weapon'} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {weaponRows.map(([wep, { hits, headHits }]) => {
              const wpct = hits > 0 ? Math.round(headHits / hits * 100) : 0
              const color = wpct >= 50 ? 'var(--green)' : wpct >= 30 ? 'var(--accent2)' : 'var(--red)'
              const label = wep.replace('weapon_', '')
              return (
                <div key={wep} style={{
                  background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px',
                  minWidth: 110, flex: '1 1 110px',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>
                    {wpct}%
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                    {headHits}/{hits} {ru ? 'в голову' : 'head hits'}
                  </div>
                  <div style={{ marginTop: 6, height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${wpct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .3s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 400, overflowY: 'auto' }}>
        {shots.filter(s => s.hit).map((s, i) => {
          const duel = duels.find(d => d.round === s.round && d.won)
          const isHead = duel?.headshot ?? false
          const wepLabel = s.weapon.replace('weapon_', '')
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: isHead ? 'rgba(80,200,120,0.05)' : 'rgba(200,200,100,0.04)',
              border: `1px solid ${isHead ? 'var(--green)' : 'var(--border)'}`,
              borderRadius: 6, padding: '7px 12px',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 28 }}>R{s.round}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: isHead ? 'var(--green)' : 'var(--text2)', minWidth: 80 }}>
                {isHead ? (ru ? '✓ Голова' : '✓ Head') : (ru ? '— Тело' : '— Body')}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>{wepLabel}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ missed first shot page

function MissedFirstPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>
  lang: 'ru' | 'en'; totalRounds: number
}) {
  const ru = lang === 'ru'
  const wonDuels = analytics.duels.filter(d => d.won)
  const missedDuels = wonDuels.filter(d => d.errors.includes('missed_first'))
  const hitDuels = wonDuels.filter(d => !d.errors.includes('missed_first'))

  const [filter, setFilter] = useState<'missed' | 'hit'>('missed')
  const shown = filter === 'missed' ? missedDuels : hitDuels

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of wonDuels) {
    if (d.errors.includes('missed_first')) roundOutcomes[d.round] = 'death'
    else if (!(d.round in roundOutcomes)) roundOutcomes[d.round] = 'kill'
  }

  const pct = wonDuels.length > 0 ? Math.round(missedDuels.length / wonDuels.length * 100) : 0

  return (
    <div>
      <MetricHero
        title={ru ? 'Неточный первый выстрел' : 'Inaccurate first shot'}
        subtitle={ru
          ? `${missedDuels.length} промахов первой пулей из ${wonDuels.length} выигранных дуэлей`
          : `${missedDuels.length} first-bullet misses out of ${wonDuels.length} won duels`}
        value={`${pct}%`} metricKey="firstBulletAcc" lang={lang} higherIsBetter={false}
      />

      {wonDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Структура побед' : 'Win breakdown'} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 20 }}>
            {[
              { key: 'missed' as const, label: ru ? 'Промах 1-й пулей' : 'Missed 1st bullet', count: missedDuels.length, color: 'var(--red)' },
              { key: 'hit' as const, label: ru ? 'Попал 1-й пулей' : 'Hit 1st bullet', count: hitDuels.length, color: 'var(--green)' },
            ].map(({ key, label, count, color }) => {
              const barPct = wonDuels.length > 0 ? Math.round(count / wonDuels.length * 100) : 0
              return (
                <div key={key} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{count}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>{barPct}% {ru ? 'от побед' : 'of wins'}</div>
                  <div style={{ height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${barPct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .3s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {missedDuels.length > 0 && hitDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Влияние на результат' : 'Impact on outcome'} />
          <WinRateComparison
            cleanCount={hitDuels.length} cleanWins={hitDuels.filter(d => d.won).length}
            otherCount={missedDuels.length} otherWins={missedDuels.filter(d => d.won).length}
            lang={lang}
            cleanLabel={ru ? 'Попал первой пулей' : 'Hit 1st bullet'}
            otherLabel={ru ? 'Промахнулся 1-й пулей' : 'Missed 1st bullet'}
          />
        </>
      )}

      <SectionHeading label={ru ? 'Что это значит' : 'What this means'} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {ru
          ? 'Неточный первый выстрел — первая пуля в дуэли не нанесла урона врагу. Даже если ты выиграл дуэль, это означает, что ты потерял преимущество первого выстрела. Улучши пре-аим и контрстрейф, чтобы снизить этот показатель.'
          : 'Inaccurate first shot — the first bullet fired in the duel did no damage. Even when you won, it means you lost the first-bullet advantage. Improve your pre-aim and counter-strafe to reduce this number.'}
      </div>

      {wonDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
          <FilterBar
            options={[
              { key: 'missed' as const, label: ru ? `Промах (${missedDuels.length})` : `Missed (${missedDuels.length})`, color: 'var(--red)' },
              { key: 'hit' as const, label: ru ? `Попал (${hitDuels.length})` : `Hit (${hitDuels.length})`, color: 'var(--green)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
          <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
          <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ excellent contacts page

function ExcellentContactsPage({ analytics, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const count = (m as any).excellentContacts ?? 0
  const ru = lang === 'ru'
  const duels = analytics.duels
  const shots = m.firstBulletShots ?? []

  // Excellent contact = won + stopped (no moving_shot error) + first bullet hit
  const hitRounds = new Set(shots.filter(s => s.hit).map(s => s.round))
  const excellentDuels = duels.filter(d => d.won && !d.errors.includes('moving_shot') && hitRounds.has(d.round))
  const otherDuels = duels.filter(d => !excellentDuels.includes(d))
  const excellentWins = excellentDuels.filter(d => d.won).length
  const otherWins = otherDuels.filter(d => d.won).length

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of analytics.duels) {
    if (d.won && !(d.round in roundOutcomes)) roundOutcomes[d.round] = 'kill'
  }

  return (
    <div>
      <MetricHero
        title={ru ? 'Качественные контакты' : 'Excellent contacts'}
        subtitle={ru ? 'Побед в дуэлях: стоял на месте + первая пуля попала' : 'Duel wins: stopped at shot + first bullet hit'}
        value={String(count)} metricKey="excellentContacts" lang={lang}
      />
      {excellentDuels.length > 0 && otherDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Влияние на результат' : 'Impact on outcome'} />
          <WinRateComparison
            cleanCount={excellentDuels.length} cleanWins={excellentWins}
            otherCount={otherDuels.length} otherWins={otherWins}
            lang={lang}
            cleanLabel={ru ? 'Качественные контакты' : 'Excellent contacts'}
            otherLabel={ru ? 'Остальные дуэли' : 'Other duels'}
          />
        </>
      )}
      <SectionHeading label={ru ? 'Что это значит' : 'What this means'} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {ru
          ? `Качественные контакты — дуэли, в которых ты победил, при этом не двигался в момент первого выстрела (скорость ≤${50} u/s) и первая пуля попала в врага. Это комбинация правильного движения и точного первого выстрела — самый ценный показатель механики в дуэлях.`
          : `Excellent contacts are duel wins where you were not moving when you first shot (velocity ≤${50} u/s) and your first bullet hit the enemy. This combines correct movement mechanics with accurate first-shot placement — the most valuable indicator of duel mechanics.`}
      </div>
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ successful reaction time page

function SuccessfulReactionTimePage({ analytics, lang }: {
  analytics: PlayerAnalyticsData; lang: 'ru' | 'en'
}) {
  const m = analytics.metrics
  const rt = (m as any).successfulReactionTimeMs ?? 0
  const rtAll = (m as any).reactionTimeMs ?? 0
  const ru = lang === 'ru'

  const deltas: number[] = (m as any).reactionDeltasHit ?? []
  const deltasAll: number[] = (m as any).reactionDeltas ?? []

  // histogram buckets: <100, 100-200, 200-300, 300-400, 400-500, >500
  const BUCKETS = [
    { lo: 0,   hi: 100,  label: '<100' },
    { lo: 100, hi: 200,  label: '100-200' },
    { lo: 200, hi: 300,  label: '200-300' },
    { lo: 300, hi: 400,  label: '300-400' },
    { lo: 400, hi: 500,  label: '400-500' },
    { lo: 500, hi: 9999, label: '>500' },
  ]
  const counts = BUCKETS.map(b => deltas.filter(v => v >= b.lo && v < b.hi).length)
  const maxCount = Math.max(1, ...counts)

  return (
    <div>
      <MetricHero
        title={ru ? 'Реакция в попаданиях' : 'Reaction on hits'}
        subtitle={ru
          ? 'Среднее время реакции только в дуэлях, где первая пуля попала'
          : 'Avg reaction time only in duels where first bullet hit'}
        value={rt > 0 ? rt.toFixed(0) + (ru ? ' мс' : ' ms') : '—'}
        metricKey="reactionTimeMs" lang={lang} higherIsBetter={false}
      />

      {rtAll > 0 && rt > 0 && (
        <>
          <SectionHeading label={ru ? 'Сравнение с общей реакцией' : 'vs. overall reaction time'} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
            {[
              { label: ru ? 'Реакция в попаданиях' : 'On hits', val: rt, color: 'var(--green)' },
              { label: ru ? 'Общая реакция' : 'All duels', val: rtAll, color: 'var(--text2)' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color }}>{val.toFixed(0)} {ru ? 'мс' : 'ms'}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {deltas.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Распределение реакции' : 'Reaction time distribution'} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, marginBottom: 6, background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
            {BUCKETS.map((b, i) => {
              const h = Math.round(counts[i] / maxCount * 56)
              return (
                <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)' }}>{counts[i] || ''}</div>
                  <div style={{
                    width: '100%', height: h || 2, borderRadius: 3,
                    background: counts[i] ? 'var(--accent)' : 'var(--bg2)',
                    transition: 'height .3s',
                  }} />
                  <div style={{ fontSize: 9, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{b.label}</div>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 20 }}>
            {ru ? `${deltas.length} дуэлей · среднее ${rt.toFixed(0)} мс · мин ${Math.min(...deltas).toFixed(0)} мс · макс ${Math.max(...deltas).toFixed(0)} мс`
              : `${deltas.length} duels · avg ${rt.toFixed(0)} ms · min ${Math.min(...deltas).toFixed(0)} ms · max ${Math.max(...deltas).toFixed(0)} ms`}
          </div>
        </>
      )}

      {deltasAll.length > 0 && deltas.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Влияние на результат' : 'Impact on outcome'} />
          <WinRateComparison
            cleanCount={deltas.length} cleanWins={deltas.length}
            otherCount={deltasAll.length - deltas.length} otherWins={0}
            lang={lang}
            cleanLabel={ru ? 'Попал первой пулей' : 'First bullet hit'}
            otherLabel={ru ? 'Промахнулся первой' : 'First bullet missed'}
          />
        </>
      )}

      <SectionHeading label={ru ? 'Что это значит' : 'What this means'} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
      }}>
        {ru
          ? 'Реакция в попаданиях — время реакции только в тех дуэлях, где первая пуля попала во врага. Это точнее оценивает, как быстро ты реагируешь, когда правильно целишься — без промахов, которые искажают общее среднее. Ниже = быстрее.'
          : 'Reaction on hits shows your reaction time only in duels where your first bullet hit the enemy. This is a cleaner measure of how fast you react when you are properly aimed — without misses that inflate the overall average. Lower is better.'}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ passive angle page

function PassiveAnglePage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>
  lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const count = (m as any).passiveAngleCount ?? 0
  const ru = lang === 'ru'
  // passive_angle is an attacker error: duels where we were attacker and had passive_angle
  const passiveDuels = analytics.duels.filter(d => d.errors.includes('passive_angle'))
  const cleanDuels = analytics.duels.filter(d => d.won !== undefined && !d.errors.includes('passive_angle') && d.won)

  const [filter, setFilter] = useState<'passive' | 'clean'>('passive')
  const shown = filter === 'passive' ? passiveDuels : cleanDuels

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of passiveDuels) roundOutcomes[d.round] = d.won ? 'kill' : 'death'

  return (
    <div>
      <MetricHero
        title={ru ? 'Пассивный угол' : 'Passive angle'}
        subtitle={ru
          ? `${count} дуэлей — стоял без движения на открытой позиции перед выстрелом`
          : `${count} duels — stood still in an exposed position before shooting`}
        value={String(count)} metricKey="passiveAngleCount" lang={lang} higherIsBetter={false}
      />

      {passiveDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Структура' : 'Breakdown'} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 20 }}>
            {[
              { key: 'passive' as const, label: ru ? 'Пассивный угол' : 'Passive angle', count: passiveDuels.length, color: 'var(--accent2)' },
              { key: 'clean' as const, label: ru ? 'Чистые (победы)' : 'Clean (wins)', count: cleanDuels.length, color: 'var(--green)' },
            ].map(({ key, label, count: c, color }) => {
              const total = passiveDuels.length + cleanDuels.length
              const pct = total > 0 ? Math.round(c / total * 100) : 0
              return (
                <div key={key} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{c}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>{pct}%</div>
                  <div style={{ height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .3s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <SectionHeading label={ru ? 'Что это значит' : 'What this means'} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {ru
          ? 'Пассивный угол — ты стоял на месте (смещение < 40 единиц) в течение нескольких тиков перед первым выстрелом на открытой позиции. Это даёт врагу легкий тейк — он уже знает, где ты. Используй быстрые пики или смещайся перед входом в контакт.'
          : 'Passive angle — you were stationary (displacement < 40 units) for several ticks before your first shot from an exposed position. This gives the enemy an easy take — they already know where you are. Use quick peeks or shift position before engaging.'}
      </div>

      {passiveDuels.length > 0 && (
        <>
          <SectionHeading label={ru ? 'Эпизоды из этой демки' : 'Episodes from this demo'} />
          <FilterBar
            options={[
              { key: 'passive' as const, label: ru ? `Пассивные (${passiveDuels.length})` : `Passive (${passiveDuels.length})`, color: 'var(--accent2)' },
              { key: 'clean' as const, label: ru ? `Чистые (${cleanDuels.length})` : `Clean (${cleanDuels.length})`, color: 'var(--green)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
          <SectionHeading label={ru ? 'По раундам матча' : 'By round'} />
          <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
        </>
      )}
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
      <div style={{ height: 36, marginBottom: 16 }} className="skeleton" />
      <div className="card">
        <div style={{ marginBottom: 28 }}>
          <div className="skeleton" style={{ height: 12, width: 120, borderRadius: 4, marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 48, width: 160, borderRadius: 6 }} />
        </div>
        <div className="skeleton" style={{ height: 12, width: 180, borderRadius: 4, marginBottom: 16 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 52, borderRadius: 6 }} />
          ))}
        </div>
      </div>
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
        return <DisciplinePage analytics={analytics} playerNames={playerNames} lang={lang} activeKey="shiftPeekPct" />
      case 'isolatedPct':
        return <DisciplinePage analytics={analytics} playerNames={playerNames} lang={lang} activeKey="isolatedPct" />
      case 'counterStrafeErrors':
        return <CounterStrafeErrorsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'ttk_ms':
        return <TtkPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'clutchWinPct':
        return <ClutchWinPctPage analytics={analytics} playerData={p!} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'flashEfficiency':
        return <FlashEfficiencyPage analytics={analytics} playerNames={playerNames} lang={lang} />
      case 'reloadErrors':
        return <ReloadErrorsPage analytics={analytics} lang={lang} totalRounds={totalRounds} />
      case 'angleControlCount':
        return <AngleControlPage analytics={analytics} lang={lang} totalRounds={totalRounds} />
      case 'reactionTimeMs':
        return <ReactionTimePage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'successfulReactionTimeMs':
        return <SuccessfulReactionTimePage analytics={analytics} lang={lang} />
      case 'overshootCount':
        return <OvershootPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'excellentContacts':
        return <ExcellentContactsPage analytics={analytics} lang={lang} totalRounds={totalRounds} />
      case 'crosshairPlacementPct':
        return <CrosshairPlacementPage analytics={analytics} lang={lang} />
      case 'missedFirst':
        return <MissedFirstPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'passiveAngle':
        return <PassiveAnglePage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
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
      <MatchNav id={id!} players={data.players} currentSteamid={steamid} />
      <div style={{ marginBottom: 16 }}>
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
