// 3D voxel heatmap canvas: orbit/pan/zoom on top of scene3d.ts, optional
// radar image drawn as the ground plane. Redraws on camera/prop changes only.
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, Map3DData, MapOverview } from '../../api'
import { t } from '../../i18n'
import { useLang } from '../../App'
import { buildVoxelBoxes, Cam, camBasis, clampPitch, drawVoxels, fitCam, groundMatrix } from './scene3d'

interface Props {
  data: Map3DData
  overview: MapOverview
  map: string
  players: { steamid: string; name: string; team: number }[]
  selected: Set<number> | null  // analysis.players indices; null = all
  alpha: number
  shift: number                 // resolution merge 0/1/2
  showGround: boolean
  width: number
  height: number
}

export default function Map3DCanvas({ data, overview, map, players, selected, alpha, shift, showGround, width, height }: Props) {
  useLang()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camRef = useRef<Cam | null>(null)
  const rafRef = useRef(0)
  const dragRef = useRef<{ x: number; y: number; pan: boolean } | null>(null)
  const [groundImg, setGroundImg] = useState<HTMLImageElement | null>(null)

  // artifact column per selected player; team per artifact column
  const { filterCols, colTeam } = useMemo(() => {
    const colOf = new Map(data.players.map((s, i) => [s, i]))
    const filterCols = selected && selected.size > 0
      ? new Set([...selected].flatMap(i => {
          const col = colOf.get(players[i]?.steamid ?? '')
          return col === undefined ? [] : [col]
        }))
      : null
    const colTeam = data.players.map(s => players.find(p => p.steamid === s)?.team ?? 0)
    return { filterCols, colTeam }
  }, [data, players, selected])

  const boxes = useMemo(
    () => buildVoxelBoxes(data, { shift, colTeam, filterCols, alpha }),
    [data, shift, colTeam, filterCols, alpha])

  const fitOnce = () => {
    if (camRef.current || width < 2 || height < 2) return
    let bbox = null as null | { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
    for (const row of data.cells) {
      const x0 = data.minX + row[0] * data.cell, y0 = data.minY + row[1] * data.cell, z0 = data.minZ + row[2] * data.zStep
      if (!bbox) bbox = { minX: x0, minY: y0, minZ: z0, maxX: x0 + data.cell, maxY: y0 + data.cell, maxZ: z0 + data.zStep }
      else {
        bbox.minX = Math.min(bbox.minX, x0); bbox.minY = Math.min(bbox.minY, y0); bbox.minZ = Math.min(bbox.minZ, z0)
        bbox.maxX = Math.max(bbox.maxX, x0 + data.cell); bbox.maxY = Math.max(bbox.maxY, y0 + data.cell); bbox.maxZ = Math.max(bbox.maxZ, z0 + data.zStep)
      }
    }
    camRef.current = fitCam(bbox ?? { minX: data.minX, minY: data.minY, minZ: data.minZ, maxX: data.minX + 1024, maxY: data.minY + 1024, maxZ: data.minZ + 128 }, width, height)
  }

  const draw = () => {
    const cv = canvasRef.current
    fitOnce()
    const cam = camRef.current
    if (!cv || !cam || width < 2 || height < 2) return
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(height * dpr)) {
      cv.width = Math.round(width * dpr)
      cv.height = Math.round(height * dpr)
    }
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (showGround && groundImg && groundImg.complete && groundImg.naturalWidth > 0) {
      const b = camBasis(cam)
      const m = groundMatrix(cam, b, width, height, overview, data.minZ - data.zStep * 0.5)
      ctx.save()
      ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5])
      ctx.globalAlpha = 0.9
      ctx.drawImage(groundImg, 0, 0)
      ctx.restore()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    drawVoxels(ctx, boxes, cam, width, height)
  }

  useEffect(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw() })
  })

  useEffect(() => {
    if (!showGround) { setGroundImg(null); return }
    const img = new Image()
    img.onload = () => setGroundImg(img)
    img.src = api.radarUrl(map)
  }, [showGround, map])

  // orbit (LMB drag), pan (Shift/RMB drag), zoom (wheel), dblclick resets
  function onMouseDown(e: React.MouseEvent) {
    const pan = e.shiftKey || e.button === 2
    if (!pan && e.button !== 0) return
    e.preventDefault()
    dragRef.current = { x: e.clientX, y: e.clientY, pan }
  }
  function onMouseMove(e: React.MouseEvent) {
    const d = dragRef.current
    const cam = camRef.current
    if (!d || !cam) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.x = e.clientX; d.y = e.clientY
    if (d.pan) {
      const b = camBasis(cam)
      const k = 1 / cam.zoom
      cam.cx += (-dx * b.right[0] + dy * b.up[0]) * k
      cam.cy += (-dx * b.right[1] + dy * b.up[1]) * k
      cam.cz += (-dx * b.right[2] + dy * b.up[2]) * k
    } else {
      cam.yaw += dx * 0.005
      cam.pitch = clampPitch(cam.pitch + dy * 0.005)
    }
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw() })
  }
  function onMouseUp() { dragRef.current = null }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const cam = camRef.current
    if (!cam) return
    cam.zoom *= e.deltaY < 0 ? 1.1 : 0.9
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw() })
  }
  function onDoubleClick() {
    camRef.current = null
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw() })
  }

  return (
    <div
      style={{ position: 'absolute', inset: 8, userSelect: 'none', cursor: dragRef.current ? 'grabbing' : 'grab' }}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      onWheel={onWheel} onDoubleClick={onDoubleClick} onContextMenu={e => e.preventDefault()}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 4 }} />
      <div style={{ position: 'absolute', bottom: 4, right: 8, background: 'rgba(0,0,0,.6)', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: 'var(--text2)', pointerEvents: 'none', textAlign: 'right' }}>
        <div>{t('heatmaps:map3dSamples', { n: data.samples, cell: Math.round(data.cell * (1 << shift)) })}</div>
        <div style={{ opacity: 0.75 }}>{t('heatmaps:map3dHint')}</div>
      </div>
    </div>
  )
}
