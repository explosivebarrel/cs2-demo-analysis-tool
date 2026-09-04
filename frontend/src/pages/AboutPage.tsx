import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { useLang } from '../App'
import { api, AutoimportStatus } from '../api'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mt-12">
      <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--text2)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</div>
      {children}
    </div>
  )
}

function Formula({ children }: { children: string }) {
  return (
    <pre style={{
      background: 'var(--bg3)', borderRadius: 6, padding: '10px 14px',
      fontSize: 13, fontFamily: 'monospace', color: 'var(--accent2)',
      overflowX: 'auto', margin: '8px 0', whiteSpace: 'pre',
    }}>{children}</pre>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.7, margin: '6px 0' }}>{children}</p>
}

function H({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 700, fontSize: 15, marginTop: 14, marginBottom: 4 }}>{children}</div>
}

function AutoImportSection() {
  const [st, setSt] = useState<AutoimportStatus | null>(null)
  useEffect(() => { api.autoimport().then(setSt).catch(() => {}) }, [])
  const on = <b style={{ color: 'var(--green)' }}>{t('about:aboutAutoOn')}</b>
  const off = <b style={{ color: 'var(--text3)' }}>{t('about:aboutAutoOff')}</b>
  return (
    <Section title={t('about:sections.autoimport')}>
      <P>{t('about:aboutAutoDesc')}</P>
      <P>{t('about:aboutAutoWatch')}</P>
      <P>{t('about:aboutAutoFaceit')}</P>
      <P>{t('about:aboutAutoNote')}</P>
      <H>{t('about:aboutAutoStatus')}</H>
      {st ? (
        <ul style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.8, paddingLeft: 20 }}>
          <li>
            {t('about:aboutAutoWatchLabel')}: {st.watch.enabled ? on : off}
            {st.watch.enabled && (
              <> · {st.watch.dirs.join(', ')} · {t('about:aboutAutoPollSec', { sec: st.watch.pollSec })}</>
            )}
          </li>
          <li>
            FACEIT: {st.faceit.enabled ? on : off}
            {st.faceit.enabled && (
              <> · {st.faceit.playerId} · {t('about:aboutAutoPollSec', { sec: st.faceit.pollSec })}
                {' · '}{t('about:aboutAutoKnown', { count: st.faceit.knownMatches })}</>
            )}
          </li>
        </ul>
      ) : (
        <P>{t('loading')}</P>
      )}
    </Section>
  )
}

export default function AboutPage() {
  useLang()
  return (
    <div className="page">
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{t('aboutTitle')}</div>
      <P>{t('aboutIntro')}</P>

      <Section title={t('about:sections.rating')}>
        <P>{t('aboutRatingDesc')}</P>
        <Formula>{'Rating = 0.0073 × KAST + 0.3591 × KPR − 0.5329 × DPR + 0.2372 × Impact + 0.0032 × ADR + 0.1587'}</Formula>
        <H>{t('aboutRatingComponents')}</H>
        <ul style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.8, paddingLeft: 20 }}>
          <li><b>KPR</b> — {t('aboutRatingKpr')}</li>
          <li><b>DPR</b> — {t('aboutRatingDpr')}</li>
          <li><b>KAST</b> — {t('aboutRatingKast')}</li>
          <li><b>ADR</b> — {t('aboutRatingAdr')}</li>
          <li><b>Impact</b> — 2 × KPR + 0.5 × APR + ImpactMult</li>
        </ul>
        <P>{t('aboutRatingNote')}</P>
      </Section>

      <Section title={t('about:sections.rws')}>
        <P>{t('aboutRwsDesc')}</P>
        <Formula>{'RWS = mean( player_dmg / team_dmg × 100 )  [over won rounds only]'}</Formula>
        <P>{t('aboutRwsNote')}</P>
      </Section>

      <Section title={t('about:sections.kast')}>
        <P>{t('aboutKastDesc')}</P>
        <Formula>{'KAST = (rounds with K or A or S or T) / total_rounds × 100%'}</Formula>
        <P>{t('aboutKastNote')}</P>
      </Section>

      <Section title={t('about:sections.imp')}>
        <P>{t('aboutImpDesc')}</P>
        <H>{t('aboutImpFormula')}</H>
        <Formula>{t('aboutImpFormulaBody')}</Formula>
        <P>{t('aboutImpNote1')}</P>
        <P>{t('aboutImpNote2')}</P>
      </Section>

      <AutoImportSection />
    </div>
  )
}
