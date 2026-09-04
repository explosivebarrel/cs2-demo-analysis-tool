import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { NadeTrailMode } from './drawFrame'

// grenade type ids as in replay events ty:"g": 0 smoke, 1 HE, 2 flash, 3 fire, 4 decoy
const NADE_TYPES = [0, 1, 2, 3, 4]

function label(g: number): string {
  return [t('replay:nade.smoke'), t('replay:nade.he'), t('replay:nade.flash'),
          t('replay:nade.molotov'), t('replay:nade.decoy')][g] ?? String(g)
}

/** Dropdown with per-grenade-type visibility checkboxes + trail/path mode. */
export default function NadeDropdown({
  nadeFilter, onToggle, trailMode, onTrailMode,
}: {
  nadeFilter: Set<number>
  onToggle: (g: number) => void
  trailMode: NadeTrailMode
  onTrailMode: (m: NadeTrailMode) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn-ghost"
        style={{ fontSize: 11, padding: '3px 8px' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        💣 {t('replay:nadesTitle')} <span style={{ fontSize: 10, opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 300,
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7,
          boxShadow: '0 4px 16px rgba(0,0,0,.45)', minWidth: 170, padding: '4px 0',
        }}>
          {NADE_TYPES.map(g => {
            const on = !nadeFilter.has(g)
            return (
              <label key={g} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                cursor: 'pointer', fontSize: 12,
              }}>
                <input type="checkbox" checked={on} onChange={() => onToggle(g)} />
                <span style={{ opacity: on ? 1 : 0.45 }}>{label(g)}</span>
              </label>
            )
          })}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, padding: '6px 12px', display: 'flex', gap: 6 }}>
            <button
              className={trailMode === 'trail' ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: 10, padding: '2px 8px' }}
              title={t('replay:trail.tailTip')}
              onClick={() => onTrailMode('trail')}
            >{t('replay:trail.tail')}</button>
            <button
              className={trailMode === 'path' ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: 10, padding: '2px 8px' }}
              title={t('replay:trail.pathTip')}
              onClick={() => onTrailMode('path')}
            >{t('replay:trail.path')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
