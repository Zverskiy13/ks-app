-- Клиники Столицы — целевая схема PostgreSQL (Фаза 0).
-- Идемпотентно: CREATE TABLE IF NOT EXISTS. Домены переносятся из GitHub по одному.

-- ---------- Пользователи и доступ ----------
CREATE TABLE IF NOT EXISTS roles (
    name        text PRIMARY KEY,
    description text
);

CREATE TABLE IF NOT EXISTS users (
    id         text PRIMARY KEY,
    name       text NOT NULL DEFAULT '',
    role       text NOT NULL DEFAULT 'staff' REFERENCES roles(name),
    title      text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
    id      bigserial PRIMARY KEY,
    name    text UNIQUE NOT NULL,
    region  text,
    segment text
);

CREATE TABLE IF NOT EXISTS business_units (
    id         bigserial PRIMARY KEY,
    company_id bigint REFERENCES companies(id) ON DELETE CASCADE,
    name       text NOT NULL
);

CREATE TABLE IF NOT EXISTS user_company_access (
    user_id    text REFERENCES users(id) ON DELETE CASCADE,
    company_id bigint REFERENCES companies(id) ON DELETE CASCADE,
    access     text NOT NULL DEFAULT 'read',
    PRIMARY KEY (user_id, company_id)
);

-- ---------- Задачи / календарь ----------
CREATE TABLE IF NOT EXISTS tasks (
    id         bigserial PRIMARY KEY,
    uid        text UNIQUE NOT NULL,              -- стабильный публичный ID (вместо сравнения по тексту)
    user_id    text REFERENCES users(id) ON DELETE SET NULL,
    company    text NOT NULL DEFAULT '',
    title      text NOT NULL,
    priority   text NOT NULL DEFAULT '🟡',
    due        date,
    status     text NOT NULL DEFAULT 'active',    -- active | done
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    done_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);

