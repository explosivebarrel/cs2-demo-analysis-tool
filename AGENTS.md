# AGENTS.md — инструкции для ИИ-агентов

Проект: **CS2 Demo Analyzer** — self-hosted веб-утилита уровня Leetify/scope.gg для
анализа демок Counter-Strike 2: статистика игроков, aim-метрики, дуэли, хитмапы,
реплей-плеер. Ответы пользователю — по-русски, код/идентификаторы/комментарии — по-английски.

Полное описание проекта: [PROJECT.md](PROJECT.md). Методология метрик (алгоритмы, пороги, упрощения): [METRICS.md](METRICS.md). Заметки прошлых сессий: [memory/](memory/).

## Архитектура (не менять принцип)

Два Docker-сервиса, точка входа `http://localhost:8080`:

- **backend** — Python 3.12, FastAPI + demoparser2, uvicorn :8000 (внутренний).
- **frontend** — React 18 + TS (Vite), раздаётся nginx'ом; nginx проксирует `/api` и `/ws` на backend.

**Хранение — файловое, без БД.** Это осознанное решение: артефакты анализа — gzip-JSON
в `/data/store/analyses/<demo_id>/` (`analysis`, `replay`, `heatmap`, `player_analytics`,
`chat` — все `.json.gz`), статусы — `status.json`. Не предлагать PostgreSQL/Redis/S3 —
использование БД было спроектировано и отвергнуто.

`demo_id = sha1(name:size)[:12]` — дедуп по содержимому; демки из `demo-examples/`
(inbox) read-only, удалять можно только uploads.

`plans/improvement_plan.md` — **исторический план**, НЕ описание реальности. Его стек
(NestJS, PostgreSQL, Redis, Redux Toolkit, i18next, TanStack Query, Tailwind, Recharts,
Leaflet) не установлен и не используется. Не импортировать эти библиотеки и не
ориентироваться на его API-контракты.

## Карта кода

### backend/app/
| Файл | Назначение |
|---|---|
| `main.py` | FastAPI: demos CRUD, probe/analyze/status/analysis/heatmap/replay/chat, player analytics, maps, WS `/ws/demos`; job-manager (лимит параллельных анализов, reaper мёртвых воркеров, startup-зачистка осиротевших parsing-статусов) |
| `worker.py` | CLI-воркер (`python -m app.worker <path> <id> [--probe]`), запускается subprocess'ом из API |
| `ingest.py` | приём демок: распаковка `.zst`/`.gz` (потоковая, с лимитом), demo_id по имени_без_архивного_суффикса:размеру_распакованного → дедуп с plain `.dem`; атомарная запись |
| `autowatch.py` | фоновый автоимпорт: watch-папки (`CS2_WATCH_DIRS`) + FACEIT-поллер (`CS2_FACEIT_API_KEY`/`CS2_FACEIT_PLAYER_ID`); первый скан только запоминает файлы, новые импортирует; колбэк в main.py → probe + авто-анализ |
| `config.py` | пути, константы таймингов (`FRAME_SECONDS` ← `CS2_FRAME_SECONDS`), автоимпорт-env, `BENCHMARKS` (тиры weak/avg/good/elite) |
| `storage.py` | реестр демок, status.json (атомарная запись), пути артефактов |
| `overviews.py` | радары карт с GitHub (MurkyYT/cs2-map-icons), кэш, world→pixel |
| `weapons.py` | канонизация названий оружия (en/ru/class); `canon_key` — ключи совпадают с именами svg в `frontend/public/icons/weapons/` |
| `pipeline/run.py` | оркестратор: собирает все стадии, пишет 5 артефактов |
| `pipeline/context.py` | однократная загрузка демо (events, тики с даунсемплом `config.FRAME_SECONDS` ~0.125 с, гранаты) |
| `pipeline/rounds.py` | сегментация раундов, стороны, победители (эвристика!), закупы, opening kills |
| `pipeline/replayframes.py` | кадры реплея + holds/клатчи/выживание |
| `pipeline/players.py` | K/D/A, урон, трейды, утилити, KAST |
| `pipeline/rating.py` | Rating 2.1 (approx), RWS, IMP |
| `pipeline/playeranalytics.py` | дуэли с тегами ошибок, per-player impact, mapEvents; покадровые эпизоды (позиционная скорость, WASD-вывод, shots), «моменты» с preSec/durSec |
| `pipeline/aim_mechanics.py` | reaction time, TTK, strafe, crosshair placement, reload/overshoot |
| `pipeline/winprob.py` | кривая вероятности победы по кадрам |
| `pipeline/heatmaps.py` | 16 слоёв хитмапов (схемы точек — в докстринге файла) |
| `pipeline/events.py` | лента событий реплея (киллы, гранаты, бомба, shots) |

