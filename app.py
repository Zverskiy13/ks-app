# -*- coding: utf-8 -*-
"""
«Клиники Столицы» — API + хостинг PWA (один сервис на Railway).
Читает реальное состояние бота из GitHub-репозитория и отдаёт его фронту
с ролевой фильтрацией. Также раздаёт сам фронт (папка ./webapp).

ENV (Railway → Variables):
  GITHUB_TOKEN   — тот же fine-grained PAT, что у бота (Contents: read)
  GITHUB_REPO    — например Zverskiy13/ks-telegram-bot
  GITHUB_BRANCH  — main
  APP_PINS       — (опц.) JSON-карта PIN→роль; иначе демо-пины 1111/2222/3333
Старт: uvicorn app:app --host 0.0.0.0 --port $PORT   (см. Procfile)
"""
import os, json, base64, re, datetime as dt
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests

GH_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GH_REPO = os.environ.get("GITHUB_REPO", "")
GH_BRANCH = os.environ.get("GITHUB_BRANCH", "main")

ROLE_SECTIONS = {
    "owner": ["home", "tasks", "money", "funnel", "more"],
    "head":  ["home", "tasks", "money", "funnel", "more"],
    "staff": ["home", "tasks", "more"],
}
DEFAULT_PINS = {
    "1111": {"id": "ivan",  "name": "Иван Кузин",         "role": "owner", "companies": "*",          "title": "Владелец"},
    "2222": {"id": "natav", "name": "Наталья Мартиросян", "role": "head",  "companies": ["Калмыкия"], "title": "Руководитель · Калмыкия"},
    "3333": {"id": "emp1",  "name": "Администратор ПВЛ",  "role": "staff", "companies": ["ПВЛ"],      "title": "Сотрудник · ПВЛ"},
}
PINS = json.loads(os.environ["APP_PINS"]) if os.environ.get("APP_PINS") else DEFAULT_PINS

app = FastAPI(title="Клиники Столицы")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def gh_read(path):
    if not (GH_TOKEN and GH_REPO):
        return None
    try:
        r = requests.get(f"https://api.github.com/repos/{GH_REPO}/contents/{path}?ref={GH_BRANCH}",
                         headers={"Authorization": f"token {GH_TOKEN}"}, timeout=15)
        if r.status_code == 200:
            return base64.b64decode(r.json()["content"]).decode("utf-8")
    except Exception:
        pass
    return None


def load_json(path, default):
    txt = gh_read(path)
    try:
        return json.loads(txt) if txt else default
    except Exception:
        return default


def by_id(uid):
    for u in PINS.values():
        if u["id"] == uid:
            return {**u, "sections": ROLE_SECTIONS[u["role"]]}
    return {"id": uid, "role": "staff", "companies": [], "sections": ROLE_SECTIONS["staff"]}


def can_company(profile, company):
    if profile["role"] == "owner" or profile.get("companies") == "*":
        return True
    if company in ("Группа", "*", ""):
        return False
    return any(c in company for c in profile.get("companies", []))


# ---------- модель состояния бота → форма фронта ----------
def parse_tasks(md):
    out = []
    if "## Активные" not in (md or ""):
        return out
    block = md.split("## Активные", 1)[1].split("\n##", 1)[0]
    i = 0
    for ln in block.splitlines():
        ln = ln.strip()
        if not ln.startswith("- "):
            continue
        pr = next((e for e in ("🔴", "🟡", "🟢") if e in ln), "🟡")
        m = re.search(r"\[([^\]]+)\]", ln)
        text = ln.lstrip("- ")
        for e in ("🔴", "🟡", "🟢"):
            text = text.replace(e, "")
        text = re.sub(r"\[[^\]]*\]", "", text)
        text = re.sub(r"_\([^)]*\)_", "", text)
        text = re.sub(r"\(T-[^)]*\)", "", text).strip()
        i += 1
        out.append({"id": "t" + str(i), "text": text, "priority": pr,
                    "company": m.group(1) if m else "", "due": "", "done": False})
    return out


def days_until(date_str):
    try:
        return (dt.date.fromisoformat(date_str) - dt.date.today()).days
    except Exception:
        return None


class Login(BaseModel):
    pin: str


@app.post("/api/login")
def login(b: Login):
    u = PINS.get(b.pin)
    if not u:
        raise HTTPException(401, "Неверный PIN")
    return {"ok": True, "profile": {**u, "sections": ROLE_SECTIONS[u["role"]]}}


