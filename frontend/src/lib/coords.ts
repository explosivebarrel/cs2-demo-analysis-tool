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

// Canvas pixels (on a centered square of size base) -> World coords.
export function canvasToWorld(
  px: number, py: number, ov: MapOverview, base: number,
): [number, number] {
  const wx = ov.pos_x + (px / base) * 1024 * ov.scale
  const wy = ov.pos_y - (py / base) * 1024 * ov.scale
  return [wx, wy]
}

// Map the center of the viewport in 2D (with letterbox base and Transform tx) to world coords [cx, cy].
export function tx2dToWorldCenter(
  tx: { scale: number; ox: number; oy: number },
  ov: MapOverview,
  base: number,
): [number, number] {
  // Center of the square view in untransformed square coordinates:
  // p_transformed = tx.ox + tx.scale * p_untransformed = base / 2
  // p_untransformed = (base / 2 - tx.ox) / tx.scale
  const sx = (base / 2 - tx.ox) / tx.scale
  const sy = (base / 2 - tx.oy) / tx.scale
  return canvasToWorld(sx, sy, ov, base)
}

// Given a target world center [cx, cy] and 2D scale, compute { scale, ox, oy } for 2D.
export function worldCenterToTx2d(
  cx: number, cy: number,
  scale: number,
  ov: MapOverview,
  base: number,
): { scale: number; ox: number; oy: number } {
  const [sx, sy] = worldToCanvas(cx, cy, ov, base, base)
  const ox = base / 2 - sx * scale
  const oy = base / 2 - sy * scale
  return { scale, ox, oy }
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