CREATE TABLE IF NOT EXISTS task_comments (
    id         bigserial PRIMARY KEY,
    task_id    bigint REFERENCES tasks(id) ON DELETE CASCADE,
    author     text,
    text       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id         bigserial PRIMARY KEY,
    uid        text UNIQUE NOT NULL,
    user_id    text REFERENCES users(id) ON DELETE SET NULL,
    date       date NOT NULL,
    start_time text,
    end_time   text,
    title      text NOT NULL,
    repeat     jsonb,                              -- {every,unit} | {dates:[...]}
    done_dates jsonb NOT NULL DEFAULT '[]',
    skip_dates jsonb NOT NULL DEFAULT '[]',
    done       boolean NOT NULL DEFAULT false,     -- для разовых
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_date ON calendar_events(date);

CREATE TABLE IF NOT EXISTS task_occurrences (
    id       bigserial PRIMARY KEY,
    event_id bigint REFERENCES calendar_events(id) ON DELETE CASCADE,
    date     date NOT NULL,
    done     boolean NOT NULL DEFAULT false,
    UNIQUE (event_id, date)
);

CREATE TABLE IF NOT EXISTS reminders (
    id         bigserial PRIMARY KEY,
    uid        text UNIQUE NOT NULL,
    user_id    text REFERENCES users(id) ON DELETE SET NULL,
    at         timestamptz NOT NULL,
    text       text NOT NULL,
    done       boolean NOT NULL DEFAULT false,
    pushed     boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS deadlines (
    id      bigserial PRIMARY KEY,
    uid     text UNIQUE NOT NULL,
    user_id text REFERENCES users(id) ON DELETE SET NULL,
    company text NOT NULL DEFAULT '',
    text    text NOT NULL,
    due     date,
    done    boolean NOT NULL DEFAULT false
);

-- ---------- Продажи ----------
CREATE TABLE IF NOT EXISTS deal_stages (
    id   bigserial PRIMARY KEY,
    name text UNIQUE NOT NULL,
    ord  int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deals (
    id         bigserial PRIMARY KEY,
    name       text NOT NULL,
    company    text NOT NULL DEFAULT '',
    stage      text,
    step       text,
    assignee   text,
    last_touch timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deal_activities (
    id         bigserial PRIMARY KEY,
    deal_id    bigint REFERENCES deals(id) ON DELETE CASCADE,
    type       text,
    note       text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Финансы ----------
CREATE TABLE IF NOT EXISTS finance_periods (
    id bigserial PRIMARY KEY,
    ym text UNIQUE NOT NULL                         -- YYYY-MM
);

CREATE TABLE IF NOT EXISTS finance_entries (
    id        bigserial PRIMARY KEY,
    ym        text NOT NULL,
    name      text NOT NULL,                        -- направление
    profit    numeric NOT NULL DEFAULT 0,
    share     numeric,
    UNIQUE (ym, name)
);

CREATE TABLE IF NOT EXISTS finance_imports (
    id         bigserial PRIMARY KEY,
    source     text,
    day        date NOT NULL,                        -- дата данных
    region     text,
    segment    text,
    revenue    numeric NOT NULL DEFAULT 0,
    cost       numeric NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (day, region, segment)
);
CREATE INDEX IF NOT EXISTS idx_fin_imports_day ON finance_imports(day);

-- ---------- Здоровье ----------
CREATE TABLE IF NOT EXISTS health_checkups (
    id             bigserial PRIMARY KEY,
    user_id        text REFERENCES users(id) ON DELETE CASCADE,
    title          text NOT NULL,
    next_date      date,
    frequency_days int,
    status         text NOT NULL DEFAULT 'active',
    comment        text
);

CREATE TABLE IF NOT EXISTS health_documents (
    id         bigserial PRIMARY KEY,
    user_id    text REFERENCES users(id) ON DELETE CASCADE,
    name       text NOT NULL,
    mime       text,
    data       bytea,                               -- сам файл (или ссылка на объектное хранилище)
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_results (
    id          bigserial PRIMARY KEY,
    user_id     text REFERENCES users(id) ON DELETE CASCADE,
    date        date NOT NULL,
    test_type   text,
    marker      text NOT NULL,
    value       numeric,
    unit        text,
    ref_min     numeric,
    ref_max     numeric,
    comment     text,
    source      text,
    document_id bigint REFERENCES health_documents(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_marker ON health_results(marker, date);

-- ---------- Уведомления ----------
CREATE TABLE IF NOT EXISTS notification_settings (
    user_id  text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS notifications (
    id         bigserial PRIMARY KEY,
    user_id    text REFERENCES users(id) ON DELETE CASCADE,
    channel    text,
    title      text,
    body       text,
    sent       boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         bigserial PRIMARY KEY,
    user_id    text REFERENCES users(id) ON DELETE CASCADE,
    endpoint   text UNIQUE NOT NULL,
    sub        jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- ИИ и аудит ----------
CREATE TABLE IF NOT EXISTS ai_conversations (
    id         bigserial PRIMARY KEY,
    chat_id    text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_runs (
    id              bigserial PRIMARY KEY,
    conversation_id bigint REFERENCES ai_conversations(id) ON DELETE CASCADE,
    kind            text,
    prompt          text,
    result          jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
    id         bigserial PRIMARY KEY,
    user_id    text REFERENCES users(id) ON DELETE CASCADE,
    kind       text,
    payload    jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id      bigserial PRIMARY KEY,
    ts      timestamptz NOT NULL DEFAULT now(),
    ip      text,
    action  text NOT NULL,
    ok      boolean NOT NULL DEFAULT true,
    user_id text,
    detail  jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

-- ---------- Клиентское состояние (здоровье/трекер): документ-хранилище по пользователю ----------
CREATE TABLE IF NOT EXISTS client_state (
    user_id    text NOT NULL,
    key        text NOT NULL,                       -- 'health' | 'tracker'
    data       jsonb NOT NULL DEFAULT '{}',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);

-- сиды справочников
INSERT INTO roles(name, description) VALUES
    ('owner','Владелец'), ('head','Руководитель'), ('staff','Сотрудник')
    ON CONFLICT (name) DO NOTHING;
