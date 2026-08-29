import { useNavigate, useParams } from 'react-router-dom'
import { DuelEpisode } from '../../api'

const ERROR_META: Record<string, { ru: string; en: string; color: string; icon: string }> = {
  shift_peek:  { ru: 'Пик на шифте',         en: 'Shift peek',       color: 'var(--accent2)', icon: '🚶' },
  moving_shot: { ru: 'Движение при стрельбе', en: 'Moving shot',      color: 'var(--red)',     icon: '🏃' },
  isolated:    { ru: 'Игра в изоляции',       en: 'Playing isolated', color: 'var(--accent)',  icon: '🔇' },
  flashed:     { ru: 'Вышел на флеше',        en: 'Entered flashed',  color: 'var(--accent2)', icon: '🌟' },
  strong_duel: { ru: 'Сильная дуэль',         en: 'Strong duel',      color: 'var(--green)',   icon: '💪' },
}

function fmtTime(ts: number): string {
  const m = Math.floor(ts / 60)
  const s = Math.floor(ts % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Props {
  duel: DuelEpisode
  playerNames: Record<string, string>
  lang: 'ru' | 'en'
  onClose: () => void
}

export default function EpisodeDrillDown({ duel, playerNames, lang, onClose }: Props) {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const errMeta = duel.errors.map(e => ERROR_META[e]).filter(Boolean)
  const primaryErr = errMeta[0]
  const attName = playerNames[duel.attacker] ?? duel.attacker.slice(-6)
  const vicName = playerNames[duel.victim] ?? duel.victim.slice(-6)

  const headerColor = duel.won
    ? (primaryErr ? primaryErr.color : 'var(--green)')
    : 'var(--red)'

  const diagLines: string[] = []
  const { context: kc } = duel
  if (duel.won) {
    if (kc.aliveAllies === 0)
      diagLines.push(lang === 'ru' ? 'Играл в полной изоляции — ни одного живого союзника' : 'Played in full isolation — no alive allies')
    else if (kc.nearAllyDist !== null && kc.nearAllyDist > 800)
      diagLines.push(lang === 'ru' ? `Ближайший союзник был в ${Math.round(kc.nearAllyDist)}u` : `Nearest ally was ${Math.round(kc.nearAllyDist)}u away`)
    if (kc.flashDur > 1.5)
      diagLines.push(lang === 'ru' ? `Враг был заблеспан ${kc.flashDur.toFixed(1)}с` : `Enemy was flashed ${kc.flashDur.toFixed(1)}s`)
    if (kc.attackerVel > 50)
      diagLines.push(lang === 'ru' ? `Стрелял в движении — ${Math.round(kc.attackerVel)}u/s` : `Shot while moving — ${Math.round(kc.attackerVel)}u/s`)
    if (kc.attackerWalking)
      diagLines.push(lang === 'ru' ? 'Выходил на шифте' : 'Peeked while shift-walking')
  } else {
    if (kc.flashDur > 1.5)
      diagLines.push(lang === 'ru' ? `Был заблеспан ${kc.flashDur.toFixed(1)}с в момент смерти` : `Was flashed ${kc.flashDur.toFixed(1)}s at death`)
    if (kc.attackerVel > 100)
      diagLines.push(lang === 'ru' ? `Атакующий двигался — ${Math.round(kc.attackerVel)}u/s` : `Attacker was moving — ${Math.round(kc.attackerVel)}u/s`)
  }

  function goToRound() {
    if (id) navigate(`/match/${id}/replay?round=${duel.round}`)
  }

  return (
    /* backdrop */
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      {/* modal panel */}
      <div
        style={{
          background: 'var(--bg2)', borderRadius: 12, width: '100%', maxWidth: 500,
          border: `1px solid ${headerColor}`, overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div style={{ background: 'var(--bg3)', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>{primaryErr?.icon ?? (duel.won ? '✅' : '❌')}</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: headerColor }}>
                  {primaryErr
                    ? (lang === 'ru' ? primaryErr.ru : primaryErr.en)
                    : (duel.won
                      ? (lang === 'ru' ? 'Дуэль выиграна' : 'Duel won')
                      : (lang === 'ru' ? 'Дуэль проиграна' : 'Duel lost'))}
                </div>
                {diagLines[0] && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{diagLines[0]}</div>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
            >×</button>
          </div>
        </div>

        {/* body */}
        <div style={{ padding: '16px 18px' }}>
          {/* participants */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, fontSize: 13 }}>
            <span style={{ fontWeight: 700, color: duel.won ? 'var(--green)' : 'var(--red)' }}>
              {attName}
            </span>
            <span style={{ fontSize: 16 }}>→</span>
            <span style={{ color: 'var(--text2)' }}>{vicName}</span>
            {duel.headshot && (
              <span style={{ fontSize: 10, background: 'var(--accent2)', color: '#fff', borderRadius: 3, padding: '2px 6px', fontWeight: 700 }}>HS</span>
            )}
            <span style={{ marginLeft: 'auto', color: 'var(--text2)', fontSize: 12 }}>{duel.weapon}</span>
          </div>

          {/* meta strip */}
          <div style={{
            display: 'flex', gap: 16, padding: '10px 14px',
            background: 'var(--bg3)', borderRadius: 8, marginBottom: 14, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--text2)' }}>{lang === 'ru' ? 'Раунд' : 'Round'} </span>
              <span style={{ fontWeight: 700 }}>R{duel.round}</span>
            </div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--text2)' }}>{lang === 'ru' ? 'Время' : 'Time'} </span>
              <span style={{ fontWeight: 700 }}>{fmtTime(duel.timestamp)}</span>
            </div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--text2)' }}>{lang === 'ru' ? 'Итог' : 'Result'} </span>
              <span style={{ fontWeight: 700, color: duel.won ? 'var(--green)' : 'var(--red)' }}>
                {duel.won ? (lang === 'ru' ? 'Победа' : 'Win') : (lang === 'ru' ? 'Поражение' : 'Loss')}
              </span>
            </div>
          </div>

          {/* context grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              { label: lang === 'ru' ? 'Скор. атак.' : 'Atk vel.', value: `${kc.attackerVel} u/s`, warn: kc.attackerVel > 50 },
              { label: lang === 'ru' ? 'Скор. жертвы' : 'Vic vel.', value: `${kc.victimVel} u/s` },
              { label: lang === 'ru' ? 'Флеш (жертва)' : 'Flash (victim)', value: `${kc.flashDur.toFixed(2)}s`, warn: kc.flashDur > 1.5 },
              { label: lang === 'ru' ? 'До союзника' : 'Nearest ally',
                value: kc.nearAllyDist != null ? `${Math.round(kc.nearAllyDist)}u` : '—',
                warn: kc.nearAllyDist !== null && kc.nearAllyDist > 800 },
              { label: lang === 'ru' ? 'Союзников' : 'Allies alive', value: String(kc.aliveAllies), warn: kc.aliveAllies === 0 },
              { label: lang === 'ru' ? 'Врагов' : 'Enemies alive', value: String(kc.aliveEnemies) },
            ].map(({ label, value, warn }) => (
              <div key={label} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
                <div style={{ fontWeight: 700, color: warn ? 'var(--red)' : 'var(--text)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* error badges */}
          {errMeta.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {errMeta.map(m => (
                <span key={m.ru} style={{
                  background: 'var(--bg3)', border: `1px solid ${m.color}`,
                  color: m.color, borderRadius: 4, padding: '3px 10px', fontSize: 12,
                }}>
                  {m.icon} {lang === 'ru' ? m.ru : m.en}
                </span>
              ))}
            </div>
          )}

          {/* extra diag lines */}
          {diagLines.slice(1).map((d, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 4 }}>⚠ {d}</div>
          ))}

          {/* go to round */}
          <button
            onClick={goToRound}
            style={{
              marginTop: 8, width: '100%',
              background: 'var(--bg3)', border: '1px solid var(--border)',
              color: 'var(--text)', borderRadius: 6, padding: '9px 0',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            {lang === 'ru' ? `→ Смотреть раунд R${duel.round} в реплее` : `→ Watch R${duel.round} in replay`}
          </button>
        </div>
      </div>
    </div>
  )
}
