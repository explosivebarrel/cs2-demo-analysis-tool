import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, AnalysisData, Map3DData, MapOverview, ReplayData, RoundData } from '../../api'
import { lowerLevelNames, tx2dToWorldCenter, worldCenterToTx2d } from '../../lib/coords'
import { F_ALIVE, fieldsOf, findRoundForTick, Transform } from '../../lib/replay'
import { t } from '../../i18n'
import drawFrame, { NadeTrailMode, preloadWeaponIcons } from './drawFrame'
import Scene3DCanvas from '../map3d/Scene3DCanvas'
import drawReplay3D from '../map3d/drawReplay3D'
import { buildDensityPlane, fitCam } from '../map3d/scene3d'
import type { BBox, Cam, DensityPlane } from '../map3d/scene3d'

const MIN_SCALE = 0.1
const MAX_SCALE = 10

interface Settings3D {
  showGround: boolean
  groundAlpha: number
  showPlane: boolean
  planeAlpha: number
  shades: number
  shift: number
}

const DEFAULT_SETTINGS_3D: Settings3D = {
  showGround: true,
  groundAlpha: 0.35,
  showPlane: true,
  planeAlpha: 0.35,
  shades: 8,
  shift: 1,
}

function load3DSettings(): Settings3D {
  try {
    const raw = localStorage.getItem('replay_3d_settings')
    if (raw) return { ...DEFAULT_SETTINGS_3D, ...JSON.parse(raw) }
  } catch {}
  return DEFAULT_SETTINGS_3D
}

/**
 * Central map player: radar canvas with free zoom (0.1x..10x), pan, pinch, overlays.
 * The canvas fills its container at any aspect ratio; the map itself is drawn in a
 * centered square (base = min(w, h)) so scale=1 always means "the whole map fits".
 * view3d swaps the flat canvas for the shared orbit scene (drawReplay3D).
 */
