# -*- coding: utf-8 -*-
"""
Модуль оценки загрузки и ответственности — пилот ПВЛ.

Самостоятельный модуль поверх того же Telegram-бота: хранит данные в GitHub
(через github_store), отправляет сообщения функциями, инъецированными из bot.py.
Личный контур владельца не затрагивает.

Что делает:
  • Регистрация сотрудников (самостоятельно по /start).
  • Утренний чек-ин: план на смену.
  • Вечерний чек-ин: план→факт, цифры по роли, нагрузка 1-5, «вопрос дня».
  • Недельная отметка руководителя по каждому сотруднику.
  • Директорский отчёт по запросу владельца.
  • Планировщик утро/вечер/неделя.

Хранилище (репозиторий, ветка та же, что у бота):
  state/workload/employees.json
  state/workload/checkins-ПВЛ-YYYY-MM.json
  state/workload/marks-ПВЛ.json
  state/workload/g_*.txt — суточные «защёлки» планировщика
"""
import time
import datetime as dt
import github_store as gh

DEPT = "ПВЛ"

# ---- расписание (местное время, МСК = now_local) ----
WL_MORNING_H = 8    # 08:00 МСК — план на смену
WL_EVENING_H = 19   # 19:00 МСК — итоги смены
WL_WEEKLY_H = 9     # 09:00 МСК (понедельник) — опрос руководителя

# ---- инъекция зависимостей из bot.py ----
_send = _send_buttons = _btn_load = _now_local = _once_per_day = _lock_is_mine = None
OWNER = ""


def init(send, send_buttons, btn_load, now_local, once_per_day, lock_is_mine, owner_chat):
    global _send, _send_buttons, _btn_load, _now_local, _once_per_day, _lock_is_mine, OWNER
    _send = send
    _send_buttons = send_buttons
    _btn_load = btn_load
    _now_local = now_local
    _once_per_day = once_per_day
    _lock_is_mine = lock_is_mine
    OWNER = str(owner_chat or "")


# ---- хранилище ----
P_EMP = "state/workload/employees.json"
P_MARKS = "state/workload/marks-ПВЛ.json"


def _month(d=None):
    return (d or _now_local()).strftime("%Y-%m")


def P_CHECK(mo=None):
    return f"state/workload/checkins-{DEPT}-{mo or _month()}.json"


def _load(path, default):
    txt, _ = gh.get_file(path)
    try:
        return __import__("json").loads(txt) if txt else default
    except Exception:
        return default


def _save(path, obj, msg):
    gh.put_file(path, __import__("json").dumps(obj, ensure_ascii=False, indent=2), msg)


def employees():
    return _load(P_EMP, [])


def save_employees(e):
    _save(P_EMP, e, "workload: employees")


def find_emp(chat_id):
    cid = str(chat_id)
    for e in employees():
        if str(e.get("chat_id")) == cid:
            return e
    return None


def _today():
    return _now_local().date().isoformat()


def _append_checkin(entry):
    p = P_CHECK()
    arr = _load(p, [])
    arr.append(entry)
    _save(p, arr, "workload: checkin")


# ---- состояние диалога (в памяти процесса) ----
_pending = {}   # chat_id(str) -> {"flow":..,"step":..,"buf":{...},...}


# ---- тексты вопросов (одобрено) ----
POS_LABELS = {"админ": "Администратор", "врач": "Врач", "медсестра": "Медсестра",
              "руководитель": "Руководитель"}
POS_BTNS = [
    [("Администратор", {"wl": "reg_pos", "p": "админ"}), ("Врач", {"wl": "reg_pos", "p": "врач"})],
    [("Медсестра", {"wl": "reg_pos", "p": "медсестра"}), ("Руководитель", {"wl": "reg_pos", "p": "руководитель"})],
]
QDAY = [
    ("blocker", "Что сегодня мешало или зависло — и на ком застряло?"),
    ("nichye", "Было что-то «ничьё» — задача, которую непонятно кто должен делать?"),
    ("fix", "Если бы мог что-то починить в работе ПВЛ — что бы это было?"),
]


def _qday():
    return QDAY[_now_local().date().toordinal() % 3]


def _num_prompt(pos):
    if pos == "админ":
        return "Сколько сегодня (примерно): звонков, записей, дозвонов? Через запятую, напр.: 40, 18, 6"
    if pos == "врач":
        return "Сколько сегодня приёмов / пациентов? Напр.: 14"
    if pos == "медсестра":
        return "Сколько сегодня процедур / пациентов? Напр.: 20"
    return None   # руководитель — без цифр


