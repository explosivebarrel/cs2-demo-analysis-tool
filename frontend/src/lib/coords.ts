import type { MapOverview } from '../api'

// World coords -> canvas pixels. The overview pos/scale reference maps world
// space onto a 1024x1024 radar image; canvas Y is flipped vs world Y, so any
// derived direction (yaw arrows, tracers) must negate sin.
export function worldToCanvas(
  wx: number, wy: number, ov: MapOverview, w: number, h: number,
): [number, number] {
  const px = ((wx - ov.pos_x) / ov.scale / 1024) * w
  const py = ((ov.pos_y - wy) / ov.scale / 1024) * h
  return [px, py]
}

// Does a world Z belong to the given map level? 'default' means the upper
// world: the section literally named 'default' when present (nuke), otherwise
// everything outside the named vertical sections.
export function zOnLevel(z: number, ov: MapOverview, level: string): boolean {
  const vs = ov.verticalsections ?? {}
  const names = Object.keys(vs)
  if (!names.length) return true
  if (level !== 'default') {
    const sec = vs[level]
    return sec ? z >= sec.altitudeMin && z <= sec.altitudeMax : true
  }
  const defSec = vs['default']
  if (defSec) return z >= defSec.altitudeMin && z <= defSec.altitudeMax
  return !names.some(n => {
    const s = vs[n]
    return z >= s.altitudeMin && z <= s.altitudeMax
  })
}

// Lower-level section names (excluding 'default') — for level switcher UI.
export function lowerLevelNames(ov: MapOverview): string[] {
  return Object.keys(ov.verticalsections ?? {}).filter(n => n !== 'default')
}

