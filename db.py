# -*- coding: utf-8 -*-
"""
Слой доступа к PostgreSQL (Фаза 0 переезда с GitHub-как-БД).
Пока НЕ подключён к доменам — только фундамент: соединение, создание схемы, статус.
Если DATABASE_URL не задан или psycopg не установлен — модуль «спит», приложение
продолжает работать на GitHub. Никакого влияния на текущее поведение.
"""
import os

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