def _load_btns():
    return [[(str(n), {"wl": "load", "v": n}) for n in range(1, 6)]]


def _had_morning_today(chat):
    cid = str(chat)
    for c in _load(P_CHECK(), []):
        if str(c.get("chat_id")) == cid and c.get("type") == "morning" and c.get("date") == _today():
            return True
    return False


# ========================= ВХОДЯЩИЕ =========================
def handle_message(m):
    """Сообщение из чата НЕ-владельца. True — если обработали."""
    chat = str(m["chat"]["id"])
    text = (m.get("text") or "").strip()
    emp = find_emp(chat)
    pend = _pending.get(chat)

    # незнакомец без активного диалога → регистрация
    if not emp and not pend:
        _pending[chat] = {"flow": "reg", "step": "name", "buf": {}}
        _send(chat, "Привет! Это рабочий помощник ПВЛ 👋\n"
                    "Помогаю навести порядок в работе — не контроль ради контроля.\n\n"
                    "Как тебя зовут? Напиши имя и фамилию.")
        return True

    if pend:
        return _continue(chat, text, emp, pend)

    # зарегистрирован, активного вопроса нет → свободное сообщение
    low = text.lower()
    FB = ("идея", "идеи", "предложение", "предложить", "улучшить", "не работает",
          "проблема", "баг", "ошибка", "совет", "пожелание")
    if any(low == k or low.startswith(k + " ") or low.startswith(k + ":") for k in FB):
        rest = text
        for k in FB:
            if low.startswith(k):
                rest = text[len(k):].lstrip(" :-—").strip()
                break
        if rest:
            _save_feedback(emp, rest)
            _send(chat, "Спасибо! Передал владельцу 🙌")
        else:
            _pending[chat] = {"flow": "feedback", "step": "text", "buf": {}}
            _send(chat, "Что предложишь или что не так — в боте или в работе? "
                        "Напиши одним сообщением, передам напрямую.")
        return True
    _log_note(emp, text)
    _send(chat, "Принял 🙌 Я задаю короткие вопросы утром и в конце смены.\n"
                "А если есть идея или что-то не работает — напиши «идея» и сообщение.")
    return True


def _continue(chat, text, emp, pend):
    flow, step = pend.get("flow"), pend.get("step")
    buf = pend.setdefault("buf", {})

    # --- регистрация: имя ---
    if flow == "reg" and step == "name":
        if len(text) < 2:
            _send(chat, "Напиши, пожалуйста, имя и фамилию одним сообщением.")
            return True
        buf["name"] = text[:60]
        pend["step"] = "pos"
        _send_buttons(chat, f"Приятно, {buf['name']}! Кем работаешь в ПВЛ?", POS_BTNS)
        return True

    # --- утро: план ---
    if flow == "morning" and step == "plan":
        _append_checkin({"date": _today(), "chat_id": chat, "name": emp.get("name"),
                         "position": emp.get("position"), "type": "morning",
                         "plan": text[:1000], "ts": _now_local().strftime("%H:%M")})
        _pending.pop(chat, None)
        _send(chat, "Записал план. Хорошей смены! 🙌")
        return True

    # --- вечер ---
    if flow == "evening":
        if step == "recap":
            buf["recap"] = text[:1500]
            np = _num_prompt(emp.get("position"))
            if np:
                pend["step"] = "nums"
                _send(chat, np)
            else:
                _ask_load(chat, pend)
            return True
        if step == "nums":
            buf["nums"] = text[:300]
            _ask_load(chat, pend)
            return True
        if step == "qday":
            buf[pend.get("qkey", "qans")] = text[:1500]
            _finish_evening(chat, emp, pend)
            return True

    # --- свободная обратная связь по боту/работе ---
    if flow == "feedback" and step == "text":
        _save_feedback(emp, text)
        _pending.pop(chat, None)
        _send(chat, "Спасибо! Передал владельцу 🙌")
        return True

    # --- недельная отметка руководителя: комментарий ---
    if flow == "mark" and step == "note":
        cur = pend["queue"][pend["i"]]
        note = "" if text.strip() in ("-", "—", "") else text[:300]
        pend["marks"].append({"name": cur, "status": pend.get("cur_status", ""), "note": note})
        pend["i"] += 1
        _ask_mark(chat, pend)
        return True

    return True


