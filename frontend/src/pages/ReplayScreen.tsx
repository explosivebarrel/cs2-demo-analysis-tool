import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'
import { api, AnalysisData, MapOverview, Moment, ReplayData, RoundData } from '../api'
import { useLang } from '../App'
import { frameForTickMinus, momentsAround } from '../components/replay/MomentsPanel'
import LeftDrawer, { DrawerTab } from '../components/replay/LeftDrawer'
import MapCanvas from '../components/replay/MapCanvas'
import RightDrawer from '../components/replay/RightDrawer'
import RoundSwitcher from '../components/replay/RoundSwitcher'
import BottomBar from '../components/replay/BottomBar'
import TopBar from '../components/replay/TopBar'
import WinProbGraph from '../components/replay/WinProbGraph'
import HotkeysModal from '../components/replay/HotkeysModal'
import { NadeTrailMode } from '../components/replay/drawFrame'
import { SPEEDS, Transform } from '../lib/replay'
import { t } from '../i18n'

const LEFT_WIDTH = 300
const RIGHT_WIDTH = 280
// moments are played from a few seconds before the action; prev/next moment
// navigation uses the same window so a fresh jump doesn't re-target itself
const SEEK_BACK_SEC = 3

/** Full-viewport replay player screen (route /match/:id/replay). */
export default function ReplayScreen() {
  useLang()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  // return target: the screen the replay button was pressed on, else match overview
  const backTo = (location.state as { from?: string } | null)?.from ?? (id ? `/match/${id}` : '/')

  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [overview, setOverview] = useState<MapOverview | null>(null)
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [err, setErr] = useState('')
  const [tx, setTx] = useState<Transform>({ scale: 1, ox: 0, oy: 0 })
  const [nadeTrailMode, setNadeTrailMode] = useState<NadeTrailMode>('trail')
  const [nadeOff, setNadeOff] = useState<Set<number>>(new Set())
  const [level, setLevel] = useState('default')
  const [leftTab, setLeftTab] = useState<DrawerTab>('events')
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const [chromeHidden, setChromeHidden] = useState(false)
  const [isFs, setIsFs] = useState(false)
  const [momentHl, setMomentHl] = useState<{ startFi: number; endFi: number } | null>(null)

  const rafRef = useRef(0)
  const lastTimeRef = useRef(0)
  const frameIdxRef = useRef(0)
  const momentHlTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replayRef = useRef<ReplayData | null>(null)
  const analysisRef = useRef<AnalysisData | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { frameIdxRef.current = frameIdx }, [frameIdx])
  useEffect(() => { replayRef.current = replay }, [replay])
  useEffect(() => { analysisRef.current = analysis }, [analysis])

  // ── data loading ────────────────────────────────────────────────────────────
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

  // jump to a tick passed via router state (e.g. clutch click on a metrics page)
  const stateSeekTick = (location.state as { seekTick?: number } | null)?.seekTick
  useEffect(() => {
    if (!replay || !stateSeekTick) return
    const fi = replay.ticks.findIndex(tk => tk >= stateSeekTick)
    if (fi >= 0) { setFrameIdx(fi); setPlaying(false) }
    // drop the state so a refresh doesn't re-seek
    window.history.replaceState({}, '')
  }, [replay, stateSeekTick])

  // ── playback ────────────────────────────────────────────────────────────────
  const totalFrames = replay?.ticks.length ?? 0

  // time-based loop producing fractional frame indices: drawFrame interpolates
  // positions between frames, so playback is smooth even at 8 frames/sec
  useEffect(() => {
    if (!playing || !replay) return
    const secPerFrame = (replay.frameStep / replay.tickrate) / speed
    // avoid a stale-dt jump on the first tick after (re)starting playback
    lastTimeRef.current = performance.now()
    function tick(now: number) {
      const dt = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now
      setFrameIdx(prev => {
        const next = prev + Math.min(0.25, dt) / secPerFrame
        const last = (replayRef.current?.ticks.length ?? 1) - 1
        if (next >= last) { setPlaying(false); return last }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, replay, speed])

  // ── fullscreen sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onFsChange() { setIsFs(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void wrapRef.current?.requestFullscreen().catch(() => {})
    }
  }, [])

  // ── navigation helpers ──────────────────────────────────────────────────────
  function jumpToFrame(fi: number, play = false) {
    setFrameIdx(fi)
    setPlaying(play)
  }

  function seekSec(deltaSec: number) {
    if (!replay) return
    const delta = Math.round(deltaSec * replay.tickrate / Math.max(1, replay.frameStep))
    setFrameIdx(prev => Math.max(0, Math.min((replay.ticks.length ?? 1) - 1, prev + delta)))
  }

  function jumpToMoment(dir: 1 | -1) {
    const curTick = replay?.ticks[Math.floor(frameIdx)] ?? 0
    const mm = momentsAround(analysisRef.current?.moments ?? [], curTick, replay?.tickrate ?? 64, SEEK_BACK_SEC)
    const m = dir === 1 ? mm.next : mm.prev
    if (m) onMomentSelect(m)
  }

  function fiForTick(tick: number): number {
    if (!replay) return 0
    const i = replay.ticks.findIndex(tk => tk >= tick)
    return i < 0 ? replay.ticks.length - 1 : Math.max(0, i)
  }

  /** Jump to a moment (and play it), flashing its episode on the winprob timeline. */
  function onMomentSelect(m: Moment) {
    if (!replay) return
    const back = Math.max(SEEK_BACK_SEC, Math.min(m.preSec ?? SEEK_BACK_SEC, 12))
    jumpToFrame(frameForTickMinus(replay, m.tick, back), true)
    const rate = replay.tickrate
    setMomentHl({
      startFi: fiForTick(m.tick - (m.preSec ?? SEEK_BACK_SEC) * rate),
      endFi: fiForTick(m.tick + (m.durSec ?? 6) * rate),
    })
    if (momentHlTimer.current) clearTimeout(momentHlTimer.current)
    momentHlTimer.current = setTimeout(() => setMomentHl(null), 6000)
  }

  // latest-ref so hotkeys can trigger moment jumps without effect dep churn
  const onMomentSelectRef = useRef<(m: Moment) => void>(() => {})
  useEffect(() => { onMomentSelectRef.current = onMomentSelect })

  function seekTick(tick: number) {
    const fi = replay?.ticks.findIndex(t => t >= tick) ?? -1
    if (fi >= 0) jumpToFrame(fi)
  }

  // ── hotkeys ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (hotkeysOpen && e.key !== 'Escape') return
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === ',') setSpeed(s => { const i = SPEEDS.indexOf(s); return SPEEDS[Math.max(0, i - 1)] })
      else if (e.key === '.') setSpeed(s => { const i = SPEEDS.indexOf(s); return SPEEDS[Math.min(SPEEDS.length - 1, i + 1)] })
      else if (e.key === '0') setTx({ scale: 1, ox: 0, oy: 0 })
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seekSec(-5) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekSec(5) }
      else if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') setChromeHidden(v => !v)
      else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') toggleFullscreen()
      else if (e.key === '[' || e.key === ']') {
        const curTick = replayRef.current?.ticks[Math.floor(frameIdxRef.current)] ?? 0
        const mm = momentsAround(analysisRef.current?.moments ?? [], curTick, replayRef.current?.tickrate ?? 64, SEEK_BACK_SEC)
        const m = e.key === '[' ? mm.prev : mm.next
        if (m) onMomentSelectRef.current(m)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hotkeysOpen, toggleFullscreen])

  function fmtTime(fi: number) {
    if (!replay) return '0:00'
    const sec = (replay.ticks[fi] ?? 0) / replay.tickrate
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }

  // ── render ──────────────────────────────────────────────────────────────────
  if (err) return <div className="page"><div className="tag tag-red">{err}</div></div>
  if (!replay || !overview || !analysis) {
    return (
      <div style={{
        height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column',
        padding: '10px 14px', gap: 8, overflow: 'hidden',
      }}>
        {/* TopBar: back button, round strip, 3 icon buttons */}
        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <div className="skeleton" style={{ width: 70, height: 28, borderRadius: 4 }} />
          <div className="skeleton" style={{ flex: 1, height: 28, borderRadius: 4 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            {[0, 1, 2].map(i => (
              <div key={i} className="skeleton" style={{ width: 34, height: 28, borderRadius: 4 }} />
            ))}
          </div>
        </div>
        {/* main row: left drawer, map canvas, right drawer */}
        <div style={{ flex: 1, display: 'flex', gap: 8, minHeight: 0 }}>
          <div style={{ width: LEFT_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <div className="skeleton" style={{ flex: 1, height: 24, borderRadius: 4 }} />
              <div className="skeleton" style={{ flex: 1, height: 24, borderRadius: 4 }} />
            </div>
            <div className="skeleton" style={{ flex: 1, borderRadius: 8 }} />
          </div>
          <div className="skeleton" style={{ flex: 1, borderRadius: 8 }} />
          <div style={{ width: RIGHT_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ flex: 1, borderRadius: 8 }} />
            <div className="skeleton" style={{ flex: 1, borderRadius: 8 }} />
          </div>
        </div>
        {/* BottomBar: playback controls + winprob strip */}
        <div className="skeleton" style={{ height: 104, flexShrink: 0, borderRadius: 8 }} />
      </div>
    )
  }

  const mapName = analysis.meta.map
  const rounds = analysis.rounds ?? []
  const winprob = replay.winprob ?? []
  const hasChrome = !chromeHidden && !isFs

  function toggleNade(g: number) {
    setNadeOff(prev => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  }

  return (
    <div ref={wrapRef} style={{
      height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column',
      padding: '10px 14px', gap: 8, overflow: 'hidden',
    }}>
      {hasChrome && (
        <TopBar backTo={backTo} onHotkeys={() => setHotkeysOpen(true)}
          onHideUi={() => setChromeHidden(true)} onFullscreen={toggleFullscreen}>
          {rounds.length > 0 && (
            <RoundSwitcher
              rounds={rounds}
              ticks={replay.ticks}
              frameIdx={frameIdx}
              onJump={jumpToFrame}
              knifeRound={analysis.knifeRound}
              matchStartTick={analysis.meta.matchStartTick}
            />
          )}
        </TopBar>
      )}

      <div style={{ flex: 1, display: 'flex', gap: 8, minHeight: 0 }}>
        {hasChrome && (
          leftOpen ? (
            <LeftDrawer
              replay={replay} analysis={analysis} frameIdx={frameIdx}
              tab={leftTab} setTab={setLeftTab} width={LEFT_WIDTH}
              onEventSeek={seekTick} onMomentSelect={onMomentSelect}
            />
          ) : (
            <button className="btn-ghost" title={t('replay:eventLog.header')} style={{ padding: '10px 2px', fontSize: 11, flexShrink: 0 }}
              onClick={() => setLeftOpen(true)}>›</button>
          )
        )}

        <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, position: 'relative' }}>
          <MapCanvas
            replay={replay} analysis={analysis} overview={overview}
            frameIdx={frameIdx} tx={tx} setTx={setTx}
            nadeTrailMode={nadeTrailMode} nadeFilter={nadeOff}
            level={level} setLevel={setLevel}
          />
        </div>

        {hasChrome && (
          rightOpen ? (
            <div style={{ width: RIGHT_WIDTH, flexShrink: 0, minHeight: 0, overflowY: 'auto' }}>
              <RightDrawer replay={replay} analysis={analysis} frameIdx={frameIdx} />
            </div>
          ) : (
            <button className="btn-ghost" title={t('players')} style={{ padding: '10px 2px', fontSize: 11, flexShrink: 0 }}
              onClick={() => setRightOpen(true)}>‹</button>
          )
        )}
      </div>

      {!hasChrome && (
        <div style={{ position: 'fixed', right: 14, bottom: 14, display: 'flex', gap: 6, zIndex: 500 }}>
          <button className="btn-ghost" title={t('replay:showUi')} onClick={() => setChromeHidden(false)}>◲</button>
          {isFs && <button className="btn-ghost" title={t('replay:exitFullscreen')} onClick={toggleFullscreen}>⛶</button>}
        </div>
      )}

      {hasChrome && (
        <BottomBar
          playing={playing} onPlayPause={() => setPlaying(p => !p)}
          onSeekSec={seekSec}
          hasMoments={(analysis.moments?.length ?? 0) > 0} onMoment={jumpToMoment}
          time={fmtTime(Math.floor(frameIdx))} duration={fmtTime(totalFrames - 1)}
          speed={speed} onSpeed={setSpeed}
          nadeFilter={nadeOff} onToggleNade={toggleNade}
          trailMode={nadeTrailMode} onTrailMode={setNadeTrailMode}
        >
          {winprob.length > 0 ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
              <WinProbGraph
                winprob={winprob}
                ticks={replay.ticks}
                rounds={rounds}
                frameIdx={frameIdx}
                onScrub={fi => { setFrameIdx(fi); setPlaying(false) }}
                height={56}
                knifeRound={analysis.knifeRound}
                matchStartTick={analysis.meta.matchStartTick}
                highlight={momentHl}
              />
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <input type="range" min={0} max={Math.max(0, totalFrames - 1)} value={Math.floor(frameIdx)}
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
        </BottomBar>
      )}

      {hotkeysOpen && <HotkeysModal onClose={() => setHotkeysOpen(false)} />}
    </div>
  )
}
