import { useNavigate, useParams } from 'react-router-dom'
import { DuelEpisode, DuelFrame } from '../../api'
import { t } from '../../i18n'

const ERROR_META: Record<string, { key: string; color: string; icon: string }> = {
  shift_peek:    { key: 'player:duels.errorShiftPeek',   color: 'var(--accent2)', icon: '🚶' },
  moving_shot:   { key: 'player:duels.errorMovingShot',  color: 'var(--red)',     icon: '🏃' },
  isolated:      { key: 'player:duels.errorIsolated',    color: 'var(--accent)',  icon: '🔇' },
  flashed:       { key: 'player:duels.errorFlashed',     color: 'var(--accent2)', icon: '🌟' },
  strong_duel:   { key: 'player:duels.errorStrongDuel',  color: 'var(--green)',   icon: '💪' },
  overshoot:     { key: 'player:duels.errorOvershoot',   color: 'var(--red)',     icon: '→' },
  undershoot:    { key: 'player:duels.errorUndershoot',  color: 'var(--accent2)', icon: '←' },
  missed_first:  { key: 'player:duels.errorMissedFirst', color: 'var(--accent)',  icon: '✗' },
  passive_angle: { key: 'player:duels.errorPassiveAngle', color: 'var(--text2)',  icon: '⏸' },
  moving:        { key: 'player:duels.errorMoving',      color: 'var(--text2)',   icon: '🏃' },
  outnumbered:   { key: 'player:duels.errorOutnumbered', color: 'var(--text2)',   icon: '⚠️' },
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
  lang?: 'ru' | 'en'
  onClose: () => void
}

function VelocityGraph({ frames }: { frames: DuelFrame[] }) {
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
        {t('player:drilldown.velocityTitle')}
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

function InputChart({ frames }: { frames: DuelFrame[] }) {
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
        {t('player:drilldown.keyPresses')}
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

export default function EpisodeDrillDown({ duel, playerNames, onClose }: Props) {
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
      diagLines.push(t('player:drilldown.diagFullIsolation'))
    else if (kc.nearAllyDist !== null && kc.nearAllyDist > 800)
      diagLines.push(t('player:drilldown.diagNearestAlly', { dist: Math.round(kc.nearAllyDist) }))
    if (kc.flashDur > 1.5)
      diagLines.push(t('player:drilldown.diagEnemyFlashed', { dur: kc.flashDur.toFixed(1) }))
    if (kc.attackerVel > 50)
      diagLines.push(t('player:drilldown.diagShootingMoving', { vel: Math.round(kc.attackerVel) }))
    if (kc.attackerWalking)
      diagLines.push(t('player:drilldown.diagShiftPeek'))
  } else {
    if (kc.flashDur > 1.5)
      diagLines.push(t('player:drilldown.diagVictimFlashed', { dur: kc.flashDur.toFixed(1) }))
    if (kc.attackerVel > 100)
      diagLines.push(t('player:drilldown.diagAttackerMoving', { vel: Math.round(kc.attackerVel) }))
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
                    ? t(primaryErr.key)
                    : (duel.won
                      ? t('player:drilldown.duelWon')
                      : t('player:drilldown.duelLost'))}
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
              <span style={{ color: 'var(--text2)' }}>{t('player:drilldown.roundLabel')} </span>
              <span style={{ fontWeight: 700 }}>R{duel.round}</span>
            </div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--text2)' }}>{t('player:drilldown.timeLabel')} </span>
              <span style={{ fontWeight: 700 }}>{fmtTime(duel.timestamp)}</span>
            </div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--text2)' }}>{t('player:drilldown.resultLabel')} </span>
              <span style={{ fontWeight: 700, color: duel.won ? 'var(--green)' : 'var(--red)' }}>
                {duel.won ? t('player:drilldown.resultWin') : t('player:drilldown.resultLoss')}
              </span>
            </div>
          </div>

          {/* context grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
            {[
              { label: t('player:drilldown.atkVel'), value: `${kc.attackerVel} u/s`, warn: kc.attackerVel > 50 },
              { label: t('player:drilldown.vicVel'), value: `${kc.victimVel} u/s` },
              { label: t('player:drilldown.flashVictim'), value: `${kc.flashDur.toFixed(2)}s`, warn: kc.flashDur > 1.5 },
              { label: t('player:drilldown.nearestAlly'),
                value: kc.nearAllyDist != null ? `${Math.round(kc.nearAllyDist)}u` : '—',
                warn: kc.nearAllyDist !== null && kc.nearAllyDist > 800 },
              { label: t('player:drilldown.alliesAlive'), value: String(kc.aliveAllies), warn: kc.aliveAllies === 0 },
              { label: t('player:drilldown.enemiesAlive'), value: String(kc.aliveEnemies) },
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
              <VelocityGraph frames={frames} />
              <InputChart frames={frames} />
            </div>
          )}

          {/* error badges */}
          {errMeta.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {errMeta.map(m => (
                <span key={m.key} style={{
                  background: 'var(--bg3)', border: `1px solid ${m.color}`,
                  color: m.color, borderRadius: 4, padding: '3px 10px', fontSize: 12,
                }}>
                  {m.icon} {t(m.key)}
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
            {t('player:drilldown.watchRound', { round: duel.round })}
          </button>
        </div>
      </div>
    </div>
  )
}
