import { useState } from 'react'

// CS2 equipment SVGs (game files via Juknum/counter-strike-icons) live in
// /icons/weapons/<canon-key>.svg; file names mostly match weapons.py canon keys.
const ALIAS: Record<string, string> = {
  m4a4: 'm4a1',            // no dedicated M4A4 icon in the game files
  glock18: 'glock',
  usp: 'usp_silencer',
  usp_s: 'usp_silencer',
  p2000: 'hkp2000',
  molotov_fire: 'molotov',
  knife_default: 'knife',
  elite_knife: 'elite',
  dual_berettas: 'elite',
  kevlar_helmet: 'armor_helmet',
}

// display name → icon key, for places that only have the localized label
const LABEL_KEY: Record<string, string> = {
  'AK-47': 'ak47', 'M4A4': 'm4a1', 'M4A1': 'm4a1', 'M4A1-S': 'm4a1_silencer',
  'Galil AR': 'galilar', FAMAS: 'famas', 'SG 553': 'sg556', AUG: 'aug',
  AWP: 'awp', 'SSG 08': 'ssg08', 'SCAR-20': 'scar20', G3SG1: 'g3sg1',
  MP9: 'mp9', 'MAC-10': 'mac10', MP7: 'mp7', 'UMP-45': 'ump45', P90: 'p90',
  'PP-Bizon': 'bizon', 'MP5-SD': 'mp5sd',
  Nova: 'nova', XM1014: 'xm1014', 'MAG-7': 'mag7', M249: 'm249', Negev: 'negev',
  'Sawed-Off': 'sawedoff',
  'Glock-18': 'glock', 'USP-S': 'usp_silencer', P2000: 'hkp2000', P250: 'p250',
  'Five-SeveN': 'fiveseven', 'CZ75-Auto': 'cz75a', 'Tec-9': 'tec9',
  'Desert Eagle': 'deagle', 'R8 Revolver': 'revolver', 'Dual Berettas': 'elite',
  Flashbang: 'flashbang', Smoke: 'smokegrenade', 'Smoke Grenade': 'smokegrenade',
  'HE Grenade': 'hegrenade', Molotov: 'molotov', Incendiary: 'incgrenade',
  Decoy: 'decoy', Fire: 'inferno', 'Zeus x27': 'taser', 'Medi-Shot': 'healthshot',
  Knife: 'knife', Bayonet: 'bayonet', C4: 'c4',
  Kevlar: 'kevlar', 'Kevlar+Helmet': 'armor_helmet', 'Defuse Kit': 'defuser',
}

function resolveKey(id?: string | null, name?: string | null): string | null {
  if (id) return ALIAS[id] ?? id
  if (name) return LABEL_KEY[name] ?? null
  return null
}

/** Weapon/equipment icon by canon key or display name; falls back to the label text. */
export default function WeaponIcon({ id, name, size = 16, withLabel = false }: {
  id?: string | null
  name?: string | null
  size?: number
  withLabel?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const key = resolveKey(id, name)
  if (!key || failed) {
    return withLabel && name
      ? <span style={{ fontSize: size - 4, color: 'var(--text2)' }}>{name}</span>
      : null
  }
  return (
    <img src={`/icons/weapons/${key}.svg`} alt={name ?? key} title={name ?? key}
      width={size} height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle' }} />
  )
}
