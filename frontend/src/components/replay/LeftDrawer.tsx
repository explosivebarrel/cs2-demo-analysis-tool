import { AnalysisData, ReplayData } from '../../api'
import { t } from '../../i18n'
import EventLog from './EventLog'
import MomentsPanel from './MomentsPanel'

export type DrawerTab = 'events' | 'moments'

/** Left drawer: event feed / curated moments tabs. */
export default function LeftDrawer({
  replay, analysis, frameIdx, tab, setTab, onEventSeek, onMomentSeek, width,
}: {
  replay: ReplayData
  analysis: AnalysisData | null
  frameIdx: number
  tab: DrawerTab
  setTab: (t: DrawerTab) => void
  onEventSeek: (tick: number) => void
  onMomentSeek: (tick: number) => void
  width: number
}) {
  const moments = analysis?.moments ?? []
  const tabs: { key: DrawerTab; label: string }[] = [
    { key: 'events', label: t('replay:eventLog.header') },
    { key: 'moments', label: t('replay:moments.title') },
  ]

  return (
    <div style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexShrink: 0 }}>
        {tabs.map(tb => (
          <button key={tb.key}
            className={tab === tb.key ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 11, padding: '3px 10px', flex: 1 }}
            onClick={() => setTab(tb.key)}
          >{tb.label}</button>
        ))}
      </div>
      <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 8px' }}>
        {tab === 'events' ? (
          <EventLog replay={replay} analysis={analysis} frameIdx={frameIdx} onSeek={onEventSeek} />
        ) : moments.length > 0 ? (
          <MomentsPanel moments={moments} replay={replay} onJump={onMomentSeek} />
        ) : (
          <div style={{ padding: 16, color: 'var(--text2)', fontSize: 12, textAlign: 'center' }}>{t('replay:moments.empty')}</div>
        )}
      </div>
    </div>
  )
}
