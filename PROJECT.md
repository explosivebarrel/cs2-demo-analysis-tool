# CS2 Demo Analyzer — описание проекта

Веб-утилита для детального анализа демо-файлов Counter-Strike 2 (уровень Leetify/scope.gg):
общая сводка матча, подробная статистика и скоринг каждого игрока, хитмапы на радаре
карты и покадровый реплей матча «что происходило в любой момент времени».

Бэкенд и фронтенд полностью запускаются в Docker (`docker compose up`), единственный
вход — порт **8080**.

---

## 1. Архитектура

```
┌────────────────────────────────────────────────────────────┐
│  docker compose                                            │
│                                                            │
│  frontend (nginx:alpine)          backend (python:3.12)    │
│  ├─ Vite+React+TS SPA (static)    ├─ FastAPI + uvicorn    │
│  └─ reverse-proxy /api → backend  ├─ demoparser2 (Rust)   │
│                                   ├─ pandas / numpy       │
│     :8080 ─────────────────────►  └─ worker-subprocess    │
│                                        (анализ демо)       │
│                                                            │
│  volumes:                                                  │
│   ./demo-examples  → /data/inbox  (ro, примеры демок)      │
│   cs2_store        → /data/store  (uploads, артефакты,     │
│                                    кэш радаров)            │
└────────────────────────────────────────────────────────────┘
```

- **Backend** — FastAPI. Загрузка демо, реестр (inbox + uploads), фоновый анализ
  (subprocess `python -m app.worker`, прогресс по фазам в `status.json`), отдача
  артефактов анализа, радары карт и overview-геоданные. Без БД — всё на диске.
- **Frontend** — SPA на React + TypeScript (Vite), сборка в Docker (multi-stage),
  раздача nginx'ом, проксирование `/api`. Локальный Node не нужен.
- **demo_id** — хэш `sha1(имя:размер)`; артефакты анализа в `/data/store/analyses/<id>/`.

## 2. Пайплайн анализа (backend/app/pipeline/)

| Фаза | Модуль | Что делает |
|---|---|---|
| загрузка | `context.py` | header, `parse_events` (~30 ивентов), тики чанками с даунсемплом до 8 тиков (~0.125 с), гранаты, определение tickrate |
| раунды | `rounds.py` | сегментация раундов, стороны T/CT, победители (FACEIT-демо без `round_end` → вывод из bomb-ивентов + живых игроков), закупки, opening kills, MVP, пистолетки, тайминги |
| кадры | `replayframes.py` | покадровый стрим позиций (10 значений на игрока: xyz/yaw/hp/armor/alive/weapon/flags/team), статистика живости/дистанции/«long holds» (стоянки >5 c), трекер клатчей 1vX, состояние бомбы |
| игроки | `players.py` | K/D/A, урон (dealt/taken/util/post-plant/по хитгруппам), трейды, мультикиллы, флешки (враги ослеплены, blindSec, эффективные), гранаты, бомба, экономика, KAST |
| рейтинг | `rating.py` | Rating 2.1 (приближение, формула HLTV закрыта): саб-рейтинги kill/survival/damage/KAST/impact, нормировка на 1.00 по матчу |
| события | `events.py` | компактная лента для плеера: киллы, трейлы гранат, детонации/зоны смоков и огня, бомба, выстрелы (трассеры), границы раундов |
| хитмапы | `heatmaps.py` | слои: kills, deaths, damage (dealt/taken), shots, flash_throws/hits, smokes, molotovs, hes, plants, defuses, opening_duels, clutches, holds, positions |
| оркестратор | `run.py` | собирает analysis/replay/heatmap, пишет `analysis.json.gz`, `replay.json.gz`, `heatmap.json.gz` |

Прогресс фаз: `probe 4% → events 12 → ticks 30 → grenades 55 → rounds 62 → frames 70
→ players 78 → events 84 → heatmaps 90 → writing 94 → done 100`.

