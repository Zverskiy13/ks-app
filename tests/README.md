# Тесты приложения «Клиники Столицы»

Смоук-набор на pytest: авторизация, RBAC, хардининг `/api/finance/ingest`,
задачи, математика маржи/агрегатора. Слой хранения подменяется на память —
**сеть к GitHub и Postgres не нужны**, тесты быстрые и детерминированные.

## Запуск локально

```bash
cd КС_бэкенд_Railway
python -m venv .venv && source .venv/bin/activate    # опционально
pip install -r requirements-dev.txt
pytest
```

Ожидаемо: все тесты зелёные. Тестовые PIN и пользователи задаются автоматически
внутри `tests/conftest.py` (реальные `APP_PINS` из окружения не используются).

## Что проверяется

| Файл | Проверка |
|------|----------|
| `test_smoke.py::test_unauth_endpoints_blocked` | без сессии все `/api/*` → 401 |
| `…::test_login_wrong_pin` | неверный PIN → 401 |
| `…::test_login_me_logout` | вход даёт cookie, `me` работает, `logout` сбрасывает |
| `…::test_staff_denied_owner_routes` | сотрудник не видит финансы/БД/аудит (403) |
| `…::test_owner_allowed_owner_routes` | владелец видит owner-only |
| `…::test_ingest_disabled_without_token` | пустой `INGEST_TOKEN` → 503 |
| `…::test_ingest_bad_token` | неверный токен → 403 |
| `…::test_ingest_ok_and_margin_math` | занос + агрегатор: выручка/себест/маржа сходятся |
| `…::test_task_add_and_list` | добавление задачи и её появление в списке |
| `…::test_tasks_add_requires_auth` | эндпоинт без Depends всё равно закрыт middleware |

## CI (по желанию)

GitHub Actions — файл `.github/workflows/tests.yml`:

```yaml
name: tests
on: [push, pull_request]
jobs:
  pytest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.13" }
      - run: pip install -r КС_бэкенд_Railway/requirements-dev.txt
      - run: cd КС_бэкенд_Railway && pytest
```

## Прогон против настоящего Postgres (опционально)

По умолчанию тесты идут в github-режиме с памятью. Чтобы проверить БД-путь,
поднимите локальный Postgres и задайте перед запуском:

```bash
export DATABASE_URL=postgresql://localhost/ks_test
export TASKS_BACKEND=db
export STORAGE_BACKEND=db
pytest
```

(тогда часть тестов пойдёт через реальный KV/таблицы; слой памяти всё равно
подменяет GitHub-чтения, поэтому сеть не требуется).