def handle_callback(cq):
    """Callback из чата сотрудника/руководителя. True — если обработали."""
    pl = _btn_load(cq.get("data", "")) or {}
    if "wl" not in pl:
        return False
    chat = str(((cq.get("message") or {}).get("chat") or {}).get("id"))
    pend = _pending.get(chat)
    kind = pl["wl"]

    if kind == "reg_pos":
        name = (pend or {}).get("buf", {}).get("name", "Сотрудник")
        pos = pl.get("p", "админ")
        role = "head" if pos == "руководитель" else "staff"
        emps = employees()
        emps.append({"chat_id": chat, "name": name, "dept": DEPT,
                     "position": pos, "role": role, "active": True,
                     "since": _today()})
        save_employees(emps)
        _pending.pop(chat, None)
        tip = "\n\nЕсли что-то в боте неудобно или есть идея — напиши «идея» и сообщение, передам владельцу."
        if role == "head":
            _send(chat, f"Готово, {name}! Ты отмечен(а) как руководитель ПВЛ.\n"
                        "Раз в неделю пришлю короткий опрос по команде, плюс ежедневные вопросы про твою смену. "
                        "Это про порядок в работе, не про контроль 🙌" + tip)
        else:
            _send(chat, f"Готово, {name}! Теперь утром спрошу план на смену, "
                        "а в конце смены — пару коротких вопросов (30 сек). "
                        "Это поможет навести порядок и снять с тебя лишнее. Хорошего дня 🙌" + tip)
        if OWNER:
            _send(OWNER, f"🆕 ПВЛ: зарегистрировался(ась) {name} — {POS_LABELS.get(pos, pos)}.")
        return True

    if kind == "load" and pend and pend.get("flow") == "evening":
        pend["buf"]["load"] = pl.get("v")
        qkey, qtext = _qday()
        pend["qkey"], pend["step"] = qkey, "qday"
        _send(chat, qtext)
        return True

    if kind == "mark_status" and pend and pend.get("flow") == "mark":
        pend["cur_status"] = pl.get("s", "")
        pend["step"] = "note"
        cur = pend["queue"][pend["i"]]
        _send(chat, f"{cur}: одной строкой — почему / что заметил? (или «-» чтобы пропустить)")
        return True

    return True


def _ask_load(chat, pend):
    pend["step"] = "load"
    _send_buttons(chat, "Насколько сегодня были загружены?\n1 — простой, 5 — зашивался(лась).", _load_btns())


def _finish_evening(chat, emp, pend):
    b = pend["buf"]
    _append_checkin({"date": _today(), "chat_id": chat, "name": emp.get("name"),
                     "position": emp.get("position"), "type": "evening",
                     "recap": b.get("recap", ""), "nums": b.get("nums", ""),
                     "load": b.get("load"), "qkey": pend.get("qkey"),
                     "qans": b.get(pend.get("qkey", ""), ""),
                     "ts": _now_local().strftime("%H:%M")})
    _pending.pop(chat, None)
    _send(chat, "Спасибо! Записал. Хорошего отдыха 🙏")


def _log_note(emp, text):
    if not text:
        return
    _append_checkin({"date": _today(), "chat_id": emp.get("chat_id"), "name": emp.get("name"),
                     "position": emp.get("position"), "type": "note",
                     "text": text[:1500], "ts": _now_local().strftime("%H:%M")})


def _save_feedback(emp, text):
    if not text:
        return
    _append_checkin({"date": _today(), "chat_id": emp.get("chat_id"), "name": emp.get("name"),
                     "position": emp.get("position"), "type": "feedback",
                     "text": text[:1500], "ts": _now_local().strftime("%H:%M")})
    if OWNER:
        _send(OWNER, f"💡 Идея/проблема от {emp.get('name')} (ПВЛ):\n{text[:1500]}")


# ========================= РАССЫЛКИ =========================
def morning_prompt_all():
    for e in employees():
        if not e.get("active") or not e.get("chat_id"):
            continue
        chat = str(e["chat_id"])
        _pending[chat] = {"flow": "morning", "step": "plan", "buf": {}}
        first = (e.get("name") or "").split()
        hi = first[0] if first else ""
        _send(chat, f"Доброе утро, {hi}! Что в плане на сегодня — 2-3 главных дела на смену?")


def evening_prompt_all():
    for e in employees():
        if not e.get("active") or not e.get("chat_id"):
            continue
        chat = str(e["chat_id"])
        _pending[chat] = {"flow": "evening", "step": "recap", "buf": {}}
        if _had_morning_today(chat):
            _send(chat, "Как прошла смена? Что из плана успел(а), а что нет — и почему?")
        else:
            _send(chat, "Как прошла смена? Что сегодня было главным?")


