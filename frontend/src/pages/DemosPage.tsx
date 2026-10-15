import { useState, useEffect, useReducer, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, DemoEntry } from '../api'
import { t } from '../i18n'
import { useLang } from '../App'

function fmtSize(b: number) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  return (b / 1e3).toFixed(0) + ' KB'
}

function fmtDate(iso?: string, mtime?: number) {
  const d = iso ? new Date(iso) : mtime ? new Date(mtime * 1000) : null
  if (!d) return ''
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtDateGroupKey(iso?: string, mtime?: number) {
  const d = iso ? new Date(iso) : mtime ? new Date(mtime * 1000) : null
  if (!d) return ''
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' })
}

function mapShortName(map?: string) {
  if (!map) return ''
  return map.replace(/^(de_|cs_)/, '')
}

function isRunning(d: DemoEntry) {
  return d.status === 'parsing' || d.status === 'running' || d.status === 'probing'
}

function isAnalyzed(d: DemoEntry) {
  return d.status === 'ready'
}

function isUnanalyzed(d: DemoEntry) {
  return !d.status || d.status === 'new' || d.status === 'probed' || d.status === 'probing' || d.status === 'error' || d.status === 'available'
}

function demoDate(d: DemoEntry): Date | null {
  if (d.date) return new Date(d.date)
  if (d.mtime) return new Date(d.mtime * 1000)
  return null
}

// ── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ d }: { d: DemoEntry }) {
  useLang()
  const s = d.status || 'new'
  if (s === 'ready') return <span className="tag tag-green">{t('ready')}</span>
  if (s === 'error') return <span className="tag tag-red" title={d.error}>{t('error')}</span>
  if (s === 'probing') return (
    <span className="flex items-center gap-8">
      <span className="spinner" />
      <span style={{ color: 'var(--text2)', fontSize: 12 }}>PROBE {d.progress ?? 0}%</span>
    </span>
  )
  if (s === 'probed') return <span className="tag" style={{ background: 'var(--bg3)', color: 'var(--accent)', border: '1px solid var(--accent)', fontSize: 11 }}>{t('probed')}</span>
  if (s === 'parsing' || s === 'running') return (
    <span className="flex items-center gap-8">
      <span className="spinner" />
      <span style={{ color: 'var(--text2)', fontSize: 12 }}>
        {d.detail || d.phase || t('analyzing')} {d.progress ?? 0}%
      </span>
    </span>
  )
  return <span className="tag" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>{t(s as 'new') ?? s}</span>
}

// ── ProgressRow ──────────────────────────────────────────────────────────────

// parse start timestamps survive re-renders so the elapsed label keeps ticking
const parseStart: Record<string, number> = {}

function ProgressRow({ d }: { d: DemoEntry }) {
  const [, tick] = useReducer(x => x + 1, 0)
  useEffect(() => {
    if (!isRunning(d)) return
    parseStart[d.id] ??= Date.now()
    const iv = window.setInterval(tick, 1000)
    return () => window.clearInterval(iv)
  }, [d.id, d.status, d.progress])
  if (!isRunning(d)) {
    delete parseStart[d.id]
    return null
  }
  if (!parseStart[d.id]) parseStart[d.id] = Date.now()
  const elapsed = Math.max(0, Math.floor((Date.now() - parseStart[d.id]) / 1000))
  const label = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const pct = d.progress ?? 0
  return (
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div className="progress-bar" style={{ width: 200 }}>
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>{label}</span>
    </div>
  )
}

// ── FilterDrawer ─────────────────────────────────────────────────────────────

interface Filters {
  dateFrom: string
  dateTo: string
  maps: string[]
  hideAnalyzed: boolean
  hideNew: boolean
}

const DEFAULT_FILTERS: Filters = { dateFrom: '', dateTo: '', maps: [], hideAnalyzed: false, hideNew: false }

