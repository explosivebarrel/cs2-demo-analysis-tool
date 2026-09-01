# План технической реализации: Аналитическая платформа игровых демок (Обновленная версия)

---

## 1. Архитектура и Выбор Стека

### Frontend
**Стек:** Vite + React 18 + TypeScript + Redux Toolkit + i18next

**Обоснование:**
- **Vite** — быстрый dev-сервер (HMR), простая настройка, идеален для SPA (не нужен SSR как в Next.js, так как это закрытая аналитическая платформа)
- **React 18** — компонентный подход, concurrent features для тяжелых графиков
- **TypeScript** — строгая типизация критична для сложных данных (метрики, координаты, временные ряды)
- **Redux Toolkit** — централизованное управление состоянием (авторизация, фильтры, кэш метрик), devtools для отладки, middleware для async-логики
- **i18next + react-i18next** — интернационализация (RU/EN минимум), возможность добавления языков без переписывания кода
- **Recharts** — для графиков (скорость, урон, таймлайны)
- **Leaflet** — для интерактивной карты (если нужен zoom/pan) или кастомный SVG
- **TanStack Query (React Query)** — кэширование API-запросов, фоновое обновление (работает вместе с Redux, не заменяет его)
- **Tailwind CSS** — быстрая разработка UI, легко кастомизируется под нашу дизайн-систему

### Backend
**Стек:** Node.js (NestJS) + Python (FastAPI) для парсинга демок

**Обоснование:**
- **NestJS** — основная бизнес-логика, авторизация, работа с БД, REST API
- **Python FastAPI** — микросервис для парсинга `.dem` файлов (библиотеки `demoparser`, `csgo-demo-parser` доступны только на Python)
- **Queue (Bull/BullMQ)** — фоновые задачи парсинга (демо парсится 2-5 минут)
- **WebSocket** — для real-time статуса парсинга ("Готово 45%...")

### База Данных
**Стек:** PostgreSQL + Redis

**Обоснование:**
- **PostgreSQL** — реляционные данные (пользователи, матчи, дуэли), JSONB для гибких метрик
- **Redis** — кэш популярных демок, сессии, queue для парсинга
- **S3/MinIO** — хранение `.dem` файлов и сгенерированных видео-хайлайтов

### Инфраструктура
- **Docker + Docker Compose** — локальная разработка
- **Kubernetes** — продакшен (масштабирование парсеров)
- **CI/CD:** GitHub Actions

---

## 2. Backend: Модели данных и Бизнес-логика

### Сущности (Entities)

```
User (1) ── (M) Demo
  │
  ── (1) ─── (M) Match
                    │
                    ├── (M) Player (участники матча)
                    ├── (M) Round
                    ├── (M) Duel (дуэль 1v1)
                    │       └── (M) Episode (эпизод внутри дуэли)
                    ├── (M) KillEvent
                    ├── (M) DeathEvent
                    ├── (M) ChatMessage (коммуникация)
                    └── (M) PositionEvent (для карты)
```

**Детальная схема:**

