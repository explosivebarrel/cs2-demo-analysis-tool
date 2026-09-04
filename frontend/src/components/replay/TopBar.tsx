import { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../../i18n'

/** Full-width top bar: back button, round switcher (children), UI toggles. */
export default function TopBar({
  backTo, children, onHotkeys, onHideUi, onFullscreen,
}: {
  backTo: string
  children: ReactNode
  onHotkeys: () => void
  onHideUi: () => void
  onFullscreen: () => void
}) {
  const navigate = useNavigate()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap' }}>
      <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 10px', flexShrink: 0 }}
        onClick={() => navigate(backTo)}
        title={t('replay:back')}
      >← {t('replay:back')}</button>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
          title={t('replay:hotkeys')} onClick={onHotkeys}>⌨</button>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
          title={t('replay:hideUi')} onClick={onHideUi}>◲</button>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
          title={t('replay:fullscreen')} onClick={onFullscreen}>⛶</button>
      </div>
    </div>
  )
}
