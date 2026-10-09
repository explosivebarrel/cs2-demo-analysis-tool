// Heatmap layer colors and compact point decoding.
// Schema docs in backend/app/pipeline/heatmaps.py
export const LAYER_COLORS: Record<string, string> = {
  kills: '255,80,80', deaths: '80,160,255', damage: '255,160,40',
  damage_taken: '200,80,255', shots: '200,200,200', flash_throws: '255,240,80',
  flash_hits: '255,200,20', smokes: '100,200,150', molotovs: '255,100,30',
  hes: '200,255,80', plants: '255,120,30', defuses: '80,255,200',
  opening_duels: '255,80,200', clutches: '255,200,80', holds: '100,180,255',
  positions: '150,150,255',
}

export interface DecodedPoint {
  x: number; y: number; z?: number; v?: number; dur?: number; pIdx: number; tick: number
}

export function decodePoint(layer: string, arr: number[]): DecodedPoint {
  switch (layer) {
    case 'kills': case 'deaths': case 'opening_duels':
      // [ax, ay, vx, vy, pIdx, tick, flags]
      return { x: arr[0], y: arr[1], pIdx: arr[4], tick: arr[5] }
    case 'damage': case 'damage_taken':
      // [x, y, dmg, pIdx, tick]
      return { x: arr[0], y: arr[1], v: arr[2], pIdx: arr[3], tick: arr[4] }
    case 'flash_hits':
      // [x, y, blindSec, throwerIdx, tick]
      return { x: arr[0], y: arr[1], v: arr[2], pIdx: arr[3], tick: arr[4] }
    case 'holds':
      // [x, y, durSec, pIdx, roundStartTick, round]
      return { x: arr[0], y: arr[1], dur: arr[2], pIdx: arr[3], tick: arr[4] }
    case 'clutches':
      // [x, y, enemies, pIdx, tick, won]
      return { x: arr[0], y: arr[1], v: arr[2], pIdx: arr[3], tick: arr[4] }
    case 'positions':
      // [x, y, z, round, pIdx]
      return { x: arr[0], y: arr[1], z: arr[2], pIdx: arr[4], tick: 0 }
    default:
      // shots, flash_throws, smokes, hes, molotovs, plants, defuses: [x, y, pIdx, tick]
      return { x: arr[0], y: arr[1], pIdx: arr[2], tick: arr[3] }
  }
}
