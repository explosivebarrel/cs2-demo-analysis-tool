const BASE = '/api'

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(BASE + url, opts)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

export interface DemoEntry {
  id: string
  name: string
  size: number
  source: 'inbox' | 'upload'
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
  weapons: Record<number, string>
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

export interface ClutchEntry { round: number; enemies: number; won: boolean; kills: number }

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

export interface WeaponInfo { raw: string; en: string; ru: string; cls: string }

export interface ReplayData {
  tickrate: number; frameStep: number
  players: { steamid: string; name: string; team: number }[]
  ticks: number[]
  data: number[]  // flat: frame * nPlayers * FIELDS + playerIdx * FIELDS + field
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
  firstBulletShots: FirstBulletShot[]
}

export interface DuelFrame {
  t: number      // ms offset from kill tick (negative = before)
  vel: number    // speed in u/s
  jump: boolean  // player_jump event in this tick window
  duck: boolean  // duck_amount > 0.3
  walk: boolean  // is_walking (Shift)
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

export interface MapOverview {
  pos_x: number; pos_y: number; scale: number
  sections?: { id: string; altitudeMax: number; altitudeMin: number; pos_x?: number; pos_y?: number; scale?: number }[]
}

export interface BenchmarkTiers {
  weak: number
  avg: number
  good: number
  elite: number
}

export type Benchmarks = Record<string, BenchmarkTiers>

export interface ChatMessage {
  tick: number
  steamid: string
  name: string
  text: string
  round: number | null
}

export const api = {
  demos: (): Promise<DemoEntry[]> => req('/demos'),
  benchmarks: (): Promise<Benchmarks> => req('/benchmarks'),
  upload: (file: File): Promise<{ id: string; name: string; size: number }> => {
    const fd = new FormData(); fd.append('file', file)
    return req('/demos/upload', { method: 'POST', body: fd })
  },
  analyze: (id: string): Promise<unknown> => req(`/demos/${id}/analyze`, { method: 'POST' }),
  probe: (id: string): Promise<unknown> => req(`/demos/${id}/probe`, { method: 'POST' }),
  status: (id: string): Promise<StatusData> => req(`/demos/${id}/status`),
  delete: (id: string): Promise<unknown> => req(`/demos/${id}`, { method: 'DELETE' }),
  analysis: (id: string): Promise<AnalysisData> => req(`/demos/${id}/analysis`),
  heatmap: (id: string): Promise<HeatmapData> => req(`/demos/${id}/heatmap`),
  replay: (id: string): Promise<ReplayData> => req(`/demos/${id}/replay`),
  chat: (id: string): Promise<ChatMessage[]> => req(`/demos/${id}/chat`),
  mapOverview: (map: string): Promise<MapOverview> => req(`/maps/${map}/overview`),
  radarUrl: (map: string) => `/api/maps/${map}/radar`,
  playerAnalytics: (id: string, steamid: string): Promise<PlayerAnalyticsData> =>
    req(`/demos/${id}/player/${steamid}/analytics`),
}
