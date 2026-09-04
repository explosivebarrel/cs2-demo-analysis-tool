import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'
import { api, AnalysisData, MapOverview, ReplayData, RoundData } from '../api'
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

  const rafRef = useRef(0)
  const lastTimeRef = useRef(0)
  const frameIdxRef = useRef(0)
  const replayRef = useRef<ReplayData | null>(null)
  const analysisRef = useRef<AnalysisData | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const midRef = useRef<HTMLDivElement>(null)
  const [midSize, setMidSize] = useState({ w: 800, h: 600 })

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

  // ── canvas sizing ───────────────────────────────────────────────────────────
  // the mid container mounts only after all three payloads arrive (overview last),
  // so re-run the observer subscription on the real mount condition
  const mounted = !!replay && !!overview && !!analysis
  useEffect(() => {
    const el = midRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setMidSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setMidSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [mounted])
  const side = Math.max(200, Math.floor(Math.min(midSize.w, midSize.h)))

  // ── playback ────────────────────────────────────────────────────────────────
  const totalFrames = replay?.ticks.length ?? 0

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
  function jumpToFrame(fi: number) { setFrameIdx(fi); setPlaying(false) }

  function seekSec(deltaSec: number) {
    if (!replay) return
    const delta = Math.round(deltaSec * replay.tickrate / Math.max(1, replay.frameStep))
    setFrameIdx(prev => Math.max(0, Math.min((replay.ticks.length ?? 1) - 1, prev + delta)))
  }

  function jumpToMoment(dir: 1 | -1) {
    const curTick = replay?.ticks[frameIdx] ?? 0
    const mm = momentsAround(analysisRef.current?.moments ?? [], curTick, replay?.tickrate ?? 64)
    const m = dir === 1 ? mm.next : mm.prev
    if (m && replay) jumpToFrame(frameForTickMinus(replay, m.tick, 3))
  }

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
        const curTick = replayRef.current?.ticks[frameIdxRef.current] ?? 0
        const mm = momentsAround(analysisRef.current?.moments ?? [], curTick, replayRef.current?.tickrate ?? 64)
        const m = e.key === '[' ? mm.prev : mm.next
        if (m && replayRef.current) {
          setFrameIdx(frameForTickMinus(replayRef.current, m.tick, 3))
          setPlaying(false)
        }
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
      <div style={{ height: 'calc(100vh - 48px)', padding: 20 }}>
        <div className="skeleton" style={{ height: 36, borderRadius: 8, marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="skeleton" style={{ flex: 1, height: '70vh', borderRadius: 8 }} />
          <div style={{ width: RIGHT_WIDTH, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...Array(10)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 44, borderRadius: 6 }} />
            ))}
          </div>
        </div>
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

      <div ref={midRef} style={{ flex: 1, display: 'flex', gap: 8, minHeight: 0 }}>
        {hasChrome && (
          leftOpen ? (
            <LeftDrawer
              replay={replay} analysis={analysis} frameIdx={frameIdx}
              tab={leftTab} setTab={setLeftTab} width={LEFT_WIDTH}
              onEventSeek={seekTick} onMomentSeek={tk => jumpToFrame(frameForTickMinus(replay, tk, 3))}
            />
          ) : (
            <button className="btn-ghost" title={t('replay:eventLog.header')} style={{ padding: '10px 2px', fontSize: 11, flexShrink: 0 }}
              onClick={() => setLeftOpen(true)}>›</button>
          )
        )}

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, position: 'relative' }}>
          <MapCanvas
            replay={replay} analysis={analysis} overview={overview}
            frameIdx={frameIdx} tx={tx} setTx={setTx}
            nadeTrailMode={nadeTrailMode} nadeFilter={nadeOff}
            level={level} setLevel={setLevel} side={side}
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
          time={fmtTime(frameIdx)} duration={fmtTime(totalFrames - 1)}
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
              />
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
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
        </BottomBar>
      )}

      {hotkeysOpen && <HotkeysModal onClose={() => setHotkeysOpen(false)} />}
    </div>
  )
}
