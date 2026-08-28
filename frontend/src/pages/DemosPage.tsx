import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, DemoEntry } from '../api'
import { t } from '../i18n'
import { useLang } from '../App'

function fmtSize(b: number) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  return (b / 1e3).toFixed(0) + ' KB'
}

function fmtDate(mtime?: number) {
  if (!mtime) return ''
  const d = new Date(mtime * 1000)
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function mapShortName(map?: string) {
  if (!map) return ''
  // strip de_ / cs_ prefix for compact display
  return map.replace(/^(de_|cs_)/, '')
}

function StatusBadge({ d }: { d: DemoEntry }) {
  useLang()
  const s = d.status || 'new'
  if (s === 'ready') return <span className="tag tag-green">{t('ready')}</span>
  if (s === 'error') return <span className="tag tag-red" title={d.error}>{t('error')}</span>
  if (s === 'running') return (
    <span className="flex items-center gap-8">
      <span className="spinner" />
      <span style={{ color: 'var(--text2)', fontSize: 12 }}>{d.phase || t('analyzing')} {d.progress ?? 0}%</span>
    </span>
  )
  return <span className="tag" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>{t(s as 'new') ?? s}</span>
}

function ProgressRow({ d }: { d: DemoEntry }) {
  if (!d.status || d.status === 'new') return null
  if (d.status !== 'running') return null
  const pct = d.progress ?? 0
  return (
    <div style={{ marginTop: 6 }}>
      <div className="progress-bar" style={{ width: 200 }}>
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function DemosPage() {
  const { lang } = useLang()
  const [demos, setDemos] = useState<DemoEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const pollRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await api.demos()
      // poll status for running demos
      const withStatus = await Promise.all(list.map(async d => {
        if (!d.status || d.status === 'new') {
          try { const s = await api.status(d.id); return { ...d, ...s } } catch { return d }
        }
        return d
      }))
      setDemos(withStatus)
      setLoading(false)
    } catch { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    pollRef.current = window.setInterval(refresh, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [refresh])

  async function startAnalyze(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    await api.analyze(id)
    refresh()
  }

  async function deletDemo(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Удалить демо?')) return
    await api.delete(id)
    refresh()
  }

  async function uploadFile(file: File) {
    if (!file.name.endsWith('.dem')) { setUploadErr('Только .dem файлы'); return }
    setUploadErr('')
    setUploading(true)
    try {
      const r = await api.upload(file)
      await api.analyze(r.id)
      refresh()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('fetch') || msg.includes('ALPN') || msg.includes('network')) {
        setUploadErr(t('uploadErrorArchive'))
      } else {
        setUploadErr(t('uploadErrorGeneric') + ': ' + msg)
      }
    } finally { setUploading(false) }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files[0]
    if (!f) {
      setUploadErr(t('uploadErrorArchive'))
      return
    }
    uploadFile(f)
  }

  const rows = demos.slice().sort((a, b) => {
    const order = { running: 0, ready: 1, error: 2, new: 3 }
    return (order[a.status as keyof typeof order] ?? 4) - (order[b.status as keyof typeof order] ?? 4)
  })

  return (
    <div className="page">
      <div className="flex items-center justify-between mb-12">
        <h1 className="page-title" style={{ margin: 0 }}>{t('demos')}</h1>
        <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <span className="spinner" /> : t('upload')}
        </button>
        <input ref={fileRef} type="file" accept=".dem" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
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

      {loading ? <div className="text-muted">{t('loading')}</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(d => (
            <div key={d.id} className="card" style={{ cursor: d.status === 'ready' ? 'pointer' : 'default' }}
              onClick={() => d.status === 'ready' && navigate(`/match/${d.id}`)}>
              <div className="flex items-center justify-between wrap gap-8">
                <div>
                  <span style={{ fontWeight: 600 }}>{d.name}</span>
                  <span className="text-muted text-sm" style={{ marginLeft: 10 }}>{fmtSize(d.size)}</span>
                  <span className="tag" style={{ marginLeft: 8, background: 'var(--bg3)', color: 'var(--text2)', fontSize: 10 }}>
                    {d.source === 'inbox' ? 'inbox' : 'upload'}
                  </span>
                </div>
                <div className="flex items-center gap-8">
                  <StatusBadge d={d} />
                  {d.status === 'ready' ? (
                    <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={e => { e.stopPropagation(); navigate(`/match/${d.id}`) }}>
                      {t('view')}
                    </button>
                  ) : (d.status !== 'running') && (
                    <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={e => startAnalyze(d.id, e)}>
                      {t('analyze')}
                    </button>
                  )}
                  {d.source === 'upload' && (
                    <button className="btn-danger" style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={e => deletDemo(d.id, e)}>
                      {t('delete')}
                    </button>
                  )}
                </div>
              </div>
              {d.status === 'ready' && (d.map || d.score?.length) && (
                <div className="flex items-center gap-12" style={{ marginTop: 6, fontSize: 12, color: 'var(--text2)' }}>
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
                  {d.mtime && (
                    <span style={{ marginLeft: 'auto' }}>{fmtDate(d.mtime)}</span>
                  )}
                </div>
              )}
              <ProgressRow d={d} />
            </div>
          ))}
          {rows.length === 0 && <div className="text-muted">{t('noData')}</div>}
        </div>
      )}
    </div>
  )
}
