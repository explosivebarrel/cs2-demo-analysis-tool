import { useEffect, useMemo, useRef, useState } from 'react'
import { AnalysisData, ReplayData, RoundData } from '../../api'
import { findRoundForTick, teamColorAtFrame } from '../../lib/replay'
import { t, getLang } from '../../i18n'

// ── kill diagnosis rules ──────────────────────────────────────────────────────
interface KillContext {
  nearAllyDist?: number | null
  flashDur?: number
  victimVel?: number
  aliveAllies?: number
  aliveEnemies?: number
  victimWalking?: number
}

function diagnosisLines(kc: KillContext, isAttacker: boolean): string[] {
  const lines: string[] = []
  if (!kc) return lines
  if (isAttacker) {
    if (kc.aliveAllies !== undefined && kc.aliveAllies === 0)
      lines.push(t('replay:diagnosis.isolated'))
    else if (kc.nearAllyDist !== undefined && kc.nearAllyDist !== null && kc.nearAllyDist > 800)
      lines.push(t('replay:diagnosis.nearestAlly', { dist: Math.round(kc.nearAllyDist) }))
    if (kc.flashDur !== undefined && kc.flashDur > 1.5)
      lines.push(t('replay:diagnosis.enemyFlashed', { dur: kc.flashDur.toFixed(1) }))
    if (kc.victimWalking)
      lines.push(t('replay:diagnosis.enemyWalking'))
  } else {
    if (kc.flashDur !== undefined && kc.flashDur > 1.5)
      lines.push(t('replay:diagnosis.victimFlashed', { dur: kc.flashDur.toFixed(1) }))
    if (kc.victimVel !== undefined && kc.victimVel > 100)
      lines.push(t('replay:diagnosis.victimSpeed', { speed: Math.round(kc.victimVel) }))
    if (kc.aliveAllies !== undefined && kc.aliveEnemies !== undefined && kc.aliveEnemies > kc.aliveAllies + 1)
      lines.push(t('replay:diagnosis.outnumbered', { enemies: kc.aliveEnemies, allies: kc.aliveAllies }))
  }
  return lines
}

type EventFilter = 'all' | 'kills' | 'bomb' | 'nades'