```sql
-- Пользователь
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  steam_id VARCHAR(20) UNIQUE,
  faceit_id VARCHAR(20),
  preferred_language VARCHAR(5) DEFAULT 'ru', -- для i18n
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Демо-файл (загруженный пользователем)
CREATE TABLE demos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  file_url TEXT NOT NULL, -- S3 URL
  file_size BIGINT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, parsing, ready, failed
  parse_progress INT DEFAULT 0, -- 0-100
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Матч (результат парсинга демо)
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_id UUID REFERENCES demos(id),
  map_name VARCHAR(50) NOT NULL, -- de_ancient
  match_date TIMESTAMPTZ,
  server_type VARCHAR(20), -- faceit, official, community
  duration_sec INT,
  rounds_count INT DEFAULT 24,
  parsed_at TIMESTAMPTZ
);

-- Игрок в матче
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES matches(id),
  user_id UUID REFERENCES users(id), -- NULL если не наш пользователь
  steam_id VARCHAR(20),
  nickname VARCHAR(100),
  team VARCHAR(10), -- T, CT
  is_analyzed BOOLEAN DEFAULT FALSE -- TRUE если это тот, чье демо смотрим
);

-- Раунд
CREATE TABLE rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES matches(id),
  round_number INT NOT NULL,
  winner_team VARCHAR(10),
  win_type VARCHAR(20), -- elimination, time, bomb, etc.
  duration_sec INT
);

-- Дуэль (1v1 контакт)
CREATE TABLE duels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES matches(id),
  round_id UUID REFERENCES rounds(id),
  attacker_id UUID REFERENCES players(id),
  defender_id UUID REFERENCES players(id),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  winner_id UUID REFERENCES players(id),
  result VARCHAR(20), -- kill, trade, death, miss
  
  -- Метрики дуэли
  first_shot_accuracy BOOLEAN, -- попала ли первая пуля
  reaction_time_ms INT, -- время реакции атакующего
  time_to_kill_ms INT, -- время от первого выстрела до фрага
  attacker_speed_at_shot FLOAT, -- скорость атакующего в момент выстрела
  is_perfect_strafe BOOLEAN, -- идеальный контрстрейф
  has_overshoot BOOLEAN, -- перелет прицела
  has_undershoot BOOLEAN, -- недолет прицела
  is_shift_peak BOOLEAN, -- пик на шифте
  weapon_class VARCHAR(20), -- rifle, pistol, awp
  weapon_name VARCHAR(30) -- ak47, m4a1, etc.
);

-- Эпизод (детальный момент внутри дуэли)
CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duel_id UUID REFERENCES duels(id),
  event_type VARCHAR(30), -- first_shot, movement, reload
  timestamp_ms INT, -- от начала дуэли
  data JSONB -- гибкие данные (координаты, скорость, нажатые клавиши)
);

-- Событие убийства
CREATE TABLE kill_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES matches(id),
  round_id UUID REFERENCES rounds(id),
  killer_id UUID REFERENCES players(id),
  victim_id UUID REFERENCES players(id),
  weapon VARCHAR(30),
  headshot BOOLEAN DEFAULT FALSE,
  killer_pos_x FLOAT,
  killer_pos_y FLOAT,
  victim_pos_x FLOAT,
  victim_pos_y FLOAT,
  timestamp TIMESTAMPTZ
);

-- Событие смерти
CREATE TABLE death_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES matches(id),
  round_id UUID REFERENCES rounds(id),
  player_id UUID REFERENCES players(id),
  killer_id UUID REFERENCES players(id),
  weapon VARCHAR(30),
  pos_x FLOAT,
  pos_y FLOAT,
  timestamp TIMESTAMPTZ
);

-- Голосовая коммуникация
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES matches(id),
  round_id UUID REFERENCES rounds(id),
  player_id UUID REFERENCES players(id),
  message_type VARCHAR(20), -- voice, text, radio
  started_at TIMESTAMPTZ,
  duration_sec INT,
  is_alive BOOLEAN DEFAULT TRUE -- говорил при жизни?
);
```

### API Контракты (REST)

**Аутентификация:**
```
POST   /api/auth/register          -- Регистрация
POST   /api/auth/login             -- Вход (email/password)
POST   /api/auth/steam             -- OAuth через Steam
GET    /api/auth/me                -- Текущий пользователь
PUT    /api/auth/preferences       -- Обновление предпочтений (язык)
```

**Демо и Матчи:**
```
POST   /api/demos/upload           -- Загрузка .dem файла (multipart)
GET    /api/demos/:id/status       -- Статус парсинга (polling)
GET    /api/demos/:id              -- Информация о демо

GET    /api/matches/:id            -- Основная информация о матче
GET    /api/matches/:id/overview   -- Сводка (вкладка "Обзор")
GET    /api/matches/:id/impact     -- Вклад в победы (вкладка "Импакт")
GET    /api/matches/:id/duels      -- Список дуэлей (вкладка "Дуэли")
GET    /api/matches/:id/map        -- Данные для карты (вкладка "Карта")
GET    /api/matches/:id/communication -- Коммуникация (вкладка "Коммуникация")
```

