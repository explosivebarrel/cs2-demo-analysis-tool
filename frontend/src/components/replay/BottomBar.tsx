import { ReactNode } from 'react'
import { t } from '../../i18n'
import { SPEEDS } from '../../lib/replay'
import { NadeTrailMode } from './drawFrame'
import NadeDropdown from './NadeDropdown'

/** Full-width bottom bar: playback controls, nade dropdown, speeds + timeline (children). */
export default function BottomBar({
  playing, onPlayPause, onSeekSec, hasMoments, onMoment, time, duration,
  speed, onSpeed, nadeFilter, onToggleNade, trailMode, onTrailMode, children,
}: {
  playing: boolean
  onPlayPause: () => void
  onSeekSec: (delta: number) => void
  hasMoments: boolean
  onMoment: (dir: 1 | -1) => void
  time: string
  duration: string
  speed: number
  onSpeed: (s: number) => void
  nadeFilter: Set<number>
  onToggleNade: (g: number) => void
  trailMode: NadeTrailMode
  onTrailMode: (m: NadeTrailMode) => void
  children: ReactNode
}) {
  return (
    <div className="card" style={{ padding: '10px 12px', flexShrink: 0 }}>
      <div className="flex items-center gap-12" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="btn-primary" style={{ minWidth: 72 }} onClick={onPlayPause}>
          {playing ? t('pause') : t('play')}
        </button>
        <button className="btn-ghost" style={{ minWidth: 40 }} title={t('replay:hotSeek')}
          onClick={() => onSeekSec(-5)}>−5s</button>
        <button className="btn-ghost" style={{ minWidth: 40 }} title={t('replay:hotSeek')}
          onClick={() => onSeekSec(5)}>+5s</button>
        {hasMoments && (
          <>
            <button className="btn-ghost" title={t('replay:moments.prev')} onClick={() => onMoment(-1)}>⏮</button>
            <button className="btn-ghost" title={t('replay:moments.next')} onClick={() => onMoment(1)}>⏭</button>
          </>
        )}
        <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 40 }}>{time}</span>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>/ {duration}</span>
        <div className="flex items-center gap-8" style={{ marginLeft: 'auto', flexWrap: 'wrap' }}>
          <NadeDropdown nadeFilter={nadeFilter} onToggle={onToggleNade} trailMode={trailMode} onTrailMode={onTrailMode} />
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('speed')}</span>
          {SPEEDS.map(s => (
            <button key={s} className={speed === s ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: 12, padding: '3px 8px' }}
              onClick={() => onSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}
