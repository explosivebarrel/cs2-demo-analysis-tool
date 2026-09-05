const BASE = '/api'

// per-demo analysis artifacts are immutable once written — cache them client
// side so back-and-forth navigation does not refetch multi-MB payloads
const _cache = new Map<string, unknown>()

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key)
  if (hit !== undefined) return Promise.resolve(hit as T)
  return fn().then(v => {
    _cache.set(key, v)
    return v
  })
}

function evictDemo(did: string) {
  for (const k of [..._cache.keys()]) {
    if (k.endsWith(`:${did}`)) _cache.delete(k)
  }
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(BASE + url, opts)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

export interface DemoEntry {
  id: string
  key?: string
  name: string
  size: number
  source: 'inbox' | 'upload' | 'faceit' | 'watch'
  status?: string
  progress?: number
  phase?: string
  detail?: string
  error?: string
  mtime?: number
  map?: string
  score?: number[]
  teamNames?: string[]
  players?: { steamid: string; name: string; clan: string; team: number }[]
  date?: string
  fetching?: boolean
}

export interface AnalysisData {
  meta: {
    map: string; server: string; tickrate: number; maxTick: number
    durationSec: number; rounds: number; score: [number, number]
    teamNames: [string, string]; matchStartTick: number; matchEndTick: number
    firstSideTeam0: string
  }
  teams: TeamData[]
  players: PlayerData[]
  rounds: RoundData[]
  halves: HalfData[]
  knifeRound?: { startTick: number; freezeEndTick?: number | null; endTick: number; winner: string } | null
  weapons: Record<number, string>
  moments?: Moment[]
}

export interface TeamData {
  name: string; players: number; score: number
  kills: number; deaths: number; assists: number
  adr: number; kast: number; rating: number; hsPct: number
  utilDmg: number; pistolRoundsWon: number; firstKills: number; clutchesWon: number
}

export interface PlayerData {
  steamid: string; name: string; team: number; clan: string; firstSide: string
  kills: number; deaths: number; assists: number; flashAssists: number
  kd: number; kpr: number; dpr: number; apr: number
  adr: number; udr: number; hsPct: number | null; kast: number
  dmgTaken: number; utilDmg: number; postPlantDmg: number
  rating: number; ratingParts: Record<string, number>
  opening: { kills: number; deaths: number; attempts: number; success: number | null }
  trades: { tradeKills: number; tradedDeaths: number }
  multiKills: { '2k': number; '3k': number; '4k': number; '5k': number; rounds: number }
  clutches: { played: number; won: number; byX: Record<string, { played: number; won: number }>; list: ClutchEntry[] }
  flashes: { thrown: number; enemiesFlashed: number; blindSec: number; effective: number; friendly: number }
  grenades: { smokes: number; he: number; fire: number; decoys: number }
  bomb: { plants: number; defuses: number; defuseAttempts: number; kits: number }
  eco: { avgSpend: number; totalSpend: number }
  movement: { distanceKm: number; aliveSecPerRound: number; survivalPct: number; saves: number }
  hitgroups: Record<string, number>
  killDist: { avgM: number | null; maxM: number | null; buckets: Record<string, number> }
  teamDmg: number
  weapons: WeaponRow[]
  bySide: { T: SideSummary; CT: SideSummary }
  series: SeriesPoint[]
  rws: number
  imp: number
  holdsCount: number
}

export interface WeaponRow {
  raw: string; en: string; ru: string; cls: string
  kills: number; hsKills: number; shots: number; hits: number
  acc: number | null; dmg: number; hsPct: number | null
}

export interface SideSummary {
  rounds: number; kills: number; deaths: number; assists: number; adr: number; kd: number
}

export interface SeriesPoint { n: number; k: number; d: number; a: number; dmg: number; sv: number; kast: number; opening: string | null; mk: boolean; pistol: number; mvp: number; won: number; imp: number; nades: number }

export interface ClutchEntry { round: number; enemies: number; won: boolean; kills: number; t0?: number }

export interface RoundData {
  n: number; freezeEndTick: number; endTick: number; durSec: number
  winnerTeam: number; reason: string; sideTeam0: string
  scoreTeam0: number; scoreTeam1: number; isPistol: boolean
  buyTeam0: string; buyTeam1: string; spendTeam0: number; spendTeam1: number
  avgSpendTeam0: number; avgSpendTeam1: number
  bombPlanted: boolean; bombSite: string | null
  planter: string | null; defuser: string | null; mvp: string | null
  openingKill: { tick: number; attacker: string; victim: string; attackerTeam: number; weapon: string; headshot: boolean } | null
}

export interface HalfData { from: number; to: number; sideTeam0: string; score0: number; score1: number }

export interface HeatmapData {
  layers: Record<string, HeatPoint[]>
  rounds: { n: number; f: number; e: number; s0: string; w: number; plant?: number }[]
}

export interface HeatPoint {
  x: number; y: number; v?: number; dur?: number
  sid?: string; team?: number; side?: string; rn?: number
  weapon?: string; hs?: boolean; phase?: string
}

export interface WeaponInfo { raw: string; key?: string; en: string; ru: string; cls: string }

export interface InvWeaponInfo { en: string; ru: string; cls: string }

export interface ReplayData {
  tickrate: number; frameStep: number
  players: { steamid: string; name: string; team: number }[]
  ticks: number[]
  // flat: frame * nPlayers * FIELDS + playerIdx * FIELDS + field;
  // payload v2: 13 fields [x,y,z,yaw,hp,armor,alive,weaponId,flags,team,equip,money,ammo],
  // legacy payloads without `inv` have 11 fields (no money/ammo)
  data: number[]
  /** Sparse inventory change-log: [frameIdx, playerIdx, "id,id,..."] (v2 only). */
  inv?: [number, number, string][]
  /** Canonical inventory id -> label/class, for decoding `inv` (v2 only). */
  invWeapons?: Record<string, InvWeaponInfo>
  bomb: (number | null)[][]
  events: ReplayEvent[]
  shots: number[][]  // compact: [tick, playerIdx, x, y, yaw]
  weapons: Record<number, WeaponInfo>
  winprob?: number[]  // ct win probability per frame [0.05, 0.95]
}

export interface ReplayEvent {
  tick: number; type: string
  [k: string]: unknown
}

export interface ShotEvent {
  tick: number; pidx: number; x: number; y: number; yaw: number
}

export interface StatusData {
  status: string; progress?: number; phase?: string; detail?: string; error?: string
  map?: string; score?: number[]; teamNames?: string[]
  players?: { steamid: string; name: string; clan: string; team: number }[]
  date?: string
}

export interface DecisionEntry {
  round: number
  tick: number
  probBefore: number
  probAfter: number
  drop: number
  side: string
}

export interface FirstBulletShot {
  round: number
  tick: number
  hit: boolean
  weapon: string
}

export interface PlayerAnalyticsData {
  duels: DuelEpisode[]
  metrics: PlayerMetrics
  impact: PlayerImpact
  mapEvents: MapEvent[]
  decisionsCost: DecisionEntry[]
}

export interface DuelFrame {
  t: number      // ms offset from kill tick (negative = before)
  vel: number    // speed in u/s (from positional deltas — velocity props lie on downsampled ticks)
  w: boolean     // moving forward (velocity direction vs yaw)
  a: boolean     // strafing left
  s: boolean     // moving back
  d: boolean     // strafing right
  jump: boolean  // player_jump event in this tick window
  duck: boolean  // duck_amount > 0.3
  walk: boolean  // is_walking (Shift)
}

export interface DuelShot {
  t: number      // ms offset from kill tick
  sid: string | null  // shooter (duel attacker or victim)
  hit: boolean   // player_hurt from this shooter within 0.15s
}

export interface DuelEpisode {
  round: number
  tick: number
  timestamp: number
  attacker: string
  victim: string
  weapon: string
  headshot: boolean
  won: boolean
  opening: boolean
  isTradeKill: boolean
  isTradedDeath: boolean
  errors: string[]
  winProb?: number | null
  context: {
    nearAllyDist: number | null
    flashDur: number
    attackerVel: number
    victimVel: number
    aliveAllies: number
    aliveEnemies: number
    attackerWalking: boolean
  }
  frames: DuelFrame[]
  shots?: DuelShot[]
}

export interface PlayerMetrics {
  tradeKillPct: number
  tradedDeathPct: number
  openingWinPct: number
  flashEfficiency: number
  clutchWinPct: number
  shiftPeekPct: number
  isolatedPct: number
  mainProblem: string | null
  tradeKillRounds: number[]
  tradedDeathRounds: number[]
  tradeKillTicks: number[]
  tradedDeathTicks: number[]
  // aim mechanics (Batch 2)
  counterStrafeErrors: number
  idealStrafePct: number
  firstBulletAcc: number
  firstBulletShots: FirstBulletShot[]
  ttk_ms: number
  reloadErrors: number
  angleControlCount: number
  angleControlByPhase?: { early: number; mid: number; late: number }
  reactionTimeMs: number
  overshootCount: number
  excellentContacts: number
  crosshairPlacementPct: number
  successfulReactionTimeMs: number
  reactionDeltas: number[]
  reactionDeltasHit: number[]
  passiveAngleCount: number
}

export interface PlayerImpact {
  topRoundsPositive: { n: number; imp: number }[]
  topRoundsNegative: { n: number; imp: number }[]
  avgWinProbAtDuel: number | null
}

export interface MapEvent {
  tick: number
  round: number
  type: 'kill' | 'death'
  x: number
  y: number
  vx: number
  vy: number
  weapon: string
  headshot: boolean
}

export interface MapVerticalSection {
  altitudeMin: number
  altitudeMax: number
  pos_x?: number
  pos_y?: number
  scale?: number
}

export interface MapOverview {
  pos_x: number; pos_y: number; scale: number
  verticalsections?: Record<string, MapVerticalSection>
  availableLevels?: string[]
  sections?: { id: string; altitudeMax: number; altitudeMin: number; pos_x?: number; pos_y?: number; scale?: number }[]
}

export interface BenchmarkTiers {
  weak: number
  avg: number
  good: number
  elite: number
}

export type Benchmarks = Record<string, BenchmarkTiers>

export interface PlayerHistoryEntry {
  demoId: string
  map: string
  date: string
  score: [number, number]
  teamNames: [string, string]
  team: number
  won: boolean
  kills: number
  deaths: number
  adr: number
  kast: number
  rating: number
  rws?: number
  imp?: number
}

export interface Moment {
  type: 'clutch' | 'multikill' | 'openingDeath' | 'mistake' | 'swing'
  tick: number
  round: number
  steamid: string | null
  won?: boolean
  count?: number
  detail?: string
  // highlight window on the timeline: [tick - preSec, tick + durSec]
  preSec?: number
  durSec?: number
}

export interface AutoimportStatus {
  import?: { windowHours: number }
  watch: { enabled: boolean; dirs: string[]; pollSec: number }
  faceit: { enabled: boolean; playerId: string; pollSec: number; knownMatches: number }
  suggestions?: number
}

export interface ProgressStageInfo {
  stage: string
  phase: string
  pct: [number, number]
  sec: number
}

export interface Settings {
  watch: { dirs: string[]; pollSec: number }
  faceit: { apiKeySet: boolean; playerId: string; pollSec: number }
  import?: { windowHours: number }
  progress?: { source: 'default' | 'measured' | 'pinned'; stages: ProgressStageInfo[] }
}

export interface SettingsPatch {
  watch?: { dirs?: string[]; pollSec?: number }
  faceit?: { apiKey?: string | null; playerId?: string; pollSec?: number }
  import?: { windowHours?: number }
}

export const api = {
  demos: (): Promise<DemoEntry[]> => req('/demos'),
  benchmarks: (): Promise<Benchmarks> => req('/benchmarks'),
  autoimport: (): Promise<AutoimportStatus> => req('/autoimport'),
  getSettings: (): Promise<Settings> => req('/settings'),
  saveSettings: (patch: SettingsPatch): Promise<AutoimportStatus> =>
    req('/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  upload: (file: File): Promise<{ id: string; name: string; size: number }> => {
    const fd = new FormData(); fd.append('file', file)
    return req('/demos/upload', { method: 'POST', body: fd })
  },
  analyze: (id: string): Promise<unknown> => {
    evictDemo(id)  // re-analysis invalidates cached artifacts
    return req(`/demos/${id}/analyze`, { method: 'POST' })
  },
  probe: (id: string): Promise<unknown> => req(`/demos/${id}/probe`, { method: 'POST' }),
  fetchDemo: (key: string): Promise<{ started: boolean }> => req('/demos/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  }),
  status: (id: string): Promise<StatusData> => req(`/demos/${id}/status`),
  delete: (id: string): Promise<unknown> => {
    evictDemo(id)
    return req(`/demos/${id}`, { method: 'DELETE' })
  },
  analysis: (id: string): Promise<AnalysisData> => cached(`analysis:${id}`, () => req(`/demos/${id}/analysis`)),
  heatmap: (id: string): Promise<HeatmapData> => cached(`heatmap:${id}`, () => req(`/demos/${id}/heatmap`)),
  replay: (id: string): Promise<ReplayData> => cached(`replay:${id}`, () => req(`/demos/${id}/replay`)),
  mapOverview: (map: string): Promise<MapOverview> => cached(`overview:${map}`, () => req(`/maps/${map}/overview`)),
  radarUrl: (map: string, level?: string) =>
    `/api/maps/${map}/radar${level && level !== 'default' ? `?level=${encodeURIComponent(level)}` : ''}`,
  playerHistory: (steamid: string): Promise<PlayerHistoryEntry[]> =>
    req(`/players/${steamid}/history`),
  playerAnalytics: (id: string, steamid: string): Promise<PlayerAnalyticsData> =>
    cached(`panalytics:${id}:${steamid}`, () => req(`/demos/${id}/player/${steamid}/analytics`)),
}