**Метрики (детальные страницы):**
```
GET    /api/matches/:id/metrics/reaction              -- Среднее время реакции
GET    /api/matches/:id/metrics/reaction-successful   -- Реакция в успешных попаданиях
GET    /api/matches/:id/metrics/first-shot-stability  -- Стабильность первой пули
GET    /api/matches/:id/metrics/perfect-strafes       -- Идеальные стрейфы
GET    /api/matches/:id/metrics/quality-contacts      -- Качественные контакты
GET    /api/matches/:id/metrics/time-to-kill          -- Time to Kill
GET    /api/matches/:id/metrics/aim-correction        -- Контроль доводки прицела
GET    /api/matches/:id/metrics/shift-peaks           -- Пики на шифте
GET    /api/matches/:id/metrics/angle-control         -- Контроль угла
GET    /api/matches/:id/metrics/reload-waste          -- Потеря патронов при перезарядке
```

**Эпизоды и Разбор:**
```
GET    /api/matches/:id/duels/:duelId/episodes        -- Эпизоды дуэли
GET    /api/matches/:id/episodes/:episodeId/detail    -- Детальный разбор эпизода
```

**Видео:**
```
POST   /api/matches/:id/highlights/generate  -- Запрос генерации хайлайта
GET    /api/matches/:id/highlights/:type     -- Получить видео (my_kills, my_deaths, etc.)
```

### Скрытая логика (Backend)

1. **Парсинг демо-файлов:**
   - Python-сервис получает `.dem` файл из S3
   - Парсит бинарный формат CS2 demo
   - Извлекает: позиции игроков, выстрелы, убийства, чат, раунды
   - Сохраняет в PostgreSQL
   - Обновляет прогресс в Redis (для polling)

2. **Расчет метрик:**
   - После парсинга запускается расчет всех метрик (реакция, стрейфы, доводка)
   - Агрегация данных (средние значения, проценты)
   - Сохранение в отдельные таблицы для быстрого доступа

3. **Генерация видео-хайлайтов:**
   - FFmpeg нарезает клипы из демо (если есть серверная запись)
   - Или генерирует ссылки на HLTV/DEMUIO

4. **Валидация файлов:**
   - Проверка формата `.dem`
   - Проверка размера (max 500MB)
   - Антивирусная проверка

5. **Кэширование:**
   - Redis кэш для популярных метрик (TTL 1 час)
   - Кэш карты (PNG тайлы)

6. **Интеграции:**
   - Steam OAuth (получение профиля)
   - Faceit API (если демо с Faceit)
   - Email уведомления (демо готово)

---

## 3. Frontend: Компонентная архитектура и Роутинг

### Маппинг блоков -> Компоненты

| Блок с референса | Наш компонент | Описание |
|------------------|---------------|----------|
| Header с навигацией | `AppHeader` | Лого, меню, профиль, переключатель языка |
| Панель информации о матче | `MatchInfoBar` | Карта, дата, игрок, статус |
| Табы навигации | `MatchTabs` | Обзор, Импакт, Дуэли, etc. |
| Карточка метрики (маленькая) | `MetricCard` | Цифра, лейбл, прогресс-бар |
| Карточка главной проблемы | `MainProblemCard` | Большая карточка с акцентом |
| Сетка метрик 6 в ряд | `MetricsGrid` | Grid layout с MetricCard |
| Детальная страница метрики | `MetricDetailPage` | Шаблон с SummaryCard + Episodes |
| Summary Card (большая) | `MetricSummaryCard` | Значение, шкала, советы |
| Gauge/Scale (шкала с маркером) | `GaugeChart` | Линейная шкала с диапазонами |
| Segmented Bar | `SegmentedBar` | Двухцветный прогресс-бар |
| Список эпизодов | `EpisodesList` | Таблица эпизодов с фильтрами |
| Timeline раундов | `RoundTimeline` | Ряд чисел 1-24 с подсветкой |
| Аккордеон дуэлей | `DuelsAccordion` | Группировка по типу ошибки |
| Модальное окно разбора | `EpisodeDetailModal` | Детальный анализ эпизода |
| Карта с маркерами | `MapView` | Интерактивная карта Ancient |
| График коммуникации | `CommunicationChart` | Столбчатая диаграмма по раундам |
| Кнопка | `Button` | Primary, Secondary, Ghost |
| Бейдж | `Badge` | Статусы, оценки |
| Прогресс-бар | `ProgressBar` | Линейный индикатор |
| Переключатель языка | `LanguageSwitcher` | Dropdown RU/EN |

