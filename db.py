# -*- coding: utf-8 -*-
"""
Слой доступа к PostgreSQL (Фаза 0 переезда с GitHub-как-БД).
Пока НЕ подключён к доменам — только фундамент: соединение, создание схемы, статус.
Если DATABASE_URL не задан или psycopg не установлен — модуль «спит», приложение
продолжает работать на GitHub. Никакого влияния на текущее поведение.
"""
import os, secrets

try:
    import psycopg
except Exception:                      # psycopg ещё не установлен / нет DATABASE_URL
    psycopg = None

DATABASE_URL = os.environ.get("DATABASE_URL", "")


def db_available():
    return bool(DATABASE_URL and psycopg)


def _dsn():
    # Railway отдаёт postgres://; psycopg хочет postgresql://
    d = DATABASE_URL
    if d.startswith("postgres://"):
        d = "postgresql://" + d[len("postgres://"):]
    return d


def _conn():
    return psycopg.connect(_dsn(), connect_timeout=10)


def execute(sql, params=None):
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(sql, params or ())
        c.commit()


def query(sql, params=None):
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(sql, params or ())
            if not cur.description:
                return []
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]


def query_one(sql, params=None):
    rows = query(sql, params)
    return rows[0] if rows else None


def init_schema():
    """Идемпотентно создаёт таблицы из schema.sql (CREATE TABLE IF NOT EXISTS)."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
    with open(path, "r", encoding="utf-8") as f:
        ddl = f.read()
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(ddl)          # psycopg3: несколько statements в одном execute без параметров — ок
        c.commit()


# ---------- Домен «Задачи» (Фаза 1) ----------
def sync_users(users):
    """Апсертит пользователей (для FK tasks.user_id)."""
    for u in users:
        execute("INSERT INTO users(id,name,role,title) VALUES(%s,%s,%s,%s) "
                "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, title=EXCLUDED.title",
                (u["id"], u.get("name", ""), u.get("role", "staff"), u.get("title", "")))


def tasks_count():
    r = query_one("SELECT count(*) AS n FROM tasks")
    return r["n"] if r else 0


def tasks_list():
    return query("SELECT id, uid, user_id, company, title, priority, "
                 "to_char(due,'YYYY-MM-DD') AS due, status "
                 "FROM tasks ORDER BY (status='done'), due NULLS LAST, id DESC")


def task_add(text, company, priority, due, user_id=None):
    uid = secrets.token_hex(8)
    execute("INSERT INTO tasks(uid,user_id,company,title,priority,due,status) "
            "VALUES(%s,%s,%s,%s,%s,%s,'active')",
            (uid, user_id, company or "", text, priority or "🟡", (due or None)))
    return uid


def task_done(task_id):
    execute("UPDATE tasks SET status='done', done_at=now(), updated_at=now() WHERE id=%s", (int(task_id),))


def task_reopen(task_id):
    execute("UPDATE tasks SET status='active', done_at=NULL, updated_at=now() WHERE id=%s", (int(task_id),))


def task_edit(task_id, new_text, new_due="__keep__"):
    if new_due == "__keep__":
        execute("UPDATE tasks SET title=%s, updated_at=now() WHERE id=%s", (new_text, int(task_id)))
    else:
        execute("UPDATE tasks SET title=%s, due=%s, updated_at=now() WHERE id=%s",
                (new_text, (new_due or None), int(task_id)))


def import_tasks(parsed):
    """Одноразовый импорт из tasks.md (parse_tasks): [{text,company,priority,due,done}]."""
    added = 0
    for t in parsed:
        execute("INSERT INTO tasks(uid,company,title,priority,due,status) VALUES(%s,%s,%s,%s,%s,%s)",
                (secrets.token_hex(8), (t.get("company") or ""), t.get("text", ""),
                 (t.get("priority") or "🟡"), (t.get("due") or None),
                 ("done" if t.get("done") else "active")))
        added += 1
    return added


# ---------- Клиентское состояние (здоровье/трекер) ----------
def cstate_get(user_id, key):
    r = query_one("SELECT data FROM client_state WHERE user_id=%s AND key=%s", (user_id, key))
    return r["data"] if r else None


def cstate_set(user_id, key, data_json):
    execute("INSERT INTO client_state(user_id,key,data,updated_at) VALUES(%s,%s,%s::jsonb,now()) "
            "ON CONFLICT (user_id,key) DO UPDATE SET data=EXCLUDED.data, updated_at=now()",
            (user_id, key, data_json))


# ---------- Универсальное key-value хранилище (Фаза 3: весь GitHub-как-БД) ----------
# Документное хранилище «путь → содержимое файла». Заменяет запись JSON/MD-файлов
# в GitHub на атомарный upsert в Postgres. Все домены (сделки, дедлайны, повестка,
# напоминания, финансы, уведомления, push, аудит, цели, привычки и т.д.) переезжают
# разом — прикладной код по-прежнему зовёт gh_read/gh_write, а маршрутизация в app.py.
def kv_get(path):
    r = query_one("SELECT content FROM kv WHERE path=%s", (path,))
    return r["content"] if r else None


def kv_set(path, content):
    execute("INSERT INTO kv(path,content,updated_at) VALUES(%s,%s,now()) "
            "ON CONFLICT (path) DO UPDATE SET content=EXCLUDED.content, updated_at=now()",
            (path, content))


def kv_del(path):
    execute("DELETE FROM kv WHERE path=%s", (path,))


def kv_count():
    r = query_one("SELECT count(*) AS n FROM kv")
    return int(r["n"]) if r else 0


def status():
    if not db_available():
        return {"connected": False, "reason": "DATABASE_URL не задан или psycopg не установлен"}
    try:
        tables = query("SELECT table_name FROM information_schema.tables "
                       "WHERE table_schema='public' ORDER BY table_name")
        out = {}
        for t in tables:
            name = t["table_name"]
            try:
                out[name] = query_one(f'SELECT count(*) AS n FROM "{name}"')["n"]
            except Exception:
                out[name] = None
        return {"connected": True, "tables": out, "count": len(out)}
    except Exception as e:
        return {"connected": False, "error": str(e)[:200]}
