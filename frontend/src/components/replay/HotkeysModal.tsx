import { useEffect } from 'react'
import { t } from '../../i18n'

function hotkeys(): { key: string; desc: string }[] {
  return [
    { key: 'Space', desc: t('replay:hotPause') },
    { key: '← / →', desc: t('replay:hotSeek') },
    { key: ', / .', desc: t('slowDown') + ' / ' + t('replay:speedUp') },
    { key: '[ / ]', desc: t('replay:hotMoments') },
    { key: 'H', desc: t('replay:hotUi') },
    { key: 'F', desc: t('replay:hotFullscreen') },
    { key: '0', desc: t('replay:hotReset') },
    { key: 'Scroll', desc: t('replay:hotZoom') },
    { key: 'Drag', desc: t('replay:hotPan') },
  ]
}

/** Fullscreen-button hotkey legend overlay. */
export default function HotkeysModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div className="card" onClick={e => e.stopPropagation()} style={{ minWidth: 300, maxWidth: 400 }}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>{t('replay:hotkeys')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hotkeys().map(hk => (
            <div key={hk.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
              <kbd style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 8px', fontFamily: 'monospace', fontSize: 11, minWidth: 52, textAlign: 'center' }}>{hk.key}</kbd>
              <span>{hk.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