### Структура роутинга

```
/                           -- Главная (лендинг)
/login                      -- Вход
/register                   -- Регистрация

/demos                      -- Список моих демок
/demos/upload               -- Загрузка демо

/m/:matchId                 -- Редирект на /m/:matchId/overview
/m/:matchId/overview        -- Вкладка "Обзор"
/m/:matchId/impact          -- Вкладка "Импакт"
/m/:matchId/training        -- Вкладка "Тренировки"
/m/:matchId/duels           -- Вкладка "Дуэли"
/m/:matchId/weapons         -- Вкладка "Оружие"
/m/:matchId/map             -- Вкладка "Карта"
/m/:matchId/rounds          -- Вкладка "Раунды"
/m/:matchId/communication   -- Вкладка "Коммуникация"

/m/:matchId/metrics/:metricId  -- Детальная страница метрики
  -- metricId: reaction, first-shot, strafes, etc.

/profile                    -- Профиль пользователя
/settings                   -- Настройки
```

### State Management

**Локальный state (useState/useReducer):**
- Открытые/закрытые аккордеоны
- Фильтры (Все/Ошибки/Сильные)
- Hover-состояния
- Форма загрузки файла

**Глобальный state (Redux Toolkit):**
- **Auth Slice:** текущий пользователь, токены, статус авторизации
- **UI Slice:** открытые модалки, тема, sidebar state
- **Filters Slice:** фильтры на странице дуэлей (тип ошибок, раунды)
- **Language Slice:** текущий язык (синхронизация с i18next)
- **Match Slice:** кэш текущего матча (чтобы не грузить повторно при переходах между вкладками)

**Пример Redux Slice:**
```typescript
// store/slices/authSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { api } from '../../api';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
}

export const login = createAsyncThunk(
  'auth/login',
  async (credentials: { email: string; password: string }) => {
    const response = await api.post('/auth/login', credentials);
    return response.data;
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState: { user: null, token: null, loading: false, error: null } as AuthState,
  reducers: {
    logout: (state) => {
      state.user = null;
      state.token = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => { state.loading = true; })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload.user;
        state.token = action.payload.token;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      });
  },
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;
```

**Серверный кэш (TanStack Query):**
- Данные матча (overview, impact, duels)
- Метрики (reaction, strafes, etc.)
- Список демок пользователя
- Статус парсинга (polling каждые 3 сек)

**Пример кэширования:**
```typescript
// hooks/useMatch.ts
export function useMatch(matchId: string) {
  return useQuery({
    queryKey: ['match', matchId],
    queryFn: () => api.getMatch(matchId),
    staleTime: 5 * 60 * 1000, // 5 минут
    gcTime: 10 * 60 * 1000,   // 10 минут в кэше
  });
}

// hooks/useMetric.ts
export function useMetric(matchId: string, metricId: string) {
  return useQuery({
    queryKey: ['metric', matchId, metricId],
    queryFn: () => api.getMetric(matchId, metricId),
    staleTime: 10 * 60 * 1000,
  });
}
```

### i18n Архитектура

**Структура файлов:**
```
src/
  i18n/
    config.ts          -- Настройка i18next
    locales/
      ru/
        common.json    -- Общие переводы (кнопки, заголовки)
        auth.json      -- Авторизация
        match.json     -- Страница матча
        metrics.json   -- Метрики
      en/
        common.json
        auth.json
        match.json
        metrics.json
```