@app.get("/api/today")
def today(user: str = ""):
    profile = by_id(user)
    today_iso = dt.date.today().isoformat()
    agenda = []
    for a in load_json("state/agenda.json", []):
        if a.get("date") == today_iso and a.get("start"):
            if profile["role"] == "owner" or can_company(profile, a.get("company", "")) or not a.get("company"):
                agenda.append({"time": a["start"], "text": a.get("text", ""), "icon": "ti-clock"})
    agenda.sort(key=lambda x: x["time"])
    dls = []
    for d in load_json("state/deadlines.json", []):
        if d.get("done"):
            continue
        n = days_until(d.get("date", ""))
        if n is None:
            continue
        if profile["role"] != "owner" and not (can_company(profile, d.get("company", "")) or d.get("company") == "Группа" and profile["role"] == "head"):
            continue
        lvl = "red" if n <= 7 else ("amber" if n <= 21 else "green")
        dls.append({"days": max(n, 0), "text": d.get("text", "")[:22], "level": lvl})
    dls.sort(key=lambda x: x["days"])
    return {"agenda": agenda, "deadlines": dls[:3]}


@app.get("/api/tasks")
def tasks(user: str = ""):
    profile = by_id(user)
    items = parse_tasks(gh_read("state/tasks.md") or "")
    if profile["role"] == "owner":
        return items
    if profile["role"] == "head":
        return [t for t in items if can_company(profile, t.get("company", ""))]
    return [t for t in items if t.get("assignee") == profile["id"]]


@app.post("/api/tasks/{tid}/toggle")
def toggle(tid: str):
    return {"ok": True}  # TODO: запись закрытия в tasks.md (через GitHub PUT)


@app.get("/api/deals")
def deals(user: str = ""):
    profile = by_id(user)
    raw = load_json("state/deals.json", [])
    today_d = dt.date.today()
    out = []
    for d in raw:
        try:
            silent = (today_d - dt.date.fromisoformat(d.get("last_touch", ""))).days
        except Exception:
            silent = 0
        out.append({"name": d.get("name", ""), "company": d.get("company", ""),
                    "stage": d.get("stage", "лид"), "step": d.get("next_step", ""), "silent": silent})
    if profile["role"] == "owner":
        return out
    if profile["role"] == "head":
        return [d for d in out if can_company(profile, d.get("company", ""))]
    return []


@app.get("/api/finance")
def finance(user: str = ""):
    profile = by_id(user)
    fin = load_json("state/finance.json", {})
    comps = fin.get("companies", {}) or {}
    def num(v):
        return isinstance(v, (int, float))
    if profile["role"] == "owner":
        income = sum((c.get("profit") or 0) * (c.get("share", 1.0) or 1.0)
                     for c in comps.values() if num(c.get("profit")))
        lev = load_json("state/levers.json", {})
        levers = lev.get("levers", []) if isinstance(lev, dict) else []
        return {"scope": "group", "data": {
            "ownerIncome": round(income), "goal": fin.get("goal_income", 5000000),
            "debt": fin.get("debt_total", 0),
            "companies": [{"name": k, "profit": v.get("profit") or 0} for k, v in comps.items() if num(v.get("profit"))],
            "levers": [{"name": l.get("name", ""), "impact": l.get("impact", 0), "progress": l.get("progress", 0)} for l in levers]
        }}
    if profile["role"] == "head":
        cos = [{"name": k, "profit": v.get("profit") or 0} for k, v in comps.items()
               if any(p in k for p in profile.get("companies", [])) and num(v.get("profit"))]
        return {"scope": "company", "data": {"companies": cos}}
    return {"scope": "none", "data": None}


# ---------- иконки приложения (генерируются при старте, без бинарей в git) ----------
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "webapp")


def ensure_icons():
    try:
        from PIL import Image, ImageDraw, ImageFont
    except Exception:
        return
    icodir = os.path.join(WEB, "icons")
    os.makedirs(icodir, exist_ok=True)
    sizes = {"apple-touch-icon.png": 180, "apple-touch-icon-167.png": 167,
             "apple-touch-icon-152.png": 152, "icon-192.png": 192,
             "icon-512.png": 512, "icon-maskable.png": 512}
    for fn, sz in sizes.items():
        p = os.path.join(icodir, fn)
        if os.path.exists(p):
            continue
        img = Image.new("RGB", (sz, sz), (225, 25, 28))   # фирменный красный
        d = ImageDraw.Draw(img)
        try:
            f = ImageFont.load_default(size=int(sz * 0.46))
        except TypeError:
            f = ImageFont.load_default()
        bb = d.textbbox((0, 0), "KC", font=f)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        d.text((sz / 2 - w / 2 - bb[0], sz / 2 - h / 2 - bb[1]), "KC", font=f, fill=(255, 255, 255))
        img.save(p, "PNG")


ensure_icons()

# ---------- статика PWA ----------
if os.path.isdir(WEB):
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