## 3. Метрики

**Матч**: карта, сервер, tickrate, длительность, счёт по половинам, названия команд,
пистолетные раунды, «моментум», типы закупок по раундам, планты/дефьюзы, MVP раундов,
причины побед (elimination/bomb/defuse/time), экономика команд.

**Раунд**: длительность, победитель и причина, opening kill (кто/на кого/оружие),
банк и тип закупки (pistol/eco/force/full), бомба (сайт, плантер, дефьюзер, kit),
клатчи, счёт на момент раунда.

**Игрок** (всё — за матч и в разбивке T/CT):
- База: K/D/A, flash-assists, K/D diff, KPR/DPR/APR, HS%, KAST%, ADR, utility ADR,
  урон полученный, урон по тиммейтам, post-plant урон.
- Дуэли: opening kills/deaths/winrate, trade kills, traded deaths, дистанции киллов
  (avg/max, бакеты по метрам).
- Мультикиллы: 2K/3K/4K/5K(ACE), раунды с мультикиллом.
- Клатчи: сыграно/выиграно, разбивка 1v1…1v5, список с деталями.
- Утилити: флешки (брошено/врагов ослеплено/секунд ослепления/эффективные/тиммейтов),
  смоки, молотовы/зажигательные, HE, декои, утилити-урон.
- Бомба: планты, дефьюзы, попытки, с китом.
- Оружия: таблица по каждому (киллы, HS%, выстрелы, попадания, точность, урон).
- Хитгруппы (head/chest/stomach/arms/legs/generic).
- Экономика: средний spend, всего потрачено.
- Движение: дистанция (км), время живости за раунд, survival%, сейвы.
- Скоринг: Rating 2.1 (approx) + разложение на 5 саб-рейтингов.
- По раундам: серия k/d/a/dmg/kast для графиков.

## 4. Хитмапы (canvas поверх радара)

Слои: `kills`, `deaths`, `damage`, `damage_taken`, `shots`, `flash_throws`,
`flash_hits`, `smokes`, `molotovs`, `hes`, `plants`, `defuses`, `opening_duels`,
`clutches`, `holds` (стоянки: размер = длительность), `positions` (плотность позиций).

Фильтры: игроки (мультивыбор), команда, сторона T/CT, половина матча, фаза раунда
(freeze/early/mid/late), пистолетные, z-уровень (upper/lower для nuke/vertigo).
Рендер: радиальные градиенты (additive), пресеты цветов, радиус/интенсивность.

## 5. Реплей-плеер

Кадры каждые ~0.125 с: позиции всех игроков (xyz, yaw, hp, armor, alive, активное
оружие, флаги: несёт бомбу/kit/ослеплён/скоуп/идёт тихо/присел), состояние бомбы
(носится/брошена/заложена/взорвана/обезврежена), трейлы гранат, зоны смоков и огня,
вспышки, трассеры, лента киллов, границы и исходы раундов.
Управление: play/pause, скорость 0.5–8x, скраб-таймлайн с раундами и маркерами событий.

## 6. API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | живость |
| GET | `/api/demos` | список демок (inbox+uploads) со статусами |
| POST | `/api/demos/upload` | загрузка .dem (мультипарт) |
| POST | `/api/demos/{id}/analyze` | запустить анализ (фоновый subprocess) |
| GET | `/api/demos/{id}/status` | статус/прогресс/фаза/ошибка |
| DELETE | `/api/demos/{id}` | удалить загруженную демку |
| GET | `/api/demos/{id}/analysis` | meta+teams+players+rounds |
| GET | `/api/demos/{id}/heatmap` | слои хитмапов |
| GET | `/api/demos/{id}/replay` | кадры+события для плеера |
| GET | `/api/maps/{map}/overview` | геоданные радара (pos_x/pos_y/scale, z-секции) |
| GET | `/api/maps/{map}/radar` | PNG радара (кэш, offline → сетка) |

