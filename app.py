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
import os, json, base64, re, threading, time as _time, datetime as dt
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests

GH_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GH_REPO = os.environ.get("GITHUB_REPO", "")
GH_BRANCH = os.environ.get("GITHUB_BRANCH", "main")

# ---------- Web Push (VAPID) ----------
VAPID_PUBLIC = os.environ.get("VAPID_PUBLIC", "BM9xFCyzg-emFABRWFgNt3-1ChYdUhhCgfZC5FZAumBhvidqJ3eeLNRdcMC8Sx-2sWh91PjM3NwAywvJGh00PT8")
VAPID_SUB = os.environ.get("VAPID_SUB", "mailto:admin@kliniki-stolicy.ru")
_VAPID_PEM = "/tmp/vapid.pem"


def _normalize_pem(raw):
    """Принять ключ как угодно: многострочный PEM, PEM с \\n, или просто base64 одной строкой."""
    raw = (raw or "").strip().replace("\\n", "\n")
    m = re.search(r"-----BEGIN ([A-Z ]+)-----(.*?)-----END \1-----", raw, re.S)
    if m:
        label, body = m.group(1).strip(), re.sub(r"\s+", "", m.group(2))
    else:
        label, body = "PRIVATE KEY", re.sub(r"\s+", "", raw)
    wrapped = "\n".join(body[i:i + 64] for i in range(0, len(body), 64))
    return f"-----BEGIN {label}-----\n{wrapped}\n-----END {label}-----\n"


if os.environ.get("VAPID_PRIVATE"):
    try:
        with open(_VAPID_PEM, "w") as _f:
            _f.write(_normalize_pem(os.environ["VAPID_PRIVATE"]))
    except Exception:
        pass
PUSH_HOUR_UTC = int(os.environ.get("PUSH_HOUR_UTC", "5"))   # ≈8:00 МСК — утренний пуш


def push_ready():
    return os.path.exists(_VAPID_PEM)


def send_push(sub, payload):
    from pywebpush import webpush
    webpush(subscription_info=sub, data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=_VAPID_PEM, vapid_claims={"sub": VAPID_SUB})

ROLE_SECTIONS = {
    "owner": ["home", "day", "tasks", "journal", "money", "funnel", "more"],
    "head":  ["home", "day", "tasks", "journal", "money", "funnel", "more"],
    "staff": ["home", "day", "tasks", "journal", "more"],
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


def gh_write(path, content, message):
    """Записать файл в репозиторий бота (PUT contents с актуальным sha)."""
    if not (GH_TOKEN and GH_REPO):
        return False
    url = f"https://api.github.com/repos/{GH_REPO}/contents/{path}"
    h = {"Authorization": f"token {GH_TOKEN}", "Accept": "application/vnd.github+json"}
    sha = None
    try:
        r = requests.get(f"{url}?ref={GH_BRANCH}", headers=h, timeout=15)
        if r.status_code == 200:
            sha = r.json().get("sha")
    except Exception:
        pass
    body = {"message": message, "branch": GH_BRANCH,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii")}
    if sha:
        body["sha"] = sha
    try:
        pr = requests.put(url, headers=h, json=body, timeout=20)
        return pr.status_code in (200, 201)
    except Exception:
        return False


def _clean_task(s):
    s = s.lstrip("- ")
    for e in ("🔴", "🟡", "🟢", "✅"):
        s = s.replace(e, "")
    s = re.sub(r"\[[^\]]*\]", "", s)
    s = re.sub(r"\(до:\d{4}-\d{2}-\d{2}\)", "", s)
    s = re.sub(r"_\([^)]*\)_", "", s)
    s = re.sub(r"\(T-[^)]*\)", "", s)
    return re.sub(r"\s+", " ", s).strip()


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
def _parse_section(md, header, done):
    out = []
    if header not in (md or ""):
        return out
    block = md.split(header, 1)[1].split("\n##", 1)[0]
    i = 0
    for ln in block.splitlines():
        ln = ln.strip()
        if not ln.startswith("- "):
            continue
        pr = next((e for e in ("🔴", "🟡", "🟢") if e in ln), "🟡")
        m = re.search(r"\[([^\]]+)\]", ln)
        dm = re.search(r"\(до:(\d{4}-\d{2}-\d{2})\)", ln)
        text = ln.lstrip("- ")
        for e in ("🔴", "🟡", "🟢", "✅"):
            text = text.replace(e, "")
        text = re.sub(r"\[[^\]]*\]", "", text)
        text = re.sub(r"\(до:\d{4}-\d{2}-\d{2}\)", "", text)
        text = re.sub(r"_\([^)]*\)_", "", text)
        text = re.sub(r"\(T-[^)]*\)", "", text).strip()
        i += 1
        out.append({"id": ("d" if done else "t") + str(i), "text": text, "priority": pr,
                    "company": m.group(1) if m else "", "due": dm.group(1) if dm else "", "done": done})
    return out


def parse_tasks(md):
    # активные + последние выполненные (для вкладки «Выполнено»)
    return _parse_section(md, "## Активные", False) + _parse_section(md, "## Выполнено", True)[:40]


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
        if a.get("date") == today_iso and a.get("start") and not a.get("done"):
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


class Done(BaseModel):
    text: str


@app.post("/api/tasks/done")
def task_done(b: Done):
    """Закрыть задачу: убрать из «Активные», добавить в «Выполнено». Пишет в tasks.md."""
    md = gh_read("state/tasks.md") or ""
    target = (b.text or "").strip()
    if not target or "## Активные" not in md:
        return {"ok": False}
    out, removed, in_active = [], None, False
    for l in md.splitlines():
        st = l.strip()
        if st.startswith("## "):
            in_active = (st == "## Активные")
        if in_active and removed is None and st.startswith("- ") and \
                (target in _clean_task(l) or _clean_task(l) in target):
            removed = l
            continue
        out.append(l)
    if removed is None:
        return {"ok": False, "reason": "not found"}
    md2 = "\n".join(out)
    done = f"- ✅ {target} _(закрыто {dt.date.today().isoformat()})_"
    if "## Выполнено" in md2:
        md2 = md2.replace("## Выполнено", "## Выполнено\n" + done, 1)
    else:
        md2 = md2.rstrip() + "\n\n## Выполнено\n" + done + "\n"
    return {"ok": gh_write("state/tasks.md", md2, "app: закрыта задача — " + target[:40])}


class EditTask(BaseModel):
    old_text: str
    new_text: str
    due: str = "__keep__"   # "__keep__" — не трогать срок; "" — убрать; "YYYY-MM-DD" — поставить


@app.post("/api/tasks/edit")
def task_edit(b: EditTask):
    md = gh_read("state/tasks.md") or ""
    target = (b.old_text or "").strip()
    new = (b.new_text or "").strip()
    if not target or not new or "## Активные" not in md:
        return {"ok": False}
    out, edited, in_active = [], False, False
    for l in md.splitlines():
        st = l.strip()
        if st.startswith("## "):
            in_active = (st == "## Активные")
        if in_active and not edited and st.startswith("- ") and (target in _clean_task(l) or _clean_task(l) in target):
            pr = next((e for e in ("🔴", "🟡", "🟢") if e in l), "🟡")
            mc = re.search(r"\[([^\]]+)\]", l)
            mt = re.search(r"_\([^)]*\)_", l)
            md_old = re.search(r"\(до:(\d{4}-\d{2}-\d{2})\)", l)
            comp = mc.group(1) if mc else "Личное"
            tail = (" " + mt.group(0)) if mt else ""
            due_val = (md_old.group(1) if md_old else "") if b.due == "__keep__" else b.due
            due_tag = f" (до:{due_val})" if due_val else ""
            out.append(f"- {pr} [{comp}] {new}{due_tag}{tail}")
            edited = True
            continue
        out.append(l)
    if not edited:
        return {"ok": False, "reason": "not found"}
    return {"ok": gh_write("state/tasks.md", "\n".join(out), "app: правка задачи")}


class Touch(BaseModel):
    name: str


@app.post("/api/deals/touch")
def deal_touch(b: Touch):
    """Отметить касание сделки: last_touch = сегодня. Пишет в deals.json."""
    deals = load_json("state/deals.json", [])
    nm = (b.name or "").strip()
    hit = False
    for d in deals:
        if nm and nm in d.get("name", ""):
            d["last_touch"] = dt.date.today().isoformat()
            hit = True
            break
    if not hit:
        return {"ok": False}
    return {"ok": gh_write("state/deals.json", json.dumps(deals, ensure_ascii=False, indent=2), "app: касание сделки")}


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


class AddTask(BaseModel):
    text: str
    company: str = ""
    priority: str = "🟡"
    due: str = ""


@app.post("/api/tasks/add")
def task_add(b: AddTask):
    md = gh_read("state/tasks.md") or "# Задачи\n\n## Активные\n\n## Выполнено\n"
    today = dt.date.today().isoformat()
    due_tag = f" (до:{b.due})" if b.due else ""
    line = f"- {b.priority} [{b.company or 'Личное'}] {b.text.strip()}{due_tag} _(добавлено {today})_"
    md2 = md.replace("## Активные", "## Активные\n" + line, 1) if "## Активные" in md \
        else md.rstrip() + "\n\n## Активные\n" + line + "\n"
    return {"ok": gh_write("state/tasks.md", md2, "app: новая задача")}


def _norm_simple(line):
    s = line.lstrip("- ")
    for e in ("🔴", "🟡", "🟢", "✅"):
        s = s.replace(e, "")
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = re.sub(r"_\([^)]*\)_", " ", s)
    s = re.sub(r"\(T-[^)]*\)", " ", s)
    s = re.sub(r"[^\wа-яё0-9 ]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def _similar(a, b):
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    sa = {w[:5] for w in a.split() if len(w) >= 4}
    sb = {w[:5] for w in b.split() if len(w) >= 4}
    if not sa or not sb:
        return False
    return len(sa & sb) / len(sa | sb) >= 0.6


@app.post("/api/tasks/dedup")
def tasks_dedup():
    md = gh_read("state/tasks.md") or ""
    if "## Активные" not in md:
        return {"ok": False, "removed": 0}
    head, rest = md.split("## Активные", 1)
    active_block = rest.split("\n##", 1)[0]
    after = rest[len(active_block):]
    lines = [l for l in active_block.splitlines() if l.strip().startswith("- ")]
    norms = [_norm_simple(l) for l in lines]
    n = len(lines)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for i in range(n):
        for j in range(i + 1, n):
            if _similar(norms[i], norms[j]):
                parent[find(i)] = find(j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    drop = set()
    for idxs in groups.values():
        if len(idxs) < 2:
            continue
        keep = max(idxs, key=lambda k: len(lines[k]))
        for k in idxs:
            if k != keep:
                drop.add(k)
    if not drop:
        return {"ok": True, "removed": 0}
    kept = [lines[k] for k in range(n) if k not in drop]
    new_md = head + "## Активные\n" + "\n".join(kept) + "\n" + after
    return {"ok": gh_write("state/tasks.md", new_md, f"app: dedup -{len(drop)}"), "removed": len(drop)}


class AddReminder(BaseModel):
    date: str
    time: str = "09:00"
    text: str


@app.post("/api/reminders/add")
def reminder_add(b: AddReminder):
    rems = load_json("state/reminders.json", [])
    rems.append({"when": f"{b.date}T{b.time}", "text": b.text.strip(), "done": False})
    return {"ok": gh_write("state/reminders.json", json.dumps(rems, ensure_ascii=False, indent=2), "app: напоминание")}


class AddBlock(BaseModel):
    date: str
    start: str
    end: str = ""
    text: str


@app.post("/api/agenda/add")
def agenda_add(b: AddBlock):
    ag = load_json("state/agenda.json", [])
    ag.append({"date": b.date, "start": b.start, "end": (b.end or None), "text": b.text.strip()})
    return {"ok": gh_write("state/agenda.json", json.dumps(ag, ensure_ascii=False, indent=2), "app: блок в сетку")}


@app.get("/api/month")
def month(ym: str = ""):
    ym = ym or dt.date.today().isoformat()[:7]
    dates = set()
    for a in load_json("state/agenda.json", []):
        if a.get("start") and str(a.get("date", ""))[:7] == ym:
            dates.add(a["date"])
    for r in load_json("state/reminders.json", []):
        if r.get("done"):
            continue
        w = r.get("when", "")
        if len(w) >= 10 and w[:7] == ym:
            dates.add(w[:10])
    return {"dates": sorted(dates)}


class Note(BaseModel):
    text: str


@app.post("/api/note/add")
def note_add(b: Note):
    j = gh_read("state/journal.md") or "# Дневник\n"
    stamp = dt.datetime.now(dt.timezone(dt.timedelta(hours=3))).strftime("%Y-%m-%d %H:%M")
    j = j.rstrip() + f"\n- {stamp} · {b.text.strip()}\n"
    return {"ok": gh_write("state/journal.md", j, "app: заметка")}


class ItemMove(BaseModel):
    kind: str            # "block" | "rem"
    date: str
    start: str
    text: str
    new_date: str
    new_start: str
    new_end: str = ""


@app.post("/api/item/move")
def item_move(b: ItemMove):
    if b.kind == "block":
        ag = load_json("state/agenda.json", [])
        for a in ag:
            if a.get("date") == b.date and a.get("start") == b.start and a.get("text", "") == b.text:
                a["date"] = b.new_date
                a["start"] = b.new_start
                a["end"] = b.new_end or None
                return {"ok": gh_write("state/agenda.json", json.dumps(ag, ensure_ascii=False, indent=2), "app: перенос блока")}
        return {"ok": False, "reason": "not found"}
    else:
        rems = load_json("state/reminders.json", [])
        for r in rems:
            w = r.get("when", "")
            if w[:10] == b.date and w[11:16] == b.start and r.get("text", "") == b.text:
                r["when"] = f"{b.new_date}T{b.new_start}"
                return {"ok": gh_write("state/reminders.json", json.dumps(rems, ensure_ascii=False, indent=2), "app: перенос напоминания")}
        return {"ok": False, "reason": "not found"}


class ItemDel(BaseModel):
    kind: str
    date: str
    start: str
    text: str


@app.post("/api/item/delete")
def item_delete(b: ItemDel):
    if b.kind == "block":
        ag = load_json("state/agenda.json", [])
        new = [a for a in ag if not (a.get("date") == b.date and a.get("start") == b.start and a.get("text", "") == b.text)]
        if len(new) == len(ag):
            return {"ok": False, "reason": "not found"}
        return {"ok": gh_write("state/agenda.json", json.dumps(new, ensure_ascii=False, indent=2), "app: удалён блок")}
    else:
        rems = load_json("state/reminders.json", [])
        new = [r for r in rems if not (r.get("when", "")[:10] == b.date and r.get("when", "")[11:16] == b.start and r.get("text", "") == b.text)]
        if len(new) == len(rems):
            return {"ok": False, "reason": "not found"}
        return {"ok": gh_write("state/reminders.json", json.dumps(new, ensure_ascii=False, indent=2), "app: удалено напоминание")}


@app.get("/api/journal")
def journal(limit: int = 50):
    j = gh_read("state/journal.md") or ""
    entries = []
    for ln in j.splitlines():
        m = re.match(r"^- (.+?) · (.+)$", ln.strip())
        if m:
            entries.append({"ts": m.group(1), "text": m.group(2)})
    entries.reverse()
    return {"entries": entries[:limit]}


@app.get("/api/day")
def day(user: str = "", date: str = ""):
    d = date or dt.date.today().isoformat()
    items = []
    for a in load_json("state/agenda.json", []):
        if a.get("date") == d and a.get("start") and not a.get("done"):
            items.append({"start": a["start"], "end": a.get("end"), "text": a.get("text", ""), "kind": "block"})
    for r in load_json("state/reminders.json", []):
        if r.get("done"):
            continue
        w = r.get("when", "")
        if len(w) >= 16 and w[:10] == d and "T" in w:
            items.append({"start": w[11:16], "end": None, "text": r.get("text", ""), "kind": "rem"})
    items.sort(key=lambda x: x["start"])

    def m(s):
        try:
            hh, mm = s.split(":")
            return int(hh) * 60 + int(mm)
        except Exception:
            return None
    ws, we = 8 * 60, 22 * 60
    busy = []
    for it in items:
        s = m(it["start"])
        e = m(it["end"]) if it["end"] else (s + 60 if s is not None else None)
        if s is None:
            continue
        busy.append((max(s, ws), min(max(e, s + 15), we)))
    busy = [x for x in busy if x[0] < we and x[1] > ws]
    busy.sort()
    free, cur = [], ws
    for s, e in busy:
        if s > cur:
            free.append(f"{cur//60:02d}:{cur%60:02d}–{s//60:02d}:{s%60:02d}")
        cur = max(cur, e)
    if cur < we:
        free.append(f"{cur//60:02d}:{cur%60:02d}–22:00")
    # выполненные за этот день (из сетки и напоминаний) — для разбора «что сделано»
    done_items = []
    for a in load_json("state/agenda.json", []):
        if a.get("date") == d and a.get("start") and a.get("done"):
            done_items.append({"start": a["start"], "text": a.get("text", ""), "kind": "block"})
    for r in load_json("state/reminders.json", []):
        w = r.get("when", "")
        if r.get("done") and len(w) >= 16 and w[:10] == d and "T" in w:
            done_items.append({"start": w[11:16], "text": r.get("text", ""), "kind": "rem"})
    done_items.sort(key=lambda x: x["start"])
    return {"date": d, "items": items, "free": free, "done": done_items}


@app.get("/api/push/key")
def push_key():
    return {"key": VAPID_PUBLIC, "ready": push_ready()}


class Sub(BaseModel):
    subscription: dict


@app.post("/api/push/subscribe")
def push_subscribe(b: Sub):
    subs = load_json("state/push_subs.json", [])
    ep = (b.subscription or {}).get("endpoint")
    if not ep:
        return {"ok": False}
    if not any(s.get("endpoint") == ep for s in subs):
        subs.append(b.subscription)
        gh_write("state/push_subs.json", json.dumps(subs, ensure_ascii=False, indent=2), "app: push subscribe")
    return {"ok": True, "count": len(subs)}


@app.post("/api/push/test")
def push_test():
    if not push_ready():
        return {"ok": False, "reason": "VAPID_PRIVATE не задан"}
    subs = load_json("state/push_subs.json", [])
    sent = 0
    for s in subs:
        try:
            send_push(s, {"title": "Клиники Столицы", "body": "Тест уведомления — всё работает ✓", "url": "/"})
            sent += 1
        except Exception:
            pass
    return {"ok": True, "sent": sent}


def _push_morning_loop():
    last = {"d": ""}
    while True:
        try:
            now = dt.datetime.now(dt.timezone.utc)
            today = dt.date.today().isoformat()
            if now.hour == PUSH_HOUR_UTC and last["d"] != today and push_ready():
                subs = load_json("state/push_subs.json", [])
                if subs:
                    near = []
                    for d in load_json("state/deadlines.json", []):
                        if d.get("done"):
                            continue
                        n = days_until(d.get("date", ""))
                        if n is not None and 0 <= n <= 7:
                            near.append(f"{d.get('text', '')[:28]} — {n} дн")
                    body = ("🔴 Горящее: " + "; ".join(near[:3])) if near else "Доброе утро! Открой план на день."
                    for s in subs:
                        try:
                            send_push(s, {"title": "Доброе утро, Иван", "body": body, "url": "/"})
                        except Exception:
                            pass
                last["d"] = today
        except Exception:
            pass
        _time.sleep(180)


threading.Thread(target=_push_morning_loop, daemon=True).start()


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

# ---------- отметить пункт сетки/напоминание выполненным ----------
class ItemDone(BaseModel):
    kind: str
    date: str
    start: str
    text: str


@app.post("/api/item/done")
def item_done(b: ItemDone):
    if b.kind == "block":
        ag = load_json("state/agenda.json", [])
        for a in ag:
            if a.get("date") == b.date and a.get("start") == b.start and a.get("text", "") == b.text:
                a["done"] = True
                return {"ok": gh_write("state/agenda.json", json.dumps(ag, ensure_ascii=False, indent=2), "app: блок выполнен")}
        return {"ok": False, "reason": "not found"}
    else:
        rems = load_json("state/reminders.json", [])
        for r in rems:
            w = r.get("when", "")
            if w[:10] == b.date and w[11:16] == b.start and r.get("text", "") == b.text:
                r["done"] = True
                return {"ok": gh_write("state/reminders.json", json.dumps(rems, ensure_ascii=False, indent=2), "app: напоминание выполнено")}
        return {"ok": False, "reason": "not found"}


# ---------- дедлайны: список / правка / выполнено / добавить ----------
@app.get("/api/deadlines")
def deadlines_list(user: str = ""):
    profile = by_id(user)
    raw = load_json("state/deadlines.json", [])
    out = []
    for i, d in enumerate(raw):
        if d.get("done"):
            continue
        if profile["role"] != "owner" and not (can_company(profile, d.get("company", "")) or (d.get("company") == "Группа" and profile["role"] == "head")):
            continue
        n = days_until(d.get("date", ""))
        out.append({"i": i, "date": d.get("date", ""), "text": d.get("text", ""),
                    "company": d.get("company", ""), "days": n})
    out.sort(key=lambda x: (x["days"] is None, x["days"] if x["days"] is not None else 0))
    return out


class DlEdit(BaseModel):
    i: int
    date: str = ""
    text: str = ""


@app.post("/api/deadlines/edit")
def deadline_edit(b: DlEdit):
    raw = load_json("state/deadlines.json", [])
    if b.i < 0 or b.i >= len(raw):
        return {"ok": False, "reason": "bad index"}
    if b.date:
        raw[b.i]["date"] = b.date
    if b.text:
        raw[b.i]["text"] = b.text.strip()
    return {"ok": gh_write("state/deadlines.json", json.dumps(raw, ensure_ascii=False, indent=2), "app: дедлайн изменён")}


class DlDone(BaseModel):
    i: int


@app.post("/api/deadlines/done")
def deadline_done(b: DlDone):
    raw = load_json("state/deadlines.json", [])
    if b.i < 0 or b.i >= len(raw):
        return {"ok": False}
    raw[b.i]["done"] = True
    return {"ok": gh_write("state/deadlines.json", json.dumps(raw, ensure_ascii=False, indent=2), "app: дедлайн закрыт")}


class DlAdd(BaseModel):
    date: str
    text: str
    company: str = ""


@app.post("/api/deadlines/add")
def deadline_add(b: DlAdd):
    raw = load_json("state/deadlines.json", [])
    raw.append({"date": b.date, "text": b.text.strip(), "company": b.company, "done": False})
    return {"ok": gh_write("state/deadlines.json", json.dumps(raw, ensure_ascii=False, indent=2), "app: новый дедлайн")}


# ---------- цели и рычаги ----------
@app.get("/api/goals")
def goals(user: str = ""):
    bosses = load_json("state/bosses.json", [])
    gl = []
    for g in bosses:
        tot = g.get("total") or 0
        left = g.get("left", tot)
        pct = 0 if not tot else max(0, min(100, round((tot - left) / tot * 100)))
        gl.append({"name": g.get("name", ""), "total": tot, "left": left, "unit": g.get("unit", ""), "pct": pct})
    lev = load_json("state/levers.json", {})
    levers = lev.get("levers", []) if isinstance(lev, dict) else []
    levers = [{"name": l.get("name", ""), "impact": l.get("impact", 0),
               "progress": l.get("progress", 0), "note": l.get("note", "")} for l in levers]
    return {"goals": gl, "levers": levers}


# ---------- план недели ----------
@app.get("/api/weekplan")
def weekplan(user: str = ""):
    ag = load_json("state/agenda.json", [])
    rems = load_json("state/reminders.json", [])
    today = dt.date.today()
    days = []
    for off in range(7):
        iso = (today + dt.timedelta(days=off)).isoformat()
        items = []
        for a in ag:
            if a.get("date") == iso and a.get("start") and not a.get("done"):
                items.append({"time": a["start"], "text": a.get("text", ""), "kind": "block"})
        for r in rems:
            w = r.get("when", "")
            if not r.get("done") and w[:10] == iso and "T" in w:
                items.append({"time": w[11:16], "text": r.get("text", ""), "kind": "rem"})
        items.sort(key=lambda x: x["time"])
        days.append({"date": iso, "items": items})
    tasks = parse_tasks(gh_read("state/tasks.md") or "")
    tdy = today.isoformat()
    # задачи со сроком — кладём под свой день
    for d in days:
        for t in tasks:
            if not t["done"] and t.get("due") == d["date"]:
                d["items"].append({"time": "", "text": t["text"], "kind": "task"})
        d["items"].sort(key=lambda x: (x["time"] == "", x["time"]))
    # просроченные (дата в прошлом, не выполнено) — предложим перенести
    overdue = []
    for t in tasks:
        if not t["done"] and t.get("due") and t["due"] < tdy:
            overdue.append({"kind": "task", "text": t["text"], "date": t["due"]})
    for a in ag:
        if a.get("start") and not a.get("done") and a.get("date") and a["date"] < tdy:
            overdue.append({"kind": "block", "date": a["date"], "start": a["start"], "text": a.get("text", "")})
    for r in rems:
        w = r.get("when", "")
        if not r.get("done") and "T" in w and len(w) >= 16 and w[:10] < tdy:
            overdue.append({"kind": "rem", "date": w[:10], "start": w[11:16], "text": r.get("text", "")})
    overdue.sort(key=lambda x: x.get("date", ""))
    return {"days": days, "overdue": overdue}


# ---------- привычки и шаги ----------
def _streak(date_strs):
    days = set()
    for s in date_strs:
        try:
            days.add(dt.date.fromisoformat(s))
        except Exception:
            pass
    today = dt.date.today()
    if today in days:
        cur = today
    elif (today - dt.timedelta(days=1)) in days:
        cur = today - dt.timedelta(days=1)
    else:
        return 0
    n = 0
    while cur in days:
        n += 1
        cur -= dt.timedelta(days=1)
    return n


def _ladder_goal(plan, streak):
    ladder = plan.get("ladder") or []
    if not ladder:
        return plan.get("goal", "")
    cur = ladder[0].get("goal", "")
    for lvl in sorted(ladder, key=lambda x: x.get("min", 0)):
        if streak >= lvl.get("min", 0):
            cur = lvl.get("goal", cur)
    return cur


@app.get("/api/habits")
def habits(user: str = ""):
    plans = load_json("state/habit_plans.json", {})
    log = load_json("state/habits.json", {})
    today = dt.date.today()
    out = []
    for name in sorted(set(list(plans.keys()) + list(log.keys()))):
        dates = log.get(name, [])
        ds = set()
        for s in dates:
            try:
                ds.add(dt.date.fromisoformat(s))
            except Exception:
                pass
        chain = [(today - dt.timedelta(days=i)) in ds for i in range(6, -1, -1)]
        plan = plans.get(name, {})
        st = _streak(dates)
        out.append({"name": name, "streak": st, "chain": chain, "week": sum(chain),
                    "goal": _ladder_goal(plan, st), "anchor": plan.get("anchor", ""),
                    "category": plan.get("category", ""), "done_today": today.isoformat() in {s for s in dates}})
    return {"habits": out}


class HabitDone(BaseModel):
    habit: str


@app.post("/api/habits/done")
def habit_done(b: HabitDone):
    log = load_json("state/habits.json", {})
    today = dt.date.today().isoformat()
    arr = log.get(b.habit, [])
    if today not in arr:
        arr.append(today)
    log[b.habit] = arr
    return {"ok": gh_write("state/habits.json", json.dumps(log, ensure_ascii=False, indent=2), "app: привычка отмечена")}


# ---------- большие цели (год/месяц) ----------
@app.get("/api/biggoals")
def biggoals(user: str = ""):
    g = load_json("state/big_goals.json", [])
    order = {"open": 0, "done": 1, "miss": 2}
    return sorted(g, key=lambda x: (order.get(x.get("status", "open"), 0),
                                    0 if x.get("scope") == "year" else 1,
                                    x.get("period", "")), reverse=False)


class BGAdd(BaseModel):
    scope: str = "year"
    period: str = ""
    text: str = ""


@app.post("/api/biggoals/add")
def biggoal_add(b: BGAdd):
    import uuid
    g = load_json("state/big_goals.json", [])
    g.append({"id": uuid.uuid4().hex[:8], "scope": b.scope, "period": b.period,
              "text": b.text.strip(), "status": "open", "ts": dt.date.today().isoformat()})
    return {"ok": gh_write("state/big_goals.json", json.dumps(g, ensure_ascii=False, indent=2), "app: большая цель")}


class BGStatus(BaseModel):
    id: str
    status: str


@app.post("/api/biggoals/status")
def biggoal_status(b: BGStatus):
    g = load_json("state/big_goals.json", [])
    hit = False
    for x in g:
        if x.get("id") == b.id:
            x["status"] = b.status
            hit = True
            break
    if not hit:
        return {"ok": False}
    return {"ok": gh_write("state/big_goals.json", json.dumps(g, ensure_ascii=False, indent=2), "app: статус цели")}


class BGDel(BaseModel):
    id: str


@app.post("/api/biggoals/delete")
def biggoal_delete(b: BGDel):
    g = [x for x in load_json("state/big_goals.json", []) if x.get("id") != b.id]
    return {"ok": gh_write("state/big_goals.json", json.dumps(g, ensure_ascii=False, indent=2), "app: цель удалена")}


# ---------- группа компаний: помесячная прибыль по направлениям ----------
DEFAULT_DIRS = {"Клиника на Павелецкой": 1.0, "Агрегатор Москва": 1.0, "Астрахань": 1.0, "Калмыкия": 0.5}


def _prev_ym(ym):
    try:
        y, m = int(ym[:4]), int(ym[5:7])
    except Exception:
        return ""
    m -= 1
    if m < 1:
        m = 12
        y -= 1
    return f"{y}-{m:02d}"


@app.get("/api/group")
def group(user: str = "", ym: str = ""):
    months = load_json("state/finance_months.json", {})
    dirs = load_json("state/finance_dirs.json", {}) or dict(DEFAULT_DIRS)
    allym = sorted(months.keys())
    if not ym:
        ym = allym[-1] if allym else dt.date.today().isoformat()[:7]
    data = months.get(ym, {})
    prev = _prev_ym(ym)
    pdata = months.get(prev, {})
    names = list(dict.fromkeys(list(dirs.keys()) + list(data.keys())))
    rows = []
    total = owner = 0.0
    for n in names:
        p = data.get(n)
        share = dirs.get(n, 1.0)
        rows.append({"name": n, "profit": p, "prev": pdata.get(n), "share": share})
        if isinstance(p, (int, float)):
            total += p
            owner += p * share
    trend = [{"ym": y, "total": sum(v for v in months[y].values() if isinstance(v, (int, float)))} for y in allym[-6:]]
    return {"ym": ym, "prev_ym": prev, "rows": rows, "total": round(total),
            "owner_income": round(owner), "months": allym, "trend": trend}


class GroupSave(BaseModel):
    ym: str
    rows: list


@app.post("/api/group/save")
def group_save(b: GroupSave):
    months = load_json("state/finance_months.json", {})
    dirs = load_json("state/finance_dirs.json", {}) or dict(DEFAULT_DIRS)
    md = {}
    for r in b.rows:
        nm = (r.get("name") or "").strip()
        if not nm:
            continue
        pr = r.get("profit")
        try:
            pr = float(pr) if pr not in (None, "") else None
        except Exception:
            pr = None
        if pr is not None:
            md[nm] = pr
        sh = r.get("share")
        try:
            if sh not in (None, ""):
                dirs[nm] = float(sh)
        except Exception:
            pass
    months[b.ym] = md
    ok1 = gh_write("state/finance_months.json", json.dumps(months, ensure_ascii=False, indent=2), f"app: финансы группы {b.ym}")
    ok2 = gh_write("state/finance_dirs.json", json.dumps(dirs, ensure_ascii=False, indent=2), "app: доли направлений")
    return {"ok": ok1 and ok2}


# ---------- голос → текст (Whisper) ----------
class STT(BaseModel):
    audio_b64: str
    mime: str = "audio/webm"


@app.post("/api/stt")
def stt(b: STT):
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        return {"ok": False, "error": "OPENAI_API_KEY не задан на сервере"}
    try:
        raw = base64.b64decode(b.audio_b64.split(",")[-1])
    except Exception:
        return {"ok": False, "error": "битый звук"}
    m = (b.mime or "").lower()
    ext = "webm" if "webm" in m else ("m4a" if ("mp4" in m or "m4a" in m or "aac" in m) else ("ogg" if "ogg" in m else "wav"))
    try:
        r = requests.post("https://api.openai.com/v1/audio/transcriptions",
                          headers={"Authorization": f"Bearer {key}"},
                          files={"file": (f"audio.{ext}", raw, b.mime or "audio/webm")},
                          data={"model": "whisper-1", "language": "ru"}, timeout=120)
        if r.status_code == 200:
            return {"ok": True, "text": (r.json().get("text") or "").strip()}
        return {"ok": False, "error": f"whisper {r.status_code}: {r.text[:160]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:160]}


# ---------- документы → текст / финансы (Claude Vision) ----------
class Vision(BaseModel):
    image_b64: str
    mime: str = "image/jpeg"
    mode: str = "text"     # "text" — извлечь суть; "finance" — прибыль по направлениям в JSON


@app.post("/api/vision")
def vision(b: Vision):
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        return {"ok": False, "error": "ANTHROPIC_API_KEY не задан на сервере"}
    data = b.image_b64.split(",")[-1]
    is_pdf = "pdf" in (b.mime or "").lower()
    if b.mode == "finance":
        prompt = ("На изображении/в документе — финансовый отчёт по направлениям компании. "
                  "Верни СТРОГО JSON без пояснений и без markdown: "
                  '{"period":"YYYY-MM или пусто","rows":[{"name":"направление","profit":число_рублей_без_пробелов}]}. '
                  "profit — чистая прибыль за месяц (если есть только выручка и расходы — посчитай прибыль). "
                  "Названия направлений бери как в отчёте.")
    else:
        prompt = ("Извлеки суть документа кратко на русском: что это, ключевые суммы, даты, стороны, главное. "
                  "Без воды, до 8 строк.")
    if is_pdf:
        src = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}}
    else:
        src = {"type": "image", "source": {"type": "base64", "media_type": b.mime or "image/jpeg", "data": data}}
    body = {"model": os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6"), "max_tokens": 1500,
            "messages": [{"role": "user", "content": [src, {"type": "text", "text": prompt}]}]}
    try:
        r = requests.post("https://api.anthropic.com/v1/messages",
                          headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                          json=body, timeout=120)
        if r.status_code == 200:
            txt = "".join(p.get("text", "") for p in r.json().get("content", []) if p.get("type") == "text")
            return {"ok": True, "text": txt.strip()}
        return {"ok": False, "error": f"claude {r.status_code}: {r.text[:160]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:160]}


# ---------- статика PWA ----------
if os.path.isdir(WEB):
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
