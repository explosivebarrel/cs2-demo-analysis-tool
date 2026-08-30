import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import MatchNavShared from '../components/MatchNav'
import { api, ReplayData, MapOverview, AnalysisData, RoundData } from '../api'
import { t, getLang } from '../i18n'
import { useLang } from '../App'

// ── field indices in the flat data buffer ────────────────────────────────────
const F_X = 0, F_Y = 1, F_Z = 2, F_YAW = 3, F_HP = 4, F_ARMOR = 5
const F_ALIVE = 6, F_WID = 7, F_FLAGS = 8, F_TEAM = 9
const FIELDS = 11

const TEAM_COLORS: Record<number, string> = { 2: '#e4882a', 3: '#4a9eda' }  // team_num: 2=T (orange), 3=CT (blue)
const TEAM_COLOR_BY_IDX = ['#e4882a', '#4a9eda']  // player.team index: 0=T, 1=CT
const SIZE = 600
const SPEEDS = [0.5, 1, 2, 4, 8]

// ── grenade zone visuals ─────────────────────────────────────────────────────
const NADE_COLORS: Record<string, string> = {
  sm: 'rgba(150,200,150,0.65)', fd: 'rgba(255,240,80,0.8)',
  hd: 'rgba(255,160,40,0.8)',  fr: 'rgba(255,80,30,0.65)',
}
const NADE_EDGE: Record<string, string> = {
  sm: 'rgba(150,200,150,0.25)', fd: 'rgba(255,240,80,0.25)',
  hd: 'rgba(255,160,40,0.25)', fr: 'rgba(255,80,30,0.25)',
}
const NADE_RADIUS: Record<string, number> = { sm: 26, fd: 10, hd: 12, fr: 20 }

interface Transform { scale: number; ox: number; oy: number }

function worldToCanvas(wx: number, wy: number, ov: MapOverview, sz = SIZE): [number, number] {
  const px = (wx - ov.pos_x) / ov.scale
  const py = (ov.pos_y - wy) / ov.scale
  const ratio = sz / 1024
  return [px * ratio, py * ratio]
}

function applyTx(x: number, y: number, tx: Transform): [number, number] {
  return [x * tx.scale + tx.ox, y * tx.scale + tx.oy]
}

// ── kill diagnosis rules ──────────────────────────────────────────────────────
interface KillContext {
  nearAllyDist?: number | null
  flashDur?: number
  victimVel?: number
  aliveAllies?: number
  aliveEnemies?: number
  victimWalking?: number
}

function diagnosisLines(kc: KillContext, isAttacker: boolean): string[] {
  const lines: string[] = []
  if (!kc) return lines
  if (isAttacker) {
    if (kc.aliveAllies !== undefined && kc.aliveAllies === 0)
      lines.push('Играл в изоляции — ни одного живого союзника')
    else if (kc.nearAllyDist !== undefined && kc.nearAllyDist !== null && kc.nearAllyDist > 800)
      lines.push(`Ближайший союзник был в ${Math.round(kc.nearAllyDist)}u`)
    if (kc.flashDur !== undefined && kc.flashDur > 1.5)
      lines.push(`Враг был заблеспан ${kc.flashDur.toFixed(1)}с`)
    if (kc.victimWalking)
      lines.push('Враг шёл на шифте — низкая скорость')
  } else {
    // victim perspective
    if (kc.flashDur !== undefined && kc.flashDur > 1.5)
      lines.push(`Был заблеспан ${kc.flashDur.toFixed(1)}с в момент смерти`)
    if (kc.victimVel !== undefined && kc.victimVel > 100)
      lines.push(`Двигался со скоростью ${Math.round(kc.victimVel)}u/s`)
    if (kc.aliveAllies !== undefined && kc.aliveEnemies !== undefined && kc.aliveEnemies > kc.aliveAllies + 1)
      lines.push(`Численный перевес у противника ${kc.aliveEnemies}v${kc.aliveAllies}`)
  }
  return lines
}

type EventFilter = 'all' | 'kills' | 'bomb' | 'nades'

