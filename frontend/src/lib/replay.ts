import { ReplayData, RoundData } from '../api'

// ── frame buffer field indices ───────────────────────────────────────────────
// v2 layout (13 fields): [x, y, z, yaw, hp, armor, alive, weaponId, flags,
//                         team, equip, money, ammo]
// legacy payloads (no `inv` key) store 11 fields — offsets 0..10 are identical.
export const F_X = 0, F_Y = 1, F_YAW = 3, F_HP = 4, F_ARMOR = 5
export const F_ALIVE = 6, F_WID = 7, F_FLAGS = 8, F_TEAM = 9, F_EQUIP = 10
export const F_MONEY = 11, F_AMMO = 12

export type ReplayFields = 11 | 13
export function fieldsOf(replay: ReplayData): ReplayFields {
  return replay.inv ? 13 : 11
}

// flags bitmask
export const FLAG_C4 = 1, FLAG_DEFUSER = 2, FLAG_FLASHED = 4
export const FLAG_SCOPED = 8, FLAG_WALKING = 16, FLAG_DUCKED = 32, FLAG_HELMET = 64

export const TEAM_COLORS: Record<number, string> = { 2: '#e4882a', 3: '#4a9eda' }  // team_num: 2=T (orange), 3=CT (blue)
export const SPEEDS = [0.5, 1, 2, 4, 8]

export interface Transform { scale: number; ox: number; oy: number }

/** Find which round owns the given tick (freeze time belongs to the NEXT round). */
export function findRoundForTick(rounds: RoundData[], tick: number): RoundData | null {
  if (!rounds.length) return null
  // each round owns: (prevRound.endTick, curRound.endTick]
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i]
    const prevEnd = i > 0 ? rounds[i - 1].endTick : 0
    if (tick > prevEnd && tick <= r.endTick) return r
  }
  return rounds[rounds.length - 1]
}

/** Live color for a static team index, sampled from the frame buffer. */
export function teamColorAtFrame(replay: ReplayData, frameIdx: number, teamIdx: number): string {
  const n = replay.players.length
  const FIELDS = fieldsOf(replay)
  const frameBase = frameIdx * n * FIELDS
  for (let i = 0; i < n; i++) {
    if (replay.players[i]?.team !== teamIdx) continue
    const alive = replay.data[frameBase + i * FIELDS + F_ALIVE]
    const teamNum = replay.data[frameBase + i * FIELDS + F_TEAM]
    if (alive && teamNum in TEAM_COLORS) return TEAM_COLORS[teamNum]
  }
  for (let i = 0; i < n; i++) {
    if (replay.players[i]?.team !== teamIdx) continue
    const teamNum = replay.data[frameBase + i * FIELDS + F_TEAM]
    if (teamNum in TEAM_COLORS) return TEAM_COLORS[teamNum]
  }
  return teamIdx === 0 ? '#e4882a' : '#4a9eda'
}

/** Player speed in units/sec vs the previous frame (velocity props are unreliable on downsampled ticks). */
export function playerSpeedAt(replay: ReplayData, pidx: number, frameIdx: number): number {
  const n = replay.players.length
  const FIELDS = fieldsOf(replay)
  const base = frameIdx * n * FIELDS + pidx * FIELDS
  const prevBase = Math.max(0, frameIdx - 1) * n * FIELDS + pidx * FIELDS
  if (!replay.data[prevBase + F_ALIVE] || !replay.data[base + F_ALIVE]) return 0
  const dx = replay.data[base + F_X] - replay.data[prevBase + F_X]
  const dy = replay.data[base + F_Y] - replay.data[prevBase + F_Y]
  return Math.round(Math.sqrt(dx * dx + dy * dy) * replay.tickrate / Math.max(1, replay.frameStep))
}

// ── inventory journal ─────────────────────────────────────────────────────────
export interface InvIndex {
  fis: number[][]      // per player: frames where inventory changed (sorted)
  lists: string[][][]  // per player: canonical id snapshot per change
}

/** Pre-process the sparse inv journal for O(log n) lookup per player/frame. */
export function buildInvIndex(replay: ReplayData): InvIndex | null {
  const rows = replay.inv
  if (!rows) return null
  const idx: InvIndex = { fis: [], lists: [] }
  for (const [fi, pidx, s] of rows) {
    if (!idx.fis[pidx]) { idx.fis[pidx] = []; idx.lists[pidx] = [] }
    idx.fis[pidx].push(fi)
    idx.lists[pidx].push(s ? s.split(',') : [])
  }
  return idx
}

const EMPTY: string[] = []

/** Canonical inventory ids of a player at a frame ([] before their first known loadout). */
export function invAt(idx: InvIndex | null, pidx: number, frameIdx: number): string[] {
  if (!idx || pidx >= idx.fis.length) return EMPTY
  const fis = idx.fis[pidx]
  if (!fis || !fis.length) return EMPTY
  let lo = 0, hi = fis.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (fis[mid] <= frameIdx) lo = mid
    else hi = mid - 1
  }
  return fis[lo] <= frameIdx ? (idx.lists[pidx][lo] ?? EMPTY) : EMPTY
}
