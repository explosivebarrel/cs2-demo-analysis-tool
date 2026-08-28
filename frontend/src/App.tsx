import { useState, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { getLang, setLang, Lang, t } from './i18n'
import DemosPage from './pages/DemosPage'
import OverviewPage from './pages/OverviewPage'
import PlayerPage from './pages/PlayerPage'
import HeatmapsPage from './pages/HeatmapsPage'
import ReplayPage from './pages/ReplayPage'

export const LangCtx = createContext<{ lang: Lang; toggle: () => void }>({
  lang: 'ru', toggle: () => {},
})
export function useLang() { return useContext(LangCtx) }

function AppNav() {
  const { lang, toggle } = useLang()
  return (
    <nav style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 24, height: 48 }}>
      <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--accent)', letterSpacing: '.05em' }}>CS2·ANA</span>
      <NavLink to="/" end style={navStyle}>{t('demos')}</NavLink>
      <div style={{ marginLeft: 'auto' }}>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={toggle}>
          {lang === 'ru' ? 'EN' : 'RU'}
        </button>
      </div>
    </nav>
  )
}

export default function App() {
  const [lang, setL] = useState<Lang>(getLang())
  const toggle = () => { const nl = lang === 'ru' ? 'en' : 'ru'; setLang(nl); setL(nl) }

  return (
    <LangCtx.Provider value={{ lang, toggle }}>
      <BrowserRouter>
        <AppNav />
        <Routes>
          <Route path="/" element={<DemosPage />} />
          <Route path="/match/:id" element={<OverviewPage />} />
          <Route path="/match/:id/player/:steamid" element={<PlayerPage />} />
          <Route path="/match/:id/heatmaps" element={<HeatmapsPage />} />
          <Route path="/match/:id/replay" element={<ReplayPage />} />
        </Routes>
      </BrowserRouter>
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
