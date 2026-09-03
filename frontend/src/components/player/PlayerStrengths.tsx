import { useBenchmarks } from '../../App'
import { Benchmarks, PlayerData, PlayerMetrics } from '../../api'
import { TIER_COLORS } from '../../benchmarkUtils'
import { t } from '../../i18n'

const LOWER_IS_BETTER = new Set([
  'reactionTimeMs', 'successfulReactionTimeMs', 'ttk_ms',
  'overshootCount', 'counterStrafeErrors', 'reloadErrors', 'passiveAngleCount',
  'shiftPeekPct', 'isolatedPct',
])

interface MetricDef {
  key: string
  getValue: (p: PlayerData, m: PlayerMetrics) => number | null
  labelKey: string
  unit: string
  minSamples?: (p: PlayerData) => boolean
}

const METRIC_DEFS: MetricDef[] = [
  {
    key: 'adr',
    getValue: (p) => p.adr,
    labelKey: 'player:strengths.metric.adr', unit: '',
  },
  {
    key: 'kd',
    getValue: (p) => p.kd,
    labelKey: 'player:strengths.metric.kd', unit: '',
  },
  {
    key: 'kast',
    getValue: (p) => p.kast,
    labelKey: 'player:strengths.metric.kast', unit: '%',
    minSamples: (p) => p.series.length >= 5,
  },
  {
    key: 'hsPct',
    getValue: (p) => p.hsPct,
    labelKey: 'player:strengths.metric.hsPct', unit: '%',
    minSamples: (p) => p.kills >= 5,
  },
  {
    key: 'rating',
    getValue: (p) => p.rating,
    labelKey: 'player:strengths.metric.rating', unit: '',
  },
  {
    key: 'openingWinPct',
    getValue: (_, m) => m.openingWinPct,
    labelKey: 'player:strengths.metric.openingWinPct', unit: '%',
  },
  {
    key: 'tradeKillPct',
    getValue: (_, m) => m.tradeKillPct,
    labelKey: 'player:strengths.metric.tradeKillPct', unit: '%',
  },
  {
    key: 'tradedDeathPct',
    getValue: (_, m) => m.tradedDeathPct,
    labelKey: 'player:strengths.metric.tradedDeathPct', unit: '%',
  },
  {
    key: 'flashEfficiency',
    getValue: (_, m) => m.flashEfficiency,
    labelKey: 'player:strengths.metric.flashEfficiency', unit: '%',
    minSamples: (p) => p.flashes.thrown >= 3,
  },
  {
    key: 'clutchWinPct',
    getValue: (_, m) => m.clutchWinPct,
    labelKey: 'player:strengths.metric.clutchWinPct', unit: '%',
    minSamples: (p) => p.clutches.played >= 2,
  },
  {
    key: 'idealStrafePct',
    getValue: (_, m) => m.idealStrafePct,
    labelKey: 'player:strengths.metric.idealStrafePct', unit: '%',
  },
  {
    key: 'firstBulletAcc',
    getValue: (_, m) => m.firstBulletAcc,
    labelKey: 'player:strengths.metric.firstBulletAcc', unit: '%',
  },
  {
    key: 'reactionTimeMs',
    getValue: (_, m) => m.reactionTimeMs && m.reactionTimeMs > 0 ? m.reactionTimeMs : null,
    labelKey: 'player:strengths.metric.reactionTimeMs', unit: ' ms',
  },
  {
    key: 'successfulReactionTimeMs',
    getValue: (_, m) => m.successfulReactionTimeMs && m.successfulReactionTimeMs > 0 ? m.successfulReactionTimeMs : null,
    labelKey: 'player:strengths.metric.successfulReactionTimeMs', unit: ' ms',
  },
  {
    key: 'ttk_ms',
    getValue: (_, m) => m.ttk_ms && m.ttk_ms > 0 ? m.ttk_ms : null,
    labelKey: 'player:strengths.metric.ttk_ms', unit: ' ms',
  },
  {
    key: 'overshootCount',
    getValue: (_, m) => m.overshootCount ?? null,
    labelKey: 'player:strengths.metric.overshootCount', unit: '',
  },
  {
    key: 'counterStrafeErrors',
    getValue: (_, m) => m.counterStrafeErrors ?? null,
    labelKey: 'player:strengths.metric.counterStrafeErrors', unit: '',
  },
  {
    key: 'crosshairPlacementPct',
    getValue: (_, m) => m.crosshairPlacementPct ?? null,
    labelKey: 'player:strengths.metric.crosshairPlacementPct', unit: '%',
  },
  {
    key: 'excellentContacts',
    getValue: (_, m) => m.excellentContacts ?? null,
    labelKey: 'player:strengths.metric.excellentContacts', unit: '',
  },
  {
    key: 'angleControlCount',
    getValue: (_, m) => m.angleControlCount ?? null,
    labelKey: 'player:strengths.metric.angleControlCount', unit: '',
  },
  {
    key: 'reloadErrors',
    getValue: (_, m) => m.reloadErrors ?? null,
    labelKey: 'player:strengths.metric.reloadErrors', unit: '',
  },
  {
    key: 'passiveAngleCount',
    getValue: (_, m) => m.passiveAngleCount ?? null,
    labelKey: 'player:strengths.metric.passiveAngleCount', unit: '',
  },
  {
    key: 'shiftPeekPct',
    getValue: (_, m) => m.shiftPeekPct ?? null,
    labelKey: 'player:strengths.metric.shiftPeekPct', unit: '%',
  },
  {
    key: 'isolatedPct',
    getValue: (_, m) => m.isolatedPct ?? null,
    labelKey: 'player:strengths.metric.isolatedPct', unit: '%',
  },
]

