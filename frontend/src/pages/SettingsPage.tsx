import { useEffect, useState } from 'react'
import { api, Settings, SettingsPatch } from '../api'
import { t } from '../i18n'
import { useLang } from '../App'

const inputStyle = {
  background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '8px 10px', color: 'var(--text)', fontSize: 13, width: '100%',
  boxSizing: 'border-box' as const,
}

const labelStyle = {
  fontSize: 12, color: 'var(--text2)', display: 'block', margin: '10px 0 4px',
}

/** /settings — runtime auto-import configuration (stored in the data volume). */
export default function SettingsPage() {
  useLang()
  const [dirsText, setDirsText] = useState('')
  const [watchPoll, setWatchPoll] = useState(20)
  const [playerId, setPlayerId] = useState('')
  const [faceitPoll, setFaceitPoll] = useState(300)
  const [apiKey, setApiKey] = useState('')
  const [apiKeySet, setApiKeySet] = useState(false)
  const [windowHours, setWindowHours] = useState(12)
  const [progress, setProgress] = useState<Settings['progress']>()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.getSettings().then(s => {
      setDirsText(s.watch.dirs.join('\n'))
      setWatchPoll(s.watch.pollSec)
      setPlayerId(s.faceit.playerId)
      setFaceitPoll(s.faceit.pollSec)
      setApiKeySet(s.faceit.apiKeySet)
      setWindowHours(s.import?.windowHours ?? 12)
      setProgress(s.progress)
    }).catch(e => setErr(e.message))
  }, [])

  async function save() {
    setSaving(true); setErr('')
    const patch: SettingsPatch = {
      watch: {
        dirs: dirsText.split('\n').map(s => s.trim()).filter(Boolean),
        pollSec: Number(watchPoll),
      },
      faceit: {
        playerId,
        pollSec: Number(faceitPoll),
        // empty field = keep the stored key
        apiKey: apiKey === '' ? null : apiKey,
      },
      import: { windowHours: Number(windowHours) },
    }
    try {
      await api.saveSettings(patch)
      const s = await api.getSettings()
      setDirsText(s.watch.dirs.join('\n'))
      setWatchPoll(s.watch.pollSec)
      setPlayerId(s.faceit.playerId)
      setFaceitPoll(s.faceit.pollSec)
      setApiKeySet(s.faceit.apiKeySet)
      setWindowHours(s.import?.windowHours ?? 12)
      setApiKey('')
      setSaved(true)
      setTimeout(() => setSaved(false), 5000)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{t('settings:title')}</div>
      <p style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.6, margin: '6px 0 16px' }}>
        {t('settings:subtitle')}
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{t('settings:watchTitle')}</div>
        <label style={labelStyle}>{t('settings:watchDirs')}</label>
        <textarea
          rows={4} value={dirsText}
          onChange={e => setDirsText(e.target.value)}
          placeholder={'/watch\n/watch2'}
          style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
        />
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{t('settings:watchDirsHint')}</div>
        <label style={labelStyle}>{t('settings:watchPoll')}</label>
        <input type="number" min={5} max={3600} value={watchPoll}
          onChange={e => setWatchPoll(Number(e.target.value))} style={{ ...inputStyle, width: 140 }} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{t('settings:faceitTitle')}</div>
        <label style={labelStyle}>{t('settings:faceitKey')}{apiKeySet && (
          <span style={{ color: 'var(--green)' }}> — {t('settings:faceitKeySaved')}</span>
        )}</label>
        <input type="password" autoComplete="off" value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          style={inputStyle} />
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{t('settings:faceitKeyHint')}</div>
        <label style={labelStyle}>{t('settings:faceitId')}</label>
        <input type="text" value={playerId} onChange={e => setPlayerId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style={{ ...inputStyle, fontFamily: 'monospace' }} />
        <label style={labelStyle}>{t('settings:faceitPoll')}</label>
        <input type="number" min={30} max={86400} value={faceitPoll}
          onChange={e => setFaceitPoll(Number(e.target.value))} style={{ ...inputStyle, width: 140 }} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{t('settings:importTitle')}</div>
        <label style={labelStyle}>{t('settings:importWindow')}</label>
        <select value={windowHours} onChange={e => setWindowHours(Number(e.target.value))}
          style={{ ...inputStyle, width: 140 }}>
          {[1, 2, 8, 12, 24, 48, 72].map(h => (
            <option key={h} value={h}>{t('settings:hours', { n: h })}</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{t('settings:importWindowHint')}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn-primary" disabled={saving} onClick={save}>
          {t('settings:save')}
        </button>
        {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>{t('settings:saved')}</span>}
        {err && <span style={{ color: 'var(--red)', fontSize: 13 }}>{err}</span>}
      </div>

      <p style={{ color: 'var(--text3)', fontSize: 11, marginTop: 14 }}>{t('settings:envNote')}</p>

      {progress && progress.stages.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{t('settings:progressTitle')}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
            {t(`settings:progressSource.${progress.source}`)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {progress.stages.map(st => (
              <div key={st.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ width: 90, flexShrink: 0, color: 'var(--text2)' }}>{st.phase}</span>
                <div style={{ flex: 1, height: 6, background: 'var(--bg3)', borderRadius: 3, position: 'relative' }}>
                  <div style={{
                    position: 'absolute', left: `${st.pct[0]}%`,
                    width: `${Math.max(1, st.pct[1] - st.pct[0])}%`,
                    top: 0, bottom: 0, background: 'var(--accent)', borderRadius: 3, opacity: 0.85,
                  }} />
                </div>
                <span style={{
                  width: 96, flexShrink: 0, textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums', color: 'var(--text2)',
                }}>
                  {st.pct[0]}–{st.pct[1]}% · {st.sec >= 10 ? Math.round(st.sec) : st.sec.toFixed(1)}s
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>{t('settings:progressHint')}</div>
        </div>
      )}
    </div>
  )
}
