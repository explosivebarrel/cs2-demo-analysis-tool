import { useBenchmarks } from '../../App'
import { Benchmarks, PlayerData, PlayerMetrics } from '../../api'
import { TIER_COLORS } from '../../benchmarkUtils'

interface MetricDef {
  key: string
  getValue: (p: PlayerData, m: PlayerMetrics) => number | null
  labelRu: string
  labelEn: string
  unit: string
  minSamples?: (p: PlayerData) => boolean
}

const METRIC_DEFS: MetricDef[] = [
  {
    key: 'adr',
    getValue: (p) => p.adr,
    labelRu: 'ADR', labelEn: 'ADR', unit: '',
  },
  {
    key: 'kd',
    getValue: (p) => p.kd,
    labelRu: 'K/D', labelEn: 'K/D', unit: '',
  },
  {
    key: 'kast',
    getValue: (p) => p.kast,
    labelRu: 'KAST%', labelEn: 'KAST%', unit: '%',
    minSamples: (p) => p.series.length >= 5,
  },
  {
    key: 'hsPct',
    getValue: (p) => p.hsPct,
    labelRu: 'HS%', labelEn: 'HS%', unit: '%',
    minSamples: (p) => p.kills >= 5,
  },
  {
    key: 'rating',
    getValue: (p) => p.rating,
    labelRu: 'Рейтинг', labelEn: 'Rating', unit: '',
  },
  {
    key: 'openingWinPct',
    getValue: (_, m) => m.openingWinPct,
    labelRu: 'Открывашки Win%', labelEn: 'Opening Win%', unit: '%',
  },
  {
    key: 'tradeKillPct',
    getValue: (_, m) => m.tradeKillPct,
    labelRu: 'Трейд-килы', labelEn: 'Trade Kills', unit: '%',
  },
  {
    key: 'tradedDeathPct',
    getValue: (_, m) => m.tradedDeathPct,
    labelRu: 'Трейд-смерти', labelEn: 'Traded Deaths', unit: '%',
  },
  {
    key: 'flashEfficiency',
    getValue: (_, m) => m.flashEfficiency,
    labelRu: 'Эфф. флешек', labelEn: 'Flash Eff.', unit: '%',
    minSamples: (p) => p.flashes.thrown >= 3,
  },
  {
    key: 'clutchWinPct',
    getValue: (_, m) => m.clutchWinPct,
    labelRu: 'Клатч Win%', labelEn: 'Clutch Win%', unit: '%',
    minSamples: (p) => p.clutches.played >= 2,
  },
  {
    key: 'idealStrafePct',
    getValue: (_, m) => m.idealStrafePct,
    labelRu: 'Идеальные стрейфы', labelEn: 'Ideal Strafes', unit: '%',
  },
  {
    key: 'firstBulletAcc',
    getValue: (_, m) => m.firstBulletAcc,
    labelRu: 'Точность первой пули', labelEn: 'First Bullet Acc', unit: '%',
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
    const range = tiers.elite - tiers.avg
    if (range <= 0) continue
    const score = (value - tiers.avg) / range
    result.push({ def, value, score, avgDiff: value - tiers.avg })
  }
  return result
}

interface Props {
  player: PlayerData
  metrics: PlayerMetrics
  lang: 'ru' | 'en'
}

export default function PlayerStrengths({ player, metrics, lang }: Props) {
  const benchmarks = useBenchmarks()
  if (!Object.keys(benchmarks).length) return null

  const scored = scoreMetrics(player, metrics, benchmarks)
  if (!scored.length) return null

  scored.sort((a, b) => b.score - a.score)
  const strengths = scored.filter(s => s.score > 0).slice(0, 3)
  const weaknesses = [...scored].filter(s => s.score < 0).sort((a, b) => a.score - b.score).slice(0, 3)

  if (!strengths.length && !weaknesses.length) return null

  const ru = lang === 'ru'

  function Card({ item, isStrength }: { item: ScoredMetric; isStrength: boolean }) {
    const tiers = benchmarks[item.def.key]!
    const color = isStrength ? TIER_COLORS.elite : TIER_COLORS.weak
    const diffSign = item.avgDiff >= 0 ? '+' : ''
    const diffStr = `${diffSign}${item.avgDiff.toFixed(1)}${item.def.unit}`
    const avgStr = `${ru ? 'средний' : 'avg'}: ${tiers.avg}${item.def.unit}`
    const displayVal = item.def.unit === '' && item.def.key !== 'kd' && item.def.key !== 'rating'
      ? item.value.toFixed(0)
      : item.value.toFixed(2)
    return (
      <div style={{
        background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px',
        borderLeft: `3px solid ${color}`,
        display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {ru ? item.def.labelRu : item.def.labelEn}
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
            {ru ? '▲ Сильные стороны' : '▲ Strengths'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {strengths.map(s => <Card key={s.def.key} item={s} isStrength />)}
          </div>
        </div>
      )}
      {weaknesses.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: TIER_COLORS.weak, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, fontWeight: 700 }}>
            {ru ? '▼ Зоны роста' : '▼ Areas to improve'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {weaknesses.map(s => <Card key={s.def.key} item={s} isStrength={false} />)}
          </div>
        </div>
      )}
    </div>
  )
}