def manager_prompt_all():
    staff = [e for e in employees() if e.get("active") and e.get("role") == "staff"]
    names = [e.get("name") for e in staff]
    for h in employees():
        if h.get("role") == "head" and h.get("active") and h.get("chat_id"):
            chat = str(h["chat_id"])
            if not names:
                _send(chat, "На этой неделе отмечать некого — в ПВЛ пока нет зарегистрированных сотрудников.")
                continue
            _pending[chat] = {"flow": "mark", "step": "status", "queue": list(names),
                              "i": 0, "marks": []}
            _send(chat, "🗓 Недельный обзор команды ПВЛ. Отметь каждого парой касаний — это займёт минуту.")
            _ask_mark(chat, _pending[chat])


def _ask_mark(chat, pend):
    if pend["i"] >= len(pend["queue"]):
        _save_marks(chat, pend["marks"])
        _pending.pop(chat, None)
        _send(chat, "Готово, спасибо! Передал директору 🙏")
        if OWNER:
            lines = [f"• {m['name']}: {_status_label(m['status'])}" + (f" — {m['note']}" if m.get("note") else "")
                     for m in pend["marks"]]
            _send(OWNER, "🗓 Недельная отметка руководителя ПВЛ:\n" + "\n".join(lines))
        return
    pend["step"] = "status"
    cur = pend["queue"][pend["i"]]
    rows = [
        [("🟢 в норме", {"wl": "mark_status", "s": "ok"}),
         ("🟡 перегружен", {"wl": "mark_status", "s": "over"})],
        [("⚪ простаивает", {"wl": "mark_status", "s": "idle"}),
         ("🔴 есть вопросы", {"wl": "mark_status", "s": "issue"})],
    ]
    _send_buttons(chat, f"{cur} — как оцениваешь за неделю?", rows)


_STATUS = {"ok": "🟢 в норме", "over": "🟡 перегружен", "idle": "⚪ простаивает", "issue": "🔴 есть вопросы"}


def _status_label(s):
    return _STATUS.get(s, s)


def _save_marks(head_chat, marks):
    arr = _load(P_MARKS, [])
    arr.append({"week": _now_local().strftime("%G-W%V"), "head_chat": head_chat,
                "ts": _now_local().strftime("%Y-%m-%d %H:%M"), "marks": marks})
    _save(P_MARKS, arr, "workload: marks")


# ========================= ОТЧЁТ ДИРЕКТОРУ =========================
def _recent_checkins(days=7):
    today = _now_local().date()
    months = set()
    for d in range(days):
        months.add((today - dt.timedelta(days=d)).strftime("%Y-%m"))
    out = []
    for mo in months:
        out += _load(P_CHECK(mo), [])
    cutoff = (today - dt.timedelta(days=days - 1)).isoformat()
    return [c for c in out if c.get("date", "") >= cutoff]


def _nums_to_ints(s):
    import re
    return [int(x) for x in re.findall(r"\d+", s or "")]