export default function MapCanvas({
  replay, analysis, overview, frameIdx, tx, setTx,
  nadeTrailMode, onTrailMode, nadeFilter, onToggleNade, level, setLevel, view3d, hm3d,
}: {
  replay: ReplayData
  analysis: AnalysisData | null
  overview: MapOverview
  frameIdx: number
  tx: Transform
  setTx: (t: Transform) => void
  nadeTrailMode: NadeTrailMode
  onTrailMode: (m: NadeTrailMode) => void
  nadeFilter: Set<number> | null
  onToggleNade: (g: number) => void
  level: string
  setLevel: (l: string) => void
  view3d: boolean
  hm3d: Map3DData | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const radarRef = useRef<HTMLImageElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const txRef = useRef(tx)
  const dragRef = useRef<{ startX: number; startY: number; startOx: number; startOy: number } | null>(null)
  const touchRef = useRef<{ dist: number; cx: number; cy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [settings3d, setSettings3d] = useState<Settings3D>(load3DSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const [resetCamTrigger, setResetCamTrigger] = useState(0)
  const [camInfo, setCamInfo] = useState<{ scale: number; yaw: number; pitch: number; cx: number; cy: number } | null>(null)
  const [syncedCam3d, setSyncedCam3d] = useState<Partial<Cam> | null>(null)
  const lastActiveCam3dRef = useRef<Cam | null>(null)
  const prevView3dRef = useRef(view3d)

  useEffect(() => {
    if (!settingsOpen) return
    function onDocClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [settingsOpen])

  const update3D = (patch: Partial<Settings3D>) => {
    setSettings3d(prev => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem('replay_3d_settings', JSON.stringify(next)) } catch {}
      return next
    })
  }

  const onCamChange = useCallback((cam: Cam, fitZoom: number) => {
    lastActiveCam3dRef.current = { ...cam }
    setCamInfo({
      scale: fitZoom > 0 ? cam.zoom / fitZoom : 1,
      yaw: Math.round((((cam.yaw * 180 / Math.PI) % 360) + 360) % 360),
      pitch: Math.round(cam.pitch * 180 / Math.PI),
      cx: Math.round(cam.cx),
      cy: Math.round(cam.cy),
    })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '0') {
        if (view3d) {
          setResetCamTrigger(t => t + 1)
        }
        setTx({ scale: 1, ox: 0, oy: 0 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view3d, setTx])

  useEffect(() => { txRef.current = tx }, [tx])

  // measure the container; this component only mounts after all payloads arrive
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const cw = Math.max(1, Math.floor(size.w))
  const ch = Math.max(1, Math.floor(size.h))
  const base = Math.min(cw, ch)

  // 3D scene: ground level = lowest alive player z across the match (sampled);
  // camera fits the whole radar square
  const groundZ = useMemo(() => {
    const n = replay.players.length
    const FIELDS = fieldsOf(replay)
    let minZ = Infinity
    for (let f = 0; f < replay.ticks.length; f += 16) {
      const fb = f * n * FIELDS
      if (fb + n * FIELDS > replay.data.length) break
      for (let i = 0; i < n; i++) {
        if (!replay.data[fb + i * FIELDS + F_ALIVE]) continue
        const z = replay.data[fb + i * FIELDS + 2]
        if (z < minZ) minZ = z
      }
    }
    return Number.isFinite(minZ) ? minZ : 0
  }, [replay])

  const bbox3d = useMemo<BBox>(() => {
    if (hm3d && hm3d.cells && hm3d.cells.length > 0) {
      let bb: BBox | null = null
      for (const row of hm3d.cells) {
        const x0 = hm3d.minX + row[0] * hm3d.cell, y0 = hm3d.minY + row[1] * hm3d.cell
        const z0 = hm3d.minZ + row[2] * hm3d.zStep
        if (!bb) bb = { minX: x0, minY: y0, minZ: z0, maxX: x0 + hm3d.cell, maxY: y0 + hm3d.cell, maxZ: z0 + hm3d.zStep }
        else {
          bb.minX = Math.min(bb.minX, x0); bb.minY = Math.min(bb.minY, y0); bb.minZ = Math.min(bb.minZ, z0)
          bb.maxX = Math.max(bb.maxX, x0 + hm3d.cell); bb.maxY = Math.max(bb.maxY, y0 + hm3d.cell); bb.maxZ = Math.max(bb.maxZ, z0 + hm3d.zStep)
        }
      }
      if (bb) return bb
    }
    // Fallback before hm3d arrives: sample alive player positions across the match with padding
    const n = replay.players.length
    const FIELDS = fieldsOf(replay)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let f = 0; f < replay.ticks.length; f += 32) {
      const fb = f * n * FIELDS
      if (fb + n * FIELDS > replay.data.length) break
      for (let i = 0; i < n; i++) {
        if (!replay.data[fb + i * FIELDS + F_ALIVE]) continue
        const px = replay.data[fb + i * FIELDS + 0]
        const py = replay.data[fb + i * FIELDS + 1]
        const pz = replay.data[fb + i * FIELDS + 2]
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
        if (pz < minZ) minZ = pz
        if (pz > maxZ) maxZ = pz
      }
    }
    if (Number.isFinite(minX) && minX < maxX) {
      const pad = 96
      return {
        minX: minX - pad, maxX: maxX + pad,
        minY: minY - pad, maxY: maxY + pad,
        minZ: Math.min(minZ - 16, groundZ - 16),
        maxZ: Math.max(maxZ + 72, groundZ + 200),
      }
    }
    const ext = 1024 * overview.scale
    return {
      minX: overview.pos_x, minY: overview.pos_y - ext, minZ: groundZ - 16,
      maxX: overview.pos_x + ext, maxY: overview.pos_y, maxZ: groundZ + 320,
    }
  }, [hm3d, replay, overview, groundZ])

  // ── Sync 2D <-> 3D on view toggle ──────────────────────────────────────────
  useEffect(() => {
    if (prevView3dRef.current === view3d) return
    const was3d = prevView3dRef.current
    prevView3dRef.current = view3d

    if (base <= 1) return

    if (!was3d && view3d) {
      // Switching from 2D to 3D:
      // If 2D was zoomed/panned, move 3D camera to the exact world focus and matching zoom
      if (tx.scale > 1.01 || tx.scale < 0.99 || tx.ox !== 0 || tx.oy !== 0) {
        const [cx, cy] = tx2dToWorldCenter(tx, overview, base)
        const fitted = fitCam(bbox3d, cw, ch)
        // Ratio of 2D screen px per world unit vs fitted 3D zoom
        const pxPerUnit2d = (base / (1024 * overview.scale)) * tx.scale
        const targetZoom = Math.max(fitted.zoom * 0.2, Math.min(fitted.zoom * 15, pxPerUnit2d))
        setSyncedCam3d({ cx, cy, cz: groundZ, zoom: targetZoom })
      }
    } else if (was3d && !view3d) {
      // Switching from 3D to 2D:
      // Focus 2D on 3D's (cam.cx, cam.cy) with scale proportional to 3D zoom and pitch
      const cam = lastActiveCam3dRef.current
      if (cam) {
        const fitted = fitCam(bbox3d, cw, ch)
        const relZoom = fitted.zoom > 0 ? cam.zoom / fitted.zoom : 1
        // If 3D was close to default fit, reset 2D as well
        if (relZoom >= 0.95 && relZoom <= 1.05 && Math.abs(cam.cx - fitted.cx) < 100 && Math.abs(cam.cy - fitted.cy) < 100) {
          setTx({ scale: 1, ox: 0, oy: 0 })
        } else {
          // Effective ground pixel density adjusted by vertical tilt sin(pitch)
          const pxPerUnit2d = cam.zoom
          const rawScale = pxPerUnit2d / (base / (1024 * overview.scale))
          const targetScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rawScale))
          const nextTx = worldCenterToTx2d(cam.cx, cam.cy, targetScale, overview, base)
          setTx(clamp(nextTx))
        }
      }
    }
  }, [view3d, base, cw, ch, tx, overview, groundZ, bbox3d, setTx])

  // voxel map surface for the 3D view; built once per payload (perf invariant:
  // geometry rebuilds only on mode/density/filter changes, never on camera moves)
  const plane3d = useMemo<DensityPlane | null>(() => {
    if (!hm3d) return null
    return buildDensityPlane(hm3d, { shift: settings3d.shift ?? 1, filterCols: null, groundZ: hm3d.minZ })
  }, [hm3d, settings3d.shift])

  const onDraw3d = useCallback((ctx: CanvasRenderingContext2D, cam: Cam, w: number, h: number) => {
    drawReplay3D(ctx, w, h, cam, replay, frameIdx, {
      ov: overview,
      level,
      nadeTrailMode,
      nadeFilter,
      groundZ,
      plane: plane3d,
      showPlane: settings3d.showPlane,
      planeAlpha: settings3d.planeAlpha,
      shades: settings3d.shades,
    })
  }, [replay, overview, frameIdx, level, nadeTrailMode, nadeFilter, groundZ, plane3d, settings3d])

  const lowerLevels = lowerLevelNames(overview)
  const curTick = replay.ticks[Math.floor(frameIdx)] ?? 0
  const knifeRound = analysis?.knifeRound ?? null
  const knife = knifeRound && knifeRound.endTick > 0 ? knifeRound : null
  // restart + freeze of round 1 belongs to R1, knife round ends at its own endTick
  const inKnife = !!knife && curTick >= knife.startTick && curTick < knife.endTick
  const currentRound = inKnife ? null : analysis?.rounds ? findRoundForTick(analysis.rounds as RoundData[], curTick) : null
  const winprob = replay.winprob ?? []

  // keep the transform consistent with the current map square
  function clamp(t: Transform): Transform {
    const sc = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale))
    const sz = base || 600
    if (sc <= 1) return { scale: sc, ox: sz * (1 - sc) / 2, oy: sz * (1 - sc) / 2 }
    const maxOff = sz * (sc - 1)
    return { scale: sc, ox: Math.max(-maxOff, Math.min(0, t.ox)), oy: Math.max(-maxOff, Math.min(0, t.oy)) }
  }

  // canvas coords → map-square coords (letterbox centering offsets)
  function squarePoint(cv: HTMLCanvasElement, px: number, py: number): [number, number] {
    return [px - (cv.width - base) / 2, py - (cv.height - base) / 2]
  }

  useEffect(() => {
    if (!canvasRef.current || cw < 2 || ch < 2) return
    drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current, tx, nadeTrailMode, level, nadeFilter)
  }, [frameIdx, replay, overview, tx, cw, ch, nadeTrailMode, nadeFilter, level])

  // weapon icon svgs decode asynchronously — redraw once they are all ready,
  // otherwise the first frame keeps the text fallback labels
  useEffect(() => {
    let alive = true
    preloadWeaponIcons(replay).then(() => {
      if (alive && canvasRef.current && cw >= 2 && ch >= 2) {
        drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current, txRef.current, nadeTrailMode, level, nadeFilter)
      }
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay])

  // planted bomb pulses: keep redrawing while this demo contains any plant
  const hasPlant = useMemo(
    () => replay.events.some(e => (e as Record<string, unknown>).ty === 'bp'),
    [replay],
  )
  useEffect(() => {
    if (!hasPlant) return
    const iv = window.setInterval(() => {
      if (canvasRef.current && cw >= 2 && ch >= 2) {
        drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current, txRef.current, nadeTrailMode, level, nadeFilter)
      }
    }, 150)
    return () => window.clearInterval(iv)
  }, [hasPlant, frameIdx, replay, overview, tx, cw, ch, nadeTrailMode, nadeFilter, level])

  // re-clamp zoom when the canvas is resized
  useEffect(() => { if (base > 1) setTx(clamp(txRef.current)) }, [cw, ch])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // re-register on resize: clamp/squarePoint close over the live base, a stale
    // one (base=1 before first measure) crushes pan offsets and misanchors zoom
    function onWheel(e: WheelEvent) {
      if (view3d) return
      const cv = canvasRef.current
      if (!cv) return
      e.preventDefault()
      const rect = cv.getBoundingClientRect()
      const [mx, my] = squarePoint(cv, e.clientX - rect.left, e.clientY - rect.top)
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const cur = txRef.current
      const sc = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cur.scale * factor))
      const ox = mx - (mx - cur.ox) * (sc / cur.scale)
      const oy = my - (my - cur.oy) * (sc / cur.scale)
      setTx(clamp({ scale: sc, ox, oy }))
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [cw, ch, view3d])

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOx: txRef.current.ox, startOy: txRef.current.oy }
    setDragging(true)
  }

  useEffect(() => {
    if (!dragging) return
    function onMove(e: MouseEvent) {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.startX, dy = e.clientY - dragRef.current.startY
      setTx(clamp({ scale: txRef.current.scale, ox: dragRef.current.startOx + dx, oy: dragRef.current.startOy + dy }))
    }
    function onUp() {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY
      touchRef.current = { dist: Math.sqrt(dx * dx + dy * dy), cx: (e.touches[0].clientX + e.touches[1].clientX) / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 }
    } else if (e.touches.length === 1) {
      dragRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, startOx: txRef.current.ox, startOy: txRef.current.oy }
    }
  }
  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const cv = canvasRef.current!
    if (e.touches.length === 2 && touchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const rect = cv.getBoundingClientRect()
      const [mx, my] = squarePoint(cv, touchRef.current.cx - rect.left, touchRef.current.cy - rect.top)
      const factor = dist / touchRef.current.dist
      const cur = txRef.current; const ns = cur.scale * factor
      setTx(clamp({ scale: ns, ox: mx - (mx - cur.ox) * (ns / cur.scale), oy: my - (my - cur.oy) * (ns / cur.scale) }))
      touchRef.current.dist = dist
    } else if (e.touches.length === 1 && dragRef.current) {
      const dx = e.touches[0].clientX - dragRef.current.startX, dy = e.touches[0].clientY - dragRef.current.startY
      setTx(clamp({ scale: txRef.current.scale, ox: dragRef.current.startOx + dx, oy: dragRef.current.startOy + dy }))
    }
  }
  function onTouchEnd() { dragRef.current = null; touchRef.current = null }

  const cursor = dragging ? 'grabbing' : tx.scale > 1 ? 'grab' : 'default'

  return (
    <div ref={rootRef} className="card" style={{ padding: 0, position: 'relative', overflow: 'hidden', width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
      <img ref={radarRef} src={api.radarUrl(analysis?.meta.map ?? '', level)} alt="" style={{ display: 'none' }}
        onLoad={() => { if (canvasRef.current) drawFrame(canvasRef.current, frameIdx, replay, overview, radarRef.current, txRef.current, nadeTrailMode, level, nadeFilter) }} />
      {view3d ? (
        <Scene3DCanvas
          width={cw} height={ch} bbox={bbox3d}
          groundUrl={analysis?.meta.map ? api.radarUrl(analysis.meta.map, level) : undefined}
          groundAnchor={overview} groundZ={groundZ}
          groundAlpha={settings3d.showGround ? settings3d.groundAlpha : 0}
          resetTrigger={resetCamTrigger}
          externalCam={syncedCam3d}
          onCamChange={onCamChange}
          onDraw={onDraw3d}
        />
      ) : (
        <canvas
          ref={canvasRef} width={cw} height={ch}
          style={{ display: 'block', cursor, width: '100%', height: '100%' }}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          onDoubleClick={() => setTx(clamp({ scale: 1, ox: 0, oy: 0 }))}
        />
      )}
      {(currentRound || inKnife) && (
        <div style={{
          position: 'absolute', top: 12, left: 12,
          height: 24, boxSizing: 'border-box',
          display: 'inline-flex', alignItems: 'center',
          background: 'rgba(0,0,0,.75)', padding: '0 10px',
          borderRadius: 4, fontSize: 12, lineHeight: '20px',
          fontFamily: 'inherit',
        }}>
          {inKnife ? t('replay:rounds.knife') : <>{t('replay:roundShort')}{currentRound!.n} · {currentRound!.scoreTeam0}:{currentRound!.scoreTeam1}
            {currentRound!.bombPlanted && <img src="/icons/weapons/bomb_c4.svg" alt="C4" width={11} height={11} style={{ marginLeft: 8, verticalAlign: 'middle' }} />}</>}
        </div>
      )}
      {winprob.length > 0 && !inKnife && (
        <div style={{
          position: 'absolute', top: 12, right: view3d ? 76 : 12,
          height: 24, boxSizing: 'border-box',
          display: 'inline-flex', alignItems: 'center',
          background: 'rgba(0,0,0,.75)', padding: '0 10px',
          borderRadius: 4, fontSize: 12, lineHeight: '20px',
          fontFamily: 'inherit', color: '#4a9eda',
        }}>
          {t('replay:side.ct')} {Math.round((winprob[Math.floor(frameIdx)] ?? 0.5) * 100)}%
        </div>
      )}
      {lowerLevels.length > 0 && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4 }}>
          <button onClick={() => setLevel('default')} style={{
            background: level === 'default' ? 'var(--accent)' : 'rgba(0,0,0,.7)',
            color: level === 'default' ? '#fff' : 'var(--text2)',
            border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11,
          }}>{t('levelUpper')}</button>
          {lowerLevels.map(sec => (
            <button key={sec} onClick={() => setLevel(sec)} style={{
              background: level === sec ? 'var(--accent)' : 'rgba(0,0,0,.7)',
              color: level === sec ? '#fff' : 'var(--text2)',
              border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11,
            }}>{t('levelLower')}</button>
          ))}
        </div>
      )}
      <div ref={settingsRef} style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
        <button
          onClick={() => setSettingsOpen(o => !o)}
          title={view3d ? t('replay:settings3d') : t('settings')}
          style={{
            height: 24,
            boxSizing: 'border-box',
            background: settingsOpen ? 'var(--accent)' : 'rgba(0,0,0,.75)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '0 8px',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'inherit',
            lineHeight: '20px',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>⚙</span>
          <span style={{ lineHeight: 1 }}>{view3d ? '3D' : t('settings')}</span>
        </button>
        {settingsOpen && (
          <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            background: 'rgba(20,22,28,.95)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '12px 14px',
            width: 230,
            boxShadow: '0 8px 24px rgba(0,0,0,.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            fontSize: 12,
            backdropFilter: 'blur(8px)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{view3d ? t('replay:settings3d') : t('settings')}</span>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 14, padding: 0 }}
              >×</button>
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase', fontWeight: 600 }}>
                {t('replay:nadesTitle')}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button
                  onClick={() => onTrailMode('trail')}
                  style={{
                    flex: 1,
                    background: nadeTrailMode === 'trail' ? 'var(--accent)' : 'var(--bg2)',
                    color: nadeTrailMode === 'trail' ? '#fff' : 'var(--text)',
                    border: '1px solid ' + (nadeTrailMode === 'trail' ? 'var(--accent)' : 'var(--border)'),
                    borderRadius: 3,
                    padding: '4px 0',
                    cursor: 'pointer',
                    fontSize: 11,
                    textAlign: 'center',
                    fontWeight: nadeTrailMode === 'trail' ? 600 : 400,
                  }}
                  title={t('replay:trail.tailTip')}
                >
                  {t('replay:trail.tail')}
                </button>
                <button
                  onClick={() => onTrailMode('path')}
                  style={{
                    flex: 1,
                    background: nadeTrailMode === 'path' ? 'var(--accent)' : 'var(--bg2)',
                    color: nadeTrailMode === 'path' ? '#fff' : 'var(--text)',
                    border: '1px solid ' + (nadeTrailMode === 'path' ? 'var(--accent)' : 'var(--border)'),
                    borderRadius: 3,
                    padding: '4px 0',
                    cursor: 'pointer',
                    fontSize: 11,
                    textAlign: 'center',
                    fontWeight: nadeTrailMode === 'path' ? 600 : 400,
                  }}
                  title={t('replay:trail.pathTip')}
                >
                  {t('replay:trail.path')}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { id: 0, label: t('replay:nade.smoke'), color: '#88bb88' },
                  { id: 1, label: t('replay:nade.he'), color: '#ff9930' },
                  { id: 2, label: t('replay:nade.flash'), color: '#ffec50' },
                  { id: 3, label: t('replay:nade.molotov'), color: '#ff5020' },
                  { id: 4, label: t('replay:nade.decoy'), color: '#aaaaaa' },
                ].map(g => {
                  const on = !(nadeFilter?.has(g.id))
                  return (
                    <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12 }}>
                      <input type="checkbox" checked={on} onChange={() => onToggleNade(g.id)} />
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, display: 'inline-block' }} />
                      <span style={{ opacity: on ? 1 : 0.45 }}>{g.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {view3d && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', fontWeight: 600 }}>
                  {t('mode3d')}
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginBottom: 4 }}>
                    <input
                      type="checkbox"
                      checked={settings3d.showGround}
                      onChange={e => update3D({ showGround: e.target.checked })}
                    />
                    <span>{t('replay:mapGround')}</span>
                  </label>
                  {settings3d.showGround && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 20 }}>
                      <input
                        type="range" min={5} max={100} step={5}
                        value={Math.round(settings3d.groundAlpha * 100)}
                        onChange={e => update3D({ groundAlpha: Number(e.target.value) / 100 })}
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                      />
                      <span style={{ minWidth: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)' }}>
                        {Math.round(settings3d.groundAlpha * 100)}%
                      </span>
                    </div>
                  )}
                </div>

                {hm3d && (
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginBottom: 4 }}>
                      <input
                        type="checkbox"
                        checked={settings3d.showPlane}
                        onChange={e => update3D({ showPlane: e.target.checked })}
                      />
                      <span>{t('replay:densityGrid')}</span>
                    </label>
                    {settings3d.showPlane && (
                      <>
                        <div style={{ paddingLeft: 20, marginBottom: 6 }}>
                          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4, textTransform: 'uppercase' }}>
                            {t('replay:detail')}
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {(() => {
                              const baseCell = hm3d.cell ?? 16
                              const targets = [16, 32, 64, 128].filter(u => u >= baseCell)
                              const curShift = settings3d.shift ?? 1
                              return targets.map(target => {
                                const s = Math.max(0, Math.round(Math.log2(target / baseCell)))
                                const active = curShift === s
                                return (
                                  <button
                                    key={target}
                                    onClick={() => update3D({ shift: s })}
                                    style={{
                                      flex: 1,
                                      background: active ? 'var(--accent)' : 'var(--bg2)',
                                      color: active ? '#fff' : 'var(--text)',
                                      border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                                      borderRadius: 3,
                                      padding: '3px 0',
                                      cursor: 'pointer',
                                      fontSize: 11,
                                      textAlign: 'center',
                                    }}
                                  >
                                    {target}u
                                  </button>
                                )
                              })
                            })()}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 20, marginBottom: 4 }}>
                          <input
                            type="range" min={5} max={100} step={5}
                            value={Math.round(settings3d.planeAlpha * 100)}
                            onChange={e => update3D({ planeAlpha: Number(e.target.value) / 100 })}
                            style={{ flex: 1, accentColor: 'var(--accent)' }}
                          />
                          <span style={{ minWidth: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)' }}>
                            {Math.round(settings3d.planeAlpha * 100)}%
                          </span>
                        </div>
                        <div style={{ paddingLeft: 20 }}>
                          <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span>{t('replay:shades')}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{settings3d.shades}</span>
                          </div>
                          <input
                            type="range" min={1} max={32} step={1}
                            value={settings3d.shades}
                            onChange={e => update3D({ shades: Number(e.target.value) })}
                            style={{ width: '100%', accentColor: 'var(--accent)' }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                <button
                  onClick={() => setResetCamTrigger(t => t + 1)}
                  style={{
                    background: 'var(--bg3)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '5px 10px',
                    cursor: 'pointer',
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  {t('replay:resetCam')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {view3d ? (
        camInfo && (
          <div
            onClick={() => setResetCamTrigger(t => t + 1)}
            title={t('replay:resetCam')}
            style={{
              position: 'absolute', bottom: 12, right: 12,
              background: 'rgba(0,0,0,.6)', padding: '2px 8px', borderRadius: 4,
              fontSize: 11, color: 'var(--text2)', cursor: 'pointer', userSelect: 'none',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {camInfo.scale.toFixed(1)}x · ∠{camInfo.yaw}°/{camInfo.pitch}° · ({camInfo.cx}, {camInfo.cy}) · [0] {t('zoomReset')}
          </div>
        )
      ) : (
        (tx.scale > 1.01 || tx.scale < 0.99) && (
          <div
            onClick={() => setTx(clamp({ scale: 1, ox: 0, oy: 0 }))}
            style={{
              position: 'absolute', bottom: 12, right: 12,
              background: 'rgba(0,0,0,.6)', padding: '2px 8px', borderRadius: 4,
              fontSize: 11, color: 'var(--text2)', cursor: 'pointer', userSelect: 'none',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {tx.scale.toFixed(1)}x · [0] {t('zoomReset')}
          </div>
        )
      )}
    </div>
  )
}
