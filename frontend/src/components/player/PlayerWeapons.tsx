import { useState } from 'react'
import { WeaponRow } from '../../api'
import { t } from '../../i18n'

const TYPE_LABELS: Record<string, { key: string; color: string }> = {
  rifle:   { key: 'player:weapons.typeRifle',   color: 'var(--accent)' },
  sniper:  { key: 'player:weapons.typeSniper',  color: 'var(--accent2)' },
  smg:     { key: 'player:weapons.typeSmg',     color: '#7ec8e3' },
  heavy:   { key: 'player:weapons.typeHeavy',   color: '#b0a0c8' },
  pistol:  { key: 'player:weapons.typePistol',  color: '#f5c542' },
  grenade: { key: 'player:weapons.typeGrenade', color: '#8bc34a' },
  gear:    { key: 'player:weapons.typeGear',    color: 'var(--text2)' },
  other:   { key: 'player:weapons.typeOther',   color: 'var(--text2)' },
}

function HorizBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .3s' }} />
    </div>
  )
}

interface WeaponRowProps {
  w: WeaponRow
  rank: number
  maxKills: number
  maxAcc: number
  lang: 'ru' | 'en'
}

function WeaponItem({ w, rank, maxKills, maxAcc, lang }: WeaponRowProps) {
  const typeMeta = TYPE_LABELS[w.cls] ?? TYPE_LABELS.other
  const name = lang === 'ru' ? (w.ru || w.en) : w.en

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '28px 1fr 130px 90px 80px 70px',
      gap: 10, padding: '10px 12px',
      borderBottom: '1px solid var(--border)',
      alignItems: 'center',
    }}>
      {/* rank */}
      <div style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'center' }}>#{rank}</div>

      {/* weapon name + type badge */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{name}</div>
        <span style={{
          fontSize: 10, color: typeMeta.color,
          border: `1px solid ${typeMeta.color}`,
          borderRadius: 3, padding: '0 4px',
          display: 'inline-block', marginTop: 2,
        }}>
          {t(typeMeta.key)}
        </span>
      </div>

      {/* enemies / kills */}
      <div>
        <div style={{ fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{w.hits}</span>
          <span style={{ color: 'var(--text2)', fontSize: 11 }}>
            {' '}· {t('player:weapons.killsCount', { count: w.kills })}
          </span>
        </div>
        <HorizBar value={w.kills} max={maxKills} color="var(--accent)" />
      </div>

      {/* accuracy */}
      <div>
        <div style={{ fontSize: 12 }}>
          {w.acc !== null ? (
            <span style={{ fontWeight: 700 }}>{w.acc.toFixed(1)}%</span>
          ) : <span style={{ color: 'var(--text2)' }}>—</span>}
        </div>
        {w.acc !== null && <HorizBar value={w.acc} max={maxAcc > 0 ? maxAcc : 100} color="#4a9eda" />}
      </div>

      {/* HS% */}
      <div style={{ fontSize: 12, fontWeight: 700, color: w.hsPct && w.hsPct > 50 ? 'var(--accent2)' : 'var(--text)' }}>
        {w.hsPct !== null ? w.hsPct.toFixed(1) + '%' : '—'}
      </div>

      {/* damage */}
      <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: w.dmg > 500 ? 700 : 400 }}>
        {w.dmg}
      </div>
    </div>
  )
}

export default function PlayerWeapons({ weapons, lang }: { weapons: WeaponRow[]; lang: 'ru' | 'en' }) {
  const [showAll, setShowAll] = useState(false)
  const INITIAL = 5

  if (!weapons.length) {
    return <div style={{ color: 'var(--text2)', fontSize: 13 }}>{t('player:weapons.noData')}</div>
  }

  const maxKills = Math.max(...weapons.map(w => w.kills), 1)
  const maxAcc   = Math.max(...weapons.map(w => w.acc ?? 0), 1)

  const visible = showAll ? weapons : weapons.slice(0, INITIAL)

  return (
    <div style={{ overflowX: 'auto' }}>
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', minWidth: 520 }}>
      {/* header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '28px 1fr 130px 90px 80px 70px',
        gap: 10, padding: '8px 12px',
        background: 'var(--bg3)',
        fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em',
        borderBottom: '1px solid var(--border)',
      }}>
        <div>#</div>
        <div>{t('player:weapons.colWeapon')}</div>
        <div>{t('player:weapons.colEnemies')}</div>
        <div>{t('player:weapons.colAccuracy')}</div>
        <div>HS %</div>
        <div>{t('player:weapons.colDamage')}</div>
      </div>

      {visible.map((w, i) => (
        <WeaponItem
          key={w.raw}
          w={w}
          rank={i + 1}
          maxKills={maxKills}
          maxAcc={maxAcc}
          lang={lang}
        />
      ))}

      {weapons.length > INITIAL && (
        <button
          onClick={() => setShowAll(v => !v)}
          style={{
            width: '100%', background: 'var(--bg3)', border: 'none',
            color: 'var(--accent)', padding: '10px 0', cursor: 'pointer',
            fontSize: 12, borderTop: '1px solid var(--border)',
          }}
        >
          {showAll
            ? t('player:weapons.showLess')
            : t('player:weapons.showAll', { count: weapons.length - INITIAL })}
        </button>
      )}
    </div>
    </div>
  )
}