**Пример переводов:**
```json
// src/i18n/locales/ru/metrics.json
{
  "reaction": {
    "title": "Среднее время реакции",
    "description": "Среднее время от появления цели до твоего первого выстрела",
    "fast": "Быстрая реакция",
    "slow": "Медленная реакция",
    "norm": "Норма {{value}} мс",
    "why_important": "Скорость первого клика напрямую влияет на шанс выиграть контакт",
    "what_to_do": "Тренируй постановку прицела и наведение на противника"
  },
  "first_shot": {
    "title": "Стабильность первой пули",
    "low_stability": "Низкая стабильность первой пули",
    "missed": "дуэлей, где первая пуля прошла мимо"
  }
}
```

**Использование в компонентах:**
```typescript
// components/MetricSummaryCard.tsx
import { useTranslation } from 'react-i18next';

interface MetricSummaryCardProps {
  metricId: string;
  value: number;
  status: 'good' | 'bad' | 'normal';
}

export function MetricSummaryCard({ metricId, value, status }: MetricSummaryCardProps) {
  const { t } = useTranslation('metrics');
  
  return (
    <div className="card">
      <h2>{t(`${metricId}.title`)}</h2>
      <div className="value">{value}</div>
      <p className="status">
        {status === 'good' 
          ? t(`${metricId}.fast`) 
          : t(`${metricId}.slow`)}
      </p>
    </div>
  );
}
```

**Переключатель языка:**
```typescript
// components/LanguageSwitcher.tsx
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { setLanguage } from '../store/slices/languageSlice';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const dispatch = useDispatch();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    dispatch(setLanguage(lng));
    // Сохранить в localStorage
    localStorage.setItem('preferred_language', lng);
  };

  return (
    <select 
      value={i18n.language} 
      onChange={(e) => changeLanguage(e.target.value)}
    >
      <option value="ru">Русский</option>
      <option value="en">English</option>
    </select>
  );
}
```

**Конфигурация i18next:**
```typescript
// src/i18n/config.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

import ruCommon from './locales/ru/common.json';
import enCommon from './locales/en/common.json';
import ruMetrics from './locales/ru/metrics.json';
import enMetrics from './locales/en/metrics.json';

const resources = {
  ru: {
    common: ruCommon,
    metrics: ruMetrics,
  },
  en: {
    common: enCommon,
    metrics: enMetrics,
  },
};

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'ru',
    interpolation: {
      escapeValue: false,
    },
    ns: ['common', 'metrics', 'auth', 'match'],
    defaultNS: 'common',
  });

export default i18n;
```

---

## 4. Адаптация UX/UI (Что берем, что меняем)

### Сохраняем (Паттерны)

1. **Иерархия информации:**
   - Header -> MatchInfo -> Tabs -> Content
   - Главная проблема сверху, детали ниже
   - Связанные метрики в конце страницы ("Что дальше")

2. **Навигация:**
   - Табы для переключения разделов матча
   - Хлебные крошки "Назад к демке" на детальных страницах
   - Кнопка "Загрузить другое демо" в шапке

3. **Интерактивность:**
   - Клик на карточку метрики -> переход на детальную страницу
   - Клик на эпизод -> открытие модалки с разбором
   - Hover на маркер карты -> tooltip
   - Фильтры "Все/Ошибки/Сильные" на странице дуэлей

4. **Обратная связь:**
   - Прогресс-бар парсинга демо
   - Статусы "Готово/Ошибка"
   - Skeleton-загрузка для метрик

5. **Структура детальной страницы метрики:**
   - Summary Card (значение + шкала + советы)
   - "Из чего складывается" (breakdown)
   - "Эпизоды из этой демки" (список)
   - "По раундам матча" (timeline)
   - "Что дальше" (связанные метрики)

### Меняем (Визуал и кастом)

1. **Цветовая схема:**
   - Референс: темно-синий фон + оранжевые акценты
   - Мы: используем нашу дизайн-систему (например, серый фон + синие акценты)

2. **Типографика:**
   - Референс: жирные uppercase заголовки с "//"
   - Мы: стандартные заголовки без декоративных элементов

