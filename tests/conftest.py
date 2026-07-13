# -*- coding: utf-8 -*-
"""
Общая настройка pytest-смоука для приложения «Клиники Столицы».

Идея: поднимаем реальное FastAPI-приложение (app.py) через TestClient, но
- PIN/пользователей берём из тестового APP_PINS (владелец + сотрудник);
- слой хранения (gh_read/gh_write/gh_stat_read/load_store_safe) подменяем на
  словарь в памяти — БЕЗ сети к GitHub и БЕЗ Postgres;
- cookie-сессия работает по http (SESSION_INSECURE=1).

Так тесты ловят регрессии в auth/RBAC/эндпоинтах, которые не видны при py_compile.
Запуск:  pip install -r requirements-dev.txt && pytest -q
"""
import os
import sys
import json
import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)                 # .../КС_бэкенд_Railway
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

OWNER_PIN = "100200"
STAFF_PIN = "300400"
_TEST_PINS = {
    OWNER_PIN: {"id": "owner1", "name": "Владелец", "role": "owner",
                "companies": ["all"], "title": "CEO"},
    STAFF_PIN: {"id": "emp1", "name": "Сотрудник", "role": "staff",
                "companies": ["ПВЛ"], "title": "Врач"},
}


@pytest.fixture(scope="session")
def app_module():
    """Импортирует app.py с тестовым окружением (github-режим, без сети/БД)."""
    os.environ["APP_PINS"] = json.dumps(_TEST_PINS, ensure_ascii=False)
    os.environ["SECRET_KEY"] = "test-secret-key-fixed"
    os.environ["SESSION_INSECURE"] = "1"        # cookie без Secure — для http-тестов
    os.environ["STORAGE_BACKEND"] = "github"    # KV не задействуем — слой подменён
    for k in ("GITHUB_TOKEN", "GITHUB_REPO", "DATABASE_URL", "INGEST_TOKEN"):
        os.environ.pop(k, None)
    import app as app_mod
    return app_mod


@pytest.fixture(autouse=True)
def _isolate(app_module, monkeypatch):
    """Перед каждым тестом: чистое in-memory хранилище + сброс антибрутфорса."""
    store = {}

    def _gh_read(path, fresh=False):
        return store.get(path)

    def _gh_write(path, content, message=""):
        store[path] = content
        return True

    def _gh_stat_read(path):
        return (store[path], 200) if path in store else (None, 404)

    def _gh_delete(path, message=""):
        store.pop(path, None)
        return True

    def _load_store_safe(path):
        raw = store.get(path)
        if not raw:
            return {}, True
        try:
            data = json.loads(raw)
            return (data if isinstance(data, dict) else {}), True
        except Exception:
            return {}, True

    monkeypatch.setattr(app_module, "gh_read", _gh_read)
    monkeypatch.setattr(app_module, "gh_write", _gh_write)
    monkeypatch.setattr(app_module, "gh_stat_read", _gh_stat_read)
    monkeypatch.setattr(app_module, "gh_delete", _gh_delete)
    monkeypatch.setattr(app_module, "load_store_safe", _load_store_safe)
    app_module._LOGIN_FAILS.clear()             # сброс лимита входа между тестами
    return store


@pytest.fixture()
def client(app_module):
    from fastapi.testclient import TestClient
    return TestClient(app_module.app)


def _login(client, pin):
    return client.post("/api/auth/login", json={"pin": pin})


@pytest.fixture()
def owner_client(app_module):
    from fastapi.testclient import TestClient
    c = TestClient(app_module.app)
    r = _login(c, OWNER_PIN)
    assert r.status_code == 200 and r.json().get("ok") is True
    return c


@pytest.fixture()
def staff_client(app_module):
    from fastapi.testclient import TestClient
    c = TestClient(app_module.app)
    r = _login(c, STAFF_PIN)
    assert r.status_code == 200 and r.json().get("ok") is True
    return c
