// Shared orbit canvas for all 3D views (heatmap, replay, episode drill-down):
// camera fit + orbit/pan/zoom gestures, coalesced redraws, DPR scaling and
// the radar ground plane via the exact affine ground matrix. Scene content is
// delegated to the onDraw callback.
//
// requestAnimationFrame can stay frozen in embedded webviews (the in-app
// preview pane keeps document.hidden=false yet never fires rAF), so the first
// draw after mount/prop change is synchronous and a one-shot probe switches
// gesture redraws to direct calls when rAF is dead.
import { useEffect, useRef, useState } from 'react'
import { Cam, BBox, camBasis, clampPitch, fitCam, groundMatrix } from './scene3d'

interface Props {
  width: number
  height: number
  bbox: BBox
  groundUrl?: string
  // world anchor of the 1024x1024 radar image (overview pos/scale)
  groundAnchor?: { pos_x: number; pos_y: number; scale: number }
  groundZ: number
  groundAlpha?: number
  // optional CSS color to retint the radar image (contrast to point colors)
  groundTint?: string
  onDraw: (ctx: CanvasRenderingContext2D, cam: Cam, w: number, h: number) => void
}

export default function Scene3DCanvas({ width, height, bbox, groundUrl, groundAnchor, groundZ, groundAlpha = 1, groundTint, onDraw }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camRef = useRef<Cam | null>(null)
  const fitZoomRef = useRef(1)
  const bboxRef = useRef(bbox)
  bboxRef.current = bbox
  const onDrawRef = useRef(onDraw)
  onDrawRef.current = onDraw
  const rafRef = useRef(0)
  const rafDeadRef = useRef(false)
  const dragRef = useRef<{ x: number; y: number; pan: boolean } | null>(null)
  const [groundImg, setGroundImg] = useState<HTMLImageElement | null>(null)

  const draw = () => {
    const cv = canvasRef.current
    if (!cv || width < 2 || height < 2) return
    if (!camRef.current) {
      camRef.current = fitCam(bboxRef.current, width, height)
      fitZoomRef.current = camRef.current.zoom
    }
    const cam = camRef.current
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(height * dpr)) {
      cv.width = Math.round(width * dpr)
      cv.height = Math.round(height * dpr)
    }
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (groundImg && groundImg.complete && groundImg.naturalWidth > 0 && groundAnchor) {
      const b = camBasis(cam)
      const m = groundMatrix(cam, b, width, height, groundAnchor, groundZ)
      ctx.save()
      ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5])
      ctx.globalAlpha = groundAlpha
      ctx.drawImage(groundImg, 0, 0)
      if (groundTint) {
        // 'color' composite keeps the image's lightness and replaces hue/sat
        ctx.globalCompositeOperation = 'color'
        ctx.globalAlpha = groundAlpha
        ctx.fillStyle = groundTint
        ctx.fillRect(0, 0, 1024, 1024)
      }
      ctx.restore()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    onDrawRef.current(ctx, cam, width, height)
  }

  const schedule = () => {
    if (rafDeadRef.current) { draw(); return }
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw() })
  }

  // redraw after every commit (ground image arrival, prop changes)
  useEffect(() => { draw() })

  // probe once: if rAF never fires, gesture redraws fall back to direct draw
  useEffect(() => {
    const t = window.setTimeout(() => { rafDeadRef.current = true }, 400)
    requestAnimationFrame(() => { rafDeadRef.current = false; window.clearTimeout(t) })
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!groundUrl) { setGroundImg(null); return }
    const img = new Image()
    img.onload = () => setGroundImg(img)
    img.src = groundUrl
  }, [groundUrl])

  // orbit (LMB drag), pan (Shift/RMB drag), zoom (wheel), dblclick refits
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
    schedule()
  }
  function onMouseUp() { dragRef.current = null }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const cam = camRef.current
    if (!cam) return
    const next = cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9)
    cam.zoom = Math.max(fitZoomRef.current * 0.2, Math.min(fitZoomRef.current * 15, next))
    schedule()
  }
  function onDoubleClick() {
    camRef.current = fitCam(bboxRef.current, width, height)
    fitZoomRef.current = camRef.current.zoom
    schedule()
  }

  return (
    <div
      style={{ position: 'absolute', inset: 0, userSelect: 'none', cursor: dragRef.current ? 'grabbing' : 'grab' }}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      onWheel={onWheel} onDoubleClick={onDoubleClick} onContextMenu={e => e.preventDefault()}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 4 }} />
    </div>
  )
}
