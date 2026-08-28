import { t } from '../i18n'
import { useLang } from '../App'

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

export default function AboutPage() {
  useLang()
  return (
    <div className="page">
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{t('aboutTitle')}</div>
      <P>{t('aboutIntro')}</P>

      <Section title="Rating 2.0">
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

      <Section title="RWS (Round Win Share)">
        <P>{t('aboutRwsDesc')}</P>
        <Formula>{'RWS = mean( player_dmg / team_dmg × 100 )  [over won rounds only]'}</Formula>
        <P>{t('aboutRwsNote')}</P>
      </Section>

      <Section title="KAST">
        <P>{t('aboutKastDesc')}</P>
        <Formula>{'KAST = (rounds with K or A or S or T) / total_rounds × 100%'}</Formula>
        <P>{t('aboutKastNote')}</P>
      </Section>

      <Section title="IMP (Impact)">
        <P>{t('aboutImpDesc')}</P>
        <H>{t('aboutImpFormula')}</H>
        <Formula>{t('aboutImpFormulaBody')}</Formula>
        <P>{t('aboutImpNote1')}</P>
        <P>{t('aboutImpNote2')}</P>
      </Section>
    </div>
  )
}