3. **Карточки метрик:**
   - Референс: 6 карточек в ряд с градиентными прогресс-барами
   - Мы: используем наши стандартные карточки из дизайн-системы

4. **Шкала Gauge:**
   - Референс: кастомная линейная шкала с маркером
   - Мы: используем наш компонент `ProgressIndicator` или `GaugeChart` из библиотеки

5. **Карта:**
   - Референс: PNG карта с абсолютным позиционированием маркеров
   - Мы: используем Leaflet с кастомными иконками (если нужен zoom) или SVG

6. **Модальное окно разбора:**
   - Референс: сложная модалка с графиками скорости, нажатий клавиш, траектории
   - Мы: упрощаем до базовых графиков (скорость + позиция), убираем "что нажимал" если нет данных

7. **Аккордеон дуэлей:**
   - Референс: кастомный аккордеон с иконками X/Warning/Check
   - Мы: используем стандартный `Accordion` из нашей UI-библиотеки

8. **График коммуникации:**
   - Референс: кастомные столбцы с двумя цветами
   - Мы: используем `BarChart` из Recharts с кастомными цветами

9. **Переключатель языка:**
   - Добавляем в Header (справа, рядом с профилем)
   - Dropdown с флагами или кодами языков (RU/EN)

---

## 5. Пошаговый Roadmap реализации

### Фаза 1: MVP (2 недели)
**Цель:** Загрузка демо, базовый парсинг, отображение сводки

**Backend:**
- [ ] Настроить NestJS + PostgreSQL
- [ ] Реализовать авторизацию (email/password)
- [ ] Создать модели User, Demo, Match
- [ ] Реализовать загрузку файлов (S3)
- [ ] Базовый парсер демо (Python) — извлечь раунды, убийства, смерти
- [ ] API: upload demo, get match info

**Frontend:**
- [ ] Настроить Vite + React + TypeScript + Redux Toolkit + i18next
- [ ] Структура проекта (папки, конфиги)
- [ ] Настроить Tailwind CSS
- [ ] Страницы: Login, Register, Demos List
- [ ] Страница загрузки демо (drag&drop)
- [ ] Страница матча (вкладка "Обзор" — базовая сводка)
- [ ] Компоненты: AppHeader, MatchInfoBar, Button, Card, LanguageSwitcher
- [ ] Базовые переводы (RU/EN) для common и auth

**DoD:** Пользователь может загрузить демо, увидеть статус парсинга, открыть страницу матча с базовой статистикой (убийства, смерти, K/D). Интерфейс переключается между RU/EN.

---

### Фаза 2: Метрики дуэлей (2 недели)
**Цель:** Расчет и отображение метрик дуэлей

**Backend:**
- [ ] Расширить парсер: извлечь дуэли, скорость, позиции
- [ ] Расчет метрик: реакция, стабильность первой пули, стрейфы
- [ ] API: get metrics (reaction, first-shot, strafes, etc.)
- [ ] API: get duels list

**Frontend:**
- [ ] Вкладка "Дуэли" — список дуэлей с фильтрами
- [ ] Детальные страницы метрик (шаблон MetricDetailPage)
- [ ] Компоненты: MetricCard, GaugeChart, EpisodesList
- [ ] Страницы: /metrics/reaction, /metrics/first-shot, etc.
- [ ] Переводы для metrics.json (RU/EN)

**DoD:** Пользователь видит 6 карточек метрик на "Обзоре", может кликнуть и увидеть детальную страницу с эпизодами. Все тексты на двух языках.

---

### Фаза 3: Импакт и Карта (2 недели)
**Цель:** Вкладка "Импакт" и интерактивная карта

**Backend:**
- [ ] Расчет импакта: вклад в победы, цена решений
- [ ] API: get impact data
- [ ] API: get map data (kill/death positions)

**Frontend:**
- [ ] Вкладка "Импакт" — вклад в победы, цена решений, качество дуэлей
- [ ] Вкладка "Карта" — карта с маркерами убийств/смертей
- [ ] Компоненты: MapView, RoundTimeline, ImpactCard
- [ ] Фильтры на карте (Все/Убийства/Смерти)
- [ ] Переводы для match.json (RU/EN)