/** Event log panel for the replay page center column. */
function EventLog({
  replay, analysis, frameIdx,
}: {
  replay: ReplayData
  analysis: AnalysisData | null
  frameIdx: number
}) {
  const [filter, setFilter] = useState<EventFilter>('all')
  const [focusPidx, setFocusPidx] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const curTick = replay.ticks[frameIdx] ?? 0

  // find current round bounds
  const curRound = analysis?.rounds ? findRoundForTick(analysis.rounds as RoundData[], curTick) : null
  const roundStart = curRound?.freezeEndTick ?? 0
  const roundEnd = curRound?.endTick ?? Infinity

  // collect events up to curTick within current round
  const visible = useMemo(() => {
    return replay.events.filter(ev => {
      const e = ev as Record<string, unknown>
      const tick = e.t as number
      if (tick > curTick || tick < roundStart) return false
      const ty = e.ty as string
      if (filter === 'kills') return ty === 'k'
      if (filter === 'bomb') return ['bp', 'bu', 'bo', 'bz', 'bf', 'bx'].includes(ty)
      if (filter === 'nades') return ['sm', 'hd', 'fd', 'fr', 'g'].includes(ty)
      return ['k', 'bp', 'bu', 'bo', 'bz', 'bf', 'bx', 'sm', 'hd', 'fd', 'fr'].includes(ty)
    }).slice(-40)
  }, [replay.events, curTick, roundStart, filter])

  // auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [visible.length])

  function fmtTick(tick: number) {
    const sec = Math.max(0, (tick - roundStart)) / replay.tickrate
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }

  const lang = getLang()

  function renderEvent(ev: unknown, idx: number) {
    const e = ev as Record<string, unknown>
    const ty = e.ty as string
    const tick = e.t as number

    if (ty === 'k') {
      const ai = e.a as number, vi = e.v as number
      const attacker = replay.players[ai]?.name ?? '?'
      const victim = replay.players[vi]?.name ?? '?'
      const weapInfo = replay.weapons[e.w as number]
      const weapName = weapInfo ? (lang === 'ru' ? weapInfo.ru : weapInfo.en) : ''
      const hs = !!e.h
      const kc = e.kc as KillContext | undefined
      const aTeam = replay.players[ai]?.team ?? -1
      // diagnosis from attacker's perspective
      const diag = kc ? diagnosisLines(kc, true) : []
      const highlighted = focusPidx !== null && (ai === focusPidx || vi === focusPidx)
      return (
        <div key={idx}
          style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', background: highlighted ? 'rgba(255,255,255,0.04)' : 'transparent', cursor: 'pointer' }}
          onClick={() => setFocusPidx(focusPidx === ai ? null : ai)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--text2)', minWidth: 30 }}>{fmtTick(tick)}</span>
            <span style={{ fontSize: 10, background: 'var(--red)', color: '#fff', borderRadius: 3, padding: '1px 5px' }}>УБИЙСТВО{hs ? ' НС' : ''}</span>
            <span style={{ fontSize: 12, color: TEAM_COLOR_BY_IDX[aTeam] ?? '#fff', fontWeight: 600 }}>{attacker}</span>
            <span style={{ fontSize: 10, color: 'var(--text2)' }}>→</span>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>{victim}</span>
            <span style={{ fontSize: 10, color: 'var(--text2)', marginLeft: 'auto' }}>{weapName}</span>
          </div>
          {diag.map((d, di) => (
            <div key={di} style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2, paddingLeft: 36 }}>{d}</div>
          ))}
        </div>
      )
    }

    const bombLabels: Record<string, string> = {
      bp: '💣 Бомба заложена', bu: '🤲 Подобрал бомбу', bo: '📦 Бомба брошена',
      bz: '🔧 Начал минировать', bf: '✅ Бомба обезврежена', bx: '💥 Бомба взорвалась',
    }
    if (bombLabels[ty]) {
      const pidx = e.p as number
      const pname = replay.players[pidx]?.name ?? ''
      return (
        <div key={idx} style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text2)', minWidth: 30 }}>{fmtTick(tick)}</span>
          <span style={{ fontSize: 12 }}>{bombLabels[ty]}{pname ? ` · ${pname}` : ''}</span>
        </div>
      )
    }

    const nadeLabels: Record<string, string> = {
      sm: '🌫 Смок', hd: '💥 HE', fd: '⚡ Флешка', fr: '🔥 Молик',
    }
    if (nadeLabels[ty]) {
      const pidx = e.p as number
      const pname = replay.players[pidx]?.name ?? ''
      return (
        <div key={idx} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', opacity: 0.8 }}>
          <span style={{ fontSize: 10, color: 'var(--text2)', minWidth: 30 }}>{fmtTick(tick)}</span>
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>{nadeLabels[ty]}{pname ? ` · ${pname}` : ''}</span>
        </div>
      )
    }

    return null
  }

  const filterBtns: { key: EventFilter; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'kills', label: 'Дуэли' },
    { key: 'bomb', label: 'Бомба' },
    { key: 'nades', label: 'Гранаты' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexShrink: 0 }}>
        {filterBtns.map(fb => (
          <button key={fb.key}
            className={filter === fb.key ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 11, padding: '3px 8px' }}
            onClick={() => setFilter(fb.key)}
          >{fb.label}</button>
        ))}
        {curRound && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text2)', alignSelf: 'center' }}>
            Р{curRound.n}
          </span>
        )}
      </div>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {visible.map((ev, i) => renderEvent(ev, i))}
        {visible.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text2)', fontSize: 12, textAlign: 'center' }}>Событий пока нет</div>
        )}
      </div>
    </div>
  )
}

// ── scoreboard panel ──────────────────────────────────────────────────────────