### frontend/src/
| Файл | Назначение |
|---|---|
| `api.ts` | **единственный источник типов** + fetch-клиент; WS в DemosPage |
| `App.tsx` | роутинг + 2 контекста: `useLang`, `useBenchmarks` |
| `components/WeaponIcon.tsx` | иконка оружия/гранаты/ножа из `public/icons/weapons/*.svg` (resolveKey с алиасами; нет файла → текст). Иконки — Valve-ассеты из [Juknum/counter-strike-icons](https://github.com/Juknum/counter-strike-icons) |
| `i18n.ts` | i18next-инициализация + фасад `t()/getLang()/setLang()`; словари в `i18n/locales/{ru,en}/*.json` по namespace (common/demos/match/player/metrics/replay/heatmaps/about), правила — `i18n/README.md` |
| `pages/DemosPage.tsx` | список/загрузка/статусы демок (WS + fallback-поллинг) |
| `pages/OverviewPage.tsx` | счёт, скорборд, раунды |
| `pages/PlayerPage.tsx` | 6 вкладок игрока (компоненты в `components/player/`) |
| `pages/MetricsPage.tsx` | 21 подстраница aim/duel-метрик (switch по `:key`) |
| `pages/HeatmapsPage.tsx` | canvas-хитмапы, `decodePoint()` послойно |
| `pages/ReplayScreen.tsx` | полноэкранный реплей-плеер: layout TopBar/драверы/MapCanvas/BottomBar, playback, хоткеи, fullscreen; компоненты в `components/replay/` (drawFrame, MapCanvas, RoundSwitcher, WinProbGraph, EventLog, LeftDrawer, RightDrawer, NadeDropdown, HotkeysModal), константы кадров и helpers — `lib/replay.ts` |
| `benchmarkUtils.ts` | тиры метрик из `/api/benchmarks` |

Маршруты: `/`, `/match/:id`, `/match/:id/player/:steamid[/metrics/:key]`,
`/match/:id/heatmaps`, `/match/:id/replay`, `/about`. Реплей — отдельный экран, вход —
кнопка «Реплей» справа в MatchNav (передаёт `state.from` для кнопки «Назад»); вкладка
чата удалена (backend продолжает писать `chat.json.gz`).

## Команды

```bash
# запуск всего (сборка + старт)
docker compose up --build -d

# пересборка после правок бэкенда
docker compose build backend && docker compose up -d backend

# e2e-проверка пайплайна на реальной демке (локальный .venv в корне)
.venv/Scripts/python scripts/test_pipeline.py            # Windows Git Bash, прогон ~60 c

# юнит-тесты и линтер бэка (запуск из backend/)
cd backend && ../.venv/Scripts/python -m pytest -q
cd backend && ../.venv/Scripts/python -m ruff check .

# фронт: dev-сервер
cd frontend && npm install && npm run dev                # проксирует только /api

# проверка типов фронта (линтера фронтового нет)
cd frontend && export PATH="/c/Users/BlackX/AppData/Roaming/fnm/aliases/default:$PATH" && npm.cmd run build
```

**Node в Git Bash не на PATH** (fnm): добавлять в PATH
`/c/Users/BlackX/AppData/Roaming/fnm/aliases/default` и вызывать `npm.cmd`; в
неинтерактивном PowerShell npm недоступен вовсе. В контейнерах — node:20-alpine.

**Codesearch**: индекс в `.codesearch.db` (LMDB+tantivy), CLI `codesearch` доступен в PowerShell
(v1.0.162+1; в Git Bash не на PATH — вызывать `powershell -NoProfile -Command "codesearch ..."`).
MCP-инструменты `mcp__codesearch__*` работают в этой папке и **сами следят за файлами**
(live watching) — новые/изменённые файлы индексируются без ручного запуска. Если MCP отдаёт
«Error opening readonly database» — временный лок LMDB при старте сессии: выполнить любой
CLI-проход (`codesearch stats`) и повторить MCP-вызов. CLI `codesearch index` при живом
MCP падает с «LockBusy» — это норм (write-lock у MCP), ничего делать не нужно.

## Критические инварианты (проверять при любых правках)

1. **Формат кадров реплея (payload v2)**: плоский `number[]`, 13 полей на игрока
   (x,y,z,yaw,hp,armor,alive,weaponId,flags,team,equip,money,ammo) плюс спарсный журнал
   `inv: [[frameIdx, playerIdx, "id,id,..."]]` и таблица `invWeapons`; индекс
   `frameIdx * nPlayers * 13 + playerIdx * 13 + field`. Легаси-payload'ы без `inv` —
   11 полей (фронт различает через `fieldsOf(replay)` в `lib/replay.ts`). Меняешь stride
   на бэке (`replayframes.py`) — синхронно правь `winprob.py` (FIELDS), `heatmaps.py`
   (`frame_pos`) и фронт (`lib/replay.ts` F_*/fieldsOf).
2. **`worldToCanvas` скопирована в 3 файла** (components/replay/drawFrame.ts, HeatmapsPage, PlayerMap) — править
   все три синхронно. Ось Y канваса инвертирована: для направлений (взгляд, трейлеры)
   `dy = -sin(yaw)`, позиция `py = (ov.pos_y - wy) / ov.scale`. См. memory/feedback_canvas_coords.md.
3. **`weapon_fire` не содержит yaw** — джойнить `ctx.ticks` через `merge_asof` (nearest tick),
   steamid с обеих сторон привести к `str`. См. memory/feedback_shot_tracers.md.
4. **Артефакты пишутся с `allow_nan=False`** — один NaN = упавшая запись анализа. Все числа
   из pandas пропускать через гварды (`_f()`: проверка `v == v`).
5. **Победитель раунда — эвристика** (бомб-ивенты + живые): в FACEIT/Valve CS2 демок
   нет события `round_end`. Аналогично MVP = max dmg в раунде у победившей команды.
6. **`config.BENCHMARKS`**: ключи должны совпадать с полями `PlayerMetrics` в api.ts;
   lower-is-better метрики (ttk, reaction) хранятся инвертированно — флаг `higherIsBetter`
   и список `LOWER_IS_BETTER` на фронте (PlayerStrengths.tsx, benchmarkUtils.ts).
7. **IMP-формула дублируется** в `run.py` и `playeranalytics.py` — менять в обоих местах.
8. **i18n — i18next**: ключи в `i18n/locales/{ru,en}/<ns>.json`; наборы ключей ru/en
   обязаны совпадать (проверять при изменениях). `t()` не реактивен — компоненту
   нужен `useLang()`; новые ключи — с namespace (`t('metrics:reaction.title')`),
   плоские легаси-ключи резолвятся через fallbackNS. Как добавить язык — `i18n/README.md`.
   Захардкоженные строки в JSX запрещены — всё через словарь.
9. **Dev-режим фронта**: vite проксирует только `/api`, WS не работает — статусы приходят
   fallback-поллингом раз в 10 с. Это не баг.
10. **Схемы точек хитмапов** — послойные (см. докстринг `heatmaps.py`); фронтовой
    `decodePoint()` в HeatmapsPage должен соответствовать.
11. **Анализ конкурентно ограничен**: `CS2_MAX_CONCURRENT_ANALYZES` (default 1);
    лимит превышен → `POST /analyze` отвечает 429. При старте API все «parsing»/
    «probing»-статусы помечаются error «interrupted by server restart» (воркеров
    уже нет).
12. **Multi-level карты** (nuke/vertigo): `verticalsections` в overview содержит
    и секцию `'default'` (верх — она тоже в словаре!), и `'lower'`. Селекторы
    уровней — через `lowerLevelNames()` из `lib/coords.ts` (исключает 'default');
    фильтр точек по z — `zOnLevel()`; радар нижнего уровня — `radarUrl(map, 'lower')` →
    `GET /api/maps/{map}/radar?level=lower` (fallback на default-радар, если
    отдельной картинки нет).
13. **Letterbox-принцип канвасов** (реплей + хитмапы): канвас занимает блок любого
    размера/аспекта, карта рисуется в центрированный квадрат `base=min(w,h)`;
    `tx.scale=1` ⇔ «гарантированно вмещается» (dblclick/клавиша 0 — сброс),
    `tx.ox/oy` относительны квадрата. Координаты курсора перед рисованием
    конвертируются с учётом центрирующего сдвига (`(w-base)/2`). В `drawFrame`
    это `translate(boxX+tx.ox, boxY+tx.oy)`.
14. **Скорость из позиций, не из props**: `velocity_*` demoparser2 на прореженных
    тиках (даунсемпл) умножены на коэффициент прореживания (на полном тикрейте
    корректны) — скорость в эпизодах дуэлей считается позиционными дельтами
    × tickrate (`playeranalytics._build_duel_frames`, `lib/replay.ts playerSpeedAt`).
    `button_states` в FACEIT-демках недоступен — WASD выводится из вектора
    движения vs yaw (forward=(cos yaw, sin yaw), right=(sin yaw, −cos yaw)).
15. **Иконки оружий**: имена файлов в `frontend/public/icons/weapons/` =
    canon-ключи `weapons.py`; исключения — через ALIAS в `WeaponIcon.tsx`.
    Новые иконки — скриптом `scripts/fetch_weapon_icons.py`.

## Стиль работы

- Код в стиле окружающего; без комментариев-шума; без новых зависимостей без нужды
  (фронт принципиально без UI-библиотек — всё на canvas/DOM).
- Пользователь предпочитает прагматичность, clean architecture, память (memory-keeper)
  и параллельных агентов. Проект публичный, некоммерческий, лицензия MIT.
- Перед завершением значимой задачи: `pytest` + `ruff check` (бэк), `npm run build`
  (фронт), `scripts/test_pipeline.py` для пайплайна; сохранить факты в memory-keeper.
- Координатные функции — только в `lib/coords.ts`; новые тексты UI — только через i18n
  словарь (оба языка).