interface ScoredMetric {
  def: MetricDef
  value: number
  score: number
  avgDiff: number
}

function scoreMetrics(
  player: PlayerData,
  metrics: PlayerMetrics,
  benchmarks: Benchmarks,
): ScoredMetric[] {
  const result: ScoredMetric[] = []
  for (const def of METRIC_DEFS) {
    const tiers = benchmarks[def.key]
    if (!tiers) continue
    const value = def.getValue(player, metrics)
    if (value == null) continue
    if (def.minSamples && !def.minSamples(player)) continue
    const lowerIsBetter = LOWER_IS_BETTER.has(def.key)
    const range = lowerIsBetter ? tiers.avg - tiers.elite : tiers.elite - tiers.avg
    if (range <= 0) continue
    // score > 0 means better than avg, score < 0 means worse
    const score = lowerIsBetter
      ? (tiers.avg - value) / range
      : (value - tiers.avg) / range
    result.push({ def, value, score, avgDiff: lowerIsBetter ? tiers.avg - value : value - tiers.avg })
  }
  return result
}

interface Props {
  player: PlayerData
  metrics: PlayerMetrics
  lang: 'ru' | 'en'
}

export default function PlayerStrengths({ player, metrics }: Props) {
  const benchmarks = useBenchmarks()
  if (!Object.keys(benchmarks).length) return null

  const scored = scoreMetrics(player, metrics, benchmarks)
  if (!scored.length) return null

  scored.sort((a, b) => b.score - a.score)
  const strengths = scored.filter(s => s.score > 0).slice(0, 3)
  const weaknesses = [...scored].filter(s => s.score < 0).sort((a, b) => a.score - b.score).slice(0, 3)

  if (!strengths.length && !weaknesses.length) return null

  function Card({ item, isStrength }: { item: ScoredMetric; isStrength: boolean }) {
    const tiers = benchmarks[item.def.key]!
    const color = isStrength ? TIER_COLORS.elite : TIER_COLORS.weak
    const diffSign = item.avgDiff >= 0 ? '+' : ''
    const diffStr = `${diffSign}${item.avgDiff.toFixed(1)}${item.def.unit}`
    const avgStr = t('player:strengths.avgValue', { value: `${tiers.avg}${item.def.unit}` })
    const isDecimal = ['kd', 'rating'].includes(item.def.key)
    const displayVal = isDecimal ? item.value.toFixed(2) : item.value.toFixed(0)
    return (
      <div style={{
        background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px',
        borderLeft: `3px solid ${color}`,
        display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {t(item.def.labelKey)}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color }}>
            {displayVal}{item.def.unit}
          </span>
          <span style={{ fontSize: 11, color, fontWeight: 700 }}>{diffStr}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text2)' }}>{avgStr}</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 4 }}>
      {strengths.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: TIER_COLORS.elite, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, fontWeight: 700 }}>
            {t('player:strengths.title')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {strengths.map(s => <Card key={s.def.key} item={s} isStrength />)}
          </div>
        </div>
      )}
      {weaknesses.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: TIER_COLORS.weak, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, fontWeight: 700 }}>
            {t('player:strengths.weaknessesTitle')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {weaknesses.map(s => <Card key={s.def.key} item={s} isStrength={false} />)}
          </div>
        </div>
      )}
    </div>
  )
}