function FilterDrawer({
  open, onClose, filters, onChange, allMaps,
}: {
  open: boolean
  onClose: () => void
  filters: Filters
  onChange: (f: Filters) => void
  allMaps: string[]
}) {
  useLang()
  if (!open) return null
  function toggleMap(m: string) {
    onChange({ ...filters, maps: filters.maps.includes(m) ? filters.maps.filter(x => x !== m) : [...filters.maps, m] })
  }
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 280,
        background: 'var(--bg2)', borderLeft: '1px solid var(--border)',
        zIndex: 201, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div className="flex items-center justify-between">
          <span style={{ fontWeight: 600 }}>{t('filterBtn')}</span>
          <button onClick={onClose} aria-label={t('demos:filter.close')} style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text2)' }}>{t('filterDateFrom')}</label>
          <input type="date" value={filters.dateFrom}
            onChange={e => onChange({ ...filters, dateFrom: e.target.value })}
            style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '4px 8px', fontSize: 13 }} />
          <label style={{ fontSize: 12, color: 'var(--text2)' }}>{t('filterDateTo')}</label>
          <input type="date" value={filters.dateTo}
            onChange={e => onChange({ ...filters, dateTo: e.target.value })}
            style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '4px 8px', fontSize: 13 }} />
        </div>

        {allMaps.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--text2)' }}>{t('filterMaps')}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allMaps.map(m => (
                <button key={m} onClick={() => toggleMap(m)}
                  style={{
                    padding: '3px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
                    background: filters.maps.includes(m) ? 'var(--accent)' : 'var(--bg3)',
                    color: filters.maps.includes(m) ? '#fff' : 'var(--text)',
                    border: '1px solid var(--border)',
                  }}>
                  {mapShortName(m)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={filters.hideAnalyzed}
              onChange={e => onChange({ ...filters, hideAnalyzed: e.target.checked })} />
            {t('filterHideAnalyzed')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={filters.hideNew}
              onChange={e => onChange({ ...filters, hideNew: e.target.checked })} />
            {t('filterHideNew')}
          </label>
        </div>

        <button className="btn-primary" style={{ marginTop: 'auto' }}
          onClick={() => onChange(DEFAULT_FILTERS)}>
          {t('filterReset')}
        </button>
      </div>
    </>
  )
}

// ── DemoMeta ─────────────────────────────────────────────────────────────────

function DemoMeta({ d, showDate }: { d: DemoEntry; showDate: boolean }) {
  const hasInfo = d.map || (d.score?.length === 2 && d.teamNames?.length === 2)
  if (!hasInfo) return null
  return (
    <div className="flex items-center gap-12" style={{ marginTop: 6, fontSize: 12, color: 'var(--text2)', flexWrap: 'wrap' }}>
      {d.map && (
        <span style={{ background: 'var(--bg3)', borderRadius: 4, padding: '1px 6px', fontWeight: 600, color: 'var(--text)' }}>
          {mapShortName(d.map)}
        </span>
      )}
      {d.teamNames?.[0] && d.score?.length === 2 && (
        <span>
          <span style={{ color: 'var(--accent)' }}>{d.teamNames[0]}</span>
          {' '}
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{d.score[0]}:{d.score[1]}</span>
          {' '}
          <span style={{ color: 'var(--accent2)' }}>{d.teamNames[1]}</span>
        </span>
      )}
      {showDate && (d.date || d.mtime) && (
        <span style={{ marginLeft: 'auto' }}>{fmtDate(d.date, d.mtime)}</span>
      )}
    </div>
  )
}

// ── DemosPage ─────────────────────────────────────────────────────────────────

type SortKey = 'date' | 'map'
type SortDir = 'asc' | 'desc'

interface UploadItem {
  key: number
  name: string
  size: number
  loaded: number
  error?: string
}

