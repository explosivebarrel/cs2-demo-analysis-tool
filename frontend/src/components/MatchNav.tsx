import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { PlayerData } from '../api'
import { t } from '../i18n'
import { useLang } from '../App'

interface Props {
  id: string
  players?: PlayerData[]
  currentSteamid?: string
}

export default function MatchNav({ id, players, currentSteamid }: Props) {
  useLang()
  const navigate = useNavigate()
  const base = `/match/${id}`
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const linkStyle = (active: boolean) => ({
    color: active ? 'var(--accent)' : 'var(--text2)',
    fontWeight: active ? 700 : 400,
    textDecoration: 'none',
    fontSize: 13,
  })

  return (
    <div
      className="flex gap-16 items-center"
      style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 20, flexWrap: 'wrap' }}
    >
      <NavLink to={base} end style={({ isActive }) => linkStyle(isActive)}>{t('overview')}</NavLink>
      <NavLink to={`${base}/heatmaps`} style={({ isActive }) => linkStyle(isActive)}>{t('heatmaps')}</NavLink>
      <NavLink to={`${base}/replay`} style={({ isActive }) => linkStyle(isActive)}>{t('replay')}</NavLink>
      <NavLink to={`${base}/chat`} style={({ isActive }) => linkStyle(isActive)}>{t('chat')}</NavLink>

      {players && players.length > 0 && (
        <div ref={ref} style={{ position: 'relative' }}>
          <button
            onClick={() => setOpen(v => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            style={{
              background: 'none',
              border: 'none',
              color: currentSteamid ? 'var(--accent)' : 'var(--text2)',
              fontWeight: currentSteamid ? 700 : 400,
              fontSize: 13,
              lineHeight: 1.5,
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              verticalAlign: 'baseline',
            }}
          >
            {currentSteamid
              ? (players?.find(p => p.steamid === currentSteamid)?.name.slice(0, 32) ?? (t('players') ?? 'Игроки'))
              : (t('players') ?? 'Игроки')}
            <span style={{ fontSize: 10, opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
          </button>

          {open && (
            <div style={{
              position: 'absolute',
              top: '110%',
              left: 0,
              zIndex: 200,
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderRadius: 7,
              boxShadow: '0 4px 16px rgba(0,0,0,.45)',
              minWidth: 180,
              overflow: 'hidden',
            }}>
              {players.map(p => (
                <button
                  key={p.steamid}
                  aria-label={p.name}
                  onClick={() => { setOpen(false); navigate(`/match/${id}/player/${p.steamid}`) }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    color: 'var(--text)',
                    fontSize: 13,
                    padding: '8px 14px',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  {p.clan && (
                    <span style={{ color: 'var(--text2)', fontSize: 11, marginLeft: 6 }}>[{p.clan}]</span>
                  )}
                  <span style={{ float: 'right', color: 'var(--accent)', fontSize: 11, fontWeight: 700 }}>
                    {p.rating.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
