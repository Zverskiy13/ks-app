# -*- coding: utf-8 -*-
"""Коннектор к МИС (модель pull): бот сам забирает текущие цифры.

Поддерживает НЕСКОЛЬКО источников-МИС (у нас две: «ЕС профосмотры» и «МИС
Реновация»). Каждая МИС реализует ОДИН одинаковый read-only endpoint по
контракту из «МИС_интеграция_ТЗ.md». Здесь — только клиент: запрос + разбор.
Сведение в finance.json (с суммированием по ПВЛ) — в bot.py (mis_sync_finance).

Источники задаются переменными окружения:
  MIS_SOURCES = es,renovation        — список активных источников (через запятую)
  для каждого <name>:
     MIS_<NAME>_URL   — базовый адрес, напр. https://api.es-profosmotr.ru/v1
     MIS_<NAME>_TOKEN — токен (Bearer), только чтение
  Пример (стартуем с одной МИС):  MIS_SOURCES=es
     MIS_ES_URL=...   MIS_ES_TOKEN=...

Совместимость: если задана одна МИС старым способом (MIS_API_URL / MIS_API_TOKEN),
она используется как источник «default».

Опц.: MIS_PERIOD (month|day, по умолчанию month), MIS_TIMEOUT (сек, 30).
"""
import os
import requests

MIS_PERIOD = os.environ.get("MIS_PERIOD", "month").strip()
TIMEOUT = int(os.environ.get("MIS_TIMEOUT", "30"))


def _sources_from_env():
    src, seen = [], set()
    names = os.environ.get("MIS_SOURCES", "").strip()
    if names:
        for n in [x.strip() for x in names.split(",") if x.strip()]:
            url = os.environ.get(f"MIS_{n.upper()}_URL", "").strip().rstrip("/")
            tok = os.environ.get(f"MIS_{n.upper()}_TOKEN", "").strip()
            if url and tok:
                src.append({"name": n, "url": url, "token": tok})
                seen.add(url)
    # обратная совместимость: одиночная МИС
    u = os.environ.get("MIS_API_URL", "").strip().rstrip("/")
    t = os.environ.get("MIS_API_TOKEN", "").strip()
    if u and t and u not in seen:
        src.append({"name": "default", "url": u, "token": t})
    return src


def sources():
    return _sources_from_env()


def configured():
    return bool(_sources_from_env())


def fetch(source, period=None, date=None):
    """GET {source.url}/summary?period=... → dict по контракту ТЗ."""
    params = {"period": period or MIS_PERIOD}
    if date:
        params["date"] = date
    r = requests.get(f"{source['url']}/summary",
                     headers={"Authorization": f"Bearer {source['token']}", "Accept": "application/json"},
                     params=params, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()
