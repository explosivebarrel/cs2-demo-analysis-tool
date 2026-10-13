import React, { useState } from 'react'
import { t } from '../i18n'

interface Props {
  rating: number
  parts?: Record<string, number>
  children?: React.ReactNode
}

export default function RatingTooltip({ rating, parts, children }: Props) {
  const [hover, setHover] = useState(false)

  if (!parts || Object.keys(parts).length === 0) {
    return <>{children ?? <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{rating.toFixed(2)}</span>}</>
  }

  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children ?? (
        <span style={{ fontWeight: 700, color: 'var(--accent)', cursor: 'help', borderBottom: '1px dotted var(--accent)' }}>
          {rating.toFixed(2)}
        </span>
      )}
      {hover && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '8px 12px', fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap',
          zIndex: 400, boxShadow: '0 4px 16px rgba(0,0,0,.6)', pointerEvents: 'none',
          textAlign: 'left', minWidth: 155, lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--accent)', fontSize: 11 }}>
            {t('ratingBreakdown')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--text2)' }}>{t('ratingKill')}:</span>
            <span style={{ fontWeight: 600 }}>{parts.kill != null ? parts.kill.toFixed(2) : '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--text2)' }}>{t('ratingSurvival')}:</span>
            <span style={{ fontWeight: 600 }}>{parts.survival != null ? parts.survival.toFixed(2) : '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--text2)' }}>{t('ratingDamage')}:</span>
            <span style={{ fontWeight: 600 }}>{parts.damage != null ? parts.damage.toFixed(2) : '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--text2)' }}>{t('ratingKast')}:</span>
            <span style={{ fontWeight: 600 }}>{parts.kast != null ? parts.kast.toFixed(2) : '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--text2)' }}>{t('ratingImpact')}:</span>
            <span style={{ fontWeight: 600 }}>{parts.impact != null ? parts.impact.toFixed(2) : '—'}</span>
          </div>
        </div>
      )}
    </span>
  )
}