def director_report(days=7):
    emps = employees()
    if not emps:
        return "В ПВЛ пока никто не зарегистрировался в боте. Как подключатся — отчёт оживёт."
    checks = _recent_checkins(days)
    by = {}
    for e in emps:
        by[str(e["chat_id"])] = {"emp": e, "ev": [], "mo": [], "notes": []}
    for c in checks:
        cid = str(c.get("chat_id"))
        if cid not in by:
            continue
        t = c.get("type")
        if t == "evening":
            by[cid]["ev"].append(c)
        elif t == "morning":
            by[cid]["mo"].append(c)
        elif t == "note":
            by[cid]["notes"].append(c)

    L = [f"📊 ПВЛ — сводка за {days} дн.", ""]
    # загрузка
    L.append("ЗАГРУЗКА (заполнено / ср. оценка):")
    quiet = []
    for cid, d in by.items():
        e = d["emp"]
        ev = d["ev"]
        loads = [x["load"] for x in ev if isinstance(x.get("load"), int)]
        avg = round(sum(loads) / len(loads), 1) if loads else "—"
        L.append(f"• {e.get('name')} ({POS_LABELS.get(e.get('position'), e.get('position'))}): "
                 f"{len(ev)} веч. отмет., ср. нагрузка {avg}")
        if len(ev) < max(1, days // 2):
            quiet.append(e.get("name"))
    if quiet:
        L += ["", "⚠️ Мало отмечаются: " + ", ".join(quiet)]

    # цифры по ролям (сумма за период)
    tot = {}
    for cid, d in by.items():
        pos = d["emp"].get("position")
        for x in d["ev"]:
            ints = _nums_to_ints(x.get("nums"))
            if ints:
                tot.setdefault(pos, [0, 0, 0])
                for i, v in enumerate(ints[:3]):
                    tot[pos][i] += v
    if tot:
        L += ["", "ОБЪЁМЫ (сумма):"]
        if "админ" in tot:
            a = tot["админ"]
            L.append(f"• Админы: звонки {a[0]}, записи {a[1]}, дозвоны {a[2]}")
        if "врач" in tot:
            L.append(f"• Врачи: приёмов {tot['врач'][0]}")
        if "медсестра" in tot:
            L.append(f"• Медсёстры: процедур {tot['медсестра'][0]}")

    # блокеры / ничьё / идеи
    blk, nich, fix = [], [], []
    for cid, d in by.items():
        nm = d["emp"].get("name", "")
        for x in d["ev"]:
            ans = (x.get("qans") or "").strip()
            if not ans or ans in ("-", "нет", "Нет", "—"):
                continue
            if x.get("qkey") == "blocker":
                blk.append(f"• {nm}: {ans}")
            elif x.get("qkey") == "nichye":
                nich.append(f"• {nm}: {ans}")
            elif x.get("qkey") == "fix":
                fix.append(f"• {nm}: {ans}")
    if blk:
        L += ["", "🚧 ЧТО МЕШАЛО / ЗАВИСЛО:"] + blk
    if nich:
        L += ["", "❓ ЗОНЫ «НИЧЬЁ» (размытая ответственность):"] + nich
    if fix:
        L += ["", "💡 ИДЕИ ОТ КОМАНДЫ (что починить):"] + fix

    # обратная связь по боту/работе (канал «идея»)
    ideas = [f"• {c.get('name')}: {c.get('text')}" for c in checks if c.get("type") == "feedback"]
    if ideas:
        L += ["", "🛠 ПРЕДЛОЖЕНИЯ / ПРОБЛЕМЫ (канал «идея»):"] + ideas

    # отметки руководителя (последняя неделя)
    marks = _load(P_MARKS, [])
    if marks:
        last = marks[-1]
        L += ["", f"🗓 Отметка руководителя ({last.get('week')}):"]
        for m in last.get("marks", []):
            L.append(f"• {m['name']}: {_status_label(m['status'])}" + (f" — {m['note']}" if m.get("note") else ""))

    return "\n".join(L)


def team_text():
    emps = employees()
    if not emps:
        return "В ПВЛ пока никто не зарегистрировался."
    L = ["👥 Команда ПВЛ в боте:"]
    for e in emps:
        role = "руководитель" if e.get("role") == "head" else POS_LABELS.get(e.get("position"), e.get("position"))
        L.append(f"• {e.get('name')} — {role}")
    return "\n".join(L)


# ========================= КОМАНДЫ ВЛАДЕЛЬЦА =========================
def owner_command(text):
    low = (text or "").strip().lower()
    if low in ("отчёт пвл", "отчет пвл", "пвл отчёт", "пвл отчет", "/pvl", "/pvl_report", "пвл"):
        return director_report()
    if low in ("команда пвл", "/pvl_team", "кто в пвл"):
        return team_text()
    if low in ("идеи пвл", "/pvl_ideas", "идеи по боту"):
        return _ideas_text()
    return None


def _ideas_text(days=30):
    fb = [c for c in _recent_checkins(days) if c.get("type") == "feedback"]
    if not fb:
        return "Идей и замечаний пока не присылали."
    L = [f"💡 Идеи и проблемы от команды ПВЛ ({days} дн.):", ""]
    for c in fb:
        L.append(f"• {c.get('name')}: {c.get('text')}")
    return "\n".join(L)


# ========================= ПЛАНИРОВЩИК =========================
def scheduler_loop():
    while True:
        try:
            if _lock_is_mine and _lock_is_mine():
                now = _now_local()
                if now.hour == WL_MORNING_H and _once_per_day("state/workload/g_morning.txt"):
                    morning_prompt_all()
                if now.hour == WL_EVENING_H and _once_per_day("state/workload/g_evening.txt"):
                    evening_prompt_all()
                if now.weekday() == 0 and now.hour == WL_WEEKLY_H and _once_per_day("state/workload/g_weekly.txt"):
                    manager_prompt_all()
        except Exception as e:
            print("workload scheduler:", e)
        time.sleep(300)
