import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { api, PlayerAnalyticsData, DuelEpisode, TeamKillEpisode, AnalysisData, FirstBulletShot } from '../api'
import { useLang, useBenchmarks } from '../App'
import { t } from '../i18n'
import { getTier, TIER_COLORS, tierLabel, formatTierTooltip } from '../benchmarkUtils'
import EpisodeDrillDown from '../components/player/EpisodeDrillDown'
import WeaponIcon from '../components/WeaponIcon'
import MatchNav from '../components/MatchNav'

type RoundOutcome = 'kill' | 'death' | 'draw' | 'tk' | 'none'

function prettyWeapon(raw: string): string {
  const id = raw.replace(/^weapon_/, '')
  return t('metrics:weapon.' + id, { defaultValue: id.replace(/_/g, ' ') })
}

// ------------------------------------------------------------------ MetricHero

function MetricHero({ title, subtitle, value, metricKey, lang, higherIsBetter = true }: {
  title: string; subtitle?: string; value: string; metricKey?: string; lang: 'ru' | 'en'; higherIsBetter?: boolean
}) {
  const benchmarks = useBenchmarks()
  const [showTip, setShowTip] = useState(false)
  const rawNum = parseFloat(value)
  const tier = !isNaN(rawNum) && metricKey
    ? getTier(benchmarks, metricKey, rawNum, higherIsBetter) : null
  const tiers = metricKey ? benchmarks[metricKey] : undefined
  const tip = tiers && !isNaN(rawNum) ? formatTierTooltip(tiers, rawNum, higherIsBetter) : null
  const color = tier ? TIER_COLORS[tier] : 'var(--text)'
  const label = tier ? tierLabel(tier) : null
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
        {duel.won ? t('metrics:duel.win') : t('metrics:duel.loss')}
      </span>
      <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {attName} → {vicName}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <WeaponIcon id={duel.weapon.replace(/^weapon_/, '')} name={prettyWeapon(duel.weapon)} size={13} />
        {prettyWeapon(duel.weapon)}
      </span>
      {duel.headshot && <img src="/icons/weapons/icon_headshot.svg" alt="HS" title="HS" width={13} height={13} />}
      {duel.errors.filter(e => e !== 'strong_duel').map(e => (
        <span key={e} style={{ fontSize: 10, color: 'var(--red)', background: 'rgba(220,80,80,.15)', borderRadius: 3, padding: '1px 5px' }}>
          {t('metrics:error.' + e, { defaultValue: e })}
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

// cap for the episode list scroll area (shrinks with content, scrolls at the cap)
const EPISODE_VIEW_H = 'calc(100vh - 250px)'

function EpisodeList({ duels, playerNames, lang }: {
  duels: DuelEpisode[]; playerNames: Record<string, string>; lang: 'ru' | 'en'
}) {
  const [sel, setSel] = useState(0)
  const [drill, setDrill] = useState(false)
  if (!duels.length) return (
    <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
      {t('metrics:shared.noEpisodes')}
    </div>
  )
  return (
    <div>
      <div style={{ color: 'var(--text2)', fontSize: 11, margin: '2px 0 6px' }}>
        {t('metrics:shared.clickRow')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: EPISODE_VIEW_H, overflowY: 'auto' }}>
        {duels.map((d, i) => (
          <DuelRow
            key={i} duel={d} playerNames={playerNames} idx={i} lang={lang}
            selected={i === sel}
            onClick={() => { setSel(i); setDrill(true) }}
          />
        ))}
      </div>
      {drill && (
        <EpisodeDrillDown duel={duels[sel]} playerNames={playerNames} lang={lang} onClose={() => setDrill(false)} />
      )}
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
    kill: 'var(--green)', death: 'var(--red)', draw: 'var(--accent2)',
    tk: '#e8a33d', none: 'var(--bg3)',
  }
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(34px, 1fr))', gap: 6 }}>
        {Array.from({ length: totalRounds }, (_, i) => i + 1).map(n => {
          const outcome = roundOutcomes[n] ?? 'none'
          const color = DOT_COLORS[outcome]
          return (
            <div key={n} title={`R${n}: ${t('metrics:outcome.' + outcome)}`} style={{
              aspectRatio: '1', borderRadius: 4,
              background: outcome === 'none' ? 'var(--bg3)' : `${color}33`,
              border: `1px solid ${color}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: outcome === 'none' ? 'var(--text3)' : color,
              fontWeight: 600, cursor: 'default',
            }}>{n}</div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--text2)', flexWrap: 'wrap' }}>
        <span><span style={{ color: 'var(--green)' }}>■</span> {t('metrics:outcome.kill')}</span>
        <span><span style={{ color: 'var(--red)' }}>■</span> {t('metrics:outcome.death')}</span>
        <span><span style={{ color: 'var(--accent2)' }}>■</span> {t('metrics:outcome.draw')}</span>
        <span><span style={{ color: '#e8a33d' }}>■</span> {t('metrics:outcome.tk')}</span>
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
  const cleanPct = cleanCount > 0 ? (cleanWins / cleanCount * 100) : 0
  const otherPct = otherCount > 0 ? (otherWins / otherCount * 100) : 0
  const delta = cleanPct - otherPct
  const deltaColor = delta >= 5 ? 'var(--green)' : delta <= -5 ? 'var(--red)' : 'var(--text2)'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 20 }}>
      {[
        { label: cleanLabel ?? t('metrics:winRate.cleanDefault'), pct: cleanPct, n: cleanCount, good: true },
        { label: otherLabel ?? t('metrics:winRate.otherDefault'), pct: otherPct, n: otherCount, good: false },
      ].map(({ label, pct, n, good }) => (
        <div key={label} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: good ? 'var(--green)' : 'var(--text)', lineHeight: 1, marginBottom: 4 }}>
            {pct.toFixed(1)}%
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>{t('metrics:winRate.duels', { n })}</div>
        </div>
      ))}
      {cleanCount > 0 && otherCount > 0 && (
        <div style={{ gridColumn: '1 / -1', fontSize: 12, color: deltaColor, fontWeight: 700, textAlign: 'center', paddingTop: 2 }}>
          {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% {t('metrics:winRate.toWin')}
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
  const nonOpeningDuels = analytics.duels.filter(d => !d.opening)
  const won = openingDuels.filter(d => d.won)
  const lost = openingDuels.filter(d => !d.won)
  const pct = analytics.metrics.openingWinPct
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all')
  const shown = filter === 'won' ? won : filter === 'lost' ? lost : openingDuels
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of openingDuels) roundOutcomes[d.round] = d.won ? 'kill' : 'death'
  return (
    <div>
      <MetricHero
        title={t('metrics:opening.title')}
        subtitle={t('metrics:opening.subtitle', { won: won.length, lost: lost.length })}
        value={pct.toFixed(1) + '%'} metricKey="openingWinPct" lang={lang}
      />
      {openingDuels.length > 0 && nonOpeningDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={openingDuels.length} cleanWins={won.length}
            otherCount={nonOpeningDuels.length} otherWins={nonOpeningDuels.filter(d => d.won).length}
            lang={lang}
            cleanLabel={t('metrics:opening.cleanLabel')}
            otherLabel={t('metrics:shared.otherDuels')}
          />
        </>
      )}
      <SectionHeading label={t('metrics:shared.episodes')} />
      {openingDuels.length > 0 ? (
        <>
          <FilterBar
            options={[
              { key: 'all'  as const, label: t('metrics:shared.filterAll', { n: openingDuels.length }) },
              { key: 'won'  as const, label: t('metrics:shared.filterWon', { n: won.length }), color: 'var(--green)' },
              { key: 'lost' as const, label: t('metrics:shared.filterLost', { n: lost.length }), color: 'var(--red)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
        </>
      ) : (
        <div style={{ color: 'var(--text2)', fontSize: 13 }}>{t('metrics:opening.empty')}</div>
      )}
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
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
  return (
    <div>
      <MetricHero
        title={t('metrics:idealStrafe.title')}
        subtitle={t('metrics:idealStrafe.subtitle', { stopped: cleanAll.length, moving: movingAll.length, total: allDuels.length })}
        value={pct.toFixed(1) + '%'} metricKey="idealStrafePct" lang={lang}
      />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '12px 16px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {t('metrics:idealStrafe.hint')}
      </div>
      <SectionHeading label={t('metrics:shared.impact')} />
      <WinRateComparison
        cleanCount={cleanAll.length} cleanWins={cleanWins}
        otherCount={movingAll.length} otherWins={movingWins}
        lang={lang}
      />
      <SectionHeading label={t('metrics:shared.episodes')} />
      <FilterBar
        options={[
          { key: 'stopped' as const, label: t('metrics:shared.filterStopped', { n: cleanAll.length }), color: 'var(--green)' },
          { key: 'moving'  as const, label: t('metrics:shared.filterMoving', { n: movingAll.length }), color: 'var(--red)' },
        ]}
        active={filter} onChange={setFilter}
      />
      <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
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

function FirstBulletAccPage({ analytics, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; lang: 'ru' | 'en'; totalRounds: number
}) {
  const shots: FirstBulletShot[] = analytics.metrics.firstBulletShots ?? []
  const pct = analytics.metrics.firstBulletAcc
  const hits = shots.filter(s => s.hit)
  const misses = shots.filter(s => !s.hit)
  const [filter, setFilter] = useState<'all' | 'hit' | 'miss'>('all')
  const shown = filter === 'hit' ? hits : filter === 'miss' ? misses : shots

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

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const s of shots) {
    if (!(s.round in roundOutcomes)) roundOutcomes[s.round] = s.hit ? 'kill' : 'death'
  }

  return (
    <div>
      <MetricHero
        title={t('metrics:firstBullet.title')}
        subtitle={t('metrics:firstBullet.subtitle', { hits: hits.length, misses: misses.length })}
        value={pct.toFixed(1) + '%'} metricKey="firstBulletAcc" lang={lang}
      />

      {/* Win rate comparison */}
      {hitDuels.length > 0 && missDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
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
          <SectionHeading label={t('metrics:firstBullet.byClass')} />
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
                    {t('metrics:weaponClass.' + cls, { defaultValue: cls })}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>
                    {acc}%
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                    {t('metrics:firstBullet.hits', { hit, total })}
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

      <SectionHeading label={t('metrics:shared.episodes')} />
      <FilterBar
        options={[
          { key: 'all'  as const, label: t('metrics:shared.filterAll', { n: shots.length }) },
          { key: 'hit'  as const, label: t('metrics:firstBullet.filterHit', { n: hits.length }), color: 'var(--green)' },
          { key: 'miss' as const, label: t('metrics:firstBullet.filterMiss', { n: misses.length }), color: 'var(--red)' },
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
              {s.hit ? t('metrics:firstBullet.hit') : t('metrics:firstBullet.miss')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>
              {prettyWeapon(s.weapon)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text2)', background: 'var(--bg3)', borderRadius: 3, padding: '1px 5px' }}>
              {t('metrics:weaponClass.' + getWeaponClass(s.weapon), { defaultValue: getWeaponClass(s.weapon) })}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
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
  const episodes = analytics.duels.filter(d => d.isTradeKill)
  const nonTradeEpisodes = analytics.duels.filter(d => !d.isTradeKill)
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const r of rounds) roundOutcomes[r] = 'kill'
  return (
    <div>
      <MetricHero
        title={t('metrics:tradeKills.title')}
        subtitle={t('metrics:tradeKills.subtitle', { n: ticks.length, rounds: rounds.join(', ') || '—' })}
        value={pct.toFixed(1) + '%'} metricKey="tradeKillPct" lang={lang}
      />
      {episodes.length > 0 && nonTradeEpisodes.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={episodes.length} cleanWins={episodes.filter(d => d.won).length}
            otherCount={nonTradeEpisodes.length} otherWins={nonTradeEpisodes.filter(d => d.won).length}
            lang={lang}
            cleanLabel={t('metrics:tradeKills.cleanLabel')}
            otherLabel={t('metrics:shared.otherDuels')}
          />
        </>
      )}
      <SectionHeading label={t('metrics:shared.episodes')} />
      <EpisodeList duels={episodes} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
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
  const episodes = analytics.duels.filter(d => d.isTradedDeath)
  const nonTradedDeaths = analytics.duels.filter(d => !d.isTradedDeath)
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const r of rounds) roundOutcomes[r] = 'draw'
  return (
    <div>
      <MetricHero
        title={t('metrics:tradedDeaths.title')}
        subtitle={t('metrics:tradedDeaths.subtitle', { n: ticks.length, rounds: rounds.join(', ') || '—' })}
        value={pct.toFixed(1) + '%'} metricKey="tradedDeathPct" lang={lang}
      />
      {episodes.length > 0 && nonTradedDeaths.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={episodes.length} cleanWins={episodes.filter(d => d.won).length}
            otherCount={nonTradedDeaths.length} otherWins={nonTradedDeaths.filter(d => d.won).length}
            lang={lang}
            cleanLabel={t('metrics:tradedDeaths.cleanLabel')}
            otherLabel={t('metrics:shared.otherDuels')}
          />
        </>
      )}
      <SectionHeading label={t('metrics:shared.episodes')} />
      <EpisodeList duels={episodes} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ team kills page

function TeamKillRow({ tk, playerNames, selected, onClick }: {
  tk: TeamKillEpisode; playerNames: Record<string, string>; selected: boolean; onClick: () => void
}) {
  const attName = playerNames[tk.attacker] ?? tk.attacker.slice(-6)
  const vicName = playerNames[tk.victim] ?? tk.victim.slice(-6)
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: selected ? 'var(--bg3)' : 'rgba(232,163,61,0.06)',
      border: `1px solid ${selected ? 'var(--accent)' : '#e8a33d'}`,
      borderRadius: 6, padding: '8px 12px', cursor: 'pointer', transition: 'background .1s',
    }}>
      <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 28 }}>R{tk.round}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#e8a33d', minWidth: 50 }}>
        {t('metrics:teamKills.badge')}
      </span>
      <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {attName} → {vicName}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <WeaponIcon id={tk.weapon.replace(/^weapon_/, '')} name={prettyWeapon(tk.weapon)} size={13} />
        {prettyWeapon(tk.weapon)}
      </span>
      {tk.headshot && <img src="/icons/weapons/icon_headshot.svg" alt="HS" title="HS" width={13} height={13} />}
    </div>
  )
}

function TeamKillsPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const episodes = analytics.teamKills ?? []
  const rounds = analytics.metrics.teamKillRounds ?? []
  const count = analytics.metrics.teamKills ?? episodes.length
  const [sel, setSel] = useState(0)
  const [drill, setDrill] = useState(false)
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const r of rounds) roundOutcomes[r] = 'tk'
  return (
    <div>
      <MetricHero
        title={t('metrics:teamKills.title')}
        subtitle={t('metrics:teamKills.subtitle', { n: count, rounds: rounds.join(', ') || '—' })}
        value={String(count)} lang={lang}
      />
      <SectionHeading label={t('metrics:shared.whatItMeans')} />
      <div className="card" style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.55, marginBottom: 20 }}>
        {t('metrics:teamKills.explanation')}
      </div>
      <SectionHeading label={t('metrics:shared.episodes')} />
      {!episodes.length ? (
        <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
          {t('metrics:shared.noEpisodes')}
        </div>
      ) : (
        <div>
          <div style={{ color: 'var(--text2)', fontSize: 11, margin: '2px 0 6px' }}>
            {t('metrics:shared.clickRow')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: EPISODE_VIEW_H, overflowY: 'auto' }}>
            {episodes.map((tk, i) => (
              <TeamKillRow
                key={i} tk={tk} playerNames={playerNames}
                selected={i === sel}
                onClick={() => { setSel(i); setDrill(true) }}
              />
            ))}
          </div>
          {drill && (
            <EpisodeDrillDown
              duel={episodes[sel] as unknown as DuelEpisode}
              playerNames={playerNames} lang={lang} isTeamKill onClose={() => setDrill(false)}
            />
          )}
        </div>
      )}
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

function LostDuelsPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const lost = analytics.duels.filter(d => !d.won)
  const flashed = lost.filter(d => d.errors.includes('flashed'))
  const moving = lost.filter(d => d.errors.includes('moving_shot'))
  const outnumbered = lost.filter(d => d.errors.includes('outnumbered'))
  const clean = lost.filter(d => d.errors.length === 0)
  const other = lost.filter(d => d.errors.length > 0 && !d.errors.includes('flashed') && !d.errors.includes('moving_shot') && !d.errors.includes('outnumbered'))
  const [filter, setFilter] = useState<'all' | 'flashed' | 'moving' | 'outnumbered' | 'clean'>('all')
  const shown = filter === 'flashed' ? flashed : filter === 'moving' ? moving
    : filter === 'outnumbered' ? outnumbered : filter === 'clean' ? clean : lost

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of lost) roundOutcomes[d.round] = 'death'

  // WinRateComparison: rounds with no deaths vs rounds with at least one death
  const lostRounds = new Set(lost.map(d => d.round))
  const allDuels = analytics.duels
  const cleanRoundDuels = allDuels.filter(d => !lostRounds.has(d.round))
  const lostRoundDuels = allDuels.filter(d => lostRounds.has(d.round))

  const breakdownItems = [
    { label: t('metrics:lostDuels.flashed'), count: flashed.length, color: 'var(--accent2)' },
    { label: t('metrics:lostDuels.moving'), count: moving.length, color: 'var(--accent)' },
    { label: t('metrics:lostDuels.outnumbered'), count: outnumbered.length, color: 'var(--red)' },
    { label: t('metrics:lostDuels.otherErrors'), count: other.length, color: 'var(--text2)' },
    { label: t('metrics:lostDuels.clean'), count: clean.length, color: '#7ec8e3' },
  ].filter(b => b.count > 0)

  return (
    <div>
      <MetricHero
        title={t('metrics:lostDuels.title')}
        subtitle={t('metrics:lostDuels.subtitle', { n: lost.length })}
        value={String(lost.length)} metricKey="lostDuels" lang={lang}
      />

      {lostRoundDuels.length > 0 && cleanRoundDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={cleanRoundDuels.length} cleanWins={cleanRoundDuels.filter(d => d.won).length}
            otherCount={lostRoundDuels.length} otherWins={lostRoundDuels.filter(d => d.won).length}
            lang={lang}
            cleanLabel={t('metrics:lostDuels.cleanLabel')}
            otherLabel={t('metrics:lostDuels.otherLabel')}
          />
        </>
      )}

      {breakdownItems.length > 0 && (
        <>
          <SectionHeading label={t('metrics:lostDuels.causes')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
            {breakdownItems.map(({ label, count, color }) => {
              const pct = lost.length > 0 ? Math.round(count / lost.length * 100) : 0
              return (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 120, fontSize: 12, color: 'var(--text2)', flexShrink: 0 }}>{label}</div>
                  <div style={{ flex: 1, height: 8, background: 'var(--bg2)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .3s' }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color, minWidth: 52, textAlign: 'right' }}>
                    {count} ({pct}%)
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <SectionHeading label={t('metrics:shared.episodes')} />
      <FilterBar
        options={[
          { key: 'all'        as const, label: t('metrics:shared.filterAll', { n: lost.length }) },
          { key: 'flashed'    as const, label: t('metrics:lostDuels.filterFlashed', { n: flashed.length }), color: 'var(--accent2)' },
          { key: 'moving'     as const, label: t('metrics:lostDuels.filterMoving', { n: moving.length }), color: 'var(--accent)' },
          { key: 'outnumbered'as const, label: t('metrics:lostDuels.filterOutnumbered', { n: outnumbered.length }), color: 'var(--red)' },
          { key: 'clean'      as const, label: t('metrics:lostDuels.filterClean', { n: clean.length }) },
        ]}
        active={filter} onChange={setFilter}
      />
      <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
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
  const errCount = m.counterStrafeErrors ?? 0
  return (
    <div>
      <MetricHero
        title={t('metrics:counterStrafe.title')}
        subtitle={t('metrics:counterStrafe.subtitle')}
        value={String(errCount)} metricKey="counterStrafeErrors" lang={lang} higherIsBetter={false}
      />
      <SectionHeading label={t('metrics:shared.impact')} />
      <WinRateComparison
        cleanCount={cleanDuels.length} cleanWins={cleanWins}
        otherCount={movingDuels.length} otherWins={movingWins}
        lang={lang}
      />
      <SectionHeading label={t('metrics:counterStrafe.movingDuels')} />
      {movingDuels.length > 0 ? (
        <>
          <FilterBar
            options={[
              { key: 'all'  as const, label: t('metrics:shared.filterAll', { n: movingDuels.length }) },
              { key: 'won'  as const, label: t('metrics:shared.filterWon', { n: movingWins }), color: 'var(--green)' },
              { key: 'lost' as const, label: t('metrics:shared.filterLost', { n: movingDuels.length - movingWins }), color: 'var(--red)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
          <div style={{ marginTop: 24 }}>
            <SectionHeading label={t('metrics:shared.byRound')} />
            <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
          </div>
        </>
      ) : (
        <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
          {t('metrics:counterStrafe.empty')}
        </div>
      )}
    </div>
  )
}

function DisciplinePage({ analytics, playerNames, lang, activeKey, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>
  lang: 'ru' | 'en'; activeKey: 'shiftPeekPct' | 'isolatedPct'; totalRounds: number
}) {
  const m = analytics.metrics
  const shiftDuels = analytics.duels.filter(d => d.errors.includes('shift_peek'))
  const isoDuels = analytics.duels.filter(d => d.errors.includes('isolated'))
  const cleanDuels = analytics.duels.filter(d => !d.errors.includes('shift_peek') && !d.errors.includes('isolated'))
  const defaultFilter = activeKey === 'shiftPeekPct' ? 'shift_peek' : 'isolated'
  const [filter, setFilter] = useState<'shift_peek' | 'isolated'>(defaultFilter)
  const shown = filter === 'shift_peek' ? shiftDuels : isoDuels

  const isShift = activeKey === 'shiftPeekPct'
  const activeDuels = isShift ? shiftDuels : isoDuels
  const heroValue = isShift ? m.shiftPeekPct.toFixed(1) + '%' : m.isolatedPct.toFixed(1) + '%'
  const heroTitle = isShift ? t('metrics:discipline.shiftTitle') : t('metrics:discipline.isolatedTitle')
  const heroSub = isShift
    ? t('metrics:discipline.shiftSubtitle')
    : t('metrics:discipline.isolatedSubtitle')

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of activeDuels) roundOutcomes[d.round] = d.won ? 'kill' : 'death'

  return (
    <div>
      <MetricHero
        title={heroTitle} subtitle={heroSub}
        value={heroValue} metricKey={activeKey} lang={lang} higherIsBetter={false}
      />
      {activeDuels.length > 0 && cleanDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={activeDuels.length} cleanWins={activeDuels.filter(d => d.won).length}
            otherCount={cleanDuels.length} otherWins={cleanDuels.filter(d => d.won).length}
            lang={lang}
            cleanLabel={isShift ? t('metrics:discipline.shiftTitle') : t('metrics:discipline.isolatedClean')}
            otherLabel={t('metrics:shared.otherDuels')}
          />
        </>
      )}
      <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
        <StatBar label={t('metrics:discipline.shiftTitle')} value={m.shiftPeekPct} max={100} color={m.shiftPeekPct > 30 ? 'var(--accent2)' : 'var(--green)'} />
        <StatBar label={t('metrics:discipline.isolatedTitle')} value={m.isolatedPct} max={100} color={m.isolatedPct > 30 ? 'var(--red)' : 'var(--green)'} />
      </div>
      <SectionHeading label={t('metrics:shared.episodes')} />
      <FilterBar
        options={[
          { key: 'shift_peek' as const, label: t('metrics:discipline.filterShift', { n: shiftDuels.length }), color: 'var(--accent2)' },
          { key: 'isolated'   as const, label: t('metrics:discipline.filterIsolated', { n: isoDuels.length }), color: 'var(--red)' },
        ]}
        active={filter} onChange={setFilter}
      />
      <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
      {activeDuels.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SectionHeading label={t('metrics:shared.byRound')} />
          <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
        </div>
      )}
    </div>
  )
}

function TtkPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const allDuels = analytics.duels
  const won = allDuels.filter(d => d.won)
  const [filter, setFilter] = useState<'all' | 'stopped' | 'moving'>('all')
  const stopped = won.filter(d => !d.errors.includes('moving_shot'))
  const moving = won.filter(d => d.errors.includes('moving_shot'))
  const shown = filter === 'stopped' ? stopped : filter === 'moving' ? moving : won
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of won) roundOutcomes[d.round] = 'kill'
  const val = (m.ttk_ms ?? 0) > 0 ? t('metrics:ttk.value', { value: m.ttk_ms.toFixed(0) }) : '—'
  return (
    <div>
      <MetricHero
        title={t('metrics:ttk.title')}
        subtitle={t('metrics:ttk.subtitle')}
        value={val} metricKey="ttk_ms" lang={lang} higherIsBetter={false}
      />
      <SectionHeading label={t('metrics:ttk.wonHeading')} />
      <FilterBar
        options={[
          { key: 'all'     as const, label: t('metrics:shared.filterAll', { n: won.length }) },
          { key: 'stopped' as const, label: t('metrics:shared.filterStopped', { n: stopped.length }), color: 'var(--green)' },
          { key: 'moving'  as const, label: t('metrics:shared.filterMoving', { n: moving.length }), color: 'var(--red)' },
        ]}
        active={filter} onChange={setFilter}
      />
      <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
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
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const location = useLocation()

  const list = clutches.list ?? []
  const wonList = list.filter(c => c.won)
  const lostList = list.filter(c => !c.won)
  const shown = filter === 'won' ? wonList : filter === 'lost' ? lostList : list

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const c of list) roundOutcomes[c.round] = c.won ? 'kill' : 'death'

  // WinRateComparison: clutch rounds vs non-clutch duels
  const clutchRounds = new Set(list.map(c => c.round))
  const nonClutchDuels = analytics.duels.filter(d => !clutchRounds.has(d.round))

  const byX = clutches.byX ?? {}
  const sizes = Object.keys(byX).sort()

  return (
    <div>
      <MetricHero
        title={t('metrics:clutch.title')}
        subtitle={t('metrics:clutch.subtitle', { won: clutches.won, played: clutches.played })}
        value={m.clutchWinPct.toFixed(1) + '%'} metricKey="clutchWinPct" lang={lang}
      />

      {list.length > 0 && nonClutchDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={nonClutchDuels.length} cleanWins={nonClutchDuels.filter(d => d.won).length}
            otherCount={list.length} otherWins={wonList.length}
            lang={lang}
            cleanLabel={t('metrics:clutch.normalRounds')}
            otherLabel={t('metrics:clutch.rounds')}
          />
        </>
      )}

      {sizes.length > 0 && (
        <>
          <SectionHeading label={t('metrics:clutch.byEnemies')} />
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
                    {t('metrics:clutch.vs', { n: k })}
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
          <SectionHeading label={t('metrics:clutch.rounds')} />
          <FilterBar
            options={[
              { key: 'all'  as const, label: t('metrics:shared.filterAll', { n: list.length }) },
              { key: 'won'  as const, label: t('metrics:shared.filterWon', { n: wonList.length }), color: 'var(--green)' },
              { key: 'lost' as const, label: t('metrics:shared.filterLost', { n: lostList.length }), color: 'var(--red)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {shown.map(c => {
              const clickable = !!c.t0
              return (
                <div key={c.round} onClick={() => {
                  if (clickable) nav(`/match/${id}/replay`, { state: { from: location.pathname, seekTick: c.t0 } })
                }} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--bg2)', borderRadius: 6, padding: '8px 12px',
                  border: `1px solid ${c.won ? 'var(--green)' : 'var(--red)'}`,
                  cursor: clickable ? 'pointer' : 'default', transition: 'background .1s',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 60 }}>
                    {t('metrics:clutch.round', { n: c.round })}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {t('metrics:clutch.vs', { n: c.enemies })}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                    {c.kills > 0 ? `${c.kills} kill${c.kills > 1 ? 's' : ''}` : ''}
                  </span>
                  <span style={{
                    marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                    color: c.won ? 'var(--green)' : 'var(--red)'
                  }}>
                    {c.won ? t('metrics:clutch.won') : t('metrics:clutch.lost')}
                  </span>
                  {clickable && <span style={{ fontSize: 11, color: 'var(--text2)' }}>▶</span>}
                </div>
              )
            })}
          </div>
          <SectionHeading label={t('metrics:shared.byRound')} />
          <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
        </>
      ) : (
        <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
          {t('metrics:clutch.empty')}
        </div>
      )}
    </div>
  )
}

function FlashEfficiencyPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const flashedDuels = analytics.duels.filter(d => d.errors.includes('flashed'))
  const flashedWon = flashedDuels.filter(d => d.won)
  const flashedLost = flashedDuels.filter(d => !d.won)
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all')
  const shown = filter === 'won' ? flashedWon : filter === 'lost' ? flashedLost : flashedDuels

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of flashedDuels) roundOutcomes[d.round] = d.won ? 'kill' : 'death'

  return (
    <div>
      <MetricHero
        title={t('metrics:flash.title')}
        subtitle={t('metrics:flash.subtitle')}
        value={m.flashEfficiency.toFixed(1) + '%'} metricKey="flashEfficiency" lang={lang}
      />
      {flashedDuels.length > 0 ? (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={flashedDuels.length} cleanWins={flashedWon.length}
            otherCount={analytics.duels.filter(d => !d.errors.includes('flashed')).length}
            otherWins={analytics.duels.filter(d => !d.errors.includes('flashed') && d.won).length}
            lang={lang}
            cleanLabel={t('metrics:flash.whileFlashed')}
            otherLabel={t('metrics:flash.notFlashed')}
          />
          <SectionHeading label={t('metrics:flash.duelsHeading')} />
          <FilterBar
            options={[
              { key: 'all'  as const, label: t('metrics:shared.filterAll', { n: flashedDuels.length }) },
              { key: 'won'  as const, label: t('metrics:shared.filterWon', { n: flashedWon.length }), color: 'var(--green)' },
              { key: 'lost' as const, label: t('metrics:shared.filterLost', { n: flashedLost.length }), color: 'var(--red)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
          <div style={{ marginTop: 24 }}>
            <SectionHeading label={t('metrics:shared.byRound')} />
            <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
          </div>
        </>
      ) : (
        <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
          {t('metrics:flash.empty')}
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
  return (
    <div>
      <MetricHero
        title={t('metrics:reload.title')}
        subtitle={t('metrics:reload.subtitle')}
        value={String(reloadErrors)} metricKey="reloadErrors" lang={lang} higherIsBetter={false}
      />

      <SectionHeading label={t('metrics:reload.stats')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { label: t('metrics:reload.early'), value: String(reloadErrors) },
          { label: t('metrics:reload.duelsPlayed'), value: String(totalDuels) },
          { label: t('metrics:reload.per100'), value: totalShots > 0 ? String(per100) : '—' },
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
      <SectionHeading label={t('metrics:shared.whatItMeans')} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 24,
      }}>
        {t('metrics:reload.explanation')}
      </div>
      <div style={{ marginTop: 8 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
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
  const byPhase = m.angleControlByPhase

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of analytics.duels) {
    if (!(d.round in roundOutcomes)) roundOutcomes[d.round] = d.won ? 'kill' : 'death'
  }

  const phaseRows = byPhase ? [
    { key: 'early', label: t('metrics:angleControl.phaseEarly'), count: byPhase.early, color: 'var(--green)' },
    { key: 'mid',   label: t('metrics:angleControl.phaseMid'),   count: byPhase.mid,   color: 'var(--accent2)' },
    { key: 'late',  label: t('metrics:angleControl.phaseLate'),  count: byPhase.late,  color: 'var(--red)' },
  ] : []

  return (
    <div>
      <MetricHero
        title={t('metrics:angleControl.title')}
        subtitle={t('metrics:angleControl.subtitle')}
        value={String(count)} metricKey="angleControlCount" lang={lang}
      />

      {phaseRows.length > 0 && count > 0 && (
        <>
          <SectionHeading label={t('metrics:angleControl.whenHeading')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {phaseRows.map(({ key, label, count: c, color }) => {
              const pct = count > 0 ? Math.round(c / count * 100) : 0
              return (
                <div key={key} style={{
                  background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color, minWidth: 36, textAlign: 'right' }}>{c}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>{label}</div>
                    <div style={{ height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .3s' }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', minWidth: 36 }}>{pct}%</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <SectionHeading label={t('metrics:shared.whatItMeans')} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {t('metrics:angleControl.explanation')}
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
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
  const rt = m.reactionTimeMs ?? 0
  const wonDuels = analytics.duels.filter(d => d.won)
  const deltas: number[] = m.reactionDeltas ?? []

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
        title={t('metrics:reaction.title')}
        subtitle={t('metrics:reaction.subtitle')}
        value={rt > 0 ? t('metrics:reaction.value', { value: rt.toFixed(0) }) : '—'}
        metricKey="reactionTimeMs" lang={lang} higherIsBetter={false}
      />

      {deltas.length > 0 && (
        <>
          <SectionHeading label={t('metrics:reaction.distribution')} />
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
            {t('metrics:reaction.summary', { n: deltas.length, avg: rt.toFixed(0), min: Math.min(...deltas).toFixed(0), max: Math.max(...deltas).toFixed(0) })}
          </div>
        </>
      )}

      <SectionHeading label={t('metrics:shared.whatItMeans')} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {t('metrics:reaction.explanation')}
      </div>

      {wonDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:reaction.wonHeading')} />
          <EpisodeList duels={wonDuels} playerNames={playerNames} lang={lang} />
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
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
  const ov = m.overshootCount ?? 0
  const allDuels = analytics.duels
  const wonDuels = allDuels.filter(d => d.won)
  const overshootDuels = wonDuels.filter(d => d.errors.includes('overshoot'))
  const undershootDuels = wonDuels.filter(d => d.errors.includes('undershoot'))
  const cleanDuels = wonDuels.filter(d => !d.errors.includes('overshoot') && !d.errors.includes('undershoot'))

  // For WinRateComparison: use ALL duels in rounds that had aim errors vs rounds without
  const aimErrRounds = new Set([...overshootDuels, ...undershootDuels].map(d => d.round))
  const cleanRounds = new Set(cleanDuels.map(d => d.round).filter(r => !aimErrRounds.has(r)))
  const allAimErrRoundDuels = allDuels.filter(d => aimErrRounds.has(d.round))
  const allCleanRoundDuels = allDuels.filter(d => cleanRounds.has(d.round))

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
        title={t('metrics:overshoot.title')}
        subtitle={t('metrics:overshoot.subtitle', { overshoots: overshootDuels.length, undershoots: undershootDuels.length, clean: cleanDuels.length, wins: wonDuels.length })}
        value={String(ov)}
        metricKey="overshootCount" lang={lang} higherIsBetter={false}
      />

      {overshootDuels.length > 0 && cleanDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={allCleanRoundDuels.length} cleanWins={allCleanRoundDuels.filter(d => d.won).length}
            otherCount={allAimErrRoundDuels.length} otherWins={allAimErrRoundDuels.filter(d => d.won).length}
            lang={lang}
            cleanLabel={t('metrics:overshoot.cleanAim')}
            otherLabel={t('metrics:overshoot.aimError')}
          />
        </>
      )}

      {/* split bar */}
      {wonDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.winBreakdown')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
            {[
              { key: 'overshoot' as const, label: t('metrics:overshoot.overshoot'), count: overshootDuels.length, color: 'var(--red)' },
              { key: 'undershoot' as const, label: t('metrics:overshoot.undershoot'), count: undershootDuels.length, color: 'var(--accent2)' },
              { key: 'clean' as const, label: t('metrics:overshoot.clean'), count: cleanDuels.length, color: 'var(--green)' },
            ].map(({ key, label, count, color }) => {
              const pct = wonDuels.length > 0 ? Math.round(count / wonDuels.length * 100) : 0
              return (
                <div key={key} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{count}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>{pct}% {t('metrics:shared.ofWins')}</div>
                  <div style={{ height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .3s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <SectionHeading label={t('metrics:shared.whatItMeans')} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {t('metrics:overshoot.explanation')}
      </div>

      {wonDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.episodes')} />
          <FilterBar
            options={[
              { key: 'overshoot' as const, label: t('metrics:overshoot.filterOvershoot', { n: overshootDuels.length }), color: 'var(--red)' },
              { key: 'undershoot' as const, label: t('metrics:overshoot.filterUndershoot', { n: undershootDuels.length }), color: 'var(--accent2)' },
              { key: 'clean' as const, label: t('metrics:overshoot.filterClean', { n: cleanDuels.length }), color: 'var(--green)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ crosshair placement page

function CrosshairPlacementPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const pct = m.crosshairPlacementPct ?? 0
  const duels = analytics.duels

  // exact episodes: duels where the crosshair was on the enemy when the peek started
  const goodTicks = m.crosshairGoodTicks ?? []
  const goodDuels = duels.filter(d => d.won && goodTicks.includes(d.tick))

  const goodRounds = new Set(goodDuels.map(d => d.round))
  const goodRoundDuels = duels.filter(d => goodRounds.has(d.round))
  const otherRoundDuels = duels.filter(d => !goodRounds.has(d.round))

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of duels) {
    if (!(d.round in roundOutcomes)) roundOutcomes[d.round] = d.won ? 'kill' : 'death'
  }

  return (
    <div>
      <MetricHero
        title={t('metrics:crosshair.title')}
        subtitle={t('metrics:crosshair.subtitle', { n: goodDuels.length })}
        value={pct.toFixed(1) + '%'} metricKey="crosshairPlacementPct" lang={lang}
      />

      <SectionHeading label={t('metrics:shared.whatItMeans')} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {t('metrics:crosshair.explanation', { deg: 25 })}
      </div>

      {goodDuels.length > 0 && otherRoundDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={goodRoundDuels.length} cleanWins={goodRoundDuels.filter(d => d.won).length}
            otherCount={otherRoundDuels.length} otherWins={otherRoundDuels.filter(d => d.won).length}
            lang={lang}
            cleanLabel={t('metrics:crosshair.goodLabel')}
            otherLabel={t('metrics:shared.otherDuels')}
          />
        </>
      )}

      <SectionHeading label={t('metrics:shared.episodes')} />
      {goodDuels.length > 0 ? (
        <EpisodeList duels={goodDuels} playerNames={playerNames} lang={lang} />
      ) : (
        <div style={{ color: 'var(--text2)', fontSize: 13, padding: '12px 0' }}>
          {t('metrics:crosshair.empty')}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ missed first shot page

function MissedFirstPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>
  lang: 'ru' | 'en'; totalRounds: number
}) {
  const allDuels = analytics.duels
  const wonDuels = allDuels.filter(d => d.won)
  const missedDuels = wonDuels.filter(d => d.errors.includes('missed_first'))
  const hitDuels = wonDuels.filter(d => !d.errors.includes('missed_first'))

  // For WinRateComparison: look at ALL duels (won+lost) per round category
  const missedRounds = new Set(missedDuels.map(d => d.round))
  const hitRounds = new Set(hitDuels.map(d => d.round))
  const allMissedRoundDuels = allDuels.filter(d => missedRounds.has(d.round))
  const allHitRoundDuels = allDuels.filter(d => hitRounds.has(d.round))

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
        title={t('metrics:missedFirst.title')}
        subtitle={t('metrics:missedFirst.subtitle', { missed: missedDuels.length, total: wonDuels.length })}
        value={`${pct}%`} lang={lang}
      />

      {wonDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.winBreakdown')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 20 }}>
            {[
              { key: 'missed' as const, label: t('metrics:missedFirst.missed'), count: missedDuels.length, color: 'var(--red)' },
              { key: 'hit' as const, label: t('metrics:missedFirst.hit'), count: hitDuels.length, color: 'var(--green)' },
            ].map(({ key, label, count, color }) => {
              const barPct = wonDuels.length > 0 ? Math.round(count / wonDuels.length * 100) : 0
              return (
                <div key={key} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{count}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>{barPct}% {t('metrics:shared.ofWins')}</div>
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
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={allHitRoundDuels.length} cleanWins={allHitRoundDuels.filter(d => d.won).length}
            otherCount={allMissedRoundDuels.length} otherWins={allMissedRoundDuels.filter(d => d.won).length}
            lang={lang}
            cleanLabel={t('metrics:missedFirst.hitLabel')}
            otherLabel={t('metrics:missedFirst.missedLabel')}
          />
        </>
      )}

      <SectionHeading label={t('metrics:shared.whatItMeans')} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {t('metrics:missedFirst.explanation')}
      </div>

      {wonDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.episodes')} />
          <FilterBar
            options={[
              { key: 'missed' as const, label: t('metrics:missedFirst.filterMissed', { n: missedDuels.length }), color: 'var(--red)' },
              { key: 'hit' as const, label: t('metrics:missedFirst.filterHit', { n: hitDuels.length }), color: 'var(--green)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
          <SectionHeading label={t('metrics:shared.byRound')} />
          <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ excellent contacts page

function ExcellentContactsPage({ analytics, playerNames, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; playerNames: Record<string, string>; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const count = m.excellentContacts ?? 0
  const duels = analytics.duels
  const shots = m.firstBulletShots ?? []

  // exact episodes from the backend (kill ticks of excellent contacts);
  // old artifacts without the ticks fall back to the won+stopped+hit heuristic
  const excellentDuels = (m.excellentContactTicks?.length
    ? duels.filter(d => d.won && m.excellentContactTicks!.includes(d.tick))
    : duels.filter(d => {
        const hitRounds = new Set(shots.filter(s => s.hit).map(s => s.round))
        return d.won && !d.errors.includes('moving_shot') && hitRounds.has(d.round)
      }))

  // For WinRateComparison: use round-level win rates, not just won-duels
  const excellentRounds = new Set(excellentDuels.map(d => d.round))
  const excellentRoundDuels = duels.filter(d => excellentRounds.has(d.round))
  const otherRoundDuels = duels.filter(d => !excellentRounds.has(d.round))

  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of analytics.duels) {
    if (d.won && !(d.round in roundOutcomes)) roundOutcomes[d.round] = 'kill'
  }

  return (
    <div>
      <MetricHero
        title={t('metrics:excellent.title')}
        subtitle={t('metrics:excellent.subtitle')}
        value={String(count)} metricKey="excellentContacts" lang={lang}
      />
      {excellentDuels.length > 0 && otherRoundDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={excellentRoundDuels.length} cleanWins={excellentRoundDuels.filter(d => d.won).length}
            otherCount={otherRoundDuels.length} otherWins={otherRoundDuels.filter(d => d.won).length}
            lang={lang}
            cleanLabel={t('metrics:excellent.title')}
            otherLabel={t('metrics:shared.otherDuels')}
          />
        </>
      )}
      <SectionHeading label={t('metrics:shared.whatItMeans')} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {t('metrics:excellent.explanation', { velocity: 50 })}
      </div>
      {excellentDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:excellent.title')} />
          <EpisodeList duels={excellentDuels} playerNames={playerNames} lang={lang} />
        </>
      )}
      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ successful reaction time page

function SuccessfulReactionTimePage({ analytics, lang, totalRounds }: {
  analytics: PlayerAnalyticsData; lang: 'ru' | 'en'; totalRounds: number
}) {
  const m = analytics.metrics
  const rt = m.successfulReactionTimeMs ?? 0
  const rtAll = m.reactionTimeMs ?? 0

  const deltas: number[] = m.reactionDeltasHit ?? []
  const deltasAll: number[] = m.reactionDeltas ?? []

  const wonDuels = analytics.duels.filter(d => d.won)
  const roundOutcomes: Record<number, RoundOutcome> = {}
  for (const d of wonDuels) {
    if (!(d.round in roundOutcomes)) roundOutcomes[d.round] = 'kill'
  }

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
        title={t('metrics:reactionHits.title')}
        subtitle={t('metrics:reactionHits.subtitle')}
        value={rt > 0 ? t('metrics:reactionHits.value', { value: rt.toFixed(0) }) : '—'}
        metricKey="successfulReactionTimeMs" lang={lang} higherIsBetter={false}
      />

      {rtAll > 0 && rt > 0 && (
        <>
          <SectionHeading label={t('metrics:reactionHits.comparison')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
            {[
              { label: t('metrics:reactionHits.onHits'), val: rt, color: 'var(--green)' },
              { label: t('metrics:reactionHits.allDuels'), val: rtAll, color: 'var(--text2)' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color }}>{val.toFixed(0)} {t('metrics:shared.ms')}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {deltas.length > 0 && (
        <>
          <SectionHeading label={t('metrics:reaction.distribution')} />
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
            {t('metrics:reaction.summary', { n: deltas.length, avg: rt.toFixed(0), min: Math.min(...deltas).toFixed(0), max: Math.max(...deltas).toFixed(0) })}
          </div>
        </>
      )}

      {deltasAll.length > 0 && deltas.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          {(() => {
            const shots = m.firstBulletShots ?? []
            const hitRounds = new Set(shots.filter(s => s.hit).map(s => s.round))
            const missRounds = new Set(shots.filter(s => !s.hit).map(s => s.round))
            const hitDuels = analytics.duels.filter(d => hitRounds.has(d.round))
            const missDuels = analytics.duels.filter(d => missRounds.has(d.round))
            return hitDuels.length > 0 && missDuels.length > 0 ? (
              <WinRateComparison
                cleanCount={hitDuels.length} cleanWins={hitDuels.filter(d => d.won).length}
                otherCount={missDuels.length} otherWins={missDuels.filter(d => d.won).length}
                lang={lang}
                cleanLabel={t('metrics:reactionHits.hitLabel')}
                otherLabel={t('metrics:reactionHits.missedLabel')}
              />
            ) : null
          })()}
        </>
      )}

      <SectionHeading label={t('metrics:shared.whatItMeans')} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
      }}>
        {t('metrics:reactionHits.explanation')}
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionHeading label={t('metrics:shared.byRound')} />
        <RoundGrid totalRounds={totalRounds} roundOutcomes={roundOutcomes} lang={lang} />
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
  const count = m.passiveAngleCount ?? 0
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
        title={t('metrics:passiveAngle.title')}
        subtitle={t('metrics:passiveAngle.subtitle', { n: count })}
        value={String(count)} metricKey="passiveAngleCount" lang={lang} higherIsBetter={false}
      />

      {passiveDuels.length > 0 && cleanDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.impact')} />
          <WinRateComparison
            cleanCount={cleanDuels.length} cleanWins={cleanDuels.filter(d => d.won).length}
            otherCount={passiveDuels.length} otherWins={passiveDuels.filter(d => d.won).length}
            lang={lang}
            cleanLabel={t('metrics:passiveAngle.active')}
            otherLabel={t('metrics:passiveAngle.title')}
          />
        </>
      )}

      {passiveDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:passiveAngle.breakdown')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 20 }}>
            {[
              { key: 'passive' as const, label: t('metrics:passiveAngle.title'), count: passiveDuels.length, color: 'var(--accent2)' },
              { key: 'clean' as const, label: t('metrics:passiveAngle.cleanWins'), count: cleanDuels.length, color: 'var(--green)' },
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

      <SectionHeading label={t('metrics:shared.whatItMeans')} />
      <div style={{
        background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '14px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6,
        marginBottom: 16,
      }}>
        {t('metrics:passiveAngle.explanation')}
      </div>

      {passiveDuels.length > 0 && (
        <>
          <SectionHeading label={t('metrics:shared.episodes')} />
          <FilterBar
            options={[
              { key: 'passive' as const, label: t('metrics:passiveAngle.filterPassive', { n: passiveDuels.length }), color: 'var(--accent2)' },
              { key: 'clean' as const, label: t('metrics:passiveAngle.filterClean', { n: cleanDuels.length }), color: 'var(--green)' },
            ]}
            active={filter} onChange={setFilter}
          />
          <EpisodeList duels={shown} playerNames={playerNames} lang={lang} />
          <SectionHeading label={t('metrics:shared.byRound')} />
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
        return <FirstBulletAccPage analytics={analytics} lang={lang} totalRounds={totalRounds} />
      case 'tradeKillPct':
        return <TradeKillsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'tradedDeathPct':
        return <TradedDeathsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'lostDuels':
        return <LostDuelsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'shiftPeekPct':
        return <DisciplinePage analytics={analytics} playerNames={playerNames} lang={lang} activeKey="shiftPeekPct" totalRounds={totalRounds} />
      case 'isolatedPct':
        return <DisciplinePage analytics={analytics} playerNames={playerNames} lang={lang} activeKey="isolatedPct" totalRounds={totalRounds} />
      case 'counterStrafeErrors':
        return <CounterStrafeErrorsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'ttk_ms':
        return <TtkPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'clutchWinPct':
        return <ClutchWinPctPage analytics={analytics} playerData={p!} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'flashEfficiency':
        return <FlashEfficiencyPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'reloadErrors':
        return <ReloadErrorsPage analytics={analytics} lang={lang} totalRounds={totalRounds} />
      case 'angleControlCount':
        return <AngleControlPage analytics={analytics} lang={lang} totalRounds={totalRounds} />
      case 'reactionTimeMs':
        return <ReactionTimePage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'successfulReactionTimeMs':
        return <SuccessfulReactionTimePage analytics={analytics} lang={lang} totalRounds={totalRounds} />
      case 'overshootCount':
        return <OvershootPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'excellentContacts':
        return <ExcellentContactsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'crosshairPlacementPct':
        return <CrosshairPlacementPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'teamKills':
        return <TeamKillsPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'missedFirst':
        return <MissedFirstPage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      case 'passiveAngle':
        return <PassiveAnglePage analytics={analytics} playerNames={playerNames} lang={lang} totalRounds={totalRounds} />
      default:
        return (
          <div style={{ color: 'var(--text2)', fontSize: 13 }}>
            {t('metrics:page.notFound', { key })}
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