Радары берутся из открытого репозитория
[MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons)
(`images/radars/<map>_radar_psd.png` + `data/radar_info/<map>.txt`),
кэшируются в volume; при отсутствии сети — тёмная сетка-заглушка.

## 7. UI (RU по умолчанию + переключатель EN)

Тёмная CS-стилистика. Страницы:
1. **Демо** — список (inbox+uploads), статус парсинга с прогресс-баром, загрузка, кнопки анализа/удаления.
2. **Обзор матча** — счёт, сравнение команд, сортируемый скорборд, графики (киллы по раундам, экономика, momentum).
3. **Игрок** — карточки всех метрик, графики по раундам, таблица оружий, клатчи.
4. **Хитмапы** — радар + слои + фильтры.
5. **Реплей** — карта с плеером и таймлайном.

## 8. Текущий статус (что сделано / что осталось)

### Сделано
- [x] Планирование и утверждение архитектуры (2 сервиса, порты, volume).
- [x] Зондирование demoparser2 0.42 на реальной демке (FACEIT, de_ancient):
      выяснен API (`parse_events([...])` → `[(name, DataFrame)]`, `list_game_events`,
      `parse_grenades`), схемы ~30 ивентов, рабочие имена пропов
      (деньги — только полный путь `CCSPlayerController...m_iAccount`;
      team-пропы через `parse_ticks` не отдаются → счёт считается из раундов;
      в FACEIT-демо нет `round_end`/`round_mvp` → победители выводятся эвристикой).
- [x] Backend-скелет: `config.py`, `weapons.py` (нормализация ~60 оружий, RU/EN),
      `storage.py` (реестр, статусы), `overviews.py` (парсер Valve KeyValues,
      загрузка/кэш радаров, world→pixel трансформация, z-секции, offline-fallback).
- [x] Весь пайплайн анализа: `context.py`, `rounds.py`, `replayframes.py`,
      `players.py`, `rating.py`, `heatmaps.py`, `events.py`, `run.py` (оркестратор
      + агрегаты + запись артефактов).
- [x] Worker CLI (`app/worker.py`) с прогрессом в status.json.
- [x] FastAPI (`app/main.py`): все эндпоинты, загрузка, subprocess-джобы, gzip.

### Не сделано (порядок работ)
1. requirements.txt, Dockerfile'ы (backend + frontend multi-stage), docker-compose.yml.
2. **Локальный прогон пайплайна на реальной демке** — отладка, проверка метрик
   (счёт, стороны, winner'ы, хитмапы на карте), скорость.
3. Frontend: каркас Vite+React+TS, i18n RU/EN, роутинг, API-клиент.
4. Страницы UI: список демо → обзор → игрок → хитмапы → реплей-плеер.
5. E2E в Docker на всех 3 демках из `demo-examples/`, скриншот-проверка,
   координатная сверка хитмапов с радаром.
6. README.md (запуск, скриншоты), полировка.

### Известные допущения
- Rating 2.1 — приближение (HLTV не публикует формулу); в UI помечаем «approx».
- Экономика команд — сумма `cash_spent_this_round` на первом тике раунда.
- MVP раунда — максимум урона в победившей команде (в FACEIT-демо нет round_mvp).
- Победа по таймеру — эвристика «живых больше у CT на конце раунда».
- «Сейв» = проиграл раунд и выжил.

## 9. Примеры демок

`demo-examples/` — 3 полных FACEIT-матча (~225–257 МБ):
`1-9799583b-…` (de_ancient), `1-efe3ec4b-…`, `1-fce3a37c-…`.
Монтируются в контейнер read-only и автоматически видны в списке UI.

## 10. Как это запускать (после завершения работ)

```bash
docker compose up --build     # сборка и запуск
# UI:      http://localhost:8080
# API:     http://localhost:8080/api/health
```

Дальше: выбрать демо в списке → «Анализировать» → страницы Обзор/Игроки/Хитмапы/Реплей.
