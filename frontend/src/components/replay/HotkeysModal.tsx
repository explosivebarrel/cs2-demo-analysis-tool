import { useEffect, useState } from 'react'
import { t } from '../../i18n'

function hotkeys(is3d: boolean): { key: string; desc: string }[] {
  const common = [
    { key: 'Space', desc: t('replay:hotPause') },
    { key: '← / →', desc: t('replay:hotSeek') },
    { key: ', / .', desc: t('slowDown') + ' / ' + t('replay:speedUp') },
    { key: '[ / ]', desc: t('replay:hotMoments') },
    { key: 'H', desc: t('replay:hotUi') },
    { key: 'F', desc: t('replay:hotFullscreen') },
    { key: '3', desc: t('replay:view3dHotkey') },
  ]
  if (is3d) {
    return [
      ...common,
      { key: 'Drag', desc: t('replay:hotOrbit') },
      { key: 'Shift+Drag / RMB', desc: t('replay:hotPan3d') },
      { key: 'Scroll', desc: t('replay:hotZoom') },
      { key: '2× click / 0', desc: t('replay:hotReset3d') },
    ]
  }
  return [
    ...common,
    { key: 'Scroll', desc: t('replay:hotZoom') },
    { key: 'Drag', desc: t('replay:hotPan') },
    { key: '2× click / 0', desc: t('replay:hotReset') },
  ]
}

/** Fullscreen-button hotkey legend overlay. */
export default function HotkeysModal({ onClose, initialMode = '2d' }: { onClose: () => void; initialMode?: '2d' | '3d' }) {
  const [mode, setMode] = useState<'2d' | '3d'>(initialMode)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabStyle = (active: boolean) => ({
    background: active ? 'var(--accent)' : 'var(--bg3)',
    color: active ? '#fff' : 'var(--text2)',
    border: 'none',
    borderRadius: 4,
    padding: '3px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
  })

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div className="card" onClick={e => e.stopPropagation()} style={{ minWidth: 320, maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{t('replay:hotkeys')}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setMode('2d')} style={tabStyle(mode === '2d')}>2D</button>
            <button onClick={() => setMode('3d')} style={tabStyle(mode === '3d')}>3D</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hotkeys(mode === '3d').map(hk => (
            <div key={hk.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
              <kbd style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 8px', fontFamily: 'monospace', fontSize: 11, minWidth: 64, textAlign: 'center' }}>{hk.key}</kbd>
              <span>{hk.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
