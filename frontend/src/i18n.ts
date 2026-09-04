// i18n: i18next bootstrap + backwards-compatible facade.
//
// Dictionaries live in i18n/locales/<lang>/<ns>.json. To add a language:
// copy the en/ folder next to ru/, translate, then extend `resources` and
// the `Lang` type below.
//
// Components keep calling the module-level t(key) / useLang(); keys resolve
// against the namespace files (fallbackNS searches every namespace, so flat
// legacy keys work without a prefix). New code should prefer namespaced
// keys, e.g. t('metrics:reaction.title').
//
// NOTE: t() is not reactive by itself — components must call useLang()
// (even without using its value) to re-render on language switch.
import i18next from 'i18next'

import ruCommon from './i18n/locales/ru/common.json'
import ruDemos from './i18n/locales/ru/demos.json'
import ruMatch from './i18n/locales/ru/match.json'
import ruPlayer from './i18n/locales/ru/player.json'
import ruMetrics from './i18n/locales/ru/metrics.json'
import ruReplay from './i18n/locales/ru/replay.json'
import ruHeatmaps from './i18n/locales/ru/heatmaps.json'
import ruAbout from './i18n/locales/ru/about.json'

import enCommon from './i18n/locales/en/common.json'
import enDemos from './i18n/locales/en/demos.json'
import enMatch from './i18n/locales/en/match.json'
import enPlayer from './i18n/locales/en/player.json'
import enMetrics from './i18n/locales/en/metrics.json'
import enReplay from './i18n/locales/en/replay.json'
import enHeatmaps from './i18n/locales/en/heatmaps.json'
import enAbout from './i18n/locales/en/about.json'

export type Lang = 'ru' | 'en'

const resources = {
  ru: {
    common: ruCommon, demos: ruDemos, match: ruMatch, player: ruPlayer,
    metrics: ruMetrics, replay: ruReplay, heatmaps: ruHeatmaps, about: ruAbout,
  },
  en: {
    common: enCommon, demos: enDemos, match: enMatch, player: enPlayer,
    metrics: enMetrics, replay: enReplay, heatmaps: enHeatmaps, about: enAbout,
  },
}

const saved = localStorage.getItem('lang')
void i18next.init({
  resources,
  lng: saved === 'en' ? 'en' : 'ru',
  fallbackLng: 'ru',
  defaultNS: 'common',
  // legacy flat keys live in common; per-domain keys also resolve without an
  // explicit prefix — t('layerKills') still finds heatmaps:layerKills
  fallbackNS: ['demos', 'match', 'player', 'metrics', 'replay', 'heatmaps', 'about'],
  interpolation: { escapeValue: false },
})

export function getLang(): Lang {
  return i18next.language === 'en' ? 'en' : 'ru'
}

export function setLang(l: Lang) {
  localStorage.setItem('lang', l)
  void i18next.changeLanguage(l)
}

export function t(k: string, args?: Record<string, unknown>): string {
  return i18next.t(k, args ?? {}) ?? k
}

export type TKey = string