/** Right-side scoreboard with CT/T sections, HP bars, equipment value, weapon. */
function ScoreboardPanel({
  replay, analysis, frameIdx,
}: {
  replay: ReplayData
  analysis: AnalysisData | null
  frameIdx: number
}) {
  const lang = getLang()
  const n = replay.players.length

  // group players by team index (0=T, 1=CT)
  const teams: { idx: number; label: string; color: string; players: typeof replay.players }[] = [
    { idx: 1, label: 'КТ', color: TEAM_COLOR_BY_IDX[1], players: replay.players.filter(p => p.team === 1) },
    { idx: 0, label: 'Т',  color: TEAM_COLOR_BY_IDX[0], players: replay.players.filter(p => p.team === 0) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {teams.map(team => {
        const teamName = analysis?.teams[team.idx === 1 ? 0 : 1]?.name ?? team.label
        return (
          <div key={team.label} className="card" style={{ padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, borderBottom: `2px solid ${team.color}`, paddingBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: team.color }}>{team.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{teamName}</span>
            </div>
            {team.players.map((pl, _) => {
              const globalIdx = replay.players.findIndex(p => p.steamid === pl.steamid)
              const base = frameIdx * n * FIELDS + globalIdx * FIELDS
              const alive = replay.data[base + F_ALIVE] ?? 0
              const hp = replay.data[base + F_HP] ?? 0
              const wid = replay.data[base + F_WID] ?? 0
              const flags = replay.data[base + F_FLAGS] ?? 0
              const hasBomb = (flags & 1) !== 0
              const weapInfo = replay.weapons[wid]
              const weapName = weapInfo ? (lang === 'ru' ? weapInfo.ru : weapInfo.en) : ''
              return (
                <div key={pl.steamid} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border)', opacity: alive ? 1 : 0.35 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: alive ? team.color : '#555', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hasBomb ? '💣 ' : ''}{pl.name}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }}>{weapName}</span>
                  <div style={{ width: 36, height: 4, background: '#333', borderRadius: 2, flexShrink: 0 }}>
                    <div style={{ width: `${hp}%`, height: '100%', borderRadius: 2, background: hp > 50 ? '#4caf7d' : hp > 25 ? '#f5c542' : '#e05252' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, minWidth: 24, textAlign: 'right', color: alive ? (hp > 50 ? 'var(--green)' : hp > 25 ? 'var(--accent2)' : 'var(--red)') : 'var(--text2)' }}>
                    {alive ? hp : '☠'}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── sub-components ────────────────────────────────────────────────────────────

/** Find which round owns the given tick (freeze time belongs to the NEXT round). */
function findRoundForTick(rounds: RoundData[], tick: number): RoundData | null {
  if (!rounds.length) return null
  // each round owns: (prevRound.endTick, curRound.endTick]
  // i.e. freeze time after prev round belongs to next round
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i]
    const prevEnd = i > 0 ? rounds[i - 1].endTick : 0
    if (tick > prevEnd && tick <= r.endTick) return r
  }
  // past the last round
  return rounds[rounds.length - 1]
}

/** Numbered round buttons with a vertical scrubber line sliding across the active round. */
function RoundSwitcher({
  rounds, ticks, frameIdx, onJump,
}: {
  rounds: RoundData[]
  ticks: number[]
  frameIdx: number
  onJump: (fi: number) => void
}) {
  const curTick = ticks[frameIdx] ?? 0
  const activeRound = findRoundForTick(rounds, curTick)

  // warmup: ticks before first round freezeEndTick
  const firstRoundStart = rounds.length > 0 ? rounds[0].freezeEndTick : 0
  const isWarmup = curTick < firstRoundStart

  function jumpWarmup() {
    const fi = ticks.findIndex(tk => tk > 0)
    if (fi >= 0) onJump(fi)
  }

  return (
    <div style={{ display: 'flex', width: '100%', marginBottom: 10, border: '1px solid var(--border)', borderRadius: 0, overflow: 'visible' }}>
      {/* warmup button */}
      <button
        onClick={jumpWarmup}
        title="Разминка"
        style={{
          position: 'relative', flexShrink: 0,
          padding: '5px 8px', fontSize: 10, fontWeight: isWarmup ? 700 : 400,
          background: isWarmup ? 'rgba(100,100,200,0.25)' : 'var(--bg2)',
          color: isWarmup ? '#aac' : 'var(--text2)',
          border: 'none', borderRight: '1px solid var(--border)',
          cursor: 'pointer', textAlign: 'center', minWidth: 0, whiteSpace: 'nowrap',
        }}
      >
        WU
      </button>

      {rounds.map((r, ri) => {
        const isActive = activeRound?.n === r.n
        // scrubber spans full round including freeze: from freezeStartTick to endTick
        const prevRound = ri > 0 ? rounds[ri - 1] : null
        const roundFreezeStart = prevRound ? prevRound.endTick : 0
        const roundTotalDur = r.endTick - roundFreezeStart
        let scrubberPct = -1
        if (isActive && roundTotalDur > 0) {
          scrubberPct = Math.min(1, Math.max(0, (curTick - roundFreezeStart) / roundTotalDur))
        }
        const startFi = ticks.findIndex(tk => tk >= r.freezeEndTick)
        return (
          <button
            key={r.n}
            onClick={() => startFi >= 0 && onJump(startFi)}
            title={`R${r.n}${r.isPistol ? ' (pistol)' : ''}`}
            style={{
              position: 'relative', flex: 1,
              padding: '5px 2px', fontSize: 11, fontWeight: isActive ? 700 : 400,
              background: isActive ? 'rgba(74,120,220,0.18)' : r.isPistol ? 'rgba(255,180,50,0.06)' : 'var(--bg2)',
              color: isActive ? 'var(--accent)' : r.isPistol ? 'var(--accent2)' : 'var(--text2)',
              border: 'none',
              borderLeft: '1px solid var(--border)',
              cursor: 'pointer', textAlign: 'center', minWidth: 0,
              overflow: 'visible',
            }}
          >
            {/* vertical scrubber line — full height, no clipping */}
            {isActive && scrubberPct >= 0 && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${scrubberPct * 100}%`,
                width: 2,
                background: 'rgba(255,255,255,0.7)',
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: 1,
              }} />
            )}
            {String(r.n).padStart(2, '0')}
          </button>
        )
      })}
    </div>
  )
}

/** SVG balance-of-power graph that acts as a timeline scrubber for the current round. */
function WinProbGraph({
  winprob, ticks, rounds, frameIdx, onScrub, height = 60,
}: {
  winprob: number[]
  ticks: number[]
  rounds: RoundData[]
  frameIdx: number
  onScrub: (fi: number) => void
  height?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const total = winprob.length
  const W = 1000

  // compute current round frame bounds — include freeze time + ±10s neighbours
  const curTick = ticks[frameIdx] ?? 0
  const curRound = findRoundForTick(rounds, curTick)

  const curRoundIdx = curRound ? rounds.findIndex(r => r.n === curRound.n) : -1
  const prevRound = curRoundIdx > 0 ? rounds[curRoundIdx - 1] : null

  const NEIGHBOUR_TICKS = 10 * 64  // ~10s at 64tick

  // core window: freeze start → round end
  const freezeStartTick = curRound
    ? (prevRound ? prevRound.endTick + 1 : Math.max(0, curRound.freezeEndTick - 960))
    : 0
  const roundEndTick = curRound?.endTick ?? 0

  // extended window with neighbours
  const extStartTick = Math.max(0, freezeStartTick - NEIGHBOUR_TICKS)
  const extEndTick   = roundEndTick + NEIGHBOUR_TICKS

  function tickToFi(tick: number): number {
    const i = ticks.findIndex(tk => tk >= tick)
    return i < 0 ? total - 1 : Math.max(0, i)
  }

  const rStartFi     = tickToFi(extStartTick)
  const rCoreStartFi = tickToFi(freezeStartTick)
  const rFreezeEndFi = curRound ? tickToFi(curRound.freezeEndTick) : 0
  const rCoreEndFi   = curRound ? tickToFi(roundEndTick) : total - 1
  const rEndFi       = Math.min(total - 1, tickToFi(extEndTick))
  const rLen         = Math.max(1, rEndFi - rStartFi)

  // map frame index → SVG x coordinate
  function fi2x(fi: number): number { return ((fi - rStartFi) / rLen) * W }

  const freezeMarkerX = fi2x(rFreezeEndFi)
  const coreStartX    = fi2x(rCoreStartFi)
  const coreEndX      = fi2x(rCoreEndFi)

  function fiFromClientX(clientX: number): number {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rLen < 2) return rStartFi
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(rStartFi + pct * rLen)
  }

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault(); dragging.current = true
    onScrub(fiFromClientX(e.clientX))
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return
    onScrub(fiFromClientX(e.clientX))
  }
  function onMouseUp() { dragging.current = false }

  if (total < 2) return null

  const H = height
  const slice = winprob.slice(rStartFi, rEndFi + 1)

  const cursorX = fi2x(frameIdx).toFixed(1)
  const midY = H / 2

  // curve points (x, y) where y=0 is top (CT winning), y=H is bottom (T winning)
  const curvePts = slice.map((p, i) => [fi2x(rStartFi + i), (1 - p) * H] as [number, number])

  // SVG polyline string
  const curveStr = curvePts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

  // CT fill: curve + right edge at mid + left edge at mid — clipped to top half
  const firstX = curvePts[0]?.[0] ?? 0
  const lastX  = curvePts[curvePts.length - 1]?.[0] ?? W
  const fillPath = `M ${firstX.toFixed(1)},${midY} ` +
    curvePts.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
    ` L ${lastX.toFixed(1)},${midY} Z`

  const curVal = winprob[frameIdx] ?? 0.5
  const ctPct  = Math.round(curVal * 100)
  const tPct   = 100 - ctPct

  const hatchId = 'nbHatch'

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block', cursor: 'crosshair', userSelect: 'none' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <defs>
        {/* CT fill: curve area above midline */}
        <clipPath id="clipCT">
          <rect x="0" y="0" width={W} height={midY} />
        </clipPath>
        {/* T fill: curve area below midline */}
        <clipPath id="clipT">
          <rect x="0" y={midY} width={W} height={midY} />
        </clipPath>
        <linearGradient id="ctFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#4a9eda" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#4a9eda" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="tFill" x1="0" x2="0" y1="1" y2="0">
          <stop offset="0%" stopColor="#e4882a" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#e4882a" stopOpacity="0.08" />
        </linearGradient>
        <pattern id={hatchId} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(120,120,120,0.35)" strokeWidth="3" />
        </pattern>
      </defs>

      {/* background */}
      <rect width={W} height={H} fill="var(--bg2, #1a1c20)" />

      {/* CT advantage fill — only above midline */}
      <path d={fillPath} fill="url(#ctFill)" clipPath="url(#clipCT)" />
      {/* T advantage fill — only below midline */}
      <path d={fillPath} fill="url(#tFill)" clipPath="url(#clipT)" />

      {/* 50% midline */}
      <line x1="0" y1={midY} x2={W} y2={midY} stroke="#555" strokeWidth="0.8" strokeDasharray="6,4" />

      {/* balance curve */}
      <polyline points={curveStr} fill="none" stroke="#4a9eda" strokeWidth="1.8" strokeLinejoin="round" />

      {/* prev-round neighbour hatch (left side) */}
      {coreStartX > 0 && (
        <rect x="0" y="0" width={coreStartX.toFixed(1)} height={H} fill={`url(#${hatchId})`} />
      )}

      {/* next-round neighbour hatch (right side) */}
      {coreEndX < W && (
        <rect x={coreEndX.toFixed(1)} y="0" width={(W - coreEndX).toFixed(1)} height={H} fill={`url(#${hatchId})`} />
      )}

      {/* freeze time subtle tint (between coreStart and freezeEnd) */}
      {freezeMarkerX > coreStartX && (
        <rect x={coreStartX.toFixed(1)} y="0"
          width={(freezeMarkerX - coreStartX).toFixed(1)} height={H}
          fill="rgba(255,255,255,0.04)" />
      )}

      {/* freeze end marker */}
      <line
        x1={freezeMarkerX.toFixed(1)} y1="0"
        x2={freezeMarkerX.toFixed(1)} y2={H}
        stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeDasharray="3,3"
      />

      {/* neighbour boundary markers */}
      {coreStartX > 0 && (
        <line x1={coreStartX.toFixed(1)} y1="0" x2={coreStartX.toFixed(1)} y2={H}
          stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      )}
      {coreEndX < W && (
        <line x1={coreEndX.toFixed(1)} y1="0" x2={coreEndX.toFixed(1)} y2={H}
          stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      )}

      {/* cursor line */}
      <line x1={cursorX} y1="0" x2={cursorX} y2={H} stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />

      {/* live score labels */}
      <text x="6" y="11" fill="#4a9eda" fontSize="10" fontFamily="monospace" fontWeight="bold">КТ {ctPct}%</text>
      <text x={W - 6} y={H - 4} fill="#e4882a" fontSize="10" fontFamily="monospace" fontWeight="bold" textAnchor="end">Т {tPct}%</text>
    </svg>
  )
}

// ── grenade trail colours ─────────────────────────────────────────────────────
const TRAIL_COLORS = ['#88bb88', '#ff9930', '#ffec50', '#ff5020', '#aaaaaa'] // smoke, HE, flash, fire/molotov, decoy
// NADE_TYPE indices: 0=smoke, 1=HE, 2=flash, 3=fire, 4=decoy

type NadeTrailMode = 'trail' | 'path'

// ── map drawing ───────────────────────────────────────────────────────────────
function drawFrame(
  canvas: HTMLCanvasElement,
  frameIdx: number,
  replay: ReplayData,
  ov: MapOverview,
  radarImg: HTMLImageElement | null,
  tx: Transform,
  nadeTrailMode: NadeTrailMode = 'trail',
) {
  const ctx = canvas.getContext('2d')!
  const SZ = canvas.width
  ctx.clearRect(0, 0, SZ, SZ)
  const dotScale = 1 / Math.sqrt(tx.scale)

  ctx.save()
  ctx.translate(tx.ox, tx.oy)
  ctx.scale(tx.scale, tx.scale)

  if (radarImg?.complete && radarImg.naturalWidth > 0) {
    ctx.drawImage(radarImg, 0, 0, SZ, SZ)
  } else {
    ctx.fillStyle = '#1a1c20'
    ctx.fillRect(0, 0, SZ, SZ)
    ctx.strokeStyle = '#2a2d35'; ctx.lineWidth = 1
    for (let i = 0; i <= SZ; i += 40) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, SZ); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(SZ, i); ctx.stroke()
    }
  }

  const curTick = replay.ticks[frameIdx] ?? 0

  // find current round start tick
  const roundEvents = replay.events.filter(ev => (ev as Record<string, unknown>).ty === 'r')
  let roundStartT = 0
  for (const rev of roundEvents) {
    const rt = (rev as Record<string, unknown>).t as number
    if (rt <= curTick) roundStartT = rt
  }

  // active smoke/fire zones
  const activeZones: { ty: string; x: number; y: number }[] = []
  for (const ev of replay.events) {
    const evTy = (ev as Record<string, unknown>).ty as string
    if (evTy !== 'sm' && evTy !== 'fr') continue
    const evT = (ev as Record<string, unknown>).t as number
    if (evT > curTick || evT < roundStartT) continue
    const expTy = evTy === 'sm' ? 'sx' : 'fx'
    const expire = replay.events.find(e2 => {
      const t2 = e2 as Record<string, unknown>
      return t2.ty === expTy && (t2.t as number) > evT &&
        Math.abs((t2.x as number) - ((ev as Record<string, unknown>).x as number)) < 50 &&
        Math.abs((t2.y as number) - ((ev as Record<string, unknown>).y as number)) < 50
    })
    const expT = expire ? (expire as Record<string, unknown>).t as number : evT + 18 * replay.tickrate
    if (curTick <= expT) activeZones.push({ ty: evTy, x: (ev as Record<string, unknown>).x as number, y: (ev as Record<string, unknown>).y as number })
  }

  // recent flash/HE detonations
  const recentDet: { ty: string; x: number; y: number }[] = []
  for (const ev of replay.events) {
    const evTy = (ev as Record<string, unknown>).ty as string
    if (evTy !== 'fd' && evTy !== 'hd') continue
    const evT = (ev as Record<string, unknown>).t as number
    if (Math.abs(evT - curTick) < replay.tickrate * 0.35)
      recentDet.push({ ty: evTy, x: (ev as Record<string, unknown>).x as number, y: (ev as Record<string, unknown>).y as number })
  }

  for (const z of [...activeZones, ...recentDet]) {
    const [cx, cy] = worldToCanvas(z.x, z.y, ov, SZ)
    const r = NADE_RADIUS[z.ty] ?? 10
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, NADE_COLORS[z.ty] ?? 'rgba(200,200,200,0.6)')
    grad.addColorStop(1, NADE_EDGE[z.ty] ?? 'rgba(200,200,200,0.15)')
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = grad; ctx.fill()
  }

  // shot tracers + hit lines
  const tracerWindow = replay.tickrate * 0.25
  // build hurt-hit map: "tick:attackerPidx" -> {hx, hy} for quick lookup
  const hurtMap = new Map<string, { hx: number; hy: number }>()
  for (const ev of replay.events) {
    const e = ev as Record<string, unknown>
    if (e.ty !== 'hi') continue
    const htick = e.t as number
    const ha = e.a as number
    if (htick > curTick || curTick - htick > tracerWindow) continue
    const key = `${htick}:${ha}`
    if (!hurtMap.has(key)) hurtMap.set(key, { hx: e.x as number, hy: e.y as number })
  }

  for (const shot of replay.shots) {
    const [stTick, pidx, sx, sy] = shot
    if (stTick > curTick || curTick - stTick > tracerWindow) continue
    const syaw = shot[4]
    const [scx, scy] = worldToCanvas(sx, sy, ov, SZ)
    const rad = (syaw * Math.PI) / 180
    const fade = 1 - (curTick - stTick) / tracerWindow
    const playerColor = TEAM_COLORS[replay.data[frameIdx * replay.players.length * FIELDS + pidx * FIELDS + F_TEAM] ?? 0] ?? '#fff'
    const alphaHex = Math.round(fade * 0xcc).toString(16).padStart(2, '0')

    // look for matching hurt event within ±3 ticks of this shot
    let hitPt: { hx: number; hy: number } | null = null
    for (let dt = 0; dt <= 3 && !hitPt; dt++) {
      hitPt = hurtMap.get(`${stTick + dt}:${pidx}`) ?? null
    }

    if (hitPt) {
      const [ecx, ecy] = worldToCanvas(hitPt.hx, hitPt.hy, ov, SZ)
      ctx.beginPath()
      ctx.moveTo(scx, scy)
      ctx.lineTo(ecx, ecy)
      ctx.strokeStyle = playerColor + alphaHex
      ctx.lineWidth = 1.2; ctx.stroke()
      // cross at impact point
      const cs = 4 * dotScale
      ctx.beginPath()
      ctx.moveTo(ecx - cs, ecy - cs); ctx.lineTo(ecx + cs, ecy + cs)
      ctx.moveTo(ecx + cs, ecy - cs); ctx.lineTo(ecx - cs, ecy + cs)
      ctx.strokeStyle = '#ffffff' + alphaHex
      ctx.lineWidth = 1.5; ctx.stroke()
    } else {
      // no hit data yet: draw short directional tracer
      const tracerLen = 40
      ctx.beginPath()
      ctx.moveTo(scx, scy)
      ctx.lineTo(scx + Math.cos(rad) * tracerLen, scy - Math.sin(rad) * tracerLen)
      ctx.strokeStyle = playerColor + alphaHex
      ctx.lineWidth = 1.5; ctx.stroke()
    }
  }

  // grenade trails
  // Each trail event: { ty:"g", t: throwTick, g: nadeType(0-4), p: pidx, tr: [x,y,z, x,y,z,...] }
  // tr is downsampled at ~4 pts/sec, so each segment ≈ tickrate/4 ticks
  const TRAIL_FADE_TICKS = replay.tickrate * 2.5  // trail mode: show last 2.5s of flight
  for (const ev of replay.events) {
    const e = ev as Record<string, unknown>
    if (e.ty !== 'g') continue
    const throwTick = e.t as number
    if (throwTick > curTick || throwTick < roundStartT) continue

    const tr = e.tr as number[]
    const gtype = (e.g as number) ?? 4
    const color = TRAIL_COLORS[gtype] ?? '#aaaaaa'
    if (!tr || tr.length < 6) continue

    const nPts = Math.floor(tr.length / 3)
    // estimate ticks per segment based on ~4pts/sec downsampling
    const ticksPerSeg = replay.tickrate / 4

    // find detonate tick: look for matching fd/sm/hd/fr event near end position
    const endX = tr[tr.length - 3], endY = tr[tr.length - 2]
    const detTypes: Record<number, string[]> = { 0: ['sm'], 1: ['hd'], 2: ['fd'], 3: ['fr'], 4: [] }
    let detonateTick = throwTick + nPts * ticksPerSeg  // fallback
    for (const ev2 of replay.events) {
      const e2 = ev2 as Record<string, unknown>
      const detTys = detTypes[gtype] ?? []
      if (!detTys.includes(e2.ty as string)) continue
      const ex = e2.x as number, ey = e2.y as number
      const dx = ex - endX, dy = ey - endY
      if (dx * dx + dy * dy < 2500 && (e2.t as number) >= throwTick) {
        detonateTick = e2.t as number
        break
      }
    }

    // only draw while in flight (throwTick → detonateTick)
    if (curTick < throwTick || curTick > detonateTick + replay.tickrate * 0.5) continue

    // how far along the trajectory are we? (fraction 0..1)
    const flightDur = Math.max(1, detonateTick - throwTick)
    const progressTick = Math.min(curTick, detonateTick) - throwTick
    const progress = progressTick / flightDur

    // number of trail points visible
    const visiblePts = Math.max(2, Math.ceil(progress * nPts + 1))

    // in trail mode: only show last TRAIL_FADE_TICKS worth of points
    const trailSegs = Math.ceil(TRAIL_FADE_TICKS / ticksPerSeg)
    const startPt = nadeTrailMode === 'trail' ? Math.max(0, visiblePts - trailSegs) : 0
    const endPt = Math.min(nPts, visiblePts)

    if (endPt - startPt < 2) continue

    ctx.save()
    for (let pi = startPt; pi < endPt - 1; pi++) {
      const x0 = tr[pi * 3], y0 = tr[pi * 3 + 1]
      const x1 = tr[(pi + 1) * 3], y1 = tr[(pi + 1) * 3 + 1]
      const [cx0, cy0] = worldToCanvas(x0, y0, ov, SZ)
      const [cx1, cy1] = worldToCanvas(x1, y1, ov, SZ)
      // fade: older segments more transparent
      const segFrac = (pi - startPt) / Math.max(1, endPt - startPt - 1)
      const alpha = nadeTrailMode === 'trail' ? 0.2 + segFrac * 0.7 : 0.5
      ctx.beginPath()
      ctx.moveTo(cx0, cy0)
      ctx.lineTo(cx1, cy1)
      ctx.strokeStyle = color + Math.round(alpha * 0xff).toString(16).padStart(2, '0')
      ctx.lineWidth = 2 * dotScale
      ctx.stroke()
    }
    // draw grenade dot at current position
    const headPt = Math.min(endPt - 1, nPts - 1)
    const hx = tr[headPt * 3], hy = tr[headPt * 3 + 1]
    const [hcx, hcy] = worldToCanvas(hx, hy, ov, SZ)
    ctx.beginPath()
    ctx.arc(hcx, hcy, 4 * dotScale, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.restore()
  }

  // players
  const n = replay.players.length
  const frameBase = frameIdx * n * FIELDS
  if (frameBase + n * FIELDS > replay.data.length) { ctx.restore(); return }

  // velocity: compute per-player from prev frame position
  const prevFrameBase = Math.max(0, frameIdx - 1) * n * FIELDS
  const velScale = replay.tickrate / Math.max(1, replay.frameStep)

  for (let i = 0; i < n; i++) {
    const base = frameBase + i * FIELDS
    const alive = replay.data[base + F_ALIVE]
    if (!alive) continue
    const x = replay.data[base + F_X], y = replay.data[base + F_Y]
    const hp = replay.data[base + F_HP]
    const team = replay.data[base + F_TEAM]
    const flags = replay.data[base + F_FLAGS]
    const [cx, cy] = worldToCanvas(x, y, ov, SZ)
    const hasBomb = (flags & 1) !== 0
    const color = TEAM_COLORS[team] ?? '#ccc'
    const r = 8 * dotScale

    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = color + 'cc'; ctx.fill()
    ctx.strokeStyle = hasBomb ? '#fff' : color
    ctx.lineWidth = (hasBomb ? 2.5 : 1.5) * dotScale; ctx.stroke()

    // weapon label above dot (instead of name)
    const wid = replay.data[base + F_WID] ?? 0
    const weapRaw = replay.weapons[wid]?.raw ?? ''
    const weapKey = weapRaw.replace(/^weapon_/, '').toLowerCase()
    const NADE_ICONS: Record<string, string> = {
      smokegrenade: '💨', hegrenade: '💥', flashbang: '⚡',
      molotov: '🔥', incgrenade: '🔥', decoy: '🔊', c4: '💣',
    }
    const WEAP_SHORT: Record<string, string> = {
      ak47: 'AK', m4a1_silencer: 'M4S', m4a4: 'M4A4', m4a1: 'M4',
      awp: 'AWP', ssg08: 'Scout', deagle: 'DEagle', revolver: 'R8',
      galilar: 'Galil', famas: 'FAMAS', aug: 'AUG', sg556: 'SG556',
      mp9: 'MP9', mac10: 'MAC10', mp7: 'MP7', ump45: 'UMP', p90: 'P90',
      bizon: 'Bizon', mp5sd: 'MP5',
      nova: 'Nova', xm1014: 'XM', mag7: 'MAG7', sawedoff: 'Sawed',
      m249: 'M249', negev: 'Negev',
      usp_silencer: 'USP-S', hkp2000: 'P2000', glock: 'Glock',
      p250: 'P250', fiveseven: '57', cz75a: 'CZ', tec9: 'Tec9', elite: 'Elites',
      knife: '🔪', knife_t: '🔪', knife_karambit: '🔪',
    }
    const nadIcon = NADE_ICONS[weapKey]
    const weapShort = nadIcon ?? WEAP_SHORT[weapKey] ?? weapKey.slice(0, 6)
    const isEmoji = !!nadIcon
    ctx.font = isEmoji
      ? `${Math.round(11 * dotScale)}px sans-serif`
      : `${Math.round(10 * dotScale)}px monospace`
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
    ctx.fillText(weapShort, cx, cy - r - 2 * dotScale)

    // velocity: units/sec from prev frame
    const prevBase = prevFrameBase + i * FIELDS
    const prevAlive = replay.data[prevBase + F_ALIVE] ?? 0
    if (prevAlive) {
      const px = replay.data[prevBase + F_X], py = replay.data[prevBase + F_Y]
      const dx = x - px, dy = y - py
      const vel = Math.round(Math.sqrt(dx * dx + dy * dy) * velScale)
      if (vel > 5) {
        ctx.font = `${Math.round(9 * dotScale)}px monospace`
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.textAlign = 'left'
        ctx.fillText(`${vel}`, cx + r + 3 * dotScale, cy + 4 * dotScale)
      }
    }

    const yaw = replay.data[base + F_YAW]
    const rad = (yaw * Math.PI) / 180
    const arrowLen = 14 * dotScale
    const ax = cx + Math.cos(rad) * arrowLen, ay = cy - Math.sin(rad) * arrowLen
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ax, ay)
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dotScale; ctx.stroke()
    const headLen = 4 * dotScale, headAngle = Math.PI / 6
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - headLen * Math.cos(rad - headAngle), ay + headLen * Math.sin(rad - headAngle))
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - headLen * Math.cos(rad + headAngle), ay + headLen * Math.sin(rad + headAngle))
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dotScale; ctx.stroke()

    const bw = 20 * dotScale, bh = 3 * dotScale
    const bx = cx - bw / 2, by = cy + r + 2 * dotScale
    ctx.fillStyle = '#333'; ctx.fillRect(bx, by, bw, bh)
    ctx.fillStyle = hp > 50 ? '#4caf7d' : hp > 25 ? '#f5c542' : '#e05252'
    ctx.fillRect(bx, by, bw * hp / 100, bh)
  }

  ctx.restore()
}

// ── hotkeys helper ────────────────────────────────────────────────────────────
function getHotkeys() {
  return [
    { key: 'Space', label: 'Space', desc: t('hotPause') },
    { key: ',', label: ',', desc: t('slowDown') },
    { key: '.', label: '.', desc: t('speedUp') },
    { key: '0', label: '0', desc: t('zoomReset') },
    { key: 'Scroll', label: 'Scroll', desc: t('hotZoom') },
    { key: 'Drag', label: 'Drag', desc: t('hotPan') },
  ]
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function ReplayPage() {
  useLang()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [overview, setOverview] = useState<MapOverview | null>(null)
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [speedIdx, setSpeedIdx] = useState(1)
  const [err, setErr] = useState('')
  const [tx, setTx] = useState<Transform>({ scale: 1, ox: 0, oy: 0 })
  const [showEventLog, setShowEventLog] = useState(true)
  const [nadeTrailMode, setNadeTrailMode] = useState<NadeTrailMode>('trail')

  const txRef = useRef<Transform>({ scale: 1, ox: 0, oy: 0 })
  const dragRef = useRef<{ startX: number; startY: number; startOx: number; startOy: number } | null>(null)
  const touchRef = useRef<{ dist: number; cx: number; cy: number } | null>(null)

  const [leftWidth, setLeftWidth] = useState(600)
  const resizerRef = useRef<{ startX: number; startW: number } | null>(null)

  function onResizerMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    resizerRef.current = { startX: e.clientX, startW: leftWidth }
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizerRef.current) return
      const delta = e.clientX - resizerRef.current.startX
      setLeftWidth(Math.max(300, Math.min(900, resizerRef.current.startW + delta)))
    }
    function onUp() { resizerRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const radarRef = useRef<HTMLImageElement>(null)
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  const frameIdxRef = useRef(0)
  const replayRef = useRef<ReplayData | null>(null)

  useEffect(() => { frameIdxRef.current = frameIdx }, [frameIdx])
  useEffect(() => { txRef.current = tx }, [tx])
  useEffect(() => { replayRef.current = replay }, [replay])

  useEffect(() => {
    if (!id) return
    Promise.all([api.replay(id), api.analysis(id)])
      .then(([r, a]) => { setReplay(r); setAnalysis(a); return api.mapOverview(a.meta.map) })
      .then(setOverview)
      .catch(e => setErr(e.message))
  }, [id])

  // jump to round from ?round=N URL param once replay is loaded
  useEffect(() => {
    if (!replay || !analysis) return
    const roundParam = searchParams.get('round')
    if (!roundParam) return
    const rn = parseInt(roundParam, 10)
    if (isNaN(rn)) return
    const round = analysis.rounds.find((r: RoundData) => r.n === rn)
    if (!round) return
    const fi = replay.ticks.findIndex(tk => tk >= round.freezeEndTick)
    if (fi >= 0) setFrameIdx(fi)
  }, [replay, analysis, searchParams])

  const totalFrames = replay?.ticks.length ?? 0

  useEffect(() => {
    if (!canvasRef.current || !replay || !overview) return
    drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current, tx, nadeTrailMode)
  }, [frameIdx, replay, overview, tx, leftWidth, nadeTrailMode])

  useEffect(() => {
    if (!playing || !replay) return
    const frameMs = (replay.frameStep / replay.tickrate) * 1000 / speed
    function tick(now: number) {
      if (now - lastTimeRef.current >= frameMs) {
        lastTimeRef.current = now
        setFrameIdx(prev => {
          const next = prev + 1
          if (next >= (replayRef.current?.ticks.length ?? 0)) { setPlaying(false); return prev }
          return next
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, replay, speed])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      if (e.key === ',') setSpeedIdx(i => { const ni = Math.max(0, i - 1); setSpeed(SPEEDS[ni]); return ni })
      if (e.key === '.') setSpeedIdx(i => { const ni = Math.min(SPEEDS.length - 1, i + 1); setSpeed(SPEEDS[ni]); return ni })
      if (e.key === '0') setTx({ scale: 1, ox: 0, oy: 0 })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const clampTx = useCallback((t: Transform): Transform => {
    const sc = Math.max(1, Math.min(8, t.scale))
    const sz = canvasRef.current?.width ?? SIZE
    const maxOff = sz * (sc - 1)
    return { scale: sc, ox: Math.max(-maxOff, Math.min(0, t.ox)), oy: Math.max(-maxOff, Math.min(0, t.oy)) }
  }, [])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const cur = txRef.current
      const rawScale = cur.scale * factor
      const sc = Math.max(1, Math.min(8, rawScale))
      const ox = mx - (mx - cur.ox) * (sc / cur.scale)
      const oy = my - (my - cur.oy) * (sc / cur.scale)
      const maxOff = (el!.width ?? SIZE) * (sc - 1)
      setTx({ scale: sc, ox: Math.max(-maxOff, Math.min(0, ox)), oy: Math.max(-maxOff, Math.min(0, oy)) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [canvasRef.current])

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOx: txRef.current.ox, startOy: txRef.current.oy }
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX, dy = e.clientY - dragRef.current.startY
    setTx(clampTx({ scale: txRef.current.scale, ox: dragRef.current.startOx + dx, oy: dragRef.current.startOy + dy }))
  }
  function onMouseUp() { dragRef.current = null }

  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY
      touchRef.current = { dist: Math.sqrt(dx*dx+dy*dy), cx: (e.touches[0].clientX+e.touches[1].clientX)/2, cy: (e.touches[0].clientY+e.touches[1].clientY)/2 }
    } else if (e.touches.length === 1) {
      dragRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, startOx: txRef.current.ox, startOy: txRef.current.oy }
    }
  }
  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (e.touches.length === 2 && touchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx*dx+dy*dy)
      const rect = canvasRef.current!.getBoundingClientRect()
      const mx = touchRef.current.cx - rect.left, my = touchRef.current.cy - rect.top
      const factor = dist / touchRef.current.dist
      const cur = txRef.current; const ns = cur.scale * factor
      setTx(clampTx({ scale: ns, ox: mx-(mx-cur.ox)*(ns/cur.scale), oy: my-(my-cur.oy)*(ns/cur.scale) }))
      touchRef.current.dist = dist
    } else if (e.touches.length === 1 && dragRef.current) {
      const dx = e.touches[0].clientX - dragRef.current.startX, dy = e.touches[0].clientY - dragRef.current.startY
      setTx(clampTx({ scale: txRef.current.scale, ox: dragRef.current.startOx+dx, oy: dragRef.current.startOy+dy }))
    }
  }
  function onTouchEnd() { dragRef.current = null; touchRef.current = null }

  function fmtTime(fi: number) {
    if (!replay) return '0:00'
    const sec = (replay.ticks[fi] ?? 0) / replay.tickrate
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }

  function jumpToFrame(fi: number) { setFrameIdx(fi); setPlaying(false) }

  const curTick = replay?.ticks[frameIdx] ?? 0
  const currentRound = analysis?.rounds ? findRoundForTick(analysis.rounds as RoundData[], curTick) : null

  if (err) return <div className="page"><div className="tag tag-red">{err}</div></div>
  if (!replay || !overview) return <div className="page"><span className="spinner" /><span className="text-muted" style={{ marginLeft: 8 }}>{t('loading')}</span></div>

  const mapName = analysis?.meta.map ?? ''
  const cursor = dragRef.current ? 'grabbing' : tx.scale > 1 ? 'grab' : 'default'
  const rounds = analysis?.rounds ?? []
  const winprob = replay.winprob ?? []

  // 3-column layout: map | event log | scoreboard
  const logWidth = showEventLog ? 280 : 0
  const scoreWidth = 260

  return (
    <div className="page">
      <MatchNavShared id={id!} players={analysis?.players} />

      {/* round switcher */}
      {rounds.length > 0 && (
        <RoundSwitcher
          rounds={rounds}
          ticks={replay.ticks}
          frameIdx={frameIdx}
          onJump={jumpToFrame}
        />
      )}

      {/* main 3-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: `${leftWidth}px 8px ${showEventLog ? `${logWidth}px 8px ` : ''}${scoreWidth}px`, gap: 0, alignItems: 'start' }}>

        {/* ── left: map canvas ── */}
        <div style={{ minWidth: 0 }}>
          <div className="card" style={{ padding: 0, position: 'relative', overflow: 'hidden' }}>
            <img ref={radarRef} src={api.radarUrl(mapName)} alt="" style={{ display: 'none' }}
              onLoad={() => { if (canvasRef.current && replay && overview) drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current, txRef.current, nadeTrailMode) }} />
            <canvas
              ref={canvasRef} width={leftWidth} height={leftWidth}
              style={{ display: 'block', cursor, width: '100%', height: 'auto' }}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
              onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
            />
            {currentRound && (
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,.7)', padding: '3px 10px', borderRadius: 4, fontSize: 12 }}>
                R{currentRound.n} · {currentRound.scoreTeam0}:{currentRound.scoreTeam1}
                {currentRound.bombPlanted && <span style={{ color: 'var(--accent)', marginLeft: 8 }}>💣</span>}
              </div>
            )}
            {winprob.length > 0 && (
              <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,.7)', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: '#4a9eda' }}>
                КТ {Math.round((winprob[frameIdx] ?? 0.5) * 100)}%
              </div>
            )}
            {tx.scale > 1 && (
              <div style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(0,0,0,.6)', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: 'var(--text2)' }}>
                {tx.scale.toFixed(1)}x · [0] {t('zoomReset')}
              </div>
            )}
          </div>

          {/* controls + win prob scrubber */}
          <div className="card" style={{ marginTop: 8 }}>
            <div className="flex items-center gap-12" style={{ marginBottom: 8 }}>
              <button className="btn-primary" style={{ minWidth: 72 }} onClick={() => setPlaying(p => !p)}>
                {playing ? t('pause') : t('play')}
              </button>
              <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 40 }}>{fmtTime(frameIdx)}</span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>/ {fmtTime(totalFrames - 1)}</span>
              {winprob.length > 0 && currentRound && (
                <span style={{ fontSize: 12, color: '#4a9eda', marginLeft: 8 }}>
                  КТ {Math.round((winprob[frameIdx] ?? 0.5) * 100)}% · Т {Math.round((1 - (winprob[frameIdx] ?? 0.5)) * 100)}%
                </span>
              )}
              <div className="flex items-center gap-8" style={{ marginLeft: 'auto' }}>
                <button
                  className={showEventLog ? 'btn-primary' : 'btn-ghost'}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => setShowEventLog(v => !v)}
                >Лог</button>
                <button
                  className={nadeTrailMode === 'trail' ? 'btn-primary' : 'btn-ghost'}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  title="Трейл гранат: хвост во время полёта"
                  onClick={() => setNadeTrailMode('trail')}
                >🔴 Хвост</button>
                <button
                  className={nadeTrailMode === 'path' ? 'btn-primary' : 'btn-ghost'}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  title="Путь гранат: вся траектория с момента броска"
                  onClick={() => setNadeTrailMode('path')}
                >🔴 Путь</button>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('speed')}</span>
                {SPEEDS.map((s, si) => (
                  <button key={s} className={speed === s ? 'btn-primary' : 'btn-ghost'}
                    style={{ fontSize: 12, padding: '3px 8px' }}
                    onClick={() => { setSpeed(s); setSpeedIdx(si) }}>
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            {/* win probability scrubber */}
            {winprob.length > 0 ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                <WinProbGraph
                  winprob={winprob}
                  ticks={replay.ticks}
                  rounds={rounds}
                  frameIdx={frameIdx}
                  onScrub={fi => { setFrameIdx(fi); setPlaying(false) }}
                  height={56}
                />
              </div>
            ) : (
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input type="range" min={0} max={Math.max(0, totalFrames - 1)} value={frameIdx}
                  onChange={e => { setFrameIdx(Number(e.target.value)); setPlaying(false) }}
                  style={{ width: '100%', accentColor: 'var(--accent)' }} />
                {rounds.map(r => {
                  const fi = replay.ticks.findIndex(tick => tick >= r.freezeEndTick)
                  if (fi < 0) return null
                  const pct = fi / (totalFrames - 1) * 100
                  return (
                    <div key={r.n} title={`R${r.n}`}
                      style={{ position: 'absolute', top: 0, left: `${pct}%`, width: 2, height: 8, background: r.isPistol ? 'var(--accent2)' : 'var(--border)', transform: 'translateX(-50%)', pointerEvents: 'none' }} />
                  )
                })}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {getHotkeys().map(hk => (
                <div key={hk.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text2)' }}>
                  <kbd style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px', fontFamily: 'monospace', fontSize: 11 }}>{hk.label}</kbd>
                  <span>{hk.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── resizer 1 ── */}
        <div
          onMouseDown={onResizerMouseDown}
          style={{ cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', minHeight: 400, userSelect: 'none', padding: '0 2px' }}
        >
          <div style={{ width: 4, height: '100%', background: 'var(--border)', borderRadius: 2, transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--border)')}
          />
        </div>

        {/* ── center: event log ── */}
        {showEventLog && (
          <>
            <div className="card" style={{ minWidth: 0, height: leftWidth, display: 'flex', flexDirection: 'column', padding: '10px 8px' }}>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12, textTransform: 'uppercase', color: 'var(--text2)', flexShrink: 0 }}>
                СОБЫТИЯ
              </div>
              <EventLog replay={replay} analysis={analysis} frameIdx={frameIdx} />
            </div>
            <div style={{ cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', minHeight: 400, padding: '0 2px' }}>
              <div style={{ width: 4, height: '100%', background: 'var(--border)', borderRadius: 2 }} />
            </div>
          </>
        )}

        {/* ── right: scoreboard ── */}
        <div style={{ minWidth: 0 }}>
          <ScoreboardPanel replay={replay} analysis={analysis} frameIdx={frameIdx} />
        </div>
      </div>
    </div>
  )
}
