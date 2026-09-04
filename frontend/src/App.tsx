import { useState, useEffect, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { getLang, setLang, Lang, t } from './i18n'
import { api, Benchmarks } from './api'
import DemosPage from './pages/DemosPage'
import OverviewPage from './pages/OverviewPage'
import PlayerPage from './pages/PlayerPage'
import MetricsPage from './pages/MetricsPage'
import HeatmapsPage from './pages/HeatmapsPage'
import ReplayScreen from './pages/ReplayScreen'
import AboutPage from './pages/AboutPage'

export const LangCtx = createContext<{ lang: Lang; toggle: () => void }>({
  lang: 'ru', toggle: () => {},
})
export function useLang() { return useContext(LangCtx) }

export const BenchmarksCtx = createContext<Benchmarks>({})
export function useBenchmarks() { return useContext(BenchmarksCtx) }

function AppNav() {
  const { lang, toggle } = useLang()
  return (
    <nav style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 24, height: 48 }}>
      <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--accent)', letterSpacing: '.05em' }}>CS2·ANA</span>
      <NavLink to="/" end style={navStyle}>{t('demos')}</NavLink>
      <NavLink to="/about" style={navStyle}>{t('about')}</NavLink>
      <div style={{ marginLeft: 'auto' }}>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={toggle}>
          {lang === 'ru' ? 'EN' : 'RU'}
        </button>
      </div>
    </nav>
  )
}

// fixed-height screens (viewport-fit, not scrollable) don't get the footer
const FOOTER_HIDDEN = [/\/replay$/, /\/heatmaps$/]

function Footer() {
  const loc = useLocation()
  if (FOOTER_HIDDEN.some(re => re.test(loc.pathname))) return null
  return (
    <footer style={{
      borderTop: '1px solid var(--border)', padding: '14px 20px', flexShrink: 0,
      fontSize: 11, color: 'var(--text2)', textAlign: 'center',
    }}>
      {t('footer.note')}
    </footer>
  )
}

export default function App() {
  const [lang, setL] = useState<Lang>(getLang())
  const toggle = () => { const nl = lang === 'ru' ? 'en' : 'ru'; setLang(nl); setL(nl) }
  const [benchmarks, setBenchmarks] = useState<Benchmarks>({})

  useEffect(() => {
    api.benchmarks().then(setBenchmarks).catch(() => {})
  }, [])

  return (
    <LangCtx.Provider value={{ lang, toggle }}>
      <BenchmarksCtx.Provider value={benchmarks}>
        <BrowserRouter>
          <AppNav />
          <div style={{ minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1 }}>
              <Routes>
                <Route path="/" element={<DemosPage />} />
                <Route path="/match/:id" element={<OverviewPage />} />
                <Route path="/match/:id/player/:steamid" element={<PlayerPage />} />
                <Route path="/match/:id/player/:steamid/metrics/:key" element={<MetricsPage />} />
                <Route path="/match/:id/heatmaps" element={<HeatmapsPage />} />
                <Route path="/match/:id/replay" element={<ReplayScreen />} />
                <Route path="/about" element={<AboutPage />} />
              </Routes>
            </div>
            <Footer />
          </div>
        </BrowserRouter>
      </BenchmarksCtx.Provider>
    </LangCtx.Provider>
  )
}

function navStyle({ isActive }: { isActive: boolean }) {
  return {
    color: isActive ? 'var(--accent)' : 'var(--text2)',
    fontWeight: isActive ? 700 : 400,
    fontSize: 14,
    textDecoration: 'none',
  }
}
