import { useNavigate, useParams } from 'react-router-dom'
import { DuelEpisode, DuelFrame } from '../../api'

const ERROR_META: Record<string, { ru: string; en: string; color: string; icon: string }> = {
  shift_peek:    { ru: 'Пик на шифте',             en: 'Shift peek',           color: 'var(--accent2)', icon: '🚶' },
  moving_shot:   { ru: 'Движение при стрельбе',    en: 'Moving shot',          color: 'var(--red)',     icon: '🏃' },
  isolated:      { ru: 'Игра в изоляции',          en: 'Playing isolated',     color: 'var(--accent)',  icon: '🔇' },
  flashed:       { ru: 'Вышел на флеше',           en: 'Entered flashed',      color: 'var(--accent2)', icon: '🌟' },
  strong_duel:   { ru: 'Сильная дуэль',            en: 'Strong duel',          color: 'var(--green)',   icon: '💪' },
  overshoot:     { ru: 'Перелёт прицела',          en: 'Aim overshoot',        color: 'var(--red)',     icon: '→' },
  undershoot:    { ru: 'Недолёт прицела',          en: 'Aim undershoot',       color: 'var(--accent2)', icon: '←' },
  missed_first:  { ru: 'Неточный первый выстрел',  en: 'Inaccurate 1st shot',  color: 'var(--accent)',  icon: '✗' },
  passive_angle: { ru: 'Пассивный угол',           en: 'Passive angle',        color: 'var(--text2)',   icon: '⏸' },
  moving:        { ru: 'Движение (жертва)',         en: 'Moving (victim)',      color: 'var(--text2)',   icon: '🏃' },
  outnumbered:   { ru: 'В меньшинстве',            en: 'Outnumbered',          color: 'var(--text2)',   icon: '⚠️' },
}

// Keys to display in input bar, in order
const INPUT_KEYS: { key: keyof DuelFrame; label: string; color: string }[] = [
  { key: 'jump', label: 'Space', color: '#aed581' },
  { key: 'duck', label: 'Ctrl',  color: '#ffb74d' },
  { key: 'walk', label: 'Shift', color: '#ce93d8' },
]

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

function VelocityGraph({ frames, lang }: { frames: DuelFrame[]; lang: 'ru' | 'en' }) {
  if (!frames.length) return null

  const W = 480, H = 72, PAD_L = 28, PAD_R = 8, PAD_T = 6, PAD_B = 18
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  const maxVel = Math.max(200, ...frames.map(f => f.vel))
  const tMin = frames[0].t
  const tMax = frames[frames.length - 1].t
  const tRange = tMax - tMin || 1

  const toX = (t: number) => PAD_L + ((t - tMin) / tRange) * innerW
  const toY = (v: number) => PAD_T + innerH - (v / maxVel) * innerH

  const pts = frames.map(f => `${toX(f.t).toFixed(1)},${toY(f.vel).toFixed(1)}`).join(' ')
  const killX = toX(0)
  const thresh50Y = toY(50)

  // x-axis tick positions
  const tickTs = [tMin, 0, tMax].filter((v, i, a) => a.indexOf(v) === i)

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>
        {lang === 'ru' ? 'Скорость (u/s)' : 'Velocity (u/s)'}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* grid */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="var(--border)" strokeWidth={1} />
        <line x1={PAD_L} y1={PAD_T + innerH} x2={PAD_L + innerW} y2={PAD_T + innerH} stroke="var(--border)" strokeWidth={1} />
        {/* 50 u/s threshold */}
        <line x1={PAD_L} y1={thresh50Y} x2={PAD_L + innerW} y2={thresh50Y}
          stroke="#ffb74d" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
        <text x={PAD_L + innerW + 2} y={thresh50Y + 3} fontSize={8} fill="#ffb74d" opacity={0.8}>50</text>
        {/* kill moment reference */}
        {killX >= PAD_L && killX <= PAD_L + innerW && (
          <line x1={killX} y1={PAD_T} x2={killX} y2={PAD_T + innerH}
            stroke="var(--red)" strokeWidth={1} strokeDasharray="4 2" opacity={0.8} />
        )}
        {/* velocity line */}
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinejoin="round" />
        {/* x axis labels */}
        {tickTs.map(t => (
          <text key={t} x={toX(t)} y={H - 3} fontSize={8} fill="var(--text2)" textAnchor="middle">
            {t > 0 ? `+${t}` : t}ms
          </text>
        ))}
        {/* y axis labels */}
        <text x={PAD_L - 2} y={PAD_T + 4} fontSize={8} fill="var(--text2)" textAnchor="end">{Math.round(maxVel)}</text>
        <text x={PAD_L - 2} y={PAD_T + innerH + 3} fontSize={8} fill="var(--text2)" textAnchor="end">0</text>
      </svg>
    </div>
  )
}

function InputChart({ frames, lang }: { frames: DuelFrame[]; lang: 'ru' | 'en' }) {
  if (!frames.length) return null

  // compute active % per key across all frames
  const total = frames.length
  const stats = INPUT_KEYS.map(({ key, label, color }) => ({
    label,
    color,
    pct: Math.round(frames.filter(f => Boolean(f[key])).length / total * 100),
  }))

  // only show keys with at least 1 active frame
  const active = stats.filter(s => s.pct > 0)
  if (!active.length) return null

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
        {lang === 'ru' ? 'Нажатия клавиш (% времени в окне)' : 'Key presses (% of window)'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {active.map(({ label, color, pct }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 36, textAlign: 'center', fontSize: 11, fontWeight: 700,
              background: 'var(--bg3)', borderRadius: 4, padding: '2px 0',
              color: 'var(--text2)', flexShrink: 0,
            }}>{label}</div>
            <div style={{ flex: 1, height: 14, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
            <div style={{ width: 32, textAlign: 'right', fontSize: 11, color: 'var(--text2)', flexShrink: 0 }}>{pct}%</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function EpisodeDrillDown({ duel, playerNames, lang, onClose }: Props) {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const frames = duel.frames ?? []

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
          background: 'var(--bg2)', borderRadius: 12, width: '100%', maxWidth: 560,
          border: `1px solid ${headerColor}`, overflow: 'hidden',
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
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
              aria-label="Close"
              style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
            >×</button>
          </div>
        </div>

        {/* body */}
        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1 }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
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

          {/* velocity graph + input chart */}
          {frames.length > 0 && (
            <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
              <VelocityGraph frames={frames} lang={lang} />
              <InputChart frames={frames} lang={lang} />
            </div>
          )}

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
