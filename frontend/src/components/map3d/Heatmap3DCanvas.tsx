// 3D heatmap view: flat density cells on the ground + a point cloud of the
// selected layer. Points of the positions layer float at their real z; every
// other layer draws on the ground plane. Geometry is rebuilt only when the
// layer / resolution / filters change — camera and opacity only re-draw.
import { useCallback, useMemo } from 'react'
import { api, AnalysisData, HeatmapData, Map3DData, MapOverview } from '../../api'
import { t } from '../../i18n'
import { useLang } from '../../App'
import { zOnLevel } from '../../lib/coords'
import { decodePoint, LAYER_COLORS } from '../../lib/heatmapLayers'
import { BBox, buildDensityPlane, Cam, drawDensityPlane, drawPoints3D } from './scene3d'
import Scene3DCanvas from './Scene3DCanvas'

interface Props {
  heatmap: HeatmapData
  hm3d: Map3DData
  layer: string
  overview: MapOverview
  map: string
  players: AnalysisData['players']
  selected: Set<number> | null  // analysis.players indices; null = all
  alpha: number                 // point opacity (shared with 2D)
  mapAlpha: number              // density plane + radar ground opacity (3D)
  contrast: boolean             // density tiles use the hue opposite to points
  shades: number                // density shading levels (tiles)
  shift: number                 // resolution merge 0/1/2
  showGround: boolean
  level: string                 // map level filter (same semantics as 2D)
  width: number
  height: number
}

// 'r,g,b' -> hue in degrees
function rgbHue(rgb: string): number {
  const [r, g, b] = rgb.split(',').map(Number)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const d = mx - mn
  if (d <= 0) return 0
  let h: number
  if (mx === r) h = ((g - b) / d) % 6
  else if (mx === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return ((h * 60) + 360) % 360
}

// hue -> 'r,g,b' triplet at fixed saturation/lightness (tile fill color)
function hslTriplet(hue: number, sat = 0.45, light = 0.55): string {
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = light - c / 2
  const seg = Math.floor(hue / 60) % 6
  const table: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ]
  const [r, g, b] = table[seg]
  return `${Math.round((r + m) * 255)},${Math.round((g + m) * 255)},${Math.round((b + m) * 255)}`
}

export default function Heatmap3DCanvas({
  heatmap, hm3d, layer, overview, map, players, selected, alpha, mapAlpha, contrast, shades, shift, showGround, level, width, height,
}: Props) {
  useLang()
  const groundZ = hm3d.minZ

  // artifact player columns for the density plane
  const filterCols = useMemo(() => {
    if (!selected || selected.size === 0) return null
    const sids = new Set([...selected].map(i => players[i]?.steamid))
    const set = new Set<number>()
    hm3d.players.forEach((s, i) => { if (sids.has(s)) set.add(i) })
    return set.size ? set : null
  }, [hm3d, players, selected])

  // layer pIdx values follow heatmap.players order (steamids)
  const pIdxFilter = useMemo(() => {
    if (!selected || selected.size === 0) return null
    const sids = new Set([...selected].map(i => players[i]?.steamid))
    if (!heatmap.players) return new Set(selected)  // legacy artifacts
    const set = new Set<number>()
    heatmap.players.forEach((sid, i) => { if (sids.has(sid)) set.add(i) })
    return set
  }, [heatmap, players, selected])

  const plane = useMemo(
    () => buildDensityPlane(hm3d, { shift, filterCols, groundZ }),
    [hm3d, shift, filterCols, groundZ])

  const pts = useMemo(() => {
    const raw = (heatmap.layers[layer] ?? []) as unknown as number[][]
    const out: number[] = []
    for (const arr of raw) {
      if (!arr || arr.length < 2) continue
      const pt = decodePoint(layer, arr)
      if (pIdxFilter !== null && !pIdxFilter.has(pt.pIdx)) continue
      if (pt.z !== undefined && !zOnLevel(pt.z, overview, level)) continue
      out.push(pt.x, pt.y, pt.z ?? groundZ)
    }
    return new Float64Array(out)
  }, [heatmap, layer, pIdxFilter, overview, level, groundZ])

  const bbox = useMemo<BBox>(() => {
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
    return bb ?? { minX: hm3d.minX, minY: hm3d.minY, minZ: hm3d.minZ, maxX: hm3d.minX + 1024, maxY: hm3d.minY + 1024, maxZ: hm3d.minZ + 128 }
  }, [hm3d])

  // tiles take the hue opposite to the points so both stay readable
  const tileColor = useMemo(() => {
    const base = LAYER_COLORS[layer] ?? '255,255,255'
    return contrast ? hslTriplet((rgbHue(base) + 180) % 360) : base
  }, [contrast, layer])

  const onDraw = useCallback((ctx: CanvasRenderingContext2D, cam: Cam, w: number, h: number) => {
    drawDensityPlane(ctx, plane, cam, w, h, tileColor, mapAlpha, shades)
    const radius = Math.max(2, Math.min(5, w / 300))
    drawPoints3D(ctx, pts, cam, w, h, LAYER_COLORS[layer] ?? '255,255,255', alpha * 0.9, radius)
  }, [plane, pts, tileColor, layer, alpha, mapAlpha, shades, hm3d])

  return (
    <div style={{ position: 'absolute', inset: 8, userSelect: 'none' }}>
      <Scene3DCanvas
        width={width} height={height} bbox={bbox}
        groundUrl={showGround ? api.radarUrl(map) : undefined}
        groundAnchor={overview} groundZ={groundZ}
        groundAlpha={mapAlpha}
        onDraw={onDraw} />
      <div style={{ position: 'absolute', bottom: 4, right: 8, background: 'rgba(0,0,0,.6)', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: 'var(--text2)', pointerEvents: 'none', textAlign: 'right' }}>
        <div>{t('heatmaps:map3dSamples', { n: pts.length / 3, cell: Math.round(hm3d.cell * (1 << shift)) })}</div>
        <div style={{ opacity: 0.75 }}>{t('heatmaps:map3dHint')}</div>
      </div>
    </div>
  )
}
