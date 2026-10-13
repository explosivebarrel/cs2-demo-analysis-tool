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

// ── active bomb tracking (planted or dropped on ground) ─────────────────────
export interface ActiveBomb {
  state: 'planted' | 'dropped'
  x: number
  y: number
  z: number
}

interface ParsedBombEv {
  ty: string
  t: number
  x?: number
  y?: number
  z?: number
  p?: number
}

const bombEventsCache = new WeakMap<ReplayData, ParsedBombEv[]>()

function getSortedBombEvents(replay: ReplayData): ParsedBombEv[] {
  let cached = bombEventsCache.get(replay)
  if (!cached) {
    cached = []
    const n = replay.players.length
    const FIELDS = fieldsOf(replay)
    for (const ev of replay.events) {
      const e = ev as Record<string, unknown>
      const ty = e.ty as string
      if (ty === 'bp' || ty === 'bo' || ty === 'bu' || ty === 'bf' || ty === 'bx') {
        const t = e.t as number
        let x = typeof e.x === 'number' ? e.x : undefined
        let y = typeof e.y === 'number' ? e.y : undefined
        let z = typeof e.z === 'number' ? e.z : undefined
        const p = typeof e.p === 'number' ? e.p : undefined

        // Resolve exact ground elevation at the event tick (planter/dropper position)
        if (t !== undefined && (x === undefined || y === undefined || z === undefined)) {
          const evFi = Math.max(0, replay.ticks.findIndex(tk => tk >= t))
          if (evFi >= 0 && evFi < replay.ticks.length) {
            const base = evFi * n * FIELDS
            if (p !== undefined && p >= 0 && p < n) {
              if (x === undefined) x = replay.data[base + p * FIELDS + F_X]
              if (y === undefined) y = replay.data[base + p * FIELDS + F_Y]
              if (z === undefined) z = replay.data[base + p * FIELDS + 2]
            } else if (x !== undefined && y !== undefined) {
              let bestD2 = Infinity
              let bestPz: number | undefined
              for (let i = 0; i < n; i++) {
                const px = replay.data[base + i * FIELDS + F_X]
                const py = replay.data[base + i * FIELDS + F_Y]
                const pz = replay.data[base + i * FIELDS + 2]
                const d2 = (px - x) ** 2 + (py - y) ** 2
                if (d2 < bestD2) {
                  bestD2 = d2
                  bestPz = pz
                }
              }
              if (bestD2 < 600 * 600 && bestPz !== undefined) {
                z = bestPz
              }
            } else {
              // Look for carrier (FLAG_C4) at event tick or the frame just before
              for (const fi of [evFi, Math.max(0, evFi - 1)]) {
                const fBase = fi * n * FIELDS
                for (let i = 0; i < n; i++) {
                  if ((replay.data[fBase + i * FIELDS + F_FLAGS] & FLAG_C4) !== 0) {
                    if (x === undefined) x = replay.data[fBase + i * FIELDS + F_X]
                    if (y === undefined) y = replay.data[fBase + i * FIELDS + F_Y]
                    if (z === undefined) z = replay.data[fBase + i * FIELDS + 2]
                    break
                  }
                }
                if (x !== undefined) break
              }
            }
          }
        }

        cached.push({ ty, t, x, y, z, p })
      }
    }
    cached.sort((a, b) => a.t - b.t)
    bombEventsCache.set(replay, cached)
  }
  return cached
}

export function resolveActiveBomb(
  replay: ReplayData,
  frameIdx: number,
  curTick: number,
  roundStartT: number,
  roundEndActual: number,
): ActiveBomb | null {
  const fi = Math.floor(frameIdx)
  const n = replay.players.length
  const FIELDS = fieldsOf(replay)
  const base = fi * n * FIELDS

  // Check if any alive player currently carries the bomb
  let hasLivingCarrier = false
  for (let i = 0; i < n; i++) {
    const alive = replay.data[base + i * FIELDS + F_ALIVE]
    const flags = replay.data[base + i * FIELDS + F_FLAGS]
    if (alive && (flags & FLAG_C4) !== 0) {
      hasLivingCarrier = true
      break
    }
  }

  const evs = getSortedBombEvents(replay)
  let cur: { state: 'planted' | 'dropped'; x: number; y: number; z?: number; t: number } | null = null

  for (const ev of evs) {
    if (ev.t > curTick) break
    if (ev.ty === 'bp') {
      cur = { state: 'planted', x: ev.x ?? 0, y: ev.y ?? 0, z: ev.z, t: ev.t }
    } else if (ev.ty === 'bo') {
      if (ev.x !== undefined && ev.y !== undefined) {
        cur = { state: 'dropped', x: ev.x, y: ev.y, z: ev.z, t: ev.t }
      }
    } else if (ev.ty === 'bu' || ev.ty === 'bf' || ev.ty === 'bx') {
      cur = null
    }
  }

  // If a dropped bomb is reported but a living player currently carries it, it is carried
  if (cur?.state === 'dropped' && hasLivingCarrier) {
    cur = null
  }

  // If outside the round boundaries, dismiss
  if (cur && (cur.t < roundStartT || curTick > roundEndActual)) {
    cur = null
  }

  // Fallback to replay.bomb if no active event found but replay.bomb says dropped/planted
  if (!cur && replay.bomb && fi < replay.bomb.length) {
    const b = replay.bomb[fi]
    if (b && b.length >= 4) {
      const bState = b[0]
      const bx = b[1] ?? 0
      const by = b[2] ?? 0
      const bz = b.length >= 5 ? (b[3] ?? 0) : undefined
      if ((bState === 2 || bState === 3) && (bx !== 0 || by !== 0)) {
        if (!(bState === 2 && hasLivingCarrier)) {
          cur = {
            state: bState === 3 ? 'planted' : 'dropped',
            x: bx,
            y: by,
            z: bz,
            t: curTick,
          }
        }
      }
    }
  }

  if (!cur) return null

  // If z is still unresolved, scan closest player at plant/current tick
  let z = cur.z
  if (z === undefined) {
    let bestDist2 = Infinity
    let bestZ = 0
    for (let i = 0; i < n; i++) {
      const px = replay.data[base + i * FIELDS + F_X]
      const py = replay.data[base + i * FIELDS + F_Y]
      const pz = replay.data[base + i * FIELDS + 2]
      const d2 = (px - cur.x) ** 2 + (py - cur.y) ** 2
      if (d2 < bestDist2) {
        bestDist2 = d2
        bestZ = pz
      }
    }
    z = bestDist2 < 800 * 800 ? bestZ : 0
  }

  return {
    state: cur.state,
    x: cur.x,
    y: cur.y,
    z,
  }
}
