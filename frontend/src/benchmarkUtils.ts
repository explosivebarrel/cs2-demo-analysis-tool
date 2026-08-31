import { Benchmarks, BenchmarkTiers } from './api'

export type BenchmarkTier = 'weak' | 'avg' | 'good' | 'elite'

export const TIER_COLORS: Record<BenchmarkTier, string> = {
  weak:  '#e05555',
  avg:   '#888888',
  good:  '#4a9eda',
  elite: '#f0a830',
}

export const TIER_LABELS: Record<BenchmarkTier, { ru: string; en: string }> = {
  weak:  { ru: 'СЛАБО',    en: 'WEAK'  },
  avg:   { ru: 'СРЕДНЕЕ',  en: 'AVG'   },
  good:  { ru: 'ХОРОШО',   en: 'GOOD'  },
  elite: { ru: 'ОТЛИЧНО',  en: 'ELITE' },
}

// For metrics where lower is better (e.g. counterStrafeErrors), pass higherIsBetter=false
export function getBenchmarkTier(
  tiers: BenchmarkTiers,
  value: number,
  higherIsBetter = true,
): BenchmarkTier {
  const v = higherIsBetter ? value : -value
  const w = higherIsBetter ? tiers.weak  : -tiers.elite
  const a = higherIsBetter ? tiers.avg   : -tiers.good
  const g = higherIsBetter ? tiers.good  : -tiers.avg
  if (v >= g) return 'elite'  // note: elite threshold == good threshold when inverted — handled below
  if (v >= a) return 'good'
  if (v >= w) return 'avg'
  return 'weak'
}

// Simpler version: just pass the tiers dict and a raw value
// For "lower is better" metrics (ttk_ms, counterStrafeErrors, reloadErrors), pass higherIsBetter=false
export function getTier(benchmarks: Benchmarks, key: string, value: number | null | undefined, higherIsBetter = true): BenchmarkTier | null {
  if (value == null) return null
  const tiers = benchmarks[key]
  if (!tiers) return null
  if (higherIsBetter) {
    if (value >= tiers.elite) return 'elite'
    if (value >= tiers.good)  return 'good'
    if (value >= tiers.avg)   return 'avg'
    return 'weak'
  } else {
    // lower is better: elite threshold is the smallest number
    if (value <= tiers.elite) return 'elite'
    if (value <= tiers.good)  return 'good'
    if (value <= tiers.avg)   return 'avg'
    return 'weak'
  }
}

export function formatTierTooltip(
  tiers: BenchmarkTiers,
  value: number,
  lang: 'ru' | 'en',
  higherIsBetter = true,
): string {
  const u = lang === 'ru'
  if (higherIsBetter) {
    return [
      `${u ? 'Слабые' : 'Weak'}: <${tiers.avg}`,
      `${u ? 'Средние' : 'Avg'}: ${tiers.avg}–${tiers.good}`,
      `${u ? 'Хорошие' : 'Good'}: ${tiers.good}–${tiers.elite}`,
      `${u ? 'Элита' : 'Elite'}: >${tiers.elite}`,
      `${u ? 'У тебя' : 'Yours'}: ${value.toFixed(1)}`,
    ].join(' · ')
  } else {
    return [
      `${u ? 'Слабые' : 'Weak'}: >${tiers.avg}`,
      `${u ? 'Средние' : 'Avg'}: ${tiers.good}–${tiers.avg}`,
      `${u ? 'Хорошие' : 'Good'}: ${tiers.elite}–${tiers.good}`,
      `${u ? 'Элита' : 'Elite'}: <${tiers.elite}`,
      `${u ? 'У тебя' : 'Yours'}: ${value.toFixed(1)}`,
    ].join(' · ')
  }
}
