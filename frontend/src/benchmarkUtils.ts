import { Benchmarks, BenchmarkTiers } from './api'
import { t } from './i18n'

export type BenchmarkTier = 'weak' | 'avg' | 'good' | 'elite'

export const TIER_COLORS: Record<BenchmarkTier, string> = {
  weak:  '#e05555',
  avg:   '#888888',
  good:  '#4a9eda',
  elite: '#f0a830',
}

export function tierLabel(tier: BenchmarkTier): string {
  return t('common:benchmarks.tier.' + tier)
}

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
  higherIsBetter = true,
): string {
  if (higherIsBetter) {
    return [
      t('common:benchmarks.weak',  { range: `<${tiers.avg}` }),
      t('common:benchmarks.avg',   { range: `${tiers.avg}–${tiers.good}` }),
      t('common:benchmarks.good',  { range: `${tiers.good}–${tiers.elite}` }),
      t('common:benchmarks.elite', { range: `>${tiers.elite}` }),
      t('common:benchmarks.yours', { value: value.toFixed(1) }),
    ].join(' · ')
  } else {
    return [
      t('common:benchmarks.weak',  { range: `>${tiers.avg}` }),
      t('common:benchmarks.avg',   { range: `${tiers.good}–${tiers.avg}` }),
      t('common:benchmarks.good',  { range: `${tiers.elite}–${tiers.good}` }),
      t('common:benchmarks.elite', { range: `<${tiers.elite}` }),
      t('common:benchmarks.yours', { value: value.toFixed(1) }),
    ].join(' · ')
  }
}