**DoD:** Пользователь видит вклад "Импакт" с графиками и вкладку "Карта" с интерактивными маркерами. Все тексты локализованы.

---

### Фаза 4: Коммуникация и Видео (1 неделя)
**Цель:** Вкладка "Коммуникация" и генерация хайлайтов

**Backend:**
- [ ] Парсинг голосового чата (если доступно)
- [ ] API: get communication data
- [ ] Генерация видео-хайлайтов (FFmpeg)
- [ ] API: generate highlights, get highlight video

**Frontend:**
- [ ] Вкладка "Коммуникация" — график голосовой активности
- [ ] Секция "Видео" на "Обзоре" — кнопки генерации хайлайтов
- [ ] Компоненты: CommunicationChart, VideoPlayer
- [ ] Переводы для communication.json (RU/EN)

**DoD:** Пользователь видит вкладку "Коммуникация" и может запросить генерацию видео "Мои киллы". Интерфейс полностью на двух языках.

---

### Фаза 5: Детальный разбор эпизодов (2 недели)
**Цель:** Модальное окно с детальным анализом эпизода

**Backend:**
- [ ] API: get episode detail (скорость, позиции, нажатия клавиш)
- [ ] Извлечение данных о нажатых клавишах из демо

**Frontend:**
- [ ] Модальное окно EpisodeDetailModal
- [ ] Графики: скорость, траектория, нажатия клавиш
- [ ] Компоненты: SpeedChart, KeyPressTimeline, MovementPath
- [ ] Переводы для episodes.json (RU/EN)

**DoD:** Пользователь может кликнуть на эпизод и увидеть детальный разбор с графиками скорости и траектории. Все тексты в модалке локализованы.

---

### Фаза 6: Полировка и Оптимизация (1 неделя)
**Цель:** Улучшение UX, производительности, мобильной версии

**Backend:**
- [ ] Кэширование метрик (Redis)
- [ ] Оптимизация запросов (индексы БД)
- [ ] WebSocket для real-time статуса парсинга

**Frontend:**
- [ ] Skeleton-загрузка для всех страниц
- [ ] Мобильная адаптация (responsive)
- [ ] Оптимизация графиков (lazy loading)
- [ ] Доступность (a11y) — aria-labels, keyboard navigation
- [ ] Тестирование i18n (проверить все страницы на обоих языках)
- [ ] Добавить fallback для недостающих переводов

**DoD:** Все страницы работают быстро (<2 сек загрузка), мобильная версия удобна, есть skeleton-загрузка, все тексты корректно переводятся на RU/EN.

---

### Открытые вопросы

1. **Формат демо-файлов:**
   - CS2 демо имеют новый формат, старые парсеры могут не работать
   - **Решение:** Использовать `demoparser2` (Python) — активно поддерживается

2. **Генерация видео:**
   - Требуется ли серверная запись игры или достаточно нарезки из демо?
   - **Решение:** Начать с нарезки готовых видео (если есть), позже добавить серверную запись

3. **Данные о нажатых клавишах:**
   - Не все демо содержат эту информацию (зависит от сервера)
   - **Решение:** Показывать "Данные недоступны" если нет информации (текст должен быть в i18n)

4. **Масштабирование парсеров:**
   - Парсинг одного демо занимает 2-5 минут
   - **Решение:** Queue с приоритетами, масштабирование воркеров

5. **Хранение файлов:**
   - Демо-файлы большие (100-500MB)
   - **Решение:** S3 с lifecycle policy (удаление через 30 дней для free-пользователей)

6. **i18n — дополнительные языки:**
   - Какие языки нужны кроме RU/EN?
   - **Решение:** Архитектура позволяет легко добавить новые языки (просто добавить файлы в locales/)

7. **Redux vs React Query — дублирование:**
   - Что хранить в Redux, что в React Query?
   - **Решение:** Redux — UI state (фильтры, модалки, авторизация), React Query — серверные данные (метрики, матчи)