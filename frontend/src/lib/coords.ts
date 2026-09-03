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