/** Event log panel for the replay left drawer. */
export default function EventLog({
  replay, analysis, frameIdx, onSeek,
}: {
  replay: ReplayData
  analysis: AnalysisData | null
  frameIdx: number
  onSeek: (tick: number) => void
}) {
  const [filter, setFilter] = useState<EventFilter>('all')
  const [focusPidx, setFocusPidx] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const curTick = replay.ticks[frameIdx] ?? 0

  const curRound = analysis?.rounds ? findRoundForTick(analysis.rounds as RoundData[], curTick) : null
  const roundStart = curRound?.freezeEndTick ?? 0

  const visible = useMemo(() => {
    return replay.events.filter(ev => {
      const e = ev as Record<string, unknown>
      const tick = e.t as number
      if (tick > curTick || tick < roundStart) return false
      const ty = e.ty as string
      if (filter === 'kills') return ty === 'k'
      if (filter === 'bomb') return ['bp', 'bu', 'bo', 'bz', 'bf', 'bx'].includes(ty)
      if (filter === 'nades') return ['sm', 'hd', 'fd', 'fr', 'g'].includes(ty)
      return ['k', 'bp', 'bu', 'bo', 'bz', 'bf', 'bx', 'sm', 'hd', 'fd', 'fr'].includes(ty)
    }).slice(-40)
  }, [replay.events, curTick, roundStart, filter])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [visible.length])

  function fmtTick(tick: number) {
    const sec = Math.max(0, (tick - roundStart)) / replay.tickrate
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }

  const lang = getLang()

  function renderEvent(ev: unknown, idx: number) {
    const e = ev as Record<string, unknown>
    const ty = e.ty as string
    const tick = e.t as number

    if (ty === 'k') {
      const ai = e.a as number, vi = e.v as number
      const attacker = replay.players[ai]?.name ?? '?'
      const victim = replay.players[vi]?.name ?? '?'
      const weapInfo = replay.weapons[e.w as number]
      const weapName = weapInfo ? (lang === 'ru' ? weapInfo.ru : weapInfo.en) : ''
      const hs = !!e.h
      const kc = e.kc as KillContext | undefined
      const aTeam = replay.players[ai]?.team ?? -1
      const diag = kc ? diagnosisLines(kc, true) : []
      const highlighted = focusPidx !== null && (ai === focusPidx || vi === focusPidx)
      const attackerColor = aTeam >= 0 ? teamColorAtFrame(replay, frameIdx, aTeam) : '#fff'
      return (
        <div key={idx}
          style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', background: highlighted ? 'rgba(255,255,255,0.04)' : 'transparent', cursor: 'pointer' }}
          onClick={() => { onSeek(tick); setFocusPidx(focusPidx === ai ? null : ai) }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--text2)', minWidth: 30 }}>{fmtTick(tick)}</span>
            <span style={{ fontSize: 10, background: 'var(--red)', color: '#fff', borderRadius: 3, padding: '1px 5px' }}>{t('replay:eventLog.kill')}{hs ? ` ${t('replay:eventLog.hs')}` : ''}</span>
            <span style={{ fontSize: 12, color: attackerColor, fontWeight: 600 }}>{attacker}</span>
            <span style={{ fontSize: 10, color: 'var(--text2)' }}>→</span>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>{victim}</span>
            <span style={{ fontSize: 10, color: 'var(--text2)', marginLeft: 'auto' }}>{weapName}</span>
          </div>
          {diag.map((d, di) => (
            <div key={di} style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2, paddingLeft: 36 }}>{d}</div>
          ))}
        </div>
      )
    }

    const bombLabels: Record<string, string> = {
      bp: t('replay:bomb.planted'), bu: t('replay:bomb.picked'), bo: t('replay:bomb.dropped'),
      bz: t('replay:bomb.defuseStart'), bf: t('replay:bomb.defused'), bx: t('replay:bomb.exploded'),
    }
    if (bombLabels[ty]) {
      const pidx = e.p as number
      const pname = replay.players[pidx]?.name ?? ''
      return (
        <div key={idx} style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text2)', minWidth: 30 }}>{fmtTick(tick)}</span>
          <span style={{ fontSize: 12 }}>{bombLabels[ty]}{pname ? ` · ${pname}` : ''}</span>
        </div>
      )
    }

    const nadeLabels: Record<string, string> = {
      sm: t('replay:nade.smoke'), hd: t('replay:nade.he'), fd: t('replay:nade.flash'), fr: t('replay:nade.molotov'),
    }
    if (nadeLabels[ty]) {
      const pidx = e.p as number
      const pname = replay.players[pidx]?.name ?? ''
      return (
        <div key={idx} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', opacity: 0.8 }}>
          <span style={{ fontSize: 10, color: 'var(--text2)', minWidth: 30 }}>{fmtTick(tick)}</span>
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>{nadeLabels[ty]}{pname ? ` · ${pname}` : ''}</span>
        </div>
      )
    }

    return null
  }

  const filterBtns: { key: EventFilter; label: string }[] = [
    { key: 'all', label: t('replay:filter.all') },
    { key: 'kills', label: t('replay:filter.kills') },
    { key: 'bomb', label: t('replay:filter.bomb') },
    { key: 'nades', label: t('replay:filter.nades') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        {filterBtns.map(fb => (
          <button key={fb.key}
            className={filter === fb.key ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 11, padding: '3px 8px' }}
            onClick={() => setFilter(fb.key)}
          >{fb.label}</button>
        ))}
        {curRound && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text2)', alignSelf: 'center' }}>
            {t('replay:roundShort')}{curRound.n}
          </span>
        )}
      </div>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {visible.map((ev, i) => renderEvent(ev, i))}
        {visible.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text2)', fontSize: 12, textAlign: 'center' }}>{t('replay:eventLog.empty')}</div>
        )}
      </div>
    </div>
  )
}