// client-side pseudo-rows for files currently being uploaded; they are not on
// the server yet, so they live outside the demo list and disappear on success
function UploadCard({ u, onDismiss }: { u: UploadItem; onDismiss: () => void }) {
  useLang()
  const pct = u.size > 0 ? Math.min(100, Math.round((u.loaded / u.size) * 100)) : 0
  return (
    <div className="card">
      <div className="flex items-center justify-between wrap gap-8">
        <div>
          <span style={{ fontWeight: 600 }}>{u.name}</span>
          {u.size > 0 && <span className="text-muted text-sm" style={{ marginLeft: 10 }}>{fmtSize(u.size)}</span>}
        </div>
        <div className="flex items-center gap-8">
          {u.error ? (
            <>
              <span className="tag tag-red" title={u.error}>{t('error')}</span>
              <button onClick={onDismiss} aria-label={t('demos:dismissError')}
                style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </>
          ) : (
            <span className="flex items-center gap-8">
              <span className="spinner" />
              <span style={{ color: 'var(--text2)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                {t('demos:uploading')} {pct}%
              </span>
            </span>
          )}
        </div>
      </div>
      {u.error ? (
        <div style={{ color: 'var(--red)', marginTop: 6, fontSize: 13 }}>{u.error}</div>
      ) : (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="progress-bar" style={{ width: 200 }}>
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtSize(u.loaded)} / {fmtSize(u.size)}
          </span>
        </div>
      )}
    </div>
  )
}

export default function DemosPage() {
  const { lang } = useLang()
  const [demos, setDemos] = useState<DemoEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [drag, setDrag] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const fileRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const pollRef = useRef<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const demosRef = useRef<DemoEntry[]>([])

  const refresh = useCallback(async () => {
    try {
      const list = await api.demos()
      demosRef.current = list
      setDemos(list)
      setLoading(false)
    } catch { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()

    // WebSocket for real-time status pushes
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${window.location.host}/ws/demos`
    let ws: WebSocket
    let reconnectTimer: number | null = null
    let unmounted = false

    function connect() {
      if (unmounted) return
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type !== 'status') return
          setDemos(prev => {
            const idx = prev.findIndex(d => d.id === msg.id)
            if (idx === -1) {
              // new demo appeared — trigger a full refresh to get its metadata
              refresh()
              return prev
            }
            const updated = { ...prev[idx],
              status: msg.status,
              progress: msg.progress,
              phase: msg.phase,
              detail: msg.detail,
              error: msg.error,
              map: msg.map || prev[idx].map,
              score: msg.score?.length ? msg.score : prev[idx].score,
              teamNames: msg.teamNames?.length ? msg.teamNames : prev[idx].teamNames,
              date: msg.date || prev[idx].date,
            }
            const next = [...prev]
            next[idx] = updated
            return next
          })
        } catch { /* ignore malformed */ }
      }

      ws.onclose = () => {
        if (!unmounted) {
          reconnectTimer = window.setTimeout(connect, 3000)
        }
      }

      ws.onerror = () => { ws.close() }
    }

    connect()

    // Slow fallback poll (10 s) — catches new demos added externally, covers WS gaps
    pollRef.current = window.setInterval(refresh, 10000)

    return () => {
      unmounted = true
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      if (pollRef.current) clearInterval(pollRef.current)
      ws?.close()
    }
  }, [refresh])

  async function startAnalyze(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    await api.analyze(id)
    refresh()
  }

  async function startFetch(key: string, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await api.fetchDemo(key)
    } catch { /* 404/409 — the record state shows what happened */ }
    refresh()
  }

  async function deletDemo(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(t('confirmDeleteDemo'))) return
    await api.delete(id)
    refresh()
  }

  const DEMO_EXTS = ['.dem', '.dem.zst', '.zst', '.dem.gz', '.gz']
  const isDemoFile = (name: string) => DEMO_EXTS.some(ext => name.toLowerCase().endsWith(ext))

  const uploadKeyRef = useRef(0)
  const uploading = uploads.some(u => !u.error)

  async function uploadFiles(files: File[]) {
    if (!files.length) return
    const items: UploadItem[] = files.map(f => ({
      key: ++uploadKeyRef.current,
      name: f.name,
      size: f.size,
      loaded: 0,
      error: isDemoFile(f.name) ? undefined : t('onlyDemFiles'),
    }))
    setUploads(prev => [...prev, ...items])
    // sequential: the backend reads each upload fully into memory
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (!isDemoFile(f.name)) continue
      const key = items[i].key
      try {
        await api.upload(f, loaded =>
          setUploads(prev => prev.map(u => (u.key === key ? { ...u, loaded } : u))))
        setUploads(prev => prev.filter(u => u.key !== key))
        refresh()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        const err = msg.includes('fetch') || msg.includes('ALPN') || msg.includes('network')
          ? t('uploadErrorArchive')
          : t('uploadErrorGeneric') + ': ' + msg
        setUploads(prev => prev.map(u => (u.key === key ? { ...u, error: err } : u)))
      }
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    uploadFiles(Array.from(e.dataTransfer.files))
  }

  // collect all unique maps for filter
  const allMaps = Array.from(new Set(demos.map(d => d.map).filter(Boolean) as string[])).sort()

  // apply filters
  let rows = demos.slice()
  if (filters.hideAnalyzed) rows = rows.filter(d => !isAnalyzed(d))
  if (filters.hideNew) rows = rows.filter(d => !isUnanalyzed(d))
  if (filters.maps.length) rows = rows.filter(d => d.map && filters.maps.includes(d.map))
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime()
    rows = rows.filter(d => { const dt = demoDate(d); return dt && dt.getTime() >= from })
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo).getTime() + 86400000
    rows = rows.filter(d => { const dt = demoDate(d); return dt && dt.getTime() <= to })
  }

  // sort
  rows.sort((a, b) => {
    let cmp = 0
    if (sortKey === 'date') {
      const da = demoDate(a)?.getTime() ?? 0
      const db = demoDate(b)?.getTime() ?? 0
      cmp = da - db
    } else {
      cmp = (a.map || '').localeCompare(b.map || '')
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  // group by date when sorting by date
  const groupByDate = sortKey === 'date'

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const activeFilters = filters.maps.length > 0 || filters.dateFrom || filters.dateTo || filters.hideAnalyzed || filters.hideNew

  return (
    <div className="page">
      <div className="flex items-center mb-12" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
        <h1 className="page-title" style={{ margin: 0 }}>{t('demos')}</h1>
        <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
          {/* sort controls */}
          <button
            onClick={() => toggleSort('date')}
            style={{
              background: sortKey === 'date' ? 'var(--accent)' : 'var(--bg3)',
              color: sortKey === 'date' ? '#fff' : 'var(--text2)',
              border: '1px solid var(--border)', borderRadius: 4,
              padding: '4px 10px', cursor: 'pointer', fontSize: 12,
            }}>
            {t('sortDate')} {sortKey === 'date' ? (sortDir === 'asc' ? t('sortAsc') : t('sortDesc')) : ''}
          </button>
          <button
            onClick={() => toggleSort('map')}
            style={{
              background: sortKey === 'map' ? 'var(--accent)' : 'var(--bg3)',
              color: sortKey === 'map' ? '#fff' : 'var(--text2)',
              border: '1px solid var(--border)', borderRadius: 4,
              padding: '4px 10px', cursor: 'pointer', fontSize: 12,
            }}>
            {t('sortMap')} {sortKey === 'map' ? (sortDir === 'asc' ? t('sortAsc') : t('sortDesc')) : ''}
          </button>
          {/* filter button */}
          <button
            onClick={() => setFilterOpen(true)}
            style={{
              background: activeFilters ? 'var(--accent)' : 'var(--bg3)',
              color: activeFilters ? '#fff' : 'var(--text2)',
              border: '1px solid var(--border)', borderRadius: 4,
              padding: '4px 10px', cursor: 'pointer', fontSize: 12,
            }}>
            {t('filterBtn')}{activeFilters ? ' ●' : ''}
          </button>
          <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <span className="spinner" /> : t('upload')}
          </button>
          <input ref={fileRef} type="file" accept=".dem,.dem.zst,.zst,.dem.gz,.gz" multiple style={{ display: 'none' }}
            onChange={e => {
              const files = e.target.files ? Array.from(e.target.files) : []
              if (files.length) uploadFiles(files)
              e.target.value = ''
            }} />
        </div>
      </div>

      <div
        className="card"
        style={{ borderStyle: drag ? 'dashed' : 'solid', borderColor: drag ? 'var(--accent)' : 'var(--border)', cursor: 'pointer', textAlign: 'center', padding: 24, marginBottom: 20, color: 'var(--text2)' }}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        {t('dropHere')} <span style={{ color: 'var(--accent)' }}>{t('chooseFile')}</span>
      </div>

      {uploads.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, padding: '0 2px' }}>
            {t('demos:uploadsTitle')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {uploads.map(u => (
              <UploadCard key={u.key} u={u}
                onDismiss={() => setUploads(prev => prev.filter(x => x.key !== u.key))} />
            ))}
          </div>
        </div>
      )}

      <FilterDrawer open={filterOpen} onClose={() => setFilterOpen(false)} filters={filters} onChange={setFilters} allMaps={allMaps} />

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 64, borderRadius: 8 }} />
          ))}
        </div>
      ) : (
        <DemoList rows={rows} groupByDate={groupByDate} onAnalyze={startAnalyze} onFetch={startFetch} onDelete={deletDemo} onNavigate={id => navigate(`/match/${id}`)} />
      )}
    </div>
  )
}

// ── DemoList ──────────────────────────────────────────────────────────────────

function DemoList({ rows, groupByDate, onAnalyze, onFetch, onDelete, onNavigate }: {
  rows: DemoEntry[]
  groupByDate: boolean
  onAnalyze: (id: string, e: React.MouseEvent) => void
  onFetch: (key: string, e: React.MouseEvent) => void
  onDelete: (id: string, e: React.MouseEvent) => void
  onNavigate: (id: string) => void
}) {
  useLang()
  if (rows.length === 0) return <div className="text-muted">{t('noData')}</div>

  if (!groupByDate) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(d => <DemoCard key={d.id} d={d} showDate onAnalyze={onAnalyze} onFetch={onFetch} onDelete={onDelete} onNavigate={onNavigate} />)}
      </div>
    )
  }

  // group by date label
  const groups: { label: string; demos: DemoEntry[] }[] = []
  for (const d of rows) {
    const label = fmtDateGroupKey(d.date, d.mtime) || '—'
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.demos.push(d)
    else groups.push({ label, demos: [d] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {groups.map(g => (
        <div key={g.label}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, padding: '0 2px' }}>
            {g.label}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.demos.map(d => <DemoCard key={d.id} d={d} showDate={false} onAnalyze={onAnalyze} onFetch={onFetch} onDelete={onDelete} onNavigate={onNavigate} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── DemoCard ─────────────────────────────────────────────────────────────────

function DemoCard({ d, showDate, onAnalyze, onFetch, onDelete, onNavigate }: {
  d: DemoEntry
  showDate: boolean
  onAnalyze: (id: string, e: React.MouseEvent) => void
  onFetch: (key: string, e: React.MouseEvent) => void
  onDelete: (id: string, e: React.MouseEvent) => void
  onNavigate: (id: string) => void
}) {
  useLang()
  const running = isRunning(d)
  const ready = d.status === 'ready'
  const errored = d.status === 'error'
  const probed = d.status === 'probed'
  const available = d.status === 'available'
  const srcLabel = d.source === 'inbox' ? 'inbox'
    : d.source === 'upload' ? 'upload'
      : d.source === 'faceit' ? t('demos:srcFaceit') : t('demos:srcWatch')

  return (
    <div className="card" style={{ cursor: ready ? 'pointer' : 'default' }}
      onClick={() => ready && onNavigate(d.id)}>
      <div className="flex items-center justify-between wrap gap-8">
        <div>
          <span style={{ fontWeight: 600 }}>{d.name}</span>
          {d.size > 0 && <span className="text-muted text-sm" style={{ marginLeft: 10 }}>{fmtSize(d.size)}</span>}
          <span className="tag" style={{
            marginLeft: 8, fontSize: 10,
            ...(d.source === 'faceit'
              ? { background: '#001a3d', color: 'var(--blue)' }
              : { background: 'var(--bg3)', color: 'var(--text2)' }),
          }}>
            {srcLabel}
          </span>
        </div>
        <div className="flex items-center gap-8">
          {!probed && !available && <StatusBadge d={d} />}
          {available && d.error && (
            <span className="tag tag-red" title={d.error}>{t('demos:fetchError')}</span>
          )}
          {ready && (
            <>
              <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={e => { e.stopPropagation(); onNavigate(d.id) }}>
                {t('view')}
              </button>
              <button style={{ fontSize: 12, padding: '4px 10px', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}
                onClick={e => onAnalyze(d.id, e)}>
                {t('reAnalyze')}
              </button>
            </>
          )}
          {errored && (
            <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={e => onAnalyze(d.id, e)}>
              {t('retryAnalyze')}
            </button>
          )}
          {available && d.fetching && (
            <span className="flex items-center gap-8">
              <span className="spinner" />
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('demos:fetching')}</span>
            </span>
          )}
          {available && !d.fetching && d.key && (
            <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={e => onFetch(d.key!, e)}>
              {t('demos:fetchAnalyze')}
            </button>
          )}
          {(probed || (!d.status || d.status === 'new')) && !running && (
            <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={e => onAnalyze(d.id, e)}>
              {t('analyze')}
            </button>
          )}
          {running && (
            <button style={{ fontSize: 12, padding: '4px 10px', opacity: 0.5, cursor: 'not-allowed', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 4 }} disabled>
              {t('analyzing')}
            </button>
          )}
          {d.source === 'upload' && !running && (
            <button className="btn-danger" style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={e => onDelete(d.id, e)}>
              {t('delete')}
            </button>
          )}
        </div>
      </div>
      <DemoMeta d={d} showDate={showDate} />
      <ProgressRow d={d} />
    </div>
  )
}
