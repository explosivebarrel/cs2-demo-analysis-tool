import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { api, ChatMessage, AnalysisData } from '../api'
import { useLang } from '../App'
import { t } from '../i18n'
import MatchNav from '../components/MatchNav'

// ─── helpers ────────────────────────────────────────────────────────────────

function teamColor(team: number) {
  return team === 0 ? 'var(--accent2)' : '#4db8ff'
}

function MessageRow({ msg, players, lang }: {
  msg: ChatMessage
  players: AnalysisData['players']
  lang: 'ru' | 'en'
}) {
  const player = players.find(p => p.steamid === msg.steamid)
  const color = player ? teamColor(player.team) : 'var(--text2)'
  const ru = lang === 'ru'

  return (
    <div style={{
      display: 'flex',
      gap: 10,
      padding: '7px 0',
      borderBottom: '1px solid var(--border)',
      alignItems: 'flex-start',
    }}>
      {/* round badge */}
      <div style={{
        minWidth: 36,
        fontSize: 11,
        color: 'var(--text2)',
        paddingTop: 2,
        flexShrink: 0,
        textAlign: 'right',
      }}>
        {msg.round != null ? `R${msg.round}` : '—'}
      </div>

      {/* sender */}
      <div style={{
        minWidth: 120,
        maxWidth: 140,
        fontSize: 12,
        fontWeight: 700,
        color,
        flexShrink: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        paddingTop: 2,
      }}>
        {msg.name}
      </div>

      {/* message */}
      <div style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-word' }}>
        {msg.text}
      </div>
    </div>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const { lang } = useLang()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [players, setPlayers] = useState<AnalysisData['players']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [roundFilter, setRoundFilter] = useState<number | 'all'>('all')
  const [playerFilter, setPlayerFilter] = useState<string | 'all'>('all')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([api.chat(id), api.analysis(id)])
      .then(([msgs, analysis]) => {
        setMessages(msgs)
        setPlayers(analysis.players)
        setLoading(false)
      })
      .catch(e => {
        setError(String(e))
        setLoading(false)
      })
  }, [id])

  const rounds = Array.from(
    new Set(messages.map(m => m.round).filter((r): r is number => r != null))
  ).sort((a, b) => a - b)

  const senders = Array.from(
    new Set(messages.map(m => m.steamid))
  )

  const filtered = messages.filter(m => {
    if (roundFilter !== 'all' && m.round !== roundFilter) return false
    if (playerFilter !== 'all' && m.steamid !== playerFilter) return false
    return true
  })

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div className="skeleton" style={{ height: 36, margin: '0 0 20px', borderRadius: 8 }} />
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div className="skeleton" style={{ width: 120, height: 28, borderRadius: 6 }} />
          <div className="skeleton" style={{ width: 160, height: 28, borderRadius: 6 }} />
        </div>
        <div className="skeleton" style={{ borderRadius: 10, height: 480 }} />
      </div>
    </div>
  )
  if (error) return (
    <div style={{ padding: 32, color: 'var(--danger)' }}>{error}</div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <MatchNav id={id!} />

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>
        {/* filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('chatFilterRound')}:</span>
          <select
            value={roundFilter === 'all' ? 'all' : String(roundFilter)}
            onChange={e => setRoundFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            style={{
              background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '4px 8px', fontSize: 12,
            }}
          >
            <option value="all">{t('chatAllRounds')}</option>
            {rounds.map(r => (
              <option key={r} value={r}>{t('chatRound')} {r}</option>
            ))}
          </select>

          <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 8 }}>{t('chatFilterPlayer')}:</span>
          <select
            value={playerFilter}
            onChange={e => setPlayerFilter(e.target.value)}
            style={{
              background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '4px 8px', fontSize: 12,
            }}
          >
            <option value="all">{t('chatAllPlayers')}</option>
            {senders.map(sid => {
              const p = players.find(pl => pl.steamid === sid)
              return <option key={sid} value={sid}>{p?.name ?? sid}</option>
            })}
          </select>

          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text2)' }}>
            {filtered.length} / {messages.length}
          </span>
        </div>

        {/* message list */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text2)', padding: '48px 0', fontSize: 14 }}>
            {t('chatNoMessages')}
          </div>
        ) : (
          <div style={{
            background: 'var(--card)',
            borderRadius: 10,
            border: '1px solid var(--border)',
            padding: '0 16px',
          }}>
            {filtered.map((msg, i) => (
              <MessageRow key={i} msg={msg} players={players} lang={lang} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
