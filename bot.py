#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Умный бот-ежедневник «Клиники Столицы» (бизнес + личное).
Мозг на Claude API: понимает сообщения (текст и голос), раскладывает по задачам/
воронке/личному, ставит напоминания со временем и присылает их, ведёт дневник,
отвечает на вопросы и шлёт сводки. Состояние — в GitHub-репозитории.

Состояние (репозиторий):
  state/context.md   — контекст бизнеса (чтение)
  state/tasks.md     — рабочие задачи
  state/funnel.md    — воронка продаж
  state/personal.md  — личные задачи/заметки
  state/journal.md   — дневник (все сообщения)
  state/reminders.json — напоминания со временем
  state/last_digest.txt — дата последней недельной сводки

ENV: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_REPO,
     GITHUB_BRANCH(main), CLAUDE_MODEL(опц.), TZ_OFFSET(опц.,=3 МСК),
     DIGEST_HOUR_UTC(опц.,=6), STT_PROVIDER/OPENAI_API_KEY/YANDEX_* (для голоса).
Зависимости: requests, anthropic
"""
import os
import re
import sys
import json
import time
import uuid
import base64
import threading
import datetime as dt

try:
    import requests
except ImportError:
    sys.exit("pip install requests anthropic")

import github_store as gh
import brain
import voice
try:
    import mis_sync
except Exception as _e:          # коннектор МИС опционален
    mis_sync = None
try:
    import workload              # модуль оценки загрузки (пилот ПВЛ)
except Exception as _e:
    workload = None
    print(f"workload import: {_e}")

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
TZ_OFFSET = int(os.environ.get("TZ_OFFSET", "3"))          # МСК = UTC+3
DIGEST_HOUR_UTC = int(os.environ.get("DIGEST_HOUR_UTC", "6"))
POLL_TIMEOUT = 50
if not TOKEN:
    sys.exit("Нет TELEGRAM_BOT_TOKEN")
API = f"https://api.telegram.org/bot{TOKEN}"

P_CTX, P_TASKS, P_FUNNEL = "state/context.md", "state/tasks.md", "state/funnel.md"
P_PERSONAL, P_JOURNAL, P_REMINDERS = "state/personal.md", "state/journal.md", "state/reminders.json"
P_RECURRING = "state/recurring.json"
P_CONVO = "state/convo.json"
P_WELLBEING = "state/wellbeing.md"
P_PROFILE = "state/profile.md"
P_FACTS = "state/facts.md"
P_HABITS = "state/habits.json"
P_HABIT_PLANS = "state/habit_plans.json"
P_RITUALS = "state/rituals.json"
P_RLOG = "state/ritual_log.json"
P_AGENDA = "state/agenda.json"
P_DRAFT = "state/draft_agenda.json"
P_DEADLINES = "state/deadlines.json"
P_LEVERS = "state/levers.json"
P_BTN = "state/buttons.json"
DAY_START = os.environ.get("DAY_START", "08:00")   # рабочее окно для расчёта свободных слотов
DAY_END = os.environ.get("DAY_END", "22:00")
P_LASTAUTOPLAN = "state/last_autoplan.txt"
P_QUIT = "state/quit_smoking.json"
P_DATES = "state/important_dates.json"
P_WEIGHT = "state/weight.json"
P_MOOD = "state/mood.json"
P_GAME = "state/game.json"
P_MIT = "state/mit.json"
P_ENERGY = "state/energy.json"
P_BOSSES = "state/bosses.json"
P_FINANCE = "state/finance.json"
P_DEALS = "state/deals.json"
P_SETTINGS = "state/settings.json"
P_LASTDG = "state/last_digest.txt"
P_LASTDEALS = "state/last_dealswatch.txt"
DEALS_STALE_DAYS = int(os.environ.get("DEALS_STALE_DAYS", "7"))
DEALS_WATCH_HOUR_UTC = int(os.environ.get("DEALS_WATCH_HOUR_UTC", "7"))  # ≈ 10:00 МСК

CRAVING_WORDS = ["хочу курить", "хочу закурить", "тянет курить", "тянет покурить",
                 "хочется курить", "охота курить", "охота закурить", "сорвусь",
                 "тяга курить", "закурить хочу", "не могу не курить", "хочу сигарету"]
SLIP_WORDS = ["закурил", "сорвался", "не удержался", "выкурил сигарет"]

HEALTH_MILESTONES = [  # (дней с отказа, текст)
    (1, "24 часа — снижается риск инфаркта"),
    (2, "48 часов — возвращаются вкус и обоняние"),
    (3, "72 часа — дышать становится легче"),
    (14, "2 недели — улучшается кровообращение"),
    (30, "1 месяц — больше энергии, меньше кашля"),
    (90, "3 месяца — заметно лучше работают лёгкие"),
    (180, "полгода — кашель и одышка значительно меньше"),
    (365, "1 год — риск болезней сердца снижается вдвое"),
]
P_LASTMORN = "state/last_morning.txt"
P_LASTEVE = "state/last_evening.txt"
P_LASTWIND = "state/last_winddown.txt"
P_LASTBDAY = "state/last_birthday.txt"
P_LASTWEIGHT = "state/last_weightask.txt"
P_LASTHABREP = "state/last_habitreport.txt"
P_LASTPULSE = "state/last_pulse.txt"
P_LASTMIS = "state/last_missync.txt"
PULSE_HOUR_UTC = int(os.environ.get("PULSE_HOUR_UTC", "11"))        # ≈ 14:00 МСК — пульс-скан
MORNING_HOUR_UTC = int(os.environ.get("MORNING_HOUR_UTC", "5"))      # ≈ 8:00 МСК
EVENING_HOUR_UTC = int(os.environ.get("EVENING_HOUR_UTC", "18"))    # ≈ 21:00 МСК — разбор дня
WINDDOWN_HOUR_UTC = int(os.environ.get("WINDDOWN_HOUR_UTC", "19"))  # ≈ 22:00 МСК — пора спать
SEED = {P_CTX: "state_seed/context.md", P_TASKS: "state_seed/tasks.md",
        P_FUNNEL: "state_seed/funnel.md", P_WELLBEING: "state_seed/wellbeing.md",
        P_PROFILE: "state_seed/profile.md",
        P_FACTS: "state_seed/facts.md",
        P_DATES: "state_seed/important_dates.json",
        P_BOSSES: "state_seed/bosses.json",
        P_FINANCE: "state_seed/finance.json",
        P_DEALS: "state_seed/deals.json",
        P_HABIT_PLANS: "state_seed/habit_plans.json",
        P_RITUALS: "state_seed/rituals.json",
        P_DEADLINES: "state_seed/deadlines.json",
        P_LEVERS: "state_seed/levers.json"}


def now_local():
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None) + dt.timedelta(hours=TZ_OFFSET)


def stamp():
    return now_local().strftime("%Y-%m-%d %H:%M")


# ---------- Telegram ----------
def tg(method, **p):
    try:
        return requests.post(f"{API}/{method}", json=p, timeout=POLL_TIMEOUT + 10).json()
    except Exception as e:
        print(f"[{stamp()}] tg {method}: {e}")
        return {}


def send(chat_id, text):
    for i in range(0, len(text), 3900):
        tg("sendMessage", chat_id=chat_id, text=text[i:i + 3900], disable_web_page_preview=True)


def send_voice(chat_id, audio_bytes):
    try:
        requests.post(f"{API}/sendVoice", data={"chat_id": chat_id},
                      files={"voice": ("reply.ogg", audio_bytes, "audio/ogg")}, timeout=60)
    except Exception as e:
        print(f"[{stamp()}] send_voice: {e}")


def voice_always():
    return bool(_load_json(P_SETTINGS, {}).get("voice_always"))


# ---------- inline-кнопки ----------
def _btn_save(payload):
    """Сохранить полезную нагрузку кнопки, вернуть короткий токен (callback_data ≤64 байт)."""
    import random as _r
    data = _load_json(P_BTN, {})
    tok = str(int(time.time() * 1000))[-10:] + str(_r.randint(100, 999))
    data[tok] = payload
    if len(data) > 300:                       # не разрастаться
        for k in list(data.keys())[:-300]:
            data.pop(k, None)
    _save_json(P_BTN, data, "bot: btn")
    return tok


def _btn_load(tok):
    return _load_json(P_BTN, {}).get(tok)


def send_buttons(chat_id, text, rows):
    """rows: список рядов; ряд — список кортежей (label, payload_dict)."""
    kb = [[{"text": lbl, "callback_data": _btn_save(pl)} for lbl, pl in row] for row in rows]
    tg("sendMessage", chat_id=chat_id, text=text[:3900],
       reply_markup={"inline_keyboard": kb}, disable_web_page_preview=True)


def edit_message(chat_id, message_id, text, rows=None):
    p = {"chat_id": chat_id, "message_id": message_id, "text": text[:3900],
         "disable_web_page_preview": True}
    if rows is not None:
        p["reply_markup"] = {"inline_keyboard": [[{"text": lbl, "callback_data": _btn_save(pl)}
                                                  for lbl, pl in row] for row in rows]}
    tg("editMessageText", **p)


def download_file(file_id):
    path = tg("getFile", file_id=file_id).get("result", {}).get("file_path")
    if not path:
        return None
    try:
        rr = requests.get(f"https://api.telegram.org/file/bot{TOKEN}/{path}", timeout=60)
        return rr.content if rr.status_code == 200 else None
    except Exception as e:
        print(f"[{stamp()}] download: {e}")
        return None


# ---------- помощники состояния ----------
def _load_reminders():
    txt, _ = gh.get_file(P_REMINDERS)
    try:
        return json.loads(txt) if txt else []
    except Exception:
        return []


def _save_reminders(rems):
    gh.put_file(P_REMINDERS, json.dumps(rems, ensure_ascii=False, indent=2), f"bot: reminders {stamp()}")


def _load_json(path, default):
    txt, _ = gh.get_file(path)
    try:
        return json.loads(txt) if txt else default
    except Exception:
        return default


def _save_json(path, obj, msg):
    gh.put_file(path, json.dumps(obj, ensure_ascii=False, indent=2), msg)


def once_per_day(guard_path):
    """True (и помечает), если сегодня ещё не срабатывало."""
    last, _ = gh.get_file(guard_path)
    today = now_local().date().isoformat()
    if (last or "").strip() == today:
        return False
    gh.put_file(guard_path, today, "bot: guard")
    return True


# ---------- одиночный экземпляр (защита от дублей при нескольких копиях) ----------
INSTANCE = uuid.uuid4().hex[:8]
P_LOCK = "state/poller_lock.json"
LOCK_TTL = 90               # сек: если активный молчит дольше — замок перехватывается


def lock_acquire():
    """Захватить/продлить замок активного экземпляра. True — этот экземпляр активный."""
    lk = _load_json(P_LOCK, {})
    now = time.time()
    if lk.get("id") == INSTANCE or not lk.get("id") or (now - lk.get("ts", 0) > LOCK_TTL):
        _save_json(P_LOCK, {"id": INSTANCE, "ts": now}, "bot: lock")
        return _load_json(P_LOCK, {}).get("id") == INSTANCE   # подтверждаем (на случай гонки)
    return False


def lock_is_mine():
    """Только чтение: владеет ли этот экземпляр замком (для планировщиков)."""
    return _load_json(P_LOCK, {}).get("id") == INSTANCE


# ---------- геймификация ----------
LEVEL_TITLES = ["Новичок", "Боец", "Игрок", "Стратег", "Капитан", "Командир", "Мастер", "Магнат", "Легенда"]
XP_BY_PRIORITY = {"🔴": 10, "🟡": 5, "🟢": 3}


def level_title(lvl):
    return LEVEL_TITLES[min(max(lvl, 1) - 1, len(LEVEL_TITLES) - 1)]


def bar(done, total, width=10):
    if total <= 0:
        return "▰" * width
    f = max(0, min(width, round(width * done / total)))
    return "▰" * f + "▱" * (width - f)


def award_xp(game, n, reason, changes):
    game["xp"] = game.get("xp", 0) + n
    game["week_xp"] = game.get("week_xp", 0) + n
    old = game.get("level", 1)
    new = game["xp"] // 100 + 1
    game["level"] = new
    line = f"+{n} XP" + (f" · {reason}" if reason else "")
    if new > old:
        line += f"\n🎉 Новый уровень {new} — «{level_title(new)}»!"
    changes.append(line)


# ---------- важные даты / дни рождения ----------
def upcoming_birthdays(within=7):
    data = _load_json(P_DATES, [])
    today = now_local().date()
    res = []
    for d in data:
        try:
            dd, mm, yy = (int(x) for x in str(d.get("date", "")).split("."))
            nb = dt.date(today.year, mm, dd)
            if nb < today:
                nb = dt.date(today.year + 1, mm, dd)
        except Exception:
            continue
        days = (nb - today).days
        if days <= within:
            res.append((days, nb.year - yy, d.get("name", "?"), d.get("relation", "")))
    res.sort()
    return res


def birthdays_text(within=7):
    ups = upcoming_birthdays(within)
    if not ups:
        return ""
    out = []
    for days, age, name, rel in ups:
        when = "сегодня 🎉" if days == 0 else (f"завтра" if days == 1 else f"через {days} дн.")
        out.append(f"🎂 {name} ({rel}) — {when}, исполняется {age}")
    return "\n".join(out)


def _load_habits():
    txt, _ = gh.get_file(P_HABITS)
    try:
        return json.loads(txt) if txt else {}
    except Exception:
        return {}


def _save_habits(h):
    gh.put_file(P_HABITS, json.dumps(h, ensure_ascii=False, indent=2), f"bot: habits {stamp()}")


def compute_streak(date_strs):
    days = set()
    for s in date_strs:
        try:
            days.add(dt.date.fromisoformat(s))
        except Exception:
            pass
    today = now_local().date()
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


def habits_summary():
    h = _load_habits()
    if not h:
        return "пока нет отметок"
    return "; ".join(f"{name}: {compute_streak(dates)} дн" for name, dates in h.items())


# ---------- система маленьких шагов ----------
import random as _random

CELEBRATIONS = ["🎉 Есть!", "🔥 Красава!", "💪 Так держать!", "👊 Чётко!", "⭐ Молодец!",
                "✅ Зачёт!", "🙌 Огонь!", "🚀 Поехали дальше!"]
CAT_ICON = {"движение": "🏃", "питание": "💧", "сон": "😴", "стресс": "🧘", "отношения": "👨‍👧‍👧"}


def _load_plans():
    return _load_json(P_HABIT_PLANS, {})


def _save_plans(p):
    _save_json(P_HABIT_PLANS, p, f"bot: habit-plans {stamp()}")


def ladder_goal(plan, streak):
    """Текущая цель по лесенке для данной длины серии (растущая планка)."""
    ladder = plan.get("ladder") or []
    if not ladder:
        return plan.get("goal", "")
    cur = ladder[0].get("goal", "")
    for lvl in sorted(ladder, key=lambda x: x.get("min", 0)):
        if streak >= lvl.get("min", 0):
            cur = lvl.get("goal", cur)
    return cur


def next_ladder(plan, streak):
    """Следующий уровень лесенки (min, goal) или None — для мотивации «ещё N дней до …»."""
    for lvl in sorted(plan.get("ladder") or [], key=lambda x: x.get("min", 0)):
        if lvl.get("min", 0) > streak:
            return lvl
    return None


def chain_text(dates, days=7):
    """Цепочка последних N дней: ▰ выполнено, ▱ нет (не разрывай цепь)."""
    done = set()
    for s in dates:
        try:
            done.add(dt.date.fromisoformat(s))
        except Exception:
            pass
    today = now_local().date()
    return "".join("▰" if (today - dt.timedelta(days=i)) in done else "▱"
                   for i in range(days - 1, -1, -1))


def daily_step():
    """Выбрать ОДИН маленький шаг на сегодня (ротация по дням) + контекст серии."""
    plans = _load_plans()
    if not plans:
        return None
    keys = sorted(plans.keys())
    habit = keys[now_local().date().toordinal() % len(keys)]
    plan = plans[habit]
    habits = _load_habits()
    dates = habits.get(habit, [])
    streak = compute_streak(dates)
    done_today = now_local().date().isoformat() in set(dates)
    return {"habit": habit, "plan": plan, "goal": ladder_goal(plan, streak),
            "anchor": plan.get("anchor", ""), "category": plan.get("category", ""),
            "streak": streak, "done_today": done_today,
            "chain": chain_text(dates), "had_history": bool(dates),
            "next": next_ladder(plan, streak)}


def daily_step_text():
    s = daily_step()
    if not s:
        return ("Привычки-шаги ещё не заданы. Скажи, например: «новая привычка: 5 приседаний перед душем» "
                "— заведу маленький шаг и буду растить планку.")
    icon = CAT_ICON.get(s["category"], "🪜")
    anchor = f" {s['anchor']}" if s["anchor"] else ""
    lines = [f"{icon} Шаг дня (теория маленьких шагов):", f"👉 {s['goal']}{(' — ' + s['anchor']) if s['anchor'] else ''}"]
    if s["done_today"]:
        lines.append(f"✅ Уже сделано сегодня — красава! Серия: {s['streak']} дн.")
    elif s["streak"] > 0:
        lines.append(f"🔥 Серия «{s['habit']}»: {s['streak']} дн. {s['chain']}  — не разрывай цепь!")
    elif s["had_history"]:
        lines.append("🔄 Серия сорвалась — это норм, бывает у всех. Главное вернуться сегодня. Шаг крошечный — точно осилишь.")
    else:
        lines.append("Начни сегодня — шаг специально маленький, чтобы было невозможно не сделать.")
    nx = s["next"]
    if nx and not s["done_today"]:
        left = nx["min"] - s["streak"]
        if 0 < left <= 5:
            lines.append(f"📈 Ещё {left} дн. подряд — и планка вырастет до: {nx['goal']}.")
    lines.append("\nСделал — напиши «сделал шаг» или «потренировался».")
    return "\n".join(lines)


def habits_week_report():
    h = _load_habits()
    plans = _load_plans()
    names = sorted(set(list(h.keys()) + list(plans.keys())))
    if not names:
        return ""
    lines = ["📅 Привычки за неделю — не разрывай цепь:"]
    for name in names:
        dates = h.get(name, [])
        wk = sum(1 for i in range(7) if (now_local().date() - dt.timedelta(days=i)).isoformat() in set(dates))
        lines.append(f"• {name}: {chain_text(dates)}  {wk}/7 · серия {compute_streak(dates)} дн")
    lines.append("\nОдин маленький шаг в день — за год это 365 шагов. Двигаемся 💪")
    return "\n".join(lines)


# ---------- утренний / вечерний ритуалы ----------
def _step_match(a, b):
    """Совпадение шага по словам с учётом русских окончаний (основы слов)."""
    wa = [w for w in re.findall(r"[a-zа-яё0-9]+", (a or "").lower()) if len(w) >= 3]
    wb = [w for w in re.findall(r"[a-zа-яё0-9]+", (b or "").lower()) if len(w) >= 3]
    for x in wa:
        for y in wb:
            if x in y or y in x:
                return True
            if x[:4] == y[:4]:
                return True
            if min(len(x), len(y)) <= 4 and x[:3] == y[:3]:
                return True
    return False


def _load_rituals():
    return _load_json(P_RITUALS, {})


def _load_rlog():
    return _load_json(P_RLOG, {})


def _save_rlog(r):
    _save_json(P_RLOG, r, f"bot: ritual-log {stamp()}")


def _ritual_progress(rlog, key):
    """Список выполненных сегодня шагов ритуала (сбрасывается с новым днём)."""
    today = now_local().date().isoformat()
    prog = rlog.get(key, {}).get("progress", {})
    return list(prog.get("done", [])) if prog.get("date") == today else []


def ritual_text(key, rit, rlog):
    done = _ritual_progress(rlog, key)
    steps = rit.get("steps", [])
    streak = compute_streak(rlog.get(key, {}).get("dates", []))
    lines = [f"{rit.get('icon','🔁')} {rit.get('title', key)} · {rit.get('time','')}"]
    for s in steps:
        mark = "✅" if any(s == d or _step_match(s, d) for d in done) else "⬜"
        lines.append(f"{mark} {s}")
    if steps and len(done) >= len(steps):
        lines.append(f"\n🎉 Ритуал завершён! Серия: {streak} дн {chain_text(rlog.get(key,{}).get('dates',[]))}")
    else:
        lines.append(f"\nОтмечай по ходу: «сделал воду», «готово». Серия: {streak} дн")
    return "\n".join(lines)


def rituals_overview():
    rits = _load_rituals()
    if not rits:
        return ("Ритуалы не заданы. Скажи, например: «утренний ритуал: вода, 5 приседаний, главное дело» "
                "— соберу чек-лист.")
    rlog = _load_rlog()
    order = ["утро", "вечер"] + [k for k in rits if k not in ("утро", "вечер")]
    return "\n\n".join(ritual_text(k, rits[k], rlog) for k in order if k in rits)


def mark_ritual_step(key, step_text):
    """Отметить шаг ритуала; при завершении всех — засчитать день в серию. Возвращает строку-отклик."""
    rits = _load_rituals()
    rit = rits.get(key)
    if not rit:
        return None
    steps = rit.get("steps", [])
    # сопоставляем переданный шаг с реальным шагом ритуала (по подстроке)
    matched = next((s for s in steps if _step_match(step_text, s)), None)
    if not matched and steps:
        matched = step_text.strip()
    rlog = _load_rlog()
    today = now_local().date().isoformat()
    ent = rlog.setdefault(key, {})
    prog = ent.get("progress", {})
    if prog.get("date") != today:
        prog = {"date": today, "done": []}
    if matched and matched not in prog["done"]:
        prog["done"].append(matched)
    ent["progress"] = prog
    done_n, total = len(prog["done"]), len(steps)
    just_done = False
    if total and done_n >= total:
        dates = set(ent.get("dates", []))
        if today not in dates:
            dates.add(today)
            ent["dates"] = sorted(dates)
            just_done = True
    rlog[key] = ent
    _save_rlog(rlog)
    icon = rit.get("icon", "🔁")
    if just_done:
        streak = compute_streak(ent["dates"])
        return (f"{_random.choice(CELEBRATIONS)} {icon} {rit.get('title', key)} завершён! "
                f"🔥 серия {streak} дн {chain_text(ent['dates'])}")
    left = [s for s in steps if s not in prog["done"]]
    nxt = f"\nОсталось: {', '.join(left)}" if left else ""
    return f"{icon} отметил «{matched}» ({done_n}/{total}).{nxt}"


def ritual_done_all(key):
    rits = _load_rituals()
    rit = rits.get(key)
    if not rit:
        return None
    rlog = _load_rlog()
    today = now_local().date().isoformat()
    ent = rlog.setdefault(key, {})
    ent["progress"] = {"date": today, "done": list(rit.get("steps", []))}
    dates = set(ent.get("dates", []))
    dates.add(today)
    ent["dates"] = sorted(dates)
    rlog[key] = ent
    _save_rlog(rlog)
    streak = compute_streak(ent["dates"])
    return (f"{_random.choice(CELEBRATIONS)} {rit.get('icon','🔁')} {rit.get('title', key)} — весь выполнен! "
            f"🔥 серия {streak} дн {chain_text(ent['dates'])}")


def _load_quit():
    txt, _ = gh.get_file(P_QUIT)
    try:
        return json.loads(txt) if txt else {}
    except Exception:
        return {}


def _save_quit(q):
    gh.put_file(P_QUIT, json.dumps(q, ensure_ascii=False, indent=2), f"bot: quit {stamp()}")


def quit_status_text():
    q = _load_quit()
    if not q or not q.get("quit_date"):
        return ("Давай настроим трекер. Напиши, например: «бросаю с сегодня, курил 20 в день, "
                "пачка 250» — и я начну считать дни, деньги и здоровье.")
    try:
        qd = dt.date.fromisoformat(q["quit_date"])
    except Exception:
        return "Не разобрал дату отказа. Напиши «бросаю с сегодня»."
    days = max((now_local().date() - qd).days, 0)
    cpd = q.get("cigs_per_day", 0) or 0
    pack = q.get("cigs_per_pack", 20) or 20
    price = q.get("price_per_pack", 0) or 0
    cigs = days * cpd
    money = (cigs / pack) * price if pack else 0
    nxt = next(((d, t) for d, t in HEALTH_MILESTONES if d > days), None)
    lines = [f"🚭 Без сигарет: {days} дн.",
             f"🚬 Не выкурено: ~{cigs} сигарет",
             f"💰 Сэкономлено: ~{money:,.0f} ₽".replace(",", " ")]
    if q.get("cravings_resisted"):
        lines.append(f"💪 Поборол тягу: {q['cravings_resisted']} раз")
    if nxt:
        lines.append(f"🎯 Следующая веха (через {nxt[0]-days} дн.): {nxt[1]}")
    lines.append("\nТянет закурить — просто напиши «хочу курить», помогу пережить.")
    return "\n".join(lines)


def journal_append(text):
    j, _ = gh.get_file(P_JOURNAL)
    j = (j or "# Дневник\n") + f"- {stamp()} · {text}\n"
    gh.put_file(P_JOURNAL, j, f"bot: journal {stamp()}")


def journal_tail(n=40):
    j, _ = gh.get_file(P_JOURNAL)
    if not j:
        return ""
    return "\n".join(j.splitlines()[-n:])


def journal_search(query, max_lines=15, skip_recent=80):
    """Поиск по ВСЕМУ дневнику по ключевым словам из сообщения (долгая память)."""
    j, _ = gh.get_file(P_JOURNAL)
    if not j:
        return ""
    stop = {"что", "там", "как", "это", "меня", "мне", "был", "была", "было", "когда", "какие", "какой"}
    # основы слов (стемминг по первым 5 буквам) — чтобы ловить разные окончания
    stems = [w[:5] for w in re.findall(r"[a-zа-яё0-9]{4,}", query.lower()) if w not in stop]
    stems = [s for s in stems if len(s) >= 4]
    if not stems:
        return ""
    lines = j.splitlines()
    older = lines[:-skip_recent] if len(lines) > skip_recent else []
    scored = []
    for ln in older:
        low = ln.lower()
        s = sum(1 for k in stems if k in low)
        if s:
            scored.append((s, ln))
    scored.sort(key=lambda x: -x[0])
    return "\n".join(ln for _, ln in scored[:max_lines])


# ---------- финансы ----------
def fmt_money(n):
    try:
        return f"{float(n):,.0f} ₽".replace(",", " ")
    except Exception:
        return "—"


def owner_income(fin):
    """Доход владельца = сумма (прибыль × доля) по компаниям с известной прибылью."""
    total = 0.0
    for c in (fin.get("companies") or {}).values():
        p = c.get("profit")
        if isinstance(p, (int, float)):
            total += p * (c.get("share", 1.0) or 1.0)
    return total


def finance_summary_text():
    fin = _load_json(P_FINANCE, {})
    if not fin:
        return ("Финансовые цифры ещё не заданы. Напиши, например: «Калмыкия в мае +200 тыс», "
                "«агрегатор 2,1 млн», «мой доход 3,5 млн», «долг 4,2 млн».")
    lines = [f"💰 Финансовая сводка · обновлено {fin.get('updated','')}", "", "По компаниям (опер. прибыль/мес):"]
    for name, c in (fin.get("companies") or {}).items():
        p = c.get("profit")
        share = c.get("share", 1.0) or 1.0
        mon = c.get("month", "")
        if not isinstance(p, (int, float)):
            lines.append(f"• {name}: {c.get('note','уточнить')}")
            continue
        if share < 1.0:
            lines.append(f"• {name}: {fmt_money(p)} (доля {share*100:.0f}% → {fmt_money(p*share)}) · {mon}")
        else:
            lines.append(f"• {name}: {fmt_money(p)} · {mon}")
    inc = owner_income(fin)
    goal = fin.get("goal_income") or 0
    final = fin.get("goal_final")
    lines.append("")
    lines.append(f"📈 Твой доход (доля): ~{fmt_money(inc)}/мес")
    if goal:
        gap = goal - inc
        pct = min(100, inc / goal * 100) if goal else 0
        lines.append(f"🎯 Цель {fmt_money(goal)}: {bar(inc, goal)} {pct:.0f}%")
        lines.append(("   ещё " + fmt_money(gap) if gap > 0 else "   🏆 цель достигнута!")
                     + (f" · финальная {fmt_money(final)}" if final else ""))
    if fin.get("debt_total"):
        lines.append("")
        lines.append(f"🏦 Долг: {fmt_money(fin['debt_total'])}")
        for cr in fin.get("credits", []):
            pay = f" — платёж {fmt_money(cr['payment'])}/мес" if cr.get("payment") else ""
            note = f" · {cr['note']}" if cr.get("note") else ""
            lines.append(f"   • {cr.get('name','кредит')}{pay}{note}")
    lines.append("\nОбновить: «Калмыкия +200 тыс», «мой доход 3,6 млн», «долг 4,2 млн».")
    return "\n".join(lines)


def finance_for_brain():
    fin = _load_json(P_FINANCE, {})
    if not fin:
        return "цифры не заданы"
    parts = [f"доход владельца ~{fmt_money(owner_income(fin))}/мес, цель {fmt_money(fin.get('goal_income',0))}"]
    if fin.get("debt_total"):
        parts.append(f"долг {fmt_money(fin['debt_total'])}")
    for name, c in (fin.get("companies") or {}).items():
        if isinstance(c.get("profit"), (int, float)):
            parts.append(f"{name}: {fmt_money(c['profit'])}")
    return "; ".join(parts)


def mis_sync_finance(period=None):
    """Забрать сводку из ВСЕХ источников-МИС и свести в finance.json.

    Если несколько МИС отдают цифры по одной компании (например, ПВЛ из «ЕС
    профосмотры» и «Реновации») — выручка/прибыль СУММИРУЮТСЯ. Доли владельца —
    на стороне бота (из mis_map). Возвращает (список_изменённых, список_ошибок)."""
    fin = _load_json(P_FINANCE, {})
    fin.setdefault("companies", {})
    mp = fin.get("mis_map", {}) if isinstance(fin.get("mis_map"), dict) else {}
    acc = {}            # key -> {revenue, profit, share, sources:set}
    errors = []
    period_label = ""
    for s in mis_sync.sources():
        try:
            data = mis_sync.fetch(s, period)
        except Exception as e:
            errors.append(f"{s['name']}: {e}")
            continue
        per = data.get("period", {}) or {}
        period_label = per.get("to") or per.get("from") or period_label
        for c in data.get("companies", []):
            cid = str(c.get("id", ""))
            m = mp.get(cid, {}) if isinstance(mp, dict) else {}
            key = m.get("key")
            if not key:                              # нет в карте — по имени, иначе заводим
                nm = c.get("name", "") or cid
                key = next((k for k in fin["companies"]
                            if nm and (nm.lower() in k.lower() or k.lower() in nm.lower())), nm)
            a = acc.setdefault(key, {"revenue": None, "profit": None, "share": m.get("share"), "sources": set()})
            rev, prof = c.get("revenue"), c.get("profit")
            if prof is None and rev is not None and c.get("expenses") is not None:
                prof = rev - c["expenses"]
            if rev is not None:
                a["revenue"] = (a["revenue"] or 0) + rev
            if prof is not None:
                a["profit"] = (a["profit"] or 0) + prof
            if m.get("share") is not None:
                a["share"] = m["share"]
            a["sources"].add(s["name"])
    changed = []
    for key, a in acc.items():
        ent = fin["companies"].get(key, {})
        if a["revenue"] is not None:
            ent["revenue"] = a["revenue"]
        if a["profit"] is not None:
            ent["profit"] = a["profit"]
        if a["share"] is not None:
            ent["share"] = a["share"]
        ent.setdefault("share", 1.0)
        if period_label:
            ent["month"] = period_label
        fin["companies"][key] = ent
        src = "+".join(sorted(a["sources"]))
        changed.append(f"{key}" + (f" ({src})" if src else ""))
    if acc:
        fin["updated"] = "МИС · " + stamp()
        _save_json(P_FINANCE, fin, f"bot: mis sync {stamp()}")
    if errors and not acc:                            # совсем ничего не получили
        raise RuntimeError("; ".join(errors))
    return changed, errors


def cmd_missync(chat_id):
    if not (mis_sync and mis_sync.configured()):
        send(chat_id, "🔌 МИС пока не подключена.\nНужно: разработчики МИС делают endpoint по ТЗ "
                      "(файл «МИС_интеграция_ТЗ.md»), затем в Railway добавляешь переменные источника "
                      "(MIS_SOURCES + MIS_<ИМЯ>_URL/MIS_<ИМЯ>_TOKEN). После этого /missync тянет цифры сам.")
        return
    try:
        ch, errs = mis_sync_finance()
    except Exception as e:
        send(chat_id, f"Не смог получить данные из МИС: {e}")
        return
    msg = "🔄 Обновил из МИС: " + (", ".join(ch) if ch else "нет данных")
    if errs:
        msg += "\n⚠️ Часть источников недоступна: " + "; ".join(errs)
    send(chat_id, msg + "\n\n" + finance_summary_text())


# ---------- дедлайны (обратный отсчёт + эскалация) ----------
def _load_deadlines():
    return _load_json(P_DEADLINES, [])


def _save_deadlines(d):
    _save_json(P_DEADLINES, d, f"bot: deadlines {stamp()}")


def _deadline_days(date_str):
    try:
        return (dt.date.fromisoformat(date_str) - now_local().date()).days
    except Exception:
        return None


def _deadline_icon(days):
    if days is None:
        return "•"
    if days < 0:
        return "⚠️"
    if days <= 3:
        return "🔴"
    if days <= 7:
        return "🟠"
    if days <= 14:
        return "🟡"
    return "🟢"


def upcoming_deadlines(within=None, include_overdue=True):
    res = []
    for d in _load_deadlines():
        if d.get("done"):
            continue
        days = _deadline_days(d.get("date", ""))
        if days is None:
            continue
        if not include_overdue and days < 0:
            continue
        if within is not None and days > within:
            continue
        res.append((days, d))
    res.sort(key=lambda x: x[0])
    return res


def deadlines_text(within=None):
    ups = upcoming_deadlines(within)
    if not ups:
        return "✅ Горящих дедлайнов нет."
    lines = ["⏳ Дедлайны (обратный отсчёт):"]
    for days, d in ups:
        when = ("просрочен на " + str(-days) + " дн" if days < 0 else
                ("сегодня!" if days == 0 else ("завтра" if days == 1 else f"через {days} дн")))
        co = f"[{d.get('company')}] " if d.get("company") else ""
        lines.append(f"{_deadline_icon(days)} {when} ({d.get('date')}) — {co}{d.get('text','')}")
    return "\n".join(lines)


def deadlines_for_brain(within=21):
    ups = upcoming_deadlines(within)
    if not ups:
        return "нет ближайших"
    return "; ".join(f"{d.get('text','')[:40]} — {('просрочен' if days<0 else str(days)+' дн')}" for days, d in ups)


# ---------- путь к цели: рычаги дохода ----------
def _load_levers():
    return _load_json(P_LEVERS, {})


def _save_levers(obj):
    _save_json(P_LEVERS, obj, f"bot: levers {stamp()}")


def levers_text():
    obj = _load_levers()
    levers = obj.get("levers", []) if isinstance(obj, dict) else []
    fin = _load_json(P_FINANCE, {})
    inc = owner_income(fin)
    goal = fin.get("goal_income") or 0
    gap = goal - inc if goal else 0
    lines = ["🎯 Путь к цели по доходу", ""]
    if goal:
        lines.append(f"Сейчас: ~{fmt_money(inc)}/мес · цель {fmt_money(goal)} · разрыв {fmt_money(gap)}")
        lines.append(f"{bar(inc, goal)} {min(100, inc/goal*100):.0f}%\n")
    if not levers:
        lines.append("Рычаги не заданы. Скажи: «рычаг Калмыкия 30%», «новый рычаг предрейсовые, потенциал 300 тыс».")
        return "\n".join(lines)
    lines.append("Рычаги (потенциал → реализовано):")
    realized = 0
    for lv in sorted(levers, key=lambda x: -(x.get("impact") or 0)):
        imp = lv.get("impact") or 0
        pr = lv.get("progress") or 0
        realized += imp * pr / 100
        lines.append(f"• {lv.get('name','?')}: {bar(pr,100)} {pr:.0f}% · потенциал +{fmt_money(imp)}/мес")
        if lv.get("note"):
            lines.append(f"  ↳ {lv['note']}")
    total = sum((lv.get("impact") or 0) for lv in levers)
    lines.append(f"\n💡 Если закрыть все рычаги: +{fmt_money(total)}/мес (реализовано ~{fmt_money(realized)}).")
    if gap > 0:
        lines.append(f"Для разрыва {fmt_money(gap)} хватит рычагов — фокус на самых весомых сверху.")
    return "\n".join(lines)


def levers_for_brain():
    obj = _load_levers()
    levers = obj.get("levers", []) if isinstance(obj, dict) else []
    if not levers:
        return "рычаги не заданы"
    return "; ".join(f"{lv.get('name','')}: {lv.get('progress',0)}% (потенц. {fmt_money(lv.get('impact',0))})" for lv in levers)


# ---------- воронка (структурные сделки) ----------
STAGE_ORDER = ["выиграно", "кп/счёт", "переговоры", "контакт", "лид", "ожидание", "проиграно"]
STAGE_ICON = {"лид": "🌱", "контакт": "📞", "переговоры": "🔥", "кп/счёт": "📄",
              "ожидание": "⏳", "выиграно": "✅", "проиграно": "❌"}


def _norm_stage(s):
    s = (s or "").strip().lower()
    aliases = {"новый": "лид", "входящий": "лид", "квалификация": "контакт", "звонок": "контакт",
               "встреча": "переговоры", "переговор": "переговоры", "кп": "кп/счёт", "счёт": "кп/счёт",
               "счет": "кп/счёт", "оплата": "выиграно", "закрыто": "выиграно", "победа": "выиграно",
               "отказ": "проиграно", "слив": "проиграно"}
    return aliases.get(s, s) or "лид"


def days_since(date_str):
    try:
        return (now_local().date() - dt.date.fromisoformat(date_str)).days
    except Exception:
        return 0


def stale_deals(deals=None):
    deals = deals if deals is not None else _load_json(P_DEALS, [])
    res = []
    for d in deals:
        if _norm_stage(d.get("stage")) in ("выиграно", "проиграно"):
            continue
        if days_since(d.get("last_touch", "")) >= DEALS_STALE_DAYS:
            res.append(d)
    res.sort(key=lambda d: -days_since(d.get("last_touch", "")))
    return res


def deals_text():
    deals = _load_json(P_DEALS, [])
    active = [d for d in deals if _norm_stage(d.get("stage")) not in ("выиграно", "проиграно")]
    if not deals:
        return ("Воронка пуста. Скажи, например: «новый клиент Рэдиссон, стадия переговоры, "
                "шаг — отправить КП» — заведу сделку.")
    lines = [f"🎯 Воронка · {len(active)} активных сделок"]
    for stage in STAGE_ORDER:
        grp = [d for d in deals if _norm_stage(d.get("stage")) == stage]
        if not grp:
            continue
        if stage in ("выиграно", "проиграно"):
            lines.append(f"\n{STAGE_ICON[stage]} {stage.upper()}: " + ", ".join(d.get("name", "?") for d in grp))
            continue
        lines.append(f"\n{STAGE_ICON.get(stage,'•')} {stage.upper()}")
        for d in grp:
            val = f" — {d['value']}" if d.get("value") else ""
            ds = days_since(d.get("last_touch", ""))
            flag = " 🔴" if ds >= DEALS_STALE_DAYS else (" 🟡" if ds >= max(3, DEALS_STALE_DAYS - 3) else "")
            step = f"\n   шаг: {d['next_step']}" if d.get("next_step") else ""
            lines.append(f"• {d.get('name','?')}{val}{step} · тишина {ds} дн{flag}")
    return "\n".join(lines)


def deals_watch_text():
    stale = stale_deals()
    if not stale:
        return ""
    lines = ["🔔 По сделкам давно тишина — стоит шевельнуть:"]
    for d in stale[:8]:
        ds = days_since(d.get("last_touch", ""))
        step = f" → {d['next_step']}" if d.get("next_step") else ""
        lines.append(f"• {d.get('name','?')} ({_norm_stage(d.get('stage'))}, {ds} дн){step}")
    lines.append("\nДвигаем? Напиши «по <клиенту> <что сделал>» — отмечу касание и обновлю стадию.")
    return "\n".join(lines)


# ---------- применение действий ----------
def apply_actions(actions):
    if not actions:
        return []
    changes = []
    tasks, _ = gh.get_file(P_TASKS)
    funnel, _ = gh.get_file(P_FUNNEL)
    personal, _ = gh.get_file(P_PERSONAL)
    tasks = tasks or "# Задачи\n\n## Активные\n\n## Выполнено\n"
    funnel = funnel or "# Воронка продаж\n"
    personal = personal or "# Личное\n\n## Задачи\n\n## Заметки\n"
    today = now_local().date().isoformat()
    dirty = {"tasks": False, "funnel": False, "personal": False}
    game = _load_json(P_GAME, {})
    dirty_game = False

    for a in actions:
        t = a.get("type")
        if t == "add_task":
            if a.get("scope") == "personal":
                line = f"- {a.get('priority','🟡')} {a.get('text','').strip()} _(добавлено {today})_\n"
                personal = personal.replace("## Задачи\n", "## Задачи\n" + line, 1) if "## Задачи\n" in personal else personal + "\n## Задачи\n" + line
                dirty["personal"] = True
                changes.append("➕ личная задача: " + a.get("text", "")[:50])
            else:
                new_norm = _normalize_task(a.get("text", ""))
                existing = [_normalize_task(l) for l in _md_section(tasks, "## Активные").splitlines()
                            if l.strip().startswith("-")]
                if new_norm and any(_task_similar(new_norm, e) for e in existing):
                    changes.append("↩️ похожая задача уже есть — не дублирую: " + a.get("text", "")[:40])
                else:
                    line = f"- {a.get('priority','🟡')} [{a.get('company','—')}] {a.get('text','').strip()} _(добавлено {today})_\n"
                    tasks = tasks.replace("## Активные\n", "## Активные\n" + line, 1) if "## Активные\n" in tasks else tasks + "\n## Активные\n" + line
                    dirty["tasks"] = True
                    changes.append("➕ задача: " + a.get("text", "")[:50])
        elif t == "done_task":
            m = a.get("match", "").strip()
            # убрать совпадающую строку из «Активных»
            act_block = _md_section(tasks, "## Активные")
            removed = None
            for l in act_block.splitlines():
                if l.strip().startswith("-") and m and (m.lower() in l.lower()
                        or _task_similar(_normalize_task(l), _normalize_task(m))):
                    removed = l
                    break
            if removed:
                tasks = tasks.replace(removed + "\n", "", 1) if (removed + "\n") in tasks else tasks.replace(removed, "", 1)
            tasks = tasks.replace("## Выполнено\n", f"## Выполнено\n- ✅ {m} _(закрыто {today})_\n", 1) if "## Выполнено\n" in tasks else tasks + f"\n## Выполнено\n- ✅ {m} _(закрыто {today})_\n"
            dirty["tasks"] = True
            changes.append("✅ закрыто: " + m[:50])
            award_xp(game, XP_BY_PRIORITY.get(a.get("priority"), 5), "задача", changes)
            dirty_game = True
        elif t == "add_funnel":
            funnel += f"\n- {a.get('text','').strip()} _(добавлено {today})_"
            dirty["funnel"] = True
            changes.append("🎯 воронка: " + a.get("text", "")[:50])
            # дублируем в структурную воронку как лид (чтобы попадал в /deals и автопинги)
            deals = _load_json(P_DEALS, [])
            deals.append({"name": a.get("text", "").strip()[:80], "stage": "лид",
                          "next_step": "", "note": "", "value": "",
                          "last_touch": today, "created": today})
            _save_json(P_DEALS, deals, f"bot: deal+ {stamp()}")
        elif t == "add_deal":
            deals = _load_json(P_DEALS, [])
            deals.append({"name": a.get("name", a.get("text", "")).strip()[:80],
                          "stage": _norm_stage(a.get("stage")),
                          "next_step": a.get("next_step", "").strip(),
                          "note": a.get("note", "").strip(), "value": a.get("value", ""),
                          "last_touch": today, "created": today})
            _save_json(P_DEALS, deals, f"bot: deal {stamp()}")
            changes.append("🎯 сделка: " + a.get("name", a.get("text", ""))[:50])
        elif t == "update_deal":
            deals = _load_json(P_DEALS, [])
            m = (a.get("match") or a.get("name") or "").strip().lower()
            hit = None
            for d in deals:
                if m and m in d.get("name", "").lower():
                    hit = d
                    break
            if hit:
                if a.get("stage"):
                    hit["stage"] = _norm_stage(a.get("stage"))
                if a.get("next_step") is not None:
                    hit["next_step"] = a.get("next_step", "").strip()
                if a.get("note"):
                    hit["note"] = a.get("note", "").strip()
                if a.get("value"):
                    hit["value"] = a.get("value")
                hit["last_touch"] = today          # любое обновление = касание
                _save_json(P_DEALS, deals, f"bot: deal upd {stamp()}")
                tail = f" → {hit['stage']}" if a.get("stage") else ""
                changes.append(f"🎯 обновил сделку: {hit['name'][:40]}{tail}")
            else:
                changes.append("🤔 сделку не нашёл — уточни название")
        elif t == "set_finance":
            fin = _load_json(P_FINANCE, {})
            field, amt = a.get("field"), a.get("amount")
            if field == "owner_income":
                fin["owner_income_manual"] = amt        # ручной ввод (справочно)
            elif field == "goal":
                fin["goal_income"] = amt
            elif field == "goal_final":
                fin["goal_final"] = amt
            elif field == "debt":
                fin["debt_total"] = amt
            fin["updated"] = stamp()
            _save_json(P_FINANCE, fin, f"bot: finance {stamp()}")
            changes.append(f"💰 обновил: {field} = {fmt_money(amt)}")
        elif t == "set_company_finance":
            fin = _load_json(P_FINANCE, {})
            fin.setdefault("companies", {})
            name = (a.get("company") or "").strip()
            # ищем существующую компанию по подстроке, иначе создаём
            key = next((k for k in fin["companies"] if name.lower() in k.lower() or k.lower() in name.lower()), name)
            ent = fin["companies"].get(key, {})
            if a.get("profit") is not None:
                ent["profit"] = a.get("profit")
            if a.get("share") is not None:
                ent["share"] = a.get("share")
            if a.get("month"):
                ent["month"] = a.get("month")
            fin["companies"][key] = ent
            fin["updated"] = stamp()
            _save_json(P_FINANCE, fin, f"bot: finance co {stamp()}")
            changes.append(f"💰 {key}: {fmt_money(a.get('profit'))}" if a.get("profit") is not None
                           else f"💰 обновил {key}")
        elif t == "add_deadline":
            dl = _load_deadlines()
            dl.append({"date": a.get("date", ""), "text": (a.get("text") or "").strip(),
                       "company": a.get("company", ""), "done": False})
            _save_deadlines(dl)
            dd = _deadline_days(a.get("date", ""))
            changes.append(f"⏳ дедлайн {a.get('date','')}" + (f" (через {dd} дн)" if dd and dd >= 0 else "") +
                           ": " + (a.get("text", "")[:40]))
        elif t == "done_deadline":
            dl = _load_deadlines()
            m = (a.get("match") or "").strip().lower()
            hit = False
            for d in dl:
                if m and m in d.get("text", "").lower() and not d.get("done"):
                    d["done"] = True
                    hit = True
                    break
            if hit:
                _save_deadlines(dl)
                changes.append("✅ дедлайн закрыт: " + m[:40])
        elif t == "set_lever":
            obj = _load_levers()
            if not isinstance(obj, dict):
                obj = {}
            obj.setdefault("levers", [])
            name = (a.get("name") or "").strip()
            lv = next((x for x in obj["levers"] if name.lower() in x.get("name", "").lower()
                       or x.get("name", "").lower() in name.lower()), None)
            if not lv:
                lv = {"name": name, "impact": 0, "progress": 0}
                obj["levers"].append(lv)
            if a.get("impact") is not None:
                lv["impact"] = a.get("impact")
            if a.get("progress") is not None:
                lv["progress"] = max(0, min(100, a.get("progress")))
            if a.get("note"):
                lv["note"] = a.get("note")
            _save_levers(obj)
            changes.append(f"🎯 рычаг «{lv['name']}»: {lv.get('progress',0)}% · потенц. {fmt_money(lv.get('impact',0))}")
        elif t == "add_reminder":
            when = a.get("when", "").strip()
            txt = a.get("text", "").strip()
            rems = _load_reminders()
            rems.append({"when": when, "text": txt, "done": False})
            _save_reminders(rems)
            nice = when.replace("T", " ")
            changes.append(f"⏰ напоминание на {nice}: {txt[:50]}")
        elif t == "add_recurring":
            rec = _load_json(P_RECURRING, [])
            rule = {"text": a.get("text", "").strip(), "time": a.get("time", "09:00"),
                    "days_of_month": a.get("days_of_month"), "every_days": a.get("every_days"),
                    "weekdays": a.get("weekdays"), "start": today, "last_fired": ""}
            rec.append(rule)
            _save_json(P_RECURRING, rec, f"bot: recurring {stamp()}")
            if rule["days_of_month"]:
                desc = "числа: " + ", ".join(map(str, rule["days_of_month"]))
            elif rule["every_days"]:
                desc = f"каждые {rule['every_days']} дн."
            elif rule["weekdays"] is not None:
                dn = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
                desc = ", ".join(dn[d] for d in rule["weekdays"] if 0 <= d < 7)
            else:
                desc = "регулярно"
            changes.append(f"🔁 регулярное напоминание: {rule['text'][:50]} ({desc}, {rule['time']})")
        elif t == "add_block":
            date = (a.get("date") or today).strip()
            start = (a.get("start") or "").strip()
            end = (a.get("end") or "").strip() or None
            txt = (a.get("text") or "").strip()
            if start and txt:
                ag = _load_agenda()
                ag.append({"date": date, "start": start, "end": end, "text": txt})
                _save_agenda(ag)
                if a.get("remind", True):             # по умолчанию пингуем в начало блока
                    rems = _load_reminders()
                    rems.append({"when": f"{date}T{start}", "text": txt, "done": False, "from_block": True})
                    _save_reminders(rems)
                rng = start + (f"–{end}" if end else "")
                changes.append(f"🗓 в сетку {date} {rng}: {txt[:40]}")
        elif t == "del_block":
            date = (a.get("date") or today).strip()
            m = (a.get("match") or "").strip().lower()
            ag = _load_agenda()
            before = len(ag)
            ag = [b for b in ag if not (b.get("date") == date and m and m in b.get("text", "").lower())]
            if len(ag) < before:
                _save_agenda(ag)
                changes.append(f"🗑 убрал из сетки {date}: {m[:40]}")
            else:
                changes.append("🤔 в сетке такого не нашёл")
        elif t == "set_quit":
            q = _load_quit()
            q["quit_date"] = a.get("quit_date") or today
            if a.get("cigs_per_day") is not None:
                q["cigs_per_day"] = a.get("cigs_per_day")
            if a.get("price_per_pack") is not None:
                q["price_per_pack"] = a.get("price_per_pack")
            q["cigs_per_pack"] = a.get("cigs_per_pack") or q.get("cigs_per_pack", 20)
            q.setdefault("cravings_resisted", 0)
            _save_quit(q)
            changes.append("🚭 трекер отказа от курения обновлён")
        elif t == "log_habit":
            habit = (a.get("habit") or "").strip().lower()
            if habit:
                day = (a.get("date") or today).strip()
                habits = _load_habits()
                prev_streak = compute_streak(habits.get(habit, []))
                dates = set(habits.get(habit, []))
                dates.add(day)
                habits[habit] = sorted(dates)
                _save_habits(habits)
                st = compute_streak(habits[habit])
                fire = "🔥" * min(st, 5) or "✅"
                celebrate = _random.choice(CELEBRATIONS)
                line = f"{celebrate} {fire} {habit}: {st} дн. подряд {chain_text(habits[habit])}"
                # рост планки по лесенке
                plans = _load_plans()
                if habit in plans:
                    before = ladder_goal(plans[habit], prev_streak)
                    after = ladder_goal(plans[habit], st)
                    if after and after != before:
                        line += f"\n📈 Планка выросла: теперь «{after}». Ты готов 💪"
                changes.append(line)
                award_xp(game, 3, None, changes)
                dirty_game = True
        elif t == "set_habit_plan":
            plans = _load_plans()
            habit = (a.get("habit") or "").strip().lower()
            if habit:
                p = plans.get(habit, {})
                if a.get("anchor"):
                    p["anchor"] = a.get("anchor", "").strip()
                if a.get("category"):
                    p["category"] = a.get("category", "").strip()
                if a.get("ladder"):
                    p["ladder"] = a.get("ladder")
                elif a.get("goal"):
                    p.setdefault("ladder", [{"min": 0, "goal": a.get("goal", "").strip()}])
                p.setdefault("created", today)
                plans[habit] = p
                _save_plans(plans)
                g = ladder_goal(p, 0)
                an = f" {p['anchor']}" if p.get("anchor") else ""
                changes.append(f"🪜 привычка-шаг: «{habit}» → {g}{(' (' + p['anchor'] + ')') if p.get('anchor') else ''}")
        elif t == "ritual_step":
            key = (a.get("ritual") or "").strip().lower()
            key = "утро" if key in ("утренний", "утро", "morning") else ("вечер" if key in ("вечерний", "вечер", "evening") else key)
            r = mark_ritual_step(key, a.get("step", ""))
            if r:
                changes.append(r)
        elif t == "ritual_done":
            key = (a.get("ritual") or "").strip().lower()
            key = "утро" if key in ("утренний", "утро", "morning") else ("вечер" if key in ("вечерний", "вечер", "evening") else key)
            r = ritual_done_all(key)
            if r:
                changes.append(r)
        elif t == "set_ritual":
            rits = _load_rituals()
            key = (a.get("ritual") or "").strip().lower()
            key = "утро" if key in ("утренний", "утро", "morning") else ("вечер" if key in ("вечерний", "вечер", "evening") else key)
            if key:
                r = rits.get(key, {})
                if a.get("steps"):
                    r["steps"] = a.get("steps")
                if a.get("time"):
                    r["time"] = a.get("time")
                if a.get("title"):
                    r["title"] = a.get("title")
                r.setdefault("title", key.title())
                r.setdefault("icon", "🌅" if key == "утро" else ("🌙" if key == "вечер" else "🔁"))
                rits[key] = r
                _save_json(P_RITUALS, rits, f"bot: ritual set {stamp()}")
                changes.append(f"{r['icon']} {r['title']}: " + ", ".join(r.get("steps", [])))
        elif t == "log_weight":
            kg = a.get("kg")
            if kg:
                w = _load_json(P_WEIGHT, [])
                w.append({"date": today, "kg": kg})
                _save_json(P_WEIGHT, w, f"bot: weight {stamp()}")
                trend = ""
                prev = [x for x in w[:-1] if x.get("kg")]
                if prev:
                    diff = kg - prev[-1]["kg"]
                    trend = f" ({'+' if diff >= 0 else ''}{diff:.1f} кг к прошлому)"
                changes.append(f"⚖️ вес {kg} кг записан{trend}")
        elif t == "set_fact":
            f, _ = gh.get_file(P_FACTS)
            f = f or "# Проверенные факты (приоритет над остальными записями)\n"
            f += f"\n- {a.get('text', '').strip()} _(уточнено {today})_"
            gh.put_file(P_FACTS, f, f"bot: факт {stamp()}")
            changes.append("🧠 запомнил факт: " + a.get("text", "")[:60])
        elif t == "log_mood":
            m = _load_json(P_MOOD, [])
            m.append({"date": today, "score": a.get("score"), "note": a.get("note", "")})
            _save_json(P_MOOD, m, f"bot: mood {stamp()}")
            changes.append("💚 отметил твоё состояние")
        elif t == "set_mit":
            _save_json(P_MIT, {"date": today, "text": a.get("text", "").strip(), "done": False}, f"bot: mit {stamp()}")
            changes.append("⭐ главное дело дня: " + a.get("text", "")[:60])
        elif t == "done_mit":
            mit = _load_json(P_MIT, {})
            mit["done"] = True
            _save_json(P_MIT, mit, f"bot: mit done {stamp()}")
            game["mit_streak"] = game.get("mit_streak", 0) + 1
            award_xp(game, 15, f"главное дело дня (серия {game['mit_streak']})", changes)
            dirty_game = True
        elif t == "log_energy":
            e = _load_json(P_ENERGY, [])
            e.append({"date": today, "score": a.get("score")})
            _save_json(P_ENERGY, e, f"bot: energy {stamp()}")
            sc = a.get("score") or 3
            changes.append("🔋 энергия отмечена" + (" — день делаем полегче, без геройства" if sc <= 2 else ""))
        elif t == "boss_progress":
            bosses = _load_json(P_BOSSES, [])
            name = (a.get("boss") or "").lower()
            amt = a.get("amount") or 0
            for b in bosses:
                if name and name in b.get("name", "").lower():
                    b["left"] = max(0, b.get("left", b.get("total", 0)) - amt)
                    done = b.get("total", 0) - b["left"]
                    changes.append(f"⚔️ {b['name']}: {bar(done, b.get('total',0))} "
                                   f"{done:,.0f}/{b.get('total',0):,.0f} {b.get('unit','')}".replace(",", " "))
                    if b["left"] <= 0:
                        changes.append(f"🏆 БОСС ПОВЕРЖЕН: {b['name']}!")
                    break
            _save_json(P_BOSSES, bosses, f"bot: boss {stamp()}")
            award_xp(game, 10, "прогресс по цели", changes)
            dirty_game = True
        elif t == "award_badge":
            b = a.get("badge", "").strip()
            if b:
                badges = game.get("badges", [])
                if b not in badges:
                    badges.append(b)
                    game["badges"] = badges
                    award_xp(game, 20, None, changes)
                    changes.append(f"🏅 Достижение: {b}")
                    dirty_game = True
        elif t == "note":
            if a.get("scope") == "personal":
                personal += f"\n- {today}: {a.get('text','').strip()}"
                dirty["personal"] = True
                changes.append("📝 личная заметка")
            else:
                changes.append("📝 заметка")  # рабочие заметки и так в дневнике

    if dirty["tasks"]:
        gh.put_file(P_TASKS, tasks, f"bot: задачи {stamp()}")
    if dirty["funnel"]:
        gh.put_file(P_FUNNEL, funnel, f"bot: воронка {stamp()}")
    if dirty["personal"]:
        gh.put_file(P_PERSONAL, personal, f"bot: личное {stamp()}")
    if dirty_game:
        _save_json(P_GAME, game, f"bot: game {stamp()}")
    return changes


# ---------- обработка ----------
HELP = ("🤖 Я твой умный ежедневник на Claude — рабочее и личное.\n\n"
        "Пиши, наговаривай голосом 🎙 или шли фото/PDF 📸 (счёт, акт, прайс, договор) — пойму и разнесу.\n"
        "Скажи «напомни завтра в 15:00 …» — пришлю напоминание вовремя.\n\n"
        "Команды:\n• /brief — утренний бриф · /today — день по часам · /day [завтра] — сетка дня ⏱ · /week — план недели 🗓 · /plan — все будущие дела 📆\n"
        "• /tasks — задачи (кнопки ✅) · /money — финсводка 💰 · /deals — воронка 🎯 · /missync — обновить из МИС 🔄\n"
        "• /deadlines — сроки с отсчётом ⏳ · /goal — путь к 5 млн 🎯 · /autoplan — план дня авто 🤖\n"
        "• /now — что делать сейчас · /pulse — что провисает 🔔 · /focus 50 ⏳\n"
        "• /game — уровень и XP 🎮 · /boss — крупные цели ⚔️\n"
        "• /step — шаг дня 🪜 · /ritual — утро/вечер 🌅🌙 · /streaks 🔥 · /quit 🚭 · /weight ⚖️ · /mood 💚 · /dates 📅\n"
        "• /dedup — почистить дубли задач 🧹 · /digest — сводка недели · /sync — снимок для Claude 🔄 · /help\n\n"
        "Отмечай: «главное на сегодня …», «сделал главное», «не курил», «вес 92», «устал», "
        "«погасил 500 тыс долга». Тянет закурить — напиши «хочу курить».\n"
        "Финансы/продажи: «Калмыкия +200 тыс», «мой доход 3,6 млн», «долг 4,2 млн»; "
        "«новый клиент Рэдиссон, переговоры», «по Чайхоне отправил КП».\n"
        "Привычки-шаги 🪜: «новая привычка: 5 приседаний перед душем», «сделал шаг», «потренировался» — "
        "расту планку и считаю цепочку.\n"
        "Сетка дня ⏱: «в 10:00 звонок юристу», «поставь аудит на завтра 14:00–16:00» — разложу день по часам, "
        "покажу свободные окна (/day, /today).\n"
        "Авто-план 🤖: «набросай план на завтра» (или /autoplan) — сам разложу горящие задачи по часам; "
        "«прими план» — закреплю. Вечером предложу черновик на завтра сам.")


def process_text(chat_id, text, voice_reply=False):
    low = text.lower()
    if any(w in low for w in CRAVING_WORDS):   # SOS при тяге — реагируем мгновенно
        cmd_sos(chat_id)
        return
    journal_append(text)
    profile, _ = gh.get_file(P_PROFILE)
    ctx, _ = gh.get_file(P_CTX)
    tasks, _ = gh.get_file(P_TASKS)
    funnel, _ = gh.get_file(P_FUNNEL)
    personal, _ = gh.get_file(P_PERSONAL)
    facts, _ = gh.get_file(P_FACTS)
    convo = _load_json(P_CONVO, [])          # короткая память беседы
    funnel_full = (funnel or "") + "\n\n[Структурные сделки]\n" + deals_text()
    try:
        res = brain.handle(text, stamp(), profile or "", ctx or "", tasks or "", funnel_full,
                           personal or "", journal_tail(80), schedule=schedule_for_brain(),
                           recall=journal_search(text), facts=facts or "",
                           finance=finance_for_brain(), rituals=rituals_overview(),
                           deadlines=deadlines_for_brain(), levers=levers_for_brain(), history=convo)
    except Exception as e:
        print(f"[{stamp()}] brain: {e}")
        send(chat_id, "Записал в дневник, но ИИ-обработка дала сбой. Гляну позже.")
        return
    changes = apply_actions(res.get("actions", []))
    reply_text = res.get("reply", "Принял.")
    reply = reply_text + ("\n\n" + "\n".join(changes) if changes else "")
    send(chat_id, reply)
    # обновляем память беседы (последние ~16 реплик)
    convo.append({"role": "user", "content": text})
    convo.append({"role": "assistant", "content": reply_text})
    _save_json(P_CONVO, convo[-16:], f"bot: convo {stamp()}")
    if (voice_reply or voice_always()) and reply_text:
        try:
            send_voice(chat_id, voice.tts(reply_text))
        except Exception as e:
            print(f"[{stamp()}] tts: {e}")


def today_reminders_text():
    """Строки напоминаний на сегодня (и просроченные), или 'нет'."""
    rems = _load_reminders()
    today = now_local().date()
    due = []
    for r in rems:
        if r.get("done"):
            continue
        try:
            w = dt.datetime.fromisoformat(r["when"])
        except Exception:
            continue
        if w.date() <= today:
            due.append((w, r["text"]))
    # повторяющиеся на сегодня
    for rule in _load_json(P_RECURRING, []):
        if _recurring_due(rule, today):
            try:
                hh = rule.get("time", "09:00")
            except Exception:
                hh = "09:00"
            try:
                t = dt.datetime.strptime(hh, "%H:%M")
                due.append((t.replace(year=today.year, month=today.month, day=today.day), f"{rule['text']} (регулярно)"))
            except Exception:
                pass
    due.sort()
    if not due:
        return "нет"
    return "\n".join(f"• {w.strftime('%H:%M')} — {txt}" for w, txt in due)


def upcoming_text(days=14, limit=40):
    """Единый список ближайших событий: разовые напоминания + повторяющиеся + ДР."""
    now = now_local()
    items = []
    for r in _load_reminders():
        if r.get("done"):
            continue
        try:
            w = dt.datetime.fromisoformat(r["when"])
        except Exception:
            continue
        if now <= w <= now + dt.timedelta(days=days):
            items.append((w, "⏰ " + r.get("text", "")))
    for rule in _load_json(P_RECURRING, []):
        try:
            th, tm = (int(x) for x in rule.get("time", "09:00").split(":"))
        except Exception:
            th, tm = 9, 0
        for i in range(days + 1):
            d = now.date() + dt.timedelta(days=i)
            if _recurring_due(rule, d):
                items.append((dt.datetime(d.year, d.month, d.day, th, tm), "🔁 " + rule.get("text", "")))
    for days_to, age, name, rel in upcoming_birthdays(days):
        d = now.date() + dt.timedelta(days=days_to)
        items.append((dt.datetime(d.year, d.month, d.day, 9, 0), f"🎂 {name} ({rel}) — {age} лет"))
    items.sort(key=lambda x: x[0])
    if not items:
        return "ближайших событий нет"
    return "\n".join(f"{w.strftime('%a %d.%m %H:%M')} — {t}" for w, t in items[:limit])


def future_oneoffs_text(after_days=14, limit=40):
    """Все будущие РАЗОВЫЕ напоминания дальше горизонта (месяц, два — без ограничения по дате)."""
    now = now_local()
    cutoff = now + dt.timedelta(days=after_days)
    items = []
    for r in _load_reminders():
        if r.get("done"):
            continue
        try:
            w = dt.datetime.fromisoformat(r["when"])
        except Exception:
            continue
        if w > cutoff:
            items.append((w, r.get("text", "")))
    items.sort(key=lambda x: x[0])
    if not items:
        return ""
    return "\n".join(f"{w.strftime('%d.%m.%Y %H:%M')} — ⏰ {t}" for w, t in items[:limit])


def schedule_for_brain():
    near = upcoming_text(days=14)
    far = future_oneoffs_text(14)
    today_iso = now_local().date().isoformat()
    grid = day_grid_text(today_iso, header=False)
    base = near + (f"\n\nДальше (позже 2 недель):\n{far}" if far else "")
    return base + (f"\n\nСЕГОДНЯ ПО ЧАСАМ:\n{grid}" if grid else "")


# ---------- почасовая сетка дня ----------
WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]


def _load_agenda():
    return _load_json(P_AGENDA, [])


def _save_agenda(a):
    _save_json(P_AGENDA, a, f"bot: agenda {stamp()}")


def _hhmm_to_min(s):
    try:
        h, m = (int(x) for x in str(s).split(":"))
        return h * 60 + m
    except Exception:
        return None


def _min_to_hhmm(n):
    return f"{n // 60:02d}:{n % 60:02d}"


def parse_day(text):
    """Разобрать день из текста: сегодня/завтра/послезавтра/DD.MM[.YYYY]; иначе сегодня."""
    low = (text or "").lower()
    today = now_local().date()
    if "послезавтра" in low:
        return (today + dt.timedelta(days=2)).isoformat()
    if "завтра" in low:
        return (today + dt.timedelta(days=1)).isoformat()
    for i, wd in enumerate(["понедельник", "вторник", "сред", "четверг", "пятниц", "суббот", "воскрес"]):
        if wd in low:
            delta = (i - today.weekday()) % 7        # 0 = сегодня (этот же день недели)
            return (today + dt.timedelta(days=delta)).isoformat()
    m = re.search(r"(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?", low)
    if m:
        d, mo = int(m.group(1)), int(m.group(2))
        y = int(m.group(3)) if m.group(3) else today.year
        if y < 100:
            y += 2000
        try:
            return dt.date(y, mo, d).isoformat()
        except Exception:
            pass
    return today.isoformat()


def agenda_for_day(d_iso):
    """Все события дня с временем: блоки сетки + напоминания + повторяющиеся + ритуалы. (start,end,text)."""
    items = []
    for b in _load_agenda():
        if b.get("date") == d_iso and b.get("start"):
            items.append((b["start"], b.get("end"), b.get("text", "")))
    for r in _load_reminders():
        if r.get("done") or r.get("from_block"):
            continue
        try:
            w = dt.datetime.fromisoformat(r["when"])
        except Exception:
            continue
        if w.date().isoformat() == d_iso:
            items.append((w.strftime("%H:%M"), None, "⏰ " + r.get("text", "")))
    try:
        dd = dt.date.fromisoformat(d_iso)
    except Exception:
        dd = now_local().date()
    for rule in _load_json(P_RECURRING, []):
        if _recurring_due(rule, dd):
            items.append((rule.get("time", "09:00"), None, "🔁 " + rule.get("text", "")))
    for key, rit in _load_rituals().items():
        if rit.get("time"):
            items.append((rit["time"], None, f"{rit.get('icon','🔁')} {rit.get('title', key)}"))
    items = [it for it in items if _hhmm_to_min(it[0]) is not None]
    items.sort(key=lambda x: _hhmm_to_min(x[0]))
    return items


def _free_windows_min(items):
    """Свободные окна (в минутах) в рабочем дне (DAY_START..DAY_END)."""
    ws, we = _hhmm_to_min(DAY_START), _hhmm_to_min(DAY_END)
    busy = []
    for start, end, _ in items:
        s = _hhmm_to_min(start)
        e = _hhmm_to_min(end) if end else (s + 60)        # без конца — считаем час
        if s is None:
            continue
        busy.append((max(s, ws), min(max(e, s + 15), we)))
    busy = [b for b in busy if b[0] < we and b[1] > ws]
    busy.sort()
    free, cur = [], ws
    for s, e in busy:
        if s > cur:
            free.append((cur, s))
        cur = max(cur, e)
    if cur < we:
        free.append((cur, we))
    return free


def _free_windows(items):
    return [f"{_min_to_hhmm(s)}–{_min_to_hhmm(e)}" for s, e in _free_windows_min(items) if e - s >= 30]


def day_grid_text(d_iso, header=True):
    items = agenda_for_day(d_iso)
    try:
        dd = dt.date.fromisoformat(d_iso)
        label = f"{WEEKDAYS_RU[dd.weekday()]} {dd.strftime('%d.%m')}"
    except Exception:
        label = d_iso
    lines = []
    if header:
        lines.append(f"🗓 Расписание · {label}")
    if not items:
        if header:
            lines.append("\nПусто. Скажи «в 10:00 звонок юристу» или «поставь аудит на 14:00–16:00».")
        return "\n".join(lines)
    if header:
        lines.append("")
    for start, end, text in items:
        rng = start + (f"–{end}" if end else "")
        lines.append(f"• {rng} — {text}")
    free = _free_windows(items)
    if free:
        lines.append("\n🟢 Свободно: " + ", ".join(free))
    return "\n".join(lines)


def is_day_grid_query(low):
    if any(w in low for w in ["напомни", "поставь", "добавь", "запиши на", "перенеси"]):
        return False
    grid = any(w in low for w in ["сетк", "по часам", "почасов", "расписание дня", "распиши день",
                                  "разложи день", "план дня", "расписание на день", "что по времени"])
    return grid


def cmd_day(chat_id, text=""):
    send(chat_id, day_grid_text(parse_day(text)))


# ---------- авто-тайм-блокинг (черновик сетки) ----------
AUTOPLAN_DUR = {"🔴": 90, "🟡": 60, "🟢": 45}


def _task_title(line):
    s = line.lstrip("-").strip()
    s = re.sub(r"_\([^)]*\)_", "", s)
    s = re.sub(r"\(T-[^)]*\)", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _autoplan_day(text):
    """День для авто-плана: явно названный или, по умолчанию, ЗАВТРА (планируем наперёд)."""
    low = (text or "").lower()
    if any(w in low for w in ["сегодня", "послезавтра", "завтра"]) or re.search(r"\d{1,2}\.\d{1,2}", low) \
            or any(wd in low for wd in ["понедельник", "вторник", "сред", "четверг", "пятниц", "суббот", "воскрес"]):
        return parse_day(text)
    return (now_local().date() + dt.timedelta(days=1)).isoformat()


def build_autoplan(d_iso, max_items=6):
    """Черновик сетки: горящие задачи + зависшие сделки раскладываются в свободные окна дня."""
    fixed = agenda_for_day(d_iso)
    free = _free_windows_min(fixed)
    tasks, _ = gh.get_file(P_TASKS)
    block = _md_section(tasks or "", "## Активные")
    rank = {"🔴": 0, "🟡": 1, "🟢": 2}
    lines = [l for l in block.splitlines() if l.strip().startswith("-")]
    lines.sort(key=lambda l: next((rank[k] for k in rank if k in l), 3))
    cands = []
    for l in lines:
        pr = next((k for k in rank if k in l), "🟡")
        cands.append((pr, _task_title(l)))
    for d in stale_deals()[:2]:
        cands.append(("🟡", f"Сделка: {d.get('name','')} — {d.get('next_step','')}".strip(" —")))
    placed, fi = [], 0
    free = [list(w) for w in free]
    for pr, title in cands:
        if len(placed) >= max_items:
            break
        dur = AUTOPLAN_DUR.get(pr, 60)
        while fi < len(free) and free[fi][1] - free[fi][0] < dur:
            fi += 1
        if fi >= len(free):
            break
        s = free[fi][0]
        placed.append({"start": _min_to_hhmm(s), "end": _min_to_hhmm(s + dur), "text": title})
        free[fi][0] = s + dur + 15        # буфер 15 мин
    return placed


def cmd_autoplan(chat_id, text=""):
    d_iso = _autoplan_day(text)
    items = build_autoplan(d_iso)
    if not items:
        send(chat_id, "На этот день нет свободных окон или активных задач для раскладки. "
                      "Добавь задачи или освободи время — и попробуем снова.")
        return
    _save_json(P_DRAFT, {"date": d_iso, "items": items}, f"bot: draft {stamp()}")
    try:
        dd = dt.date.fromisoformat(d_iso)
        label = f"{WEEKDAYS_RU[dd.weekday()]} {dd.strftime('%d.%m')}"
    except Exception:
        label = d_iso
    lines = [f"📝 Черновик плана на {label} (по горящим задачам):", ""]
    for it in items:
        lines.append(f"• {it['start']}–{it['end']} — {it['text']}")
    combined = agenda_for_day(d_iso) + [(it["start"], it["end"], it["text"]) for it in items]
    free = _free_windows(combined)
    if free:
        lines.append("\n🟢 Останется свободно: " + ", ".join(free))
    lines.append("\nИли поправь словами: «убери X», «сдвинь Y на 15:00», «без обеда».")
    send_buttons(chat_id, "\n".join(lines), [[("✅ Принять план", {"a": "plan_accept"})]])


def cmd_autoplan_commit(chat_id):
    draft = _load_json(P_DRAFT, {})
    items = draft.get("items") or []
    if not items:
        send(chat_id, "Черновика плана нет. Скажи «набросай план на завтра» — подготовлю.")
        return
    d_iso = draft.get("date") or now_local().date().isoformat()
    acts = [{"type": "add_block", "date": d_iso, "start": it["start"], "end": it["end"], "text": it["text"]}
            for it in items]
    apply_actions(acts)
    _save_json(P_DRAFT, {}, f"bot: draft cleared {stamp()}")
    send(chat_id, "✅ Закрепил план в сетке.\n\n" + day_grid_text(d_iso))


def is_autoplan_query(low):
    trig = any(w in low for w in ["набросай план", "набросай сетк", "распланируй", "раскидай",
                                  "авто-план", "автоплан", "авто план", "предложи план", "разложи задачи",
                                  "составь план на", "сам распиши"])
    return trig


def is_autoplan_commit(low):
    return any(p in low for p in ["прими план", "ставь план", "закрепи план", "принять план",
                                  "утверди план", "да ставь", "ок ставь", "закрепляй план"])


def _active_by_priority(tasks, limit=14):
    """Активные задачи, отсортированные 🔴→🟡→🟢 (для запасного плана без ИИ)."""
    block = _md_section(tasks or "", "## Активные")
    lines = [l.strip() for l in block.splitlines() if l.strip().startswith("-")]
    rank = {"🔴": 0, "🟡": 1, "🟢": 2}
    lines.sort(key=lambda l: next((rank[k] for k in rank if k in l), 3))
    return "\n".join(lines[:limit])


def _normalize_task(line):
    """Ядро текста задачи без приоритета, [компании], _(дат)_, (T-id) — для сравнения."""
    s = line.lstrip("-").strip()
    for e in ("🔴", "🟡", "🟢", "✅"):
        s = s.replace(e, "")
    s = re.sub(r"\[[^\]]*\]", " ", s)        # [Компания]
    s = re.sub(r"_\([^)]*\)_", " ", s)       # _(добавлено …)_
    s = re.sub(r"\(T-[^)]*\)", " ", s)       # (T-0xx)
    s = re.sub(r"[^\wа-яё0-9 ]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def _task_stems(norm):
    return {w[:5] for w in norm.split() if len(w) >= 4}


def _task_similar(a_norm, b_norm):
    if not a_norm or not b_norm:
        return False
    if a_norm in b_norm or b_norm in a_norm:
        return True
    sa, sb = _task_stems(a_norm), _task_stems(b_norm)
    if not sa or not sb:
        return False
    return len(sa & sb) / len(sa | sb) >= 0.6


def find_duplicate_groups(tasks):
    """Группы похожих активных задач (по 2+ строки)."""
    block = _md_section(tasks or "", "## Активные")
    lines = [l for l in block.splitlines() if l.strip().startswith("-")]
    norms = [_normalize_task(l) for l in lines]
    n = len(lines)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for i in range(n):
        for j in range(i + 1, n):
            if _task_similar(norms[i], norms[j]):
                parent[find(i)] = find(j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(lines[i])
    return [g for g in groups.values() if len(g) > 1]


def _short(line, n=70):
    s = re.sub(r"_\([^)]*\)_", "", line.lstrip("-").strip()).strip()
    return s[:n] + ("…" if len(s) > n else "")


def cmd_dedup(chat_id):
    tasks, _ = gh.get_file(P_TASKS)
    groups = find_duplicate_groups(tasks)
    if not groups:
        send(chat_id, "✅ Дублей среди активных задач не нашёл.")
        return
    to_drop = {}                 # текст строки → сколько удалить
    report = []
    for g in groups:
        keep = max(g, key=len)   # оставляем самую подробную
        for l in g:
            if l != keep:
                to_drop[l] = to_drop.get(l, 0) + 1
        report.append("✅ оставил: " + _short(keep) + "\n   убрал: " +
                      "; ".join(_short(x) for x in g if x != keep))
    block = _md_section(tasks, "## Активные")
    active_lines = [l for l in block.splitlines() if l.strip().startswith("-")]
    kept = []
    for l in active_lines:
        if to_drop.get(l, 0) > 0:
            to_drop[l] -= 1
        else:
            kept.append(l)
    head, rest = tasks.split("## Активные", 1)
    after = rest[rest.index("\n##"):] if "\n##" in rest else ""
    tasks2 = head + "## Активные\n" + ("\n".join(kept) + ("\n" if kept else "")) + after
    gh.put_file(P_TASKS, tasks2, f"bot: dedup {stamp()}")
    n_removed = sum(len(g) - 1 for g in groups)
    send(chat_id, f"🧹 Почистил дубли — убрал {n_removed}, объединил в {len(groups)} задач:\n\n" + "\n\n".join(report))


def is_week_plan_query(low):
    """Живые формулировки «что у меня на этой неделе / план недели» (не постановка задачи)."""
    if "недел" not in low:
        return False
    ask = any(w in low for w in ["план", "записано", "повестк", "какие", "что на", "что у меня",
                                  "покажи", "выведи", "расскажи", "что мне", "дела на"])
    add = any(w in low for w in ["напомни", "поставь", "добавь", "заведи", "создай", "перенеси", "запланируй на"])
    return ask and not add


def cmd_weekplan(chat_id):
    tasks, _ = gh.get_file(P_TASKS)
    funnel, _ = gh.get_file(P_FUNNEL)
    personal, _ = gh.get_file(P_PERSONAL)
    sched = upcoming_text(days=7) + "\n\nДЕДЛАЙНЫ:\n" + deadlines_text(within=21)
    try:
        txt = brain.plan_week(stamp(), tasks or "", funnel or "", personal or "",
                              sched, finance_for_brain(), deals_text())
        if not txt or len(txt.strip()) < 10:
            raise RuntimeError("пустой ответ")
    except Exception as e:
        print(f"[{stamp()}] plan_week: {e}")
        # запасной детерминированный план (без ИИ) — чтобы НИКОГДА не оставить без ответа
        parts = ["🗓 План на неделю", "", "📌 События с датами (7 дней):", sched]
        prio = _active_by_priority(tasks)
        if prio:
            parts += ["", "🔴 Приоритеты из задач:", prio]
        stale = stale_deals()
        if stale:
            parts += ["", "🎯 Сделки, где тишина:"] + [f"• {d.get('name','?')}: {d.get('next_step','')}" for d in stale[:5]]
        txt = "\n".join(parts)
    send(chat_id, txt)


def cmd_week(chat_id):
    cmd_weekplan(chat_id)


def cmd_plan(chat_id):
    far = future_oneoffs_text(14)
    txt = "📅 Ближайшие 2 недели:\n" + upcoming_text(days=14)
    if far:
        txt += "\n\n📆 Дальше (через месяц-два и далее):\n" + far
    send(chat_id, txt)


def cmd_today(chat_id):
    today_iso = now_local().date().isoformat()
    lines = [day_grid_text(today_iso)]
    personal, _ = gh.get_file(P_PERSONAL)
    if personal and "## Задачи" in personal:
        block = personal.split("## Задачи", 1)[1].split("##", 1)[0].strip()
        if block:
            lines.append("\n📌 Личные дела:\n" + block)
    send(chat_id, "\n".join(lines))


def cmd_streaks(chat_id):
    h = _load_habits()
    if not h:
        send(chat_id, "Пока нет отметок. Напиши, например, «не курил сегодня» или «потренировался» — начну считать серию 🔥\n"
                      "Или заведи маленький шаг: «новая привычка: 5 приседаний перед душем».")
        return
    lines = ["🔥 Твои привычки (не разрывай цепь):"]
    for name, dates in h.items():
        lines.append(f"• {name}: {chain_text(dates)}  серия {compute_streak(dates)} дн (всего: {len(set(dates))})")
    send(chat_id, "\n".join(lines))


def cmd_tasks(chat_id):
    tasks, _ = gh.get_file(P_TASKS)
    block = _md_section(tasks or "", "## Активные")
    rank = {"🔴": 0, "🟡": 1, "🟢": 2}
    lines = [l for l in block.splitlines() if l.strip().startswith("-")]
    lines.sort(key=lambda l: next((rank[k] for k in rank if k in l), 3))
    if not lines:
        send(chat_id, "Активных задач нет 🎉")
        return
    rows = [[(f"✅ {_task_title(l)[:55]}", {"a": "task_done", "m": _task_title(l)})] for l in lines[:12]]
    send_buttons(chat_id, "📋 Активные задачи — нажми, чтобы закрыть:", rows)


def cmd_step(chat_id):
    s = daily_step()
    text = daily_step_text()
    if s and not s.get("done_today"):
        send_buttons(chat_id, text, [[("✅ Сделал шаг", {"a": "step_done", "h": s["habit"]})]])
    else:
        send(chat_id, text)


def _ritual_rows(key, rit, rlog):
    done = _ritual_progress(rlog, key)
    rows = [[(f"⬜ {s[:50]}", {"a": "ritual_step", "k": key, "s": s})]
            for s in rit.get("steps", []) if not any(_step_match(s, d) for d in done)]
    rows.append([("✅ Весь ритуал", {"a": "ritual_done", "k": key})])
    return rows


def cmd_ritual(chat_id):
    rits = _load_rituals()
    if not rits:
        send(chat_id, rituals_overview())
        return
    rlog = _load_rlog()
    order = [k for k in ["утро", "вечер"] if k in rits] + [k for k in rits if k not in ("утро", "вечер")]
    for key in order:
        send_buttons(chat_id, ritual_text(key, rits[key], rlog), _ritual_rows(key, rits[key], rlog))


def cmd_game(chat_id):
    g = _load_json(P_GAME, {})
    xp = g.get("xp", 0)
    lvl = g.get("level", 1)
    to_next = (lvl * 100) - xp
    lines = [f"🎮 Уровень {lvl} — «{level_title(lvl)}»",
             f"XP: {xp} (до след. уровня: {to_next})",
             f"За неделю: {g.get('week_xp', 0)} XP · 🔥 главное дело: серия {g.get('mit_streak', 0)}"]
    badges = g.get("badges", [])
    if badges:
        lines.append("🏅 Достижения: " + ", ".join(badges))
    send(chat_id, "\n".join(lines))


def cmd_boss(chat_id):
    bosses = _load_json(P_BOSSES, [])
    if not bosses:
        send(chat_id, "Боссы не заданы.")
        return
    lines = ["⚔️ Твои боссы:"]
    for b in bosses:
        total = b.get("total", 0)
        left = b.get("left", total)
        done = total - left
        pct = (done / total * 100) if total else 0
        lines.append(f"\n{b['name']}\n{bar(done, total)} {pct:.0f}%\n"
                     f"осталось: {left:,.0f} {b.get('unit','')}".replace(",", " "))
    send(chat_id, "\n".join(lines))


def cmd_focus(chat_id, minutes):
    send(chat_id, f"⏳ Фокус {minutes} мин — поехали. Убери лишнее, один таск. Я звякну в конце.")

    def done():
        g = _load_json(P_GAME, {})
        g["focus_sessions"] = g.get("focus_sessions", 0) + 1
        ch = []
        award_xp(g, 3, "фокус-сессия", ch)
        _save_json(P_GAME, g, f"bot: focus {stamp()}")
        send(chat_id, f"✅ Сессия окончена — отлично! Встань, разомнись, попей воды 5–10 мин.\n{ch[0]}")
    try:
        threading.Timer(minutes * 60, done).start()
    except Exception:
        pass


def _md_section(text, header):
    """Вытащить блок markdown между '## header' и следующим '##'."""
    if not text or header not in text:
        return ""
    part = text.split(header, 1)[1]
    return part.split("\n##", 1)[0].strip()


def cmd_sync(chat_id):
    """Снимок состояния для переноса контекста в Claude/Cowork."""
    tasks, _ = gh.get_file(P_TASKS)
    funnel, _ = gh.get_file(P_FUNNEL)
    personal, _ = gh.get_file(P_PERSONAL)
    parts = [f"🔄 СИНХРОНИЗАЦИЯ для Claude · {stamp()}",
             "— скопируй и пришли Claude в проект «Клиники Столицы» —", ""]
    parts.append("💰 ФИНАНСЫ:\n" + finance_for_brain())
    stale = stale_deals()
    if stale:
        parts.append("\n⚠️ ЗАВИСШИЕ СДЕЛКИ (тишина ≥ %d дн):\n" % DEALS_STALE_DAYS +
                     "\n".join(f"- {d.get('name','?')} ({_norm_stage(d.get('stage'))}, "
                              f"{days_since(d.get('last_touch',''))} дн): {d.get('next_step','')}" for d in stale[:8]))
    act = _md_section(tasks or "", "## Активные")
    if act:
        parts.append("\n📋 АКТИВНЫЕ ЗАДАЧИ:\n" + act)
    done = _md_section(tasks or "", "## Выполнено")
    if done:
        parts.append("\n✅ ВЫПОЛНЕНО:\n" + done[:600])
    if funnel:
        parts.append("\n🎯 ВОРОНКА:\n" + funnel.replace("# Воронка продаж", "").strip()[:1000])
    # личное/здоровье кратко
    health = [f"🔥 привычки: {habits_summary()}"]
    q = _load_quit()
    if q.get("quit_date"):
        try:
            d = max((now_local().date() - dt.date.fromisoformat(q["quit_date"])).days, 0)
            health.append(f"🚭 без курения: {d} дн")
        except Exception:
            pass
    w = _load_json(P_WEIGHT, [])
    if w:
        health.append(f"⚖️ вес: {w[-1]['kg']} кг")
    bosses = _load_json(P_BOSSES, [])
    for b in bosses:
        tot = b.get("total", 0)
        done_v = tot - b.get("left", tot)
        health.append(f"⚔️ {b['name']}: {(done_v/tot*100 if tot else 0):.0f}%")
    parts.append("\n📊 ЛИЧНОЕ/ПРОГРЕСС:\n" + "\n".join(health))
    pn = _md_section(personal or "", "## Заметки")
    if pn:
        parts.append("\n🏠 ЛИЧНЫЕ ЗАМЕТКИ:\n" + pn[:500])
    parts.append("\n📓 ПОСЛЕДНЕЕ (дневник):\n" + journal_tail(25))
    send(chat_id, "\n".join(parts))


def cmd_money(chat_id):
    send(chat_id, finance_summary_text())


def cmd_deals(chat_id):
    send(chat_id, deals_text())
    stale = stale_deals()
    if stale:
        rows = [[(f"✍️ Коснулся: {d.get('name','?')[:45]}", {"a": "deal_touch", "m": d.get("name", "")})]
                for d in stale[:6]]
        send_buttons(chat_id, deals_watch_text(), rows)


def cmd_deadlines(chat_id):
    send(chat_id, deadlines_text())


def cmd_goal(chat_id):
    send(chat_id, levers_text())


def cmd_now(chat_id):
    ctx, _ = gh.get_file(P_CTX)
    tasks, _ = gh.get_file(P_TASKS)
    funnel, _ = gh.get_file(P_FUNNEL)
    try:
        send(chat_id, brain.next_action(stamp(), ctx or "", tasks or "", funnel or ""))
    except Exception as e:
        send(chat_id, f"Не смог выбрать: {e}")


def cmd_pulse(chat_id, proactive=False):
    tasks, _ = gh.get_file(P_TASKS)
    funnel, _ = gh.get_file(P_FUNNEL)
    mit = _load_json(P_MIT, {})
    mtext = mit.get("text", "") if mit.get("date") == now_local().date().isoformat() else ""
    rt = today_reminders_text()
    dl = upcoming_deadlines(within=10)
    if dl:
        rt += "\n\nБЛИЗКИЕ ДЕДЛАЙНЫ:\n" + deadlines_for_brain(10)
    try:
        res = brain.pulse(stamp(), tasks or "", funnel or "", rt, mtext)
    except Exception as e:
        if not proactive:
            send(chat_id, f"Не смог собрать пульс: {e}")
        return
    clean = res.strip()
    if clean.upper().rstrip(".!") == "OK" or len(clean) < 3:
        if not proactive:
            send(chat_id, "✅ Всё под контролем — ничего важного не провисает.")
        return
    send(chat_id, ("🔔 Бот заметил:\n" if proactive else "") + clean)


def cmd_weight(chat_id):
    w = _load_json(P_WEIGHT, [])
    if not w:
        send(chat_id, "Пока нет записей веса. Напиши, например, «вес 93».")
        return
    last = w[-6:]
    lines = ["⚖️ Вес (последние записи):"] + [f"• {x['date']}: {x['kg']} кг" for x in last]
    d = w[-1]["kg"] - w[0]["kg"]
    lines.append(f"С начала: {'+' if d >= 0 else ''}{d:.1f} кг. Ориентир ~88–90, спокойно.")
    send(chat_id, "\n".join(lines))


def cmd_mood(chat_id):
    m = _load_json(P_MOOD, [])
    if not m:
        send(chat_id, "Пока нет отметок. Можешь просто написать, как ты — я запомню.")
        return
    last = m[-7:]
    scored = [x["score"] for x in last if x.get("score")]
    lines = ["💚 Настроение (недавнее):"] + [f"• {x['date']}: {x.get('score','?')}/5 {x.get('note','')}".strip() for x in last]
    if scored and sum(scored) / len(scored) < 2.5:
        lines.append("\nВижу, период непростой. Береги себя — и помни, что можно опереться на близких или специалиста. Я рядом.")
    send(chat_id, "\n".join(lines))


def cmd_dates(chat_id):
    txt = birthdays_text(within=90)
    send(chat_id, ("📅 Ближайшие важные даты:\n" + txt) if txt
         else "Ближайших дат нет. Добавить: «день рождения Имя — ДД.ММ.ГГГГ».")


def make_morning():
    # авто-подтягивание свежих цифр из МИС (раз в день, если подключена)
    if mis_sync and mis_sync.configured() and once_per_day(P_LASTMIS):
        try:
            mis_sync_finance()
        except Exception as e:
            print(f"[{stamp()}] mis auto-sync: {e}")
    ctx, _ = gh.get_file(P_CTX)
    tasks, _ = gh.get_file(P_TASKS)
    funnel, _ = gh.get_file(P_FUNNEL)
    personal, _ = gh.get_file(P_PERSONAL)
    wellbeing, _ = gh.get_file(P_WELLBEING)
    wb = (wellbeing or "") + f"\n\nТЕКУЩИЕ СТРИКИ (серии привычек): {habits_summary()}"
    bdays = birthdays_text(within=7)
    if bdays:
        wb += f"\nВАЖНЫЕ ДАТЫ (упомяни и подскажи подготовиться):\n{bdays}"
    dls = upcoming_deadlines(within=14)
    if dls:
        wb += ("\n⏳ ГОРЯЩИЕ ДЕДЛАЙНЫ (упомяни с обратным отсчётом, поторопи по близким):\n"
               + deadlines_for_brain(14))
    step = daily_step_text().split("\n\nСделал")[0]      # без хвостовой подсказки
    wb += (f"\n🪜 ШАГ ДНЯ (вставь ДОСЛОВНО отдельным пунктом «🪜 Шаг дня» — это и есть забота о себе "
           f"на сегодня по теории маленьких шагов; НЕ придумывай свой, используй этот):\n{step}")
    g = _load_json(P_GAME, {})
    wb += (f"\nИГРА: уровень {g.get('level',1)} «{level_title(g.get('level',1))}», "
           f"{g.get('xp',0)} XP, серия главного дела {g.get('mit_streak',0)} — упомяни одной строкой для драйва.")
    mit = _load_json(P_MIT, {})
    if mit.get("date") == now_local().date().isoformat() and mit.get("text"):
        wb += f"\nГЛАВНОЕ ДЕЛО НА СЕГОДНЯ уже задано: «{mit['text']}» — напомни о нём."
    else:
        wb += "\nГЛАВНОЕ ДЕЛО НА СЕГОДНЯ не задано — попроси назвать ОДНО главное дело дня."
    # радар перегруза
    mood = [x.get("score") for x in _load_json(P_MOOD, [])[-7:] if x.get("score")]
    en = [x.get("score") for x in _load_json(P_ENERGY, [])[-7:] if x.get("score")]
    if (mood and sum(mood) / len(mood) < 2.5) or (en and sum(en) / len(en) < 2.5):
        wb += ("\nПРИЗНАКИ ПЕРЕГРУЗА (настроение/энергия низкие): мягко предложи сегодня сбавить темп, "
               "сделать только главное и обязательно отдохнуть — без чувства вины.")
    q = _load_quit()
    if q.get("quit_date"):
        try:
            d = max((now_local().date() - dt.date.fromisoformat(q["quit_date"])).days, 0)
            wb += f"\nОТКАЗ ОТ КУРЕНИЯ: {d} дн. без сигарет — упомяни и поддержи."
        except Exception:
            pass
    try:
        return brain.morning(stamp(), ctx or "", tasks or "", funnel or "",
                             personal or "", today_reminders_text(), wb)
    except Exception as e:
        return f"Не смог собрать утренний бриф: {e}"


SOS_TEXT = (
    "🛑 Стоп, дыши. Тяга — это волна, она спадёт за 3–5 минут. Переждём вместе:\n\n"
    "1️⃣ 5 медленных вдохов: вдох на 4 счёта — задержка 4 — выдох на 6.\n"
    "2️⃣ Выпей стакан воды, не спеша.\n"
    "3️⃣ Встань, пройдись 2 минуты / выйди на воздух.\n"
    "4️⃣ Вспомни ЗАЧЕМ: дочки, энергия, бокс, свобода от зависимости.\n\n"
    "Ты уже выигрываешь — написал мне, а не закурил. Загляну к тебе через 5 минут 💪")


def sos_followup(chat_id):
    send(chat_id, "Ну как, отпустило? Если да — ты только что выиграл ещё один бой 🔥 "
                  "Если ещё тянет — давай ещё раунд дыхания, я рядом.")


def cmd_sos(chat_id):
    send(chat_id, SOS_TEXT)
    q = _load_quit()
    q["cravings_resisted"] = q.get("cravings_resisted", 0) + 1
    _save_quit(q)
    journal_append("SOS: была тяга закурить — переждал с ботом")
    try:
        threading.Timer(300, sos_followup, args=(chat_id,)).start()
    except Exception:
        pass


def process_vision(chat_id, file_id, media_type, caption, is_pdf=False):
    raw = download_file(file_id)
    if not raw:
        send(chat_id, "Не смог скачать файл, пришли ещё раз.")
        return
    b64 = base64.b64encode(raw).decode()
    profile, _ = gh.get_file(P_PROFILE)
    ctx, _ = gh.get_file(P_CTX)
    try:
        res = brain.vision(b64, media_type, caption, profile or "", ctx or "", is_pdf)
    except Exception as e:
        print(f"[{stamp()}] vision: {e}")
        send(chat_id, f"Не смог разобрать вложение ({e}).")
        return
    reply_text = res.get("reply", "Посмотрел.")
    # сохраняем СУТЬ документа в дневник, чтобы бот помнил о нём дальше
    journal_append(f"[документ{' PDF' if is_pdf else ''}{' · '+caption if caption else ''}] {reply_text}")
    changes = apply_actions(res.get("actions", []))
    send(chat_id, reply_text + ("\n\n" + "\n".join(changes) if changes else ""))


def handle_callback(cq):
    msg = cq.get("message", {}) or {}
    chat_id = (msg.get("chat") or {}).get("id")
    mid = msg.get("message_id")
    pl = _btn_load(cq.get("data", ""))
    if not pl:
        if chat_id:
            send(chat_id, "⏳ Кнопка устарела — открой список заново.")
        return
    a = pl.get("a")
    if a == "task_done":
        apply_actions([{"type": "done_task", "match": pl.get("m", "")}])
        edit_message(chat_id, mid, "✅ Закрыл: " + pl.get("m", "")[:60])
    elif a == "step_done":
        ch = apply_actions([{"type": "log_habit", "habit": pl.get("h", "тренировка")}])
        send(chat_id, "\n".join(ch) if ch else "Отметил ✅")
    elif a in ("ritual_step", "ritual_done"):
        key = pl.get("k")
        if a == "ritual_step":
            mark_ritual_step(key, pl.get("s", ""))
        else:
            r = ritual_done_all(key)
        rits = _load_rituals()
        rlog = _load_rlog()
        rit = rits.get(key, {})
        if a == "ritual_step":
            edit_message(chat_id, mid, ritual_text(key, rit, rlog), _ritual_rows(key, rit, rlog))
        else:
            edit_message(chat_id, mid, ritual_text(key, rit, rlog))
    elif a == "plan_accept":
        cmd_autoplan_commit(chat_id)
    elif a == "deal_touch":
        ch = apply_actions([{"type": "update_deal", "match": pl.get("m", "")}])
        send(chat_id, "\n".join(ch) if ch else "✍️ Отметил касание")


def handle(msg):
    chat_id = msg["chat"]["id"]

    # фото / документ (счёт, акт, прайс, договор) → распознаём содержимое
    if msg.get("photo"):
        process_vision(chat_id, msg["photo"][-1]["file_id"], "image/jpeg", msg.get("caption"))
        return
    doc = msg.get("document")
    if doc:
        mt = doc.get("mime_type", "")
        if mt.startswith("image/"):
            process_vision(chat_id, doc["file_id"], mt, msg.get("caption"))
            return
        if mt == "application/pdf":
            process_vision(chat_id, doc["file_id"], mt, msg.get("caption"), is_pdf=True)
            return
        send(chat_id, "Пришли фото или PDF — разберу. Другие форматы пока не читаю.")
        return

    media = msg.get("voice") or msg.get("audio") or msg.get("video_note")
    if media:
        audio = download_file(media["file_id"])
        if not audio:
            send(chat_id, "Не смог скачать аудио, попробуй ещё раз.")
            return
        try:
            text = voice.transcribe(audio)
        except Exception as e:
            print(f"[{stamp()}] stt: {e}")
            send(chat_id, f"Не смог распознать голос ({e}). Напиши текстом?")
            return
        if not text:
            send(chat_id, "Не расслышал — попробуй ещё раз.")
            return
        send(chat_id, f"🎙 Расшифровал: {text}")
        process_text(chat_id, text, voice_reply=True)
        return

    text = (msg.get("text") or "").strip()
    if not text:
        return
    low = text.lower()
    if low in ("/start", "/help"):
        send(chat_id, HELP + f"\n\nТвой chat_id: {chat_id}")
        return
    if low.startswith("/today"):
        cmd_today(chat_id)
        return
    if low.startswith("/tasks") or low.startswith("/задачи"):
        cmd_tasks(chat_id)
        return
    if low.startswith("/week") or low.startswith("/неделя"):
        cmd_week(chat_id)
        return
    if low.startswith("/plan") or low.startswith("/план"):
        cmd_plan(chat_id)
        return
    if low.startswith("/brief") or low.startswith("/morning"):
        send(chat_id, make_morning())
        return
    if low.startswith("/streaks") or low.startswith("/habits"):
        cmd_streaks(chat_id)
        return
    if low.startswith("/step") or low.startswith("/шаг") or low in ("шаг дня", "что сегодня"):
        cmd_step(chat_id)
        return
    if low.startswith("/ritual") or low.startswith("/ритуал") or low in ("ритуалы", "мои ритуалы"):
        cmd_ritual(chat_id)
        return
    if low.startswith("/quit") or low.startswith("/smoke"):
        send(chat_id, quit_status_text())
        return
    if low.startswith("/now") or low == "что сейчас делать?" or low == "что делать сейчас?":
        cmd_now(chat_id)
        return
    if low.startswith("/money") or low.startswith("/finance") or low.startswith("/деньги") or \
            low in ("как дела по группе?", "как дела по группе", "сводка по деньгам", "финансы"):
        cmd_money(chat_id)
        return
    if low.startswith("/deals") or low.startswith("/funnel") or low.startswith("/воронка") or \
            low.startswith("/сделки"):
        cmd_deals(chat_id)
        return
    if low.startswith("/deadlines") or low.startswith("/дедлайны") or low.startswith("/сроки") or \
            low in ("дедлайны", "сроки", "какие дедлайны", "что горит"):
        cmd_deadlines(chat_id)
        return
    if low.startswith("/goal") or low.startswith("/цель") or low.startswith("/рычаги") or \
            low in ("путь к 5 млн", "путь к цели", "рычаги дохода", "что двигает доход"):
        cmd_goal(chat_id)
        return
    if low.startswith("/missync") or low.startswith("/мис") or low in ("обнови из мис", "синхронизируй мис"):
        cmd_missync(chat_id)
        return
    if low.startswith("/game") or low.startswith("/level"):
        cmd_game(chat_id)
        return
    if low.startswith("/pulse"):
        cmd_pulse(chat_id)
        return
    if low.startswith("/sync") or low.startswith("/export"):
        cmd_sync(chat_id)
        return
    if low.startswith("/boss"):
        cmd_boss(chat_id)
        return
    if low.startswith("/focus"):
        parts = text.split()
        mins = 50
        if len(parts) > 1 and parts[1].isdigit():
            mins = max(5, min(120, int(parts[1])))
        cmd_focus(chat_id, mins)
        return
    if low.startswith("/weight") or low.startswith("/ves"):
        cmd_weight(chat_id)
        return
    if low.startswith("/mood"):
        cmd_mood(chat_id)
        return
    if low.startswith("/dates") or low.startswith("/birthdays"):
        cmd_dates(chat_id)
        return
    if low.startswith("/voiceon") or low == "отвечай голосом":
        _save_json(P_SETTINGS, {**_load_json(P_SETTINGS, {}), "voice_always": True}, "bot: voice on")
        send(chat_id, "🔊 Буду отвечать голосом. Выключить — /voiceoff")
        return
    if low.startswith("/voiceoff") or low == "пиши текстом":
        _save_json(P_SETTINGS, {**_load_json(P_SETTINGS, {}), "voice_always": False}, "bot: voice off")
        send(chat_id, "🔇 Перешёл на текст. На голосовые всё равно отвечу голосом.")
        return
    if low.startswith("/digest"):
        send(chat_id, "Собираю сводку…")
        send(chat_id, make_digest())
        return
    if is_autoplan_commit(low):
        cmd_autoplan_commit(chat_id)
        return
    if low.startswith("/autoplan") or low.startswith("/автоплан") or is_autoplan_query(low):
        cmd_autoplan(chat_id, text)
        return
    if low.startswith("/day") or low.startswith("/сетка") or low.startswith("/grid") or is_day_grid_query(low):
        cmd_day(chat_id, text)
        return
    if low.startswith("/weekplan") or low.startswith("/планнеделя") or is_week_plan_query(low):
        cmd_weekplan(chat_id)
        return
    if low.startswith("/dedup") or low.startswith("/дубли") or \
            any(p in low for p in ["почисти дубли", "убери дубли", "убрать дубли", "удали дубли",
                                   "чистка дублей", "найди дубли"]):
        cmd_dedup(chat_id)
        return
    process_text(chat_id, text)


# ---------- сводка и планировщики ----------
def make_digest():
    ctx, _ = gh.get_file(P_CTX)
    tasks, _ = gh.get_file(P_TASKS)
    funnel, _ = gh.get_file(P_FUNNEL)
    ctx = (ctx or "") + "\n\n[ФИНАНСЫ]\n" + finance_for_brain()
    funnel = (funnel or "") + "\n\n[СДЕЛКИ]\n" + deals_text()
    try:
        return brain.digest(ctx, tasks or "", funnel)
    except Exception as e:
        return f"Не смог собрать сводку: {e}"


def _recurring_due(rule, d):
    if rule.get("days_of_month"):
        return d.day in rule["days_of_month"]
    if rule.get("weekdays") is not None:
        return d.weekday() in (rule["weekdays"] or [])
    if rule.get("every_days"):
        try:
            s = dt.date.fromisoformat(rule.get("start", ""))
        except Exception:
            return False
        n = rule["every_days"] or 1
        return (d - s).days >= 0 and (d - s).days % n == 0
    return False


def reminder_scheduler():
    if not CHAT_ID:
        return
    while True:
        if not lock_is_mine():           # шлёт только активный экземпляр
            time.sleep(30)
            continue
        try:
            now = now_local()
            # разовые
            rems = _load_reminders()
            changed = False
            for r in rems:
                if r.get("done"):
                    continue
                try:
                    w = dt.datetime.fromisoformat(r["when"])
                except Exception:
                    continue
                if w <= now:
                    send(CHAT_ID, f"⏰ Напоминание: {r['text']}")
                    r["done"] = True
                    changed = True
            if changed:
                _save_reminders(rems)
            # повторяющиеся
            rec = _load_json(P_RECURRING, [])
            changed_rec = False
            today_iso = now.date().isoformat()
            for rule in rec:
                if rule.get("last_fired") == today_iso:
                    continue
                if not _recurring_due(rule, now.date()):
                    continue
                try:
                    th, tm = (int(x) for x in rule.get("time", "09:00").split(":"))
                except Exception:
                    th, tm = 9, 0
                if now.hour * 60 + now.minute >= th * 60 + tm:
                    send(CHAT_ID, f"⏰ Напоминание: {rule['text']}")
                    rule["last_fired"] = today_iso
                    changed_rec = True
            if changed_rec:
                _save_json(P_RECURRING, rec, f"bot: recurring fired {stamp()}")
            # ритуалы: в назначенное время шлём чек-лист (раз в день на ритуал)
            rits = _load_rituals()
            if rits:
                rlog = _load_rlog()
                today_iso = now.date().isoformat()
                changed_r = False
                for key, rit in rits.items():
                    if rlog.get(key, {}).get("last_sent") == today_iso:
                        continue
                    try:
                        th, tm = (int(x) for x in rit.get("time", "08:00").split(":"))
                    except Exception:
                        continue
                    if now.hour * 60 + now.minute >= th * 60 + tm:
                        send(CHAT_ID, ritual_text(key, rit, rlog))
                        rlog.setdefault(key, {})["last_sent"] = today_iso
                        changed_r = True
                if changed_r:
                    _save_rlog(rlog)
        except Exception as e:
            print(f"[{stamp()}] reminders: {e}")
        time.sleep(60)


def digest_scheduler():
    if not CHAT_ID:
        return
    while True:
        if not lock_is_mine():           # шлёт только активный экземпляр
            time.sleep(30)
            continue
        try:
            n = dt.datetime.now(dt.timezone.utc)
            if n.weekday() == 0 and n.hour == DIGEST_HOUR_UTC:
                last, _ = gh.get_file(P_LASTDG)
                today = now_local().date().isoformat()
                if (last or "").strip() != today:
                    send(CHAT_ID, make_digest())
                    gh.put_file(P_LASTDG, today, "bot: digest sent")
        except Exception as e:
            print(f"[{stamp()}] digest: {e}")
        time.sleep(1800)


def morning_scheduler():
    if not CHAT_ID:
        return
    while True:
        if not lock_is_mine():           # шлёт только активный экземпляр
            time.sleep(30)
            continue
        try:
            n = dt.datetime.now(dt.timezone.utc)
            if n.hour == MORNING_HOUR_UTC:
                last, _ = gh.get_file(P_LASTMORN)
                today = now_local().date().isoformat()
                if (last or "").strip() != today:
                    send(CHAT_ID, make_morning())
                    gh.put_file(P_LASTMORN, today, "bot: morning sent")
        except Exception as e:
            print(f"[{stamp()}] morning: {e}")
        time.sleep(1800)


def daily_events_scheduler():
    if not CHAT_ID:
        return
    while True:
        if not lock_is_mine():           # шлёт только активный экземпляр
            time.sleep(30)
            continue
        try:
            nu = dt.datetime.now(dt.timezone.utc)
            if nu.hour == EVENING_HOUR_UTC and once_per_day(P_LASTEVE):
                send(CHAT_ID, "🌙 Как прошёл день? Напиши пару строк — что сделал, что важного. "
                              "Сохраню и учту в недельной сводке. И как ты сам — как настрой?")
                if once_per_day(P_LASTAUTOPLAN):       # черновик сетки на завтра
                    try:
                        tomorrow = (now_local().date() + dt.timedelta(days=1)).isoformat()
                        if build_autoplan(tomorrow):
                            cmd_autoplan(CHAT_ID, "завтра")
                    except Exception as e:
                        print(f"[{stamp()}] autoplan: {e}")
            if nu.hour == WINDDOWN_HOUR_UTC and once_per_day(P_LASTWIND):
                send(CHAT_ID, "🛏 Пора закругляться. Убери телефон, попей воды — завтра нужен бодрый ты. "
                              "Спокойной ночи 🌙")
            if nu.weekday() == 6 and nu.hour == MORNING_HOUR_UTC and once_per_day(P_LASTWEIGHT):
                send(CHAT_ID, "⚖️ Воскресное взвешивание: какой вес? Напиши «вес NN» — отмечу динамику.")
            if nu.weekday() == 6 and nu.hour == EVENING_HOUR_UTC and once_per_day(P_LASTHABREP):
                rep = habits_week_report()       # воскресный отчёт по привычкам (цепи)
                if rep:
                    send(CHAT_ID, rep)
            if nu.hour == PULSE_HOUR_UTC and once_per_day(P_LASTPULSE):
                cmd_pulse(CHAT_ID, proactive=True)
            if nu.weekday() < 5 and nu.hour == DEALS_WATCH_HOUR_UTC and once_per_day(P_LASTDEALS):
                watch = deals_watch_text()      # автопинг по зависшим сделкам (будни)
                if watch:
                    send(CHAT_ID, watch)
        except Exception as e:
            print(f"[{stamp()}] daily_events: {e}")
        time.sleep(900)


def main():
    me = tg("getMe").get("result", {})
    print(f"[{stamp()}] Ежедневник запущен. Я: @{me.get('username','?')}, модель: {brain.MODEL}, экземпляр: {INSTANCE}")
    gh.ensure_seeded(SEED)
    threading.Thread(target=reminder_scheduler, daemon=True).start()
    threading.Thread(target=digest_scheduler, daemon=True).start()
    threading.Thread(target=morning_scheduler, daemon=True).start()
    threading.Thread(target=daily_events_scheduler, daemon=True).start()
    if workload:
        try:
            workload.init(send, send_buttons, _btn_load, now_local,
                          once_per_day, lock_is_mine, CHAT_ID)
            threading.Thread(target=workload.scheduler_loop, daemon=True).start()
            print(f"[{stamp()}] workload (пилот ПВЛ) подключён")
        except Exception as e:
            print(f"[{stamp()}] workload init: {e}")

    offset = None
    processed = set()                 # дедуп update_id в рамках процесса
    warned_passive = False
    while True:
        # только активный экземпляр опрашивает Telegram — иначе вторая копия
        # отвечала бы параллельно (дубли) и ловила 409 Conflict
        if not lock_acquire():
            if not warned_passive:
                print(f"[{stamp()}] {INSTANCE}: another instance is active — passive mode")
                warned_passive = True
            time.sleep(30)
            continue
        warned_passive = False
        resp = tg("getUpdates", offset=offset, timeout=POLL_TIMEOUT)
        if not resp.get("ok", True) and resp.get("error_code") == 409:
            print(f"[{stamp()}] 409 Conflict — несколько getUpdates на одном токене")
            time.sleep(5)
            continue
        for upd in resp.get("result", []):
            offset = upd["update_id"] + 1
            if upd["update_id"] in processed:      # уже обрабатывали (редоставка)
                continue
            processed.add(upd["update_id"])
            if len(processed) > 1000:
                processed = set(list(processed)[-500:])
            cq = upd.get("callback_query")
            if cq:
                cq_chat = ((cq.get("message") or {}).get("chat") or {}).get("id")
                if CHAT_ID and str(cq_chat) != str(CHAT_ID):
                    if workload:                      # кнопки сотрудников ПВЛ
                        try:
                            workload.handle_callback(cq)
                        except Exception as e:
                            print(f"[{stamp()}] wl callback: {e}")
                    tg("answerCallbackQuery", callback_query_id=cq.get("id"))
                    continue
                try:
                    handle_callback(cq)
                except Exception as e:
                    print(f"[{stamp()}] callback: {e}")
                tg("answerCallbackQuery", callback_query_id=cq.get("id"))
                continue
            m = upd.get("message") or upd.get("edited_message")
            if not m:
                continue
            if CHAT_ID and str(m["chat"]["id"]) != str(CHAT_ID):
                if workload:                          # чаты сотрудников ПВЛ
                    try:
                        if workload.handle_message(m):
                            continue
                    except Exception as e:
                        print(f"[{stamp()}] wl msg: {e}")
                send(m["chat"]["id"], "Приватный бот.")
                continue
            if workload:                              # команды владельца по ПВЛ
                try:
                    _oc = workload.owner_command(m.get("text") or "")
                    if _oc:
                        send(CHAT_ID, _oc)
                        continue
                except Exception as e:
                    print(f"[{stamp()}] wl owner: {e}")
            try:
                handle(m)
            except Exception as e:
                print(f"[{stamp()}] handle: {e}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nОстановлен.")
