# -*- coding: utf-8 -*-
"""Смоук-тесты: авторизация, RBAC, хардининг ingest, задачи, математика маржи."""
import os
import json
import datetime as dt

from conftest import OWNER_PIN, STAFF_PIN


# ---------- Авторизация ----------
def test_unauth_endpoints_blocked(client):
    """Без сессии любой /api/* (кроме auth) закрыт middleware'ом _auth_guard."""
    for path in ("/api/home", "/api/tasks", "/api/today", "/api/push/test"):
        r = client.get(path) if path != "/api/push/test" else client.post(path, json={})
        assert r.status_code == 401, f"{path} должен быть 401 без сессии, а вернул {r.status_code}"


def test_login_wrong_pin(client):
    r = client.post("/api/auth/login", json={"pin": "000000"})
    assert r.status_code == 401


def test_login_me_logout(client):
    r = client.post("/api/auth/login", json={"pin": OWNER_PIN})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["profile"]["role"] == "owner"
    assert "sections" in body["profile"]

    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["ok"] is True

    out = client.post("/api/auth/logout")
    assert out.status_code == 200 and out.json()["ok"] is True

    me2 = client.get("/api/auth/me")
    assert me2.json()["ok"] is False


# ---------- RBAC ----------
def test_staff_denied_owner_routes(staff_client):
    """Сотрудник не имеет доступа к owner-only разделам."""
    assert staff_client.get("/api/finance/agg").status_code == 403
    assert staff_client.get("/api/db/status").status_code == 403
    assert staff_client.get("/api/audit/logins").status_code == 403


def test_staff_allowed_own_routes(staff_client):
    """Сотруднику доступны его разделы (задачи)."""
    r = staff_client.get("/api/tasks")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_owner_allowed_owner_routes(owner_client):
    r = owner_client.get("/api/finance/agg")
    assert r.status_code == 200 and r.json()["ok"] is True
    assert owner_client.get("/api/db/status").status_code == 200


# ---------- Хардининг /api/finance/ingest ----------
def test_ingest_disabled_without_token(owner_client, monkeypatch):
    monkeypatch.delenv("INGEST_TOKEN", raising=False)
    r = owner_client.post("/api/finance/ingest",
                          json={"date": "2026-07-01", "token": "", "rows": []})
    assert r.status_code == 503


def test_ingest_bad_token(owner_client, monkeypatch):
    monkeypatch.setenv("INGEST_TOKEN", "SECRET-XYZ")
    r = owner_client.post("/api/finance/ingest",
                          json={"date": "2026-07-01", "token": "wrong", "rows": []})
    assert r.status_code == 403


def test_ingest_ok_and_margin_math(owner_client, monkeypatch):
    monkeypatch.setenv("INGEST_TOKEN", "SECRET-XYZ")
    rows = [{"region": "Москва", "clinic": "Павелецкая", "revenue": 100000, "cost": 60000},
            {"region": "Чечня", "clinic": "Корпы", "revenue": 50000, "cost": 30000}]
    r = owner_client.post("/api/finance/ingest",
                          json={"date": "2026-07-05", "token": "SECRET-XYZ", "rows": rows})
    assert r.status_code == 200
    b = r.json()
    assert b["ok"] is True
    assert b["revenue"] == 150000
    assert b["cost"] == 90000
    assert b["margin"] == 60000

    # обратное чтение через агрегатор
    agg = owner_client.get("/api/finance/agg?ym=2026-07").json()
    assert agg["ok"] is True
    assert agg["totals"]["revenue"] == 150000
    assert agg["totals"]["margin"] == 60000
    assert "breakeven" in agg
    assert agg["breakeven"]["month_margin"] == 60000


# ---------- Задачи (github-режим: tasks.md в памяти) ----------
def test_task_add_and_list(owner_client):
    r = owner_client.post("/api/tasks/add",
                          json={"text": "Позвонить в лабораторию", "company": "Москва",
                                "priority": "🔴", "due": ""})
    assert r.status_code == 200 and r.json()["ok"] is True

    lst = owner_client.get("/api/tasks").json()
    texts = " ".join(t.get("text", "") for t in lst)
    assert "лабораторию" in texts


def test_tasks_add_requires_auth(client):
    """Эндпоинт без явного Depends всё равно закрыт middleware'ом."""
    r = client.post("/api/tasks/add", json={"text": "x"})
    assert r.status_code == 401


# ---------- Клиентское состояние: валидация ключа ----------
def test_state_bad_key(owner_client):
    r = owner_client.get("/api/state?key=evil")
    assert r.json()["ok"] is False
