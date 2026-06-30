/* Логика приложения «Клиники Столицы» (каркас). */
let profile = null;
let pin = "";

const fmt = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽";
const el = (id) => document.getElementById(id);
const NAV = {
  home:   { label: "Сегодня", icon: "ti-home-2" },
  day:    { label: "День",    icon: "ti-calendar" },
  tasks:  { label: "Задачи",  icon: "ti-circle-check" },
  journal:{ label: "Дневник", icon: "ti-notebook" },
  money:  { label: "Финансы", icon: "ti-wallet" },
  funnel: { label: "Воронка", icon: "ti-target" },
  more:   { label: "Ещё",     icon: "ti-dots" }
};
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
let curDay = new Date().toISOString().slice(0, 10);
let viewYM = curDay.slice(0, 7);
function shiftMonth(n) { let [y, m] = viewYM.split("-").map(Number); m += n; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } viewYM = `${y}-${String(m).padStart(2, "0")}`; RENDER.day(); }
function pickDay(iso) { curDay = iso; viewYM = iso.slice(0, 7); RENDER.day(); }
function dayLabel(iso) { const d = new Date(iso); const t = new Date().toISOString().slice(0, 10); return (iso === t ? "Сегодня · " : "") + WD[d.getDay()] + " " + iso.slice(8, 10) + "." + iso.slice(5, 7); }

/* ---------- PIN login ---------- */
function buildPad() {
  const pad = el("pad");
  ["1","2","3","4","5","6","7","8","9","","0","⌫"].forEach((k) => {
    const b = document.createElement("button");
    b.className = "key" + (k === "" ? " blank" : "");
    b.textContent = k;
    if (k === "⌫") b.innerHTML = '<i class="ti ti-backspace"></i>';
    if (k !== "") b.onclick = () => press(k);
    pad.appendChild(b);
  });
  drawDots();
}
function drawDots() {
  el("dots").innerHTML = [0,1,2,3].map(i => `<span class="dot ${i < pin.length ? "f" : ""}"></span>`).join("");
}
function press(k) {
  if (k === "⌫") pin = pin.slice(0, -1);
  else if (pin.length < 4) pin += k;
  drawDots();
  if (pin.length === 4) setTimeout(tryLogin, 120);
}
async function tryLogin() {
  const res = await API.login(pin);
  if (res.ok) { profile = res.profile; pin = ""; enterApp(); }
  else { pin = ""; drawDots(); el("dots").animate([{transform:"translateX(-6px)"},{transform:"translateX(6px)"},{transform:"translateX(0)"}],{duration:200}); }
}

/* ---------- app shell ---------- */
function enterApp() {
  el("login").classList.add("hidden");
  el("app").classList.remove("hidden");
  el("roleName").textContent = profile.title.split("·")[0].trim();
  buildNav();
  show(profile.sections[0]);
}
function buildNav() {
  const nav = el("nav"); nav.innerHTML = "";
  profile.sections.forEach((s) => {
    const b = document.createElement("button");
    b.dataset.s = s;
    b.innerHTML = `<i class="ti ${NAV[s].icon}"></i>${NAV[s].label}`;
    b.onclick = () => show(s);
    nav.appendChild(b);
  });
}
function show(s) {
  document.querySelectorAll(".scr").forEach((x) => x.classList.remove("on"));
  el("s-" + s).classList.add("on");
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.s === s));
  RENDER[s]();
}

/* ---------- renderers ---------- */
const RENDER = {
  async home() {
    const H = await API.home(profile).catch(() => ({ agenda: [], deadlines: [], tasks: [] }));
    const agenda = H.agenda || [], tasks = H.tasks || [], dls = H.deadlines || [];
    window.__home_agenda = agenda;
    window.__dls = dls;
    const top = tasks.find((t) => !t.done && t.priority === "🔴") || tasks.find((t) => !t.done);
    const openCount = tasks.filter((t) => !t.done).length;
    const hotDls = dls.filter((d) => d.days != null && d.days <= 14).length;
    const directorText = top ? `Фокус дня — ${esc(top.text)}. ${hotDls ? `Горящих дедлайнов: ${hotDls}.` : "Критичных дедлайнов нет."}` : (hotDls ? `Нет главной задачи, но есть ${hotDls} горящих дедлайнов.` : "Критичных рисков на сегодня не вижу.");
    el("s-home").innerHTML = `
      <div class="sub">${dateLabelToday()}</div>
      <h1 class="h">${profile.role === "owner" ? "Панель<br>управления" : "Привет,<br>" + profile.name.split(" ")[0]}</h1>
      ${profile.role === "owner" ? `<div class="director-note"><div class="k">AI-ДИРЕКТОР</div><div class="v">${directorText}</div></div>
      <div class="board-pulse">
        <div class="pulse-card"><div class="k">Открыто задач</div><div class="n">${openCount}</div><div class="m">в работе</div></div>
        <div class="pulse-card ${hotDls ? "hot" : ""}"><div class="k">Дедлайны</div><div class="n">${hotDls}</div><div class="m">до 14 дней</div></div>
      </div>
      <div class="card" onclick="show('pvl')" style="cursor:pointer;margin-top:4px"><div class="row spread"><div class="t" style="font-weight:600"><i class="ti ti-users" style="color:var(--red);margin-right:8px"></i>Пилот ПВЛ — команда и ИИ-отчёт</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div></div>
      <div class="card" onclick="show('agg')" style="cursor:pointer;margin-top:4px"><div class="row spread"><div class="t" style="font-weight:600"><i class="ti ti-chart-bar" style="color:var(--red);margin-right:8px"></i>Агрегатор — выручка и маржа</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div></div>
      ${hsHomeCard()}` : ""}
      ${top ? `<div class="hero">
        <div class="top"><div class="k">ГЛАВНОЕ НА СЕГОДНЯ</div><div class="v">${esc(top.text)}</div></div>
        <div class="bot"><span class="lbl"><i class="ti ti-clock"></i> ${esc(top.due ? fmtDue(top.due) : top.company)}</span><span class="link" onclick="show('tasks')">Открыть ›</span></div>
      </div>` : ""}
      <div class="qa-row">
        <div class="qa" onclick="openCreate()"><i class="ti ti-plus"></i>Добавить</div>
        <div class="qa" onclick="startVoice()"><i class="ti ti-microphone"></i>Голос</div>
        <div class="qa" onclick="scanDoc()"><i class="ti ti-camera"></i>Документ</div>
      </div>
      <div class="row spread"><div class="sec-title">Сегодня по часам</div></div>
      <div class="card" style="padding:4px 16px">
        ${agenda.length ? agenda.map((a, i) => `<div class="li"><span class="chk" onclick="agendaDone(${i})" title="Выполнено"><i class="ti ti-check" style="font-size:15px"></i></span><span class="tcell">${a.time}</span><span class="t" style="font-weight:500">${esc(a.text)}</span></div>`).join("") : `<div class="lbl" style="padding:12px 0">На сегодня по часам пусто</div>`}
      </div>
      ${dls.length ? `<div class="sec-title">Горящие дедлайны</div>
      <div class="card" style="padding:4px 16px">${dls.slice(0, 6).map((d) => `<div class="li" style="cursor:pointer" onclick="openDeadline(${d.i})"><span class="tcell" style="color:${d.days != null && d.days <= 7 ? "var(--red)" : d.days != null && d.days <= 21 ? "var(--amber)" : "var(--muted)"}">${d.days == null ? "—" : d.days + "д"}</span><span class="t" style="font-weight:500">${esc(d.text)}<div class="m">${d.date || ""} · нажми, чтобы изменить</div></span><i class="ti ti-pencil" style="color:#ccc"></i></div>`).join("")}</div>` : ""}
    `;
  },

  async day() {
    const dd = await API.day(curDay);
    window.__dayItems = dd.items || [];
    const mk = await API.month(viewYM);
    const marks = new Set(mk.dates || []);
    const ic = (k) => k === "rem" ? "ti-bell" : "ti-clock";
    const [Y, M] = viewYM.split("-").map(Number);
    const startW = (new Date(Y, M - 1, 1).getDay() + 6) % 7;
    const dim = new Date(Y, M, 0).getDate();
    const today = new Date().toISOString().slice(0, 10);
    let cells = "";
    for (let i = 0; i < startW; i++) cells += "<div></div>";
    for (let d = 1; d <= dim; d++) {
      const iso = `${Y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells += `<button class="cal-d${iso === curDay ? " sel" : ""}${iso === today ? " tod" : ""}" onclick="pickDay('${iso}')"><span>${d}</span>${marks.has(iso) ? '<span class="cal-dot"></span>' : ''}</button>`;
    }
    el("s-day").innerHTML = `
      <div class="row spread" style="margin:8px 0 10px">
        <button class="mbtn" onclick="shiftMonth(-1)" aria-label="Пред. месяц"><i class="ti ti-chevron-left"></i></button>
        <div style="font-size:17px;font-weight:700">${MONTHS[M - 1]} ${Y}</div>
        <button class="mbtn" onclick="shiftMonth(1)" aria-label="След. месяц"><i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="cal-h">${["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map((w) => `<div>${w}</div>`).join("")}</div>
      <div class="cal">${cells}</div>
      <div class="row spread" style="margin:16px 0 8px"><div style="font-weight:600">${dayLabel(curDay)}</div><button onclick="openCreate({type:'block', date: curDay})" style="background:none;border:none;color:var(--red);font-weight:600;cursor:pointer">＋ в сетку</button></div>
      <div class="card" style="padding:6px 16px">
        ${dd.items && dd.items.length ? dd.items.map((it, i) => `<div class="li"><span class="chk" onclick="dayItemDone(${i})" title="Выполнено"><i class="ti ti-check" style="font-size:15px"></i></span><span class="tcell">${it.start}</span><span class="t" style="font-weight:500;cursor:pointer" onclick="editItem(${i})">${esc(it.text)}${it.end ? ` <span class="lbl">до ${it.end}</span>` : ""}</span><i class="ti ti-pencil" style="color:#ccc;cursor:pointer" onclick="editItem(${i})"></i></div>`).join("") : `<div class="lbl" style="padding:16px 0">На этот день пусто</div>`}
      </div>
      ${dd.free && dd.free.length ? `<div class="lbl" style="padding:2px 4px 14px">🟢 Свободно: ${dd.free.join(", ")}</div>` : ""}
      ${dd.done && dd.done.length ? `<div class="sec-title" style="margin-top:10px">✓ Выполнено в этот день (${dd.done.length})</div>
      <div class="card" style="padding:4px 16px">${dd.done.map((it) => `<div class="li"><span class="chk done"><i class="ti ti-check" style="font-size:15px"></i></span><span class="tcell">${it.start}</span><span class="t done-txt">${esc(it.text)}</span></div>`).join("")}</div>` : ""}`;
  },

  async tasks() {
    const tasks = await API.tasks(profile);
    el("s-tasks").innerHTML = `
      <h1 class="h">${profile.role === "staff" ? "Мои задачи" : "Задачи"}</h1>
      <div class="seg"><b class="on" data-f="all">Все</b><b data-f="hot">Срочные</b><b data-f="done">Выполнено</b></div>
      <div class="card" id="tasklist" style="padding:6px 16px"></div>
      <div class="lbl" style="padding:8px 2px">«Срочные» — со сроком в ближайшие 7 дней. Срок задаётся при создании или по нажатию на задачу.</div>`;
    window.__tasks = tasks;
    let filter = "all";
    const within = (due) => { if (!due) return false; const t = new Date(); t.setHours(0, 0, 0, 0); const d = new Date(due + "T00:00:00"); return (d - t) / 86400000 <= 7; };
    const draw = () => {
      const list = tasks.filter((t) => filter === "done" ? t.done : !t.done && (filter === "all" ? true : within(t.due)));
      el("tasklist").innerHTML = list.length ? list.map((t) => t.done ? `
        <div class="li">
          <span class="chk done"><i class="ti ti-check" style="font-size:15px"></i></span>
          <div class="t"><div class="done-txt">${esc(t.text)}</div></div>
          <button onclick="reopenTask('${t.id}')" title="Повторить на дату" style="border:1px solid var(--line);background:var(--card);border-radius:10px;padding:6px 9px;color:var(--red);cursor:pointer"><i class="ti ti-rotate-clockwise"></i></button>
        </div>` : `
        <div class="li">
          <span class="chk" onclick="closeTask('${t.id}')"><i class="ti ti-check" style="font-size:15px"></i></span>
          <div class="t" onclick="editTask('${t.id}')" style="cursor:pointer"><div>${esc(t.text)}</div><div class="m">${esc(t.company)}${t.due ? " · ⏰ " + fmtDue(t.due) : ""} · нажми, чтобы изменить</div></div>
        </div>`).join("") : `<div class="lbl" style="padding:14px 0">${filter === "done" ? "Выполненных пока нет" : filter === "hot" ? "Срочных задач нет 👍" : "Задач нет 🎉"}</div>`;
    };
    draw();
    document.querySelectorAll("#s-tasks .seg b").forEach((b) => b.onclick = () => {
      document.querySelectorAll("#s-tasks .seg b").forEach((x) => x.classList.remove("on"));
      b.classList.add("on"); filter = b.dataset.f; draw();
    });
  },

  async money() {
    const f = await API.finance(profile);
    if (f.scope === "group") {
      const d = f.data, pct = Math.min(100, Math.round(d.ownerIncome / d.goal * 100));
      el("s-money").innerHTML = `
        <h1 class="h">Финансы</h1>
        <div class="card"><div class="lbl">Твой доход (доля)</div>
          <div class="big">${fmt(d.ownerIncome)}</div>
          <div class="bar"><span style="width:${pct}%"></span></div>
          <div class="row spread"><span class="lbl">цель ${fmt(d.goal)} · ${pct}%</span><span class="lbl" style="font-weight:600;color:var(--ink)">ещё ${fmt(d.goal - d.ownerIncome)}</span></div>
        </div>
        <div class="metrics">
          <div class="metric"><div class="lbl" style="font-size:11px">Долг</div><div class="n">${(d.debt/1e6).toFixed(1)} млн</div></div>
          ${d.companies.slice(0,2).map((c)=>`<div class="metric"><div class="lbl" style="font-size:11px">${c.name.split("·").pop().trim()}</div><div class="n">${(c.profit/1e6).toFixed(2)} млн</div></div>`).join("")}
        </div>
        <div class="card" onclick="show('group')" style="cursor:pointer"><div class="row spread"><div class="t" style="font-weight:700"><i class="ti ti-building-community" style="color:var(--red);margin-right:8px"></i>Группа компаний — прибыль по месяцам</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div></div>
        <div class="card" onclick="show('pvl')" style="cursor:pointer"><div class="row spread"><div class="t" style="font-weight:700"><i class="ti ti-users" style="color:var(--red);margin-right:8px"></i>Пилот ПВЛ — команда и ИИ-отчёт</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div></div>
        <div class="card" onclick="show('agg')" style="cursor:pointer"><div class="row spread"><div class="t" style="font-weight:700"><i class="ti ti-chart-bar" style="color:var(--red);margin-right:8px"></i>Агрегатор — выручка и маржа</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div></div>
        <div class="sec-title">Рычаги к 5 млн</div>
        <div class="card">${d.levers.map((l)=>`<div style="padding:8px 0"><div class="row spread" style="font-size:13px;font-weight:500"><span>${l.name}</span><span class="lbl">+${Math.round(l.impact/1000)} т</span></div><div class="bar sm"><span style="width:${l.progress}%"></span></div></div>`).join("")}</div>`;
    } else if (f.scope === "company") {
      el("s-money").innerHTML = `<h1 class="h">Финансы компании</h1>
        ${f.data.companies.map((c)=>`<div class="card"><div class="lbl">${c.name}</div><div class="big">${fmt(c.profit)}</div><div class="lbl">операционная прибыль / мес</div></div>`).join("")}
        <div class="lbl" style="padding:6px 2px">Доступна только ваша компания. Сводная прибыль группы — у владельца.</div>`;
    } else {
      el("s-money").innerHTML = `<h1 class="h">Финансы</h1><div class="card"><div class="lbl">Раздел недоступен для вашей роли.</div></div>`;
    }
  },

  async funnel() {
    const deals = await API.deals(profile);
    const icon = (s) => s === "переговоры" ? "ti-flame" : s === "контакт" ? "ti-phone-call" : "ti-seeding";
    window.__deals = deals;
    el("s-funnel").innerHTML = `
      <h1 class="h">Воронка</h1>
      <div class="card" style="padding:6px 16px">
        ${deals.map((d,i)=>`<div class="li"><i class="ti ${icon(d.stage)}" style="font-size:20px;color:${d.silent>=7?"var(--red)":"var(--muted)"}"></i>
          <div class="t"><div>${d.name}</div><div class="m">${d.stage} · ${d.step}</div></div>
          <span class="badge ${d.silent>=7?"red":""}" style="margin-right:8px;${d.silent<7?"color:var(--muted)":""}">${d.silent} дн</span>
          <button onclick="touchDeal(${i})" title="Отметить касание" style="border:1px solid var(--line);background:var(--card);border-radius:10px;padding:6px 9px;cursor:pointer;color:var(--red)"><i class="ti ti-hand-finger"></i></button></div>`).join("")}
      </div>
      <div class="lbl" style="padding:6px 2px">Нажми ✋ у сделки — отметить, что связался (обнулит «тишину»).</div>`;
  },

  async more() {
    const admin = profile.role === "owner";
    el("s-more").innerHTML = `
      <h1 class="h">Ещё</h1>
      <div class="card" style="padding:6px 16px">
        <div class="li" onclick="enablePush()"><i class="ti ti-bell-ringing" style="font-size:20px;color:var(--red)"></i><div class="t">Уведомления</div><span class="lbl" id="pushState">включить</span></div>
        <div class="li" onclick="show('journal')"><i class="ti ti-notebook" style="font-size:20px;color:var(--red)"></i><div class="t">Дневник / заметки</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
        <div class="li" onclick="testPush()"><i class="ti ti-send" style="font-size:20px;color:var(--red)"></i><div class="t">Прислать тестовый пуш</div></div>
        ${admin ? `<div class="li" onclick="dedupTasks()"><i class="ti ti-eraser" style="font-size:20px;color:var(--red)"></i><div class="t">Почистить дубли задач</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
        ${admin ? `<div class="li"><i class="ti ti-users" style="font-size:20px;color:var(--red)"></i><div class="t">Роли и доступ</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
        <div class="li" onclick="show('habits')"><i class="ti ti-flame" style="font-size:20px;color:var(--red)"></i><div class="t">Привычки и шаги</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
        <div class="li" onclick="show('goals')"><i class="ti ti-target-arrow" style="font-size:20px;color:var(--red)"></i><div class="t">Цели и прогресс</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
        <div class="li" onclick="show('week')"><i class="ti ti-calendar-week" style="font-size:20px;color:var(--red)"></i><div class="t">План недели</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
        ${admin ? `<div class="li" onclick="show('health')"><i class="ti ti-heartbeat" style="font-size:20px;color:var(--red)"></i><div class="t">Здоровье</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
        <div class="li"><i class="ti ti-logout" style="font-size:20px;color:var(--muted)"></i><div class="t" onclick="logout()">Выйти</div></div>
      </div>
      <div class="card" style="text-align:center"><div class="lbl">${profile.title}</div><div style="font-size:13px;font-weight:600;margin-top:4px">Уровень 6 · «Командир» · 820 XP</div></div>`;
  }
};

/* ---------- actions ---------- */
async function closeTask(id) {
  const t = (window.__tasks || []).find((x) => x.id === id);
  if (!t) return;
  toast("Закрываю…");
  const r = await API.taskDone(t.text);
  toast(r && r.ok !== false ? "Закрыто ✓" : "Не удалось закрыть");
  RENDER.tasks();
}
async function touchDeal(i) {
  const d = (window.__deals || [])[i];
  if (!d) return;
  toast("Отмечаю…");
  const r = await API.dealTouch(d.name);
  toast(r && r.ok !== false ? "Касание отмечено ✓" : "Не удалось");
  RENDER.funnel();
}

/* ---- создание задачи / напоминания / блока ---- */
function openCreate(pre) {
  pre = pre || {};
  const type = pre.type || "task";
  const date = pre.date || curDay;
  el("create").innerHTML = `
    <div class="sheet">
      <h3>Создать</h3>
      <div class="seg" id="ctype" style="font-size:11px">
        <b data-t="task">Задача</b><b data-t="rem">Напом.</b><b data-t="block">В сетку</b><b data-t="note">Заметка</b>
      </div>
      <input id="ctext" placeholder="Текст…" value="${(pre.text || '').replace(/"/g, '&quot;')}">
      <div id="cdue-wrap" style="margin-top:10px"><div class="lbl" style="margin-bottom:4px">Срок задачи (необязательно)</div><input type="date" id="cdue" value="${pre.due || ''}" style="width:100%"></div>
      <div id="cdate-wrap" style="display:flex;gap:8px;margin-top:10px">
        <input type="date" id="cdate" value="${date}" style="flex:1">
        <input type="time" id="ctime" value="${pre.start || '10:00'}" style="width:108px">
        <input type="time" id="cend" value="${pre.end || ''}" style="width:108px">
      </div>
      <button class="btn red" style="margin-top:14px" onclick="saveCreate()">Сохранить</button>
      <div class="link" style="text-align:center;margin-top:10px;cursor:pointer" onclick="brainFromCreate()">🧠 Разобрать умно (несколько дел сразу)</div>
      <button class="btn ghost" style="margin-top:10px" onclick="closeCreate()">Отмена</button>
    </div>`;
  el("create").classList.remove("hidden");
  document.querySelectorAll("#ctype b").forEach((b) => {
    if (b.dataset.t === type) b.classList.add("on");
    b.onclick = () => { document.querySelectorAll("#ctype b").forEach((x) => x.classList.remove("on")); b.classList.add("on"); applyCreateType(b.dataset.t); };
  });
  applyCreateType(type);
}
function applyCreateType(t) {
  el("cdate-wrap").style.display = (t === "task" || t === "note") ? "none" : "flex";
  el("cend").style.display = (t === "block") ? "" : "none";
  const cd = el("cdue-wrap"); if (cd) cd.style.display = (t === "task") ? "block" : "none";
}
function curType() { const b = document.querySelector("#ctype b.on"); return b ? b.dataset.t : "task"; }
function closeCreate() { el("create").classList.add("hidden"); }
async function saveCreate() {
  const text = (el("ctext").value || "").trim();
  if (!text) { toast("Введите текст"); return; }
  const t = curType(); toast("Сохраняю…");
  let r;
  if (t === "task") r = await API.addTask(text, "", "🟡", el("cdue") ? el("cdue").value : "");
  else if (t === "note") r = await API.addNote(text);
  else if (t === "rem") r = await API.addReminder(el("cdate").value, el("ctime").value, text);
  else r = await API.addBlock(el("cdate").value, el("ctime").value, el("cend").value, text);
  closeCreate();
  toast(r && r.ok !== false ? "Добавлено ✓" : "Не удалось");
  const a = document.querySelector("#nav button.on"); const s = a ? a.dataset.s : "home";
  if (RENDER[s]) RENDER[s]();
}
function logout() { profile = null; el("app").classList.add("hidden"); el("login").classList.remove("hidden"); }

function reopenTask(id) {
  const t = (window.__tasks || []).find((x) => x.id === id);
  if (!t) return;
  openCreate({ type: "rem", text: t.text, date: curDay });   // выбрать дату → создаст напоминание
}
async function dedupTasks() {
  toast("Ищу дубли…");
  const r = await API.dedup();
  toast(r && r.ok ? (r.removed ? `Убрано дублей: ${r.removed}` : "Дублей не найдено") : "Не удалось");
  if (RENDER.tasks) RENDER.tasks();
}

/* ---- редактирование текста задачи ---- */
function editTask(id) {
  const t = (window.__tasks || []).find((x) => x.id === id);
  if (!t) return;
  el("create").innerHTML = `
    <div class="sheet">
      <h3>Изменить задачу</h3>
      <input id="etext" value="${esc(t.text).replace(/"/g, '&quot;')}" style="margin-bottom:8px">
      <div class="lbl" style="margin:2px 2px 6px">Срок (необязательно)</div>
      <input type="date" id="edue" value="${t.due || ''}" style="width:100%">
      <button class="btn red" style="margin-top:14px" onclick="saveTaskEdit('${id}')">Сохранить</button>
      <button class="btn ghost" style="margin-top:8px" onclick="closeTask2('${id}')">Отметить выполненной</button>
      <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button>
    </div>`;
  el("create").classList.remove("hidden");
  setTimeout(() => { const i = el("etext"); if (i) i.focus(); }, 50);
}
async function saveTaskEdit(id) {
  const t = (window.__tasks || []).find((x) => x.id === id); if (!t) return;
  const nw = (el("etext").value || "").trim(); if (!nw) { toast("Текст пустой"); return; }
  const due = el("edue") ? el("edue").value : undefined;
  toast("Сохраняю…");
  const r = await API.taskEdit(t.text, nw, due);
  closeCreate(); toast(r && r.ok !== false ? "Изменено ✓" : "Не удалось"); RENDER.tasks();
}
function closeTask2(id) { closeCreate(); closeTask(id); }

/* ---- редактирование элемента сетки (перенос/удаление) ---- */
function editItem(idx) {
  const it = (window.__dayItems || [])[idx];
  if (!it) return;
  el("create").innerHTML = `
    <div class="sheet">
      <h3>Изменить</h3>
      <input id="etext" value="${esc(it.text).replace(/"/g, '&quot;')}" style="margin-bottom:8px">
      <div style="display:flex;gap:8px">
        <input type="date" id="edate" value="${curDay}" style="flex:1">
        <input type="time" id="estart" value="${it.start}" style="width:108px">
        ${it.kind === "block" ? `<input type="time" id="eend" value="${it.end || ''}" style="width:108px">` : ""}
      </div>
      <button class="btn red" style="margin-top:14px" onclick="saveEdit(${idx})">Сохранить</button>
      <button class="btn ghost" style="margin-top:8px" onclick="closeCreate();dayItemDone(${idx})">Выполнено</button>
      <button class="btn ghost" style="margin-top:8px;color:#c0392b;border-color:#e3b3b3" onclick="deleteItem(${idx})">Удалить</button>
      <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button>
    </div>`;
  el("create").classList.remove("hidden");
}
async function saveEdit(idx) {
  const it = (window.__dayItems || [])[idx]; if (!it) return;
  const newText = ((el("etext") && el("etext").value) || it.text).trim() || it.text;
  const nd = el("edate").value, ns = el("estart").value;
  const ne = (it.kind === "block" && el("eend")) ? el("eend").value : "";
  toast("Сохраняю…");
  let r;
  if (newText !== it.text) {                       // текст изменился → пересоздать
    await API.itemDelete({ kind: it.kind, date: curDay, start: it.start, text: it.text });
    r = it.kind === "block" ? await API.addBlock(nd, ns, ne, newText) : await API.addReminder(nd, ns, newText);
  } else {
    r = await API.itemMove({ kind: it.kind, date: curDay, start: it.start, text: it.text,
      new_date: nd, new_start: ns, new_end: ne });
  }
  closeCreate(); toast(r && r.ok !== false ? "Сохранено ✓" : "Не удалось"); RENDER.day();
}
async function deleteItem(idx) {
  const it = (window.__dayItems || [])[idx]; if (!it) return;
  toast("Удаляю…");
  const r = await API.itemDelete({ kind: it.kind, date: curDay, start: it.start, text: it.text });
  closeCreate(); toast(r && r.ok !== false ? "Удалено ✓" : "Не удалось"); RENDER.day();
}

/* ---- дневник ---- */
RENDER.journal = async function () {
  const j = await API.journal(60);
  el("s-journal").innerHTML = `
    <h1 class="h" style="margin:8px 0 14px">Дневник</h1>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <input id="jtext" placeholder="Записать мысль / как прошёл день…" style="flex:1">
      <button class="btn red" style="width:auto;padding:0 18px" onclick="addJournal()">＋</button>
    </div>
    <div class="card" style="padding:4px 16px">
      ${j.entries && j.entries.length ? j.entries.map((e) => `<div style="padding:11px 0;border-bottom:1px solid var(--line)"><div style="font-size:14px">${e.text}</div><div class="lbl" style="font-size:11px;margin-top:3px">${e.ts}</div></div>`).join("") : `<div class="lbl" style="padding:14px 0">Записей пока нет. Пиши сюда заметки и как прошёл день.</div>`}
    </div>`;
};
async function addJournal() {
  const t = (el("jtext").value || "").trim(); if (!t) return;
  toast("Записываю…");
  await API.addNote(t);
  toast("Записал ✓ (сохранено в дневник, бот это видит)"); RENDER.journal();
}

/* ---- общие хелперы ---- */
function esc(s) { return (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
const TODAY_ISO = () => new Date().toISOString().slice(0, 10);
function dateLabelToday() {
  const d = new Date();
  const wd = ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"];
  const mo = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  return `${wd[d.getDay()]}, ${d.getDate()} ${mo[d.getMonth()]}`;
}
function fmtDue(due) { return due ? due.slice(8, 10) + "." + due.slice(5, 7) : ""; }

/* ---- отметить «час» дня выполненным ---- */
async function agendaDone(i) {
  const a = (window.__home_agenda || [])[i]; if (!a) return;
  toast("Отмечаю…");
  const r = await API.itemDone({ kind: "block", date: TODAY_ISO(), start: a.time, text: a.text });
  toast(r && r.ok !== false ? "Выполнено ✓" : "Не удалось"); RENDER.home();
}
async function dayItemDone(i) {
  const it = (window.__dayItems || [])[i]; if (!it) return;
  toast("Отмечаю…");
  const r = await API.itemDone({ kind: it.kind, date: curDay, start: it.start, text: it.text });
  toast(r && r.ok !== false ? "Выполнено ✓" : "Не удалось"); RENDER.day();
}

/* ---- дедлайны (редактирование) ---- */
function openDeadline(i) {
  const d = (window.__dls || []).find((x) => x.i === i); if (!d) return;
  el("create").innerHTML = `
    <div class="sheet">
      <h3>Дедлайн</h3>
      <input id="dltext" value="${esc(d.text).replace(/"/g, '&quot;')}" style="margin-bottom:8px">
      <input type="date" id="dldate" value="${d.date || ''}" style="width:100%">
      <button class="btn red" style="margin-top:14px" onclick="saveDeadline(${i})">Сохранить</button>
      <button class="btn ghost" style="margin-top:8px;color:#c0392b;border-color:#e3b3b3" onclick="doneDeadline(${i})">Выполнено / убрать</button>
      <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button>
    </div>`;
  el("create").classList.remove("hidden");
}
async function saveDeadline(i) {
  toast("Сохраняю…");
  const r = await API.deadlineEdit({ i, date: el("dldate").value, text: el("dltext").value });
  closeCreate(); toast(r && r.ok !== false ? "Сохранено ✓" : "Не удалось"); RENDER.home();
}
async function doneDeadline(i) {
  toast("Убираю…");
  const r = await API.deadlineDone(i);
  closeCreate(); toast(r && r.ok !== false ? "Готово ✓" : "Не удалось"); RENDER.home();
}

/* ---- разделы: Цели, План недели, Привычки ---- */
function bgPill(s) {
  return s === "done" ? '<span class="badge" style="color:#2E7D32">✓ достигнуто</span>'
    : s === "miss" ? '<span class="badge red">✗ не вышло</span>'
    : '<span class="lbl">в работе</span>';
}
RENDER.goals = async function () {
  const g = await API.goals(profile).catch(() => ({ goals: [], levers: [] }));
  const bg = await API.bigGoals(profile).catch(() => []);
  window.__bg = bg;
  const nf = (n) => new Intl.NumberFormat("ru-RU").format(n);
  el("s-goals").innerHTML = `
    <div class="link" onclick="show('more')" style="margin:8px 0;cursor:pointer">‹ Назад</div>
    <h1 class="h">Цели и прогресс</h1>
    <div class="row spread"><div class="sec-title">🎯 Мои большие цели</div><span class="link" onclick="addBigGoal()" style="cursor:pointer">＋ цель</span></div>
    <div class="card" style="padding:6px 16px">${bg.length ? bg.map((x) => `<div class="li"><div class="t" onclick="cycleBigGoal('${x.id}')" style="cursor:pointer"><div style="font-weight:500${x.status === "done" ? ";text-decoration:line-through;color:#aaa" : ""}">${esc(x.text)}</div><div class="m">${x.scope === "year" ? "Год" : "Месяц"} ${esc(x.period)} · ${bgPill(x.status)} · нажми — сменить статус</div></div><button onclick="delBigGoal('${x.id}')" title="Удалить" style="border:none;background:none;color:#ccc;cursor:pointer;font-size:18px"><i class="ti ti-x"></i></button></div>`).join("") : '<div class="lbl" style="padding:10px 0">Пока нет. Поставь большие цели на год/месяц — в конце периода увидишь, что удалось.</div>'}</div>
    <div class="sec-title">Стратегические цели (числа)</div>
    <div class="card">${(g.goals || []).map((x) => `<div style="padding:9px 0;border-bottom:1px solid var(--line)"><div class="row spread" style="font-size:14px;font-weight:600"><span>${esc(x.name)}</span><span class="lbl">${x.pct}%</span></div><div class="bar sm"><span style="width:${x.pct}%"></span></div><div class="lbl" style="font-size:11px;margin-top:4px">осталось ${nf(x.left)} ${esc(x.unit)}</div></div>`).join("") || '<div class="lbl" style="padding:10px 0">Целей пока нет</div>'}</div>
    <div class="sec-title">Рычаги дохода</div>
    <div class="card">${(g.levers || []).map((l) => `<div style="padding:9px 0;border-bottom:1px solid var(--line)"><div class="row spread" style="font-size:13px;font-weight:500"><span>${esc(l.name)}</span><span class="lbl">+${Math.round(l.impact / 1000)} т</span></div><div class="bar sm"><span style="width:${l.progress}%"></span></div>${l.note ? `<div class="lbl" style="font-size:11px;margin-top:3px">${esc(l.note)}</div>` : ""}</div>`).join("") || '<div class="lbl" style="padding:10px 0">Рычагов нет</div>'}</div>`;
};
function addBigGoal() {
  const y = new Date().getFullYear();
  const ym = new Date().toISOString().slice(0, 7);
  el("create").innerHTML = `
    <div class="sheet">
      <h3>Большая цель</h3>
      <input id="bgtext" placeholder="Например: запустить 3 новых потока выручки" style="margin-bottom:10px">
      <div class="seg" id="bgscope"><b class="on" data-s="year">На год (${y})</b><b data-s="month">На месяц (${ym})</b></div>
      <button class="btn red" style="margin-top:14px" onclick="saveBigGoal()">Добавить</button>
      <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button>
    </div>`;
  el("create").classList.remove("hidden");
  document.querySelectorAll("#bgscope b").forEach((b) => b.onclick = () => { document.querySelectorAll("#bgscope b").forEach((x) => x.classList.remove("on")); b.classList.add("on"); });
  setTimeout(() => { const i = el("bgtext"); if (i) i.focus(); }, 50);
}
async function saveBigGoal() {
  const t = (el("bgtext").value || "").trim(); if (!t) { toast("Введите цель"); return; }
  const sb = document.querySelector("#bgscope b.on"); const scope = sb ? sb.dataset.s : "year";
  const period = scope === "year" ? String(new Date().getFullYear()) : new Date().toISOString().slice(0, 7);
  toast("Добавляю…");
  const r = await API.bigGoalAdd({ scope, period, text: t });
  closeCreate(); toast(r && r.ok !== false ? "Добавлено ✓" : "Не удалось"); RENDER.goals();
}
async function cycleBigGoal(id) {
  const x = (window.__bg || []).find((z) => z.id === id); if (!x) return;
  const nx = x.status === "open" ? "done" : x.status === "done" ? "miss" : "open";
  toast("Меняю…");
  const r = await API.bigGoalStatus(id, nx);
  toast(r && r.ok !== false ? ({ done: "Достигнуто ✓", miss: "Не вышло", open: "В работе" })[nx] : "Не удалось"); RENDER.goals();
}
async function delBigGoal(id) {
  toast("Удаляю…");
  const r = await API.bigGoalDelete(id);
  toast(r && r.ok !== false ? "Удалено ✓" : "Не удалось"); RENDER.goals();
}

/* ---- группа компаний: прибыль по месяцам ---- */
let groupYM = "";
RENDER.group = async function () {
  const d = await API.group(profile, groupYM).catch(() => ({ rows: [], total: 0, owner_income: 0, months: [], trend: [], ym: groupYM }));
  groupYM = d.ym || groupYM;
  window.__group = d;
  const nf = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n || 0));
  const M = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  const ymLabel = (ym) => ym ? M[parseInt(ym.slice(5, 7)) - 1] + " " + ym.slice(0, 4) : "";
  const dlt = (p, prev) => (typeof p === "number" && typeof prev === "number") ? `<span style="color:${p - prev >= 0 ? "#15A06D" : "#C0392B"};font-size:11.5px;font-weight:700">${p - prev >= 0 ? "▲" : "▼"} ${nf(Math.abs(p - prev))}</span>` : "";
  el("s-group").innerHTML = `
    <div class="link" onclick="show('money')" style="margin:8px 0;cursor:pointer">‹ Назад</div>
    <h1 class="h">Группа компаний</h1>
    <div class="row spread" style="margin:2px 0 12px">
      <button class="mbtn" onclick="groupShift(-1)"><i class="ti ti-chevron-left"></i></button>
      <div style="font-size:17px;font-weight:800">${ymLabel(d.ym)}</div>
      <button class="mbtn" onclick="groupShift(1)"><i class="ti ti-chevron-right"></i></button>
    </div>
    <div class="card"><div class="lbl">Прибыль группы за месяц</div><div class="big">${nf(d.total)} ₽</div>
      <div class="lbl">Твой доход (с учётом долей): <b style="color:var(--ink)">${nf(d.owner_income)} ₽</b></div></div>
    <div class="card" style="padding:6px 16px">${(d.rows || []).map((r) => `<div class="li"><div class="t"><div style="font-weight:700">${esc(r.name)}${r.share && r.share !== 1 ? ` <span class="lbl" style="font-weight:400">· доля ${Math.round(r.share * 100)}%</span>` : ""}</div><div class="m">${r.profit == null ? "нет данных за месяц" : dlt(r.profit, r.prev)}</div></div><div style="font-weight:800">${r.profit == null ? "—" : nf(r.profit)}</div></div>`).join("") || '<div class="lbl" style="padding:10px 0">Направлений нет</div>'}</div>
    <button class="btn red" onclick="openGroupForm()">Внести / изменить за ${ymLabel(d.ym)}</button>
    <button class="btn ghost" style="margin-top:8px" onclick="scanFinance()"><i class="ti ti-camera" style="margin-right:6px"></i>Распознать отчёт фото/PDF</button>
    ${(d.trend && d.trend.length > 1) ? `<div class="sec-title" style="margin-top:16px">Динамика группы</div><div class="card" style="padding:6px 16px">${d.trend.map((t) => `<div class="li"><span class="t">${ymLabel(t.ym)}</span><span style="font-weight:700">${nf(t.total)} ₽</span></div>`).join("")}</div>` : ""}
    <div class="lbl" style="padding:8px 2px">Пока вносишь вручную. Позже подключим интеграцию — цифры будут обновляться сами.</div>`;
};
function groupShift(n) {
  const cur = (window.__group && window.__group.ym) || new Date().toISOString().slice(0, 7);
  let y = parseInt(cur.slice(0, 4)), m = parseInt(cur.slice(5, 7)) + n;
  if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  groupYM = `${y}-${String(m).padStart(2, "0")}`; RENDER.group();
}
function openGroupForm() {
  const d = window.__group || { rows: [], ym: groupYM };
  el("create").innerHTML = `
    <div class="sheet">
      <h3>Прибыль за ${d.ym}</h3>
      <div class="lbl" style="margin-bottom:8px">Прибыль по направлениям (₽) и доля (%)</div>
      <div id="gform">${(d.rows || []).map((r, i) => `<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center"><div style="flex:1;font-size:13px;font-weight:600">${esc(r.name)}</div><input id="gp${i}" type="number" inputmode="numeric" placeholder="прибыль" value="${r.profit == null ? "" : r.profit}" style="width:108px"><input id="gs${i}" type="number" inputmode="numeric" placeholder="%" value="${Math.round((r.share == null ? 1 : r.share) * 100)}" style="width:54px"></div>`).join("")}</div>
      <button class="btn red" style="margin-top:8px" onclick="saveGroupForm()">Сохранить</button>
      <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button>
    </div>`;
  el("create").classList.remove("hidden");
}
async function saveGroupForm() {
  const d = window.__group || { rows: [] };
  const rows = (d.rows || []).map((r, i) => {
    const p = el("gp" + i) ? el("gp" + i).value : "";
    const s = el("gs" + i) ? el("gs" + i).value : "";
    return { name: r.name, profit: p === "" ? null : Number(p), share: s === "" ? 1 : Number(s) / 100 };
  });
  toast("Сохраняю…");
  const r = await API.groupSave(d.ym, rows);
  closeCreate(); toast(r && r.ok !== false ? "Сохранено ✓" : "Не удалось"); RENDER.group();
}

/* ---- голос → текст ---- */
function _toB64(blobOrFile) { return new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blobOrFile); }); }
let _rec = null, _chunks = [];
async function startVoice() {
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast("Запись голоса не поддерживается на этом устройстве"); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _chunks = [];
    _rec = new MediaRecorder(stream);
    _rec.ondataavailable = (e) => { if (e.data && e.data.size) _chunks.push(e.data); };
    _rec.onstop = async () => {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      const mime = _rec.mimeType || "audio/webm";
      const blob = new Blob(_chunks, { type: mime });
      el("create").innerHTML = `<div class="sheet"><h3>Распознаю…</h3><div class="lbl">Секунду, отправляю запись.</div></div>`;
      el("create").classList.remove("hidden");
      const b64 = await _toB64(blob);
      const r = await API.stt(b64, mime);
      closeCreate();
      if (r && r.ok && r.text) { voiceResult(r.text); }
      else { toast("Не распозналось" + (r && r.error ? ": " + r.error : "")); }
    };
    _rec.start();
    el("create").innerHTML = `<div class="sheet"><h3>🎤 Запись…</h3><div class="lbl" style="margin-bottom:14px">Говори, потом нажми «Стоп».</div><button class="btn red" onclick="stopVoice()">■ Стоп и распознать</button><button class="btn ghost" style="margin-top:8px" onclick="cancelVoice()">Отмена</button></div>`;
    el("create").classList.remove("hidden");
  } catch (e) { toast("Нет доступа к микрофону. Разреши доступ в настройках."); }
}
function stopVoice() { try { if (_rec && _rec.state !== "inactive") _rec.stop(); } catch (e) {} }
function cancelVoice() { try { if (_rec && _rec.state !== "inactive") { _rec.onstop = null; const s = _rec.stream; _rec.stop(); if (s) s.getTracks().forEach((t) => t.stop()); } } catch (e) {} closeCreate(); }
function voiceResult(text) {
  el("create").innerHTML = `<div class="sheet">
    <h3>Распознано</h3>
    <input id="vrtext" value="${esc(text).replace(/"/g, '&quot;')}" style="margin-bottom:10px">
    <button class="btn red" onclick="smartParse()">🧠 Разобрать и выполнить</button>
    <div style="display:flex;gap:8px;margin-top:8px"><button class="btn ghost" style="flex:1" onclick="vrAs('task')">Задача</button><button class="btn ghost" style="flex:1" onclick="vrAs('note')">Заметка</button></div>
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button></div>`;
  el("create").classList.remove("hidden");
}
function vrAs(type) { const t = (el("vrtext") ? el("vrtext").value : "").trim(); closeCreate(); openCreate({ type, text: t }); }
async function smartParse() {
  const t = (el("vrtext") ? el("vrtext").value : "").trim(); if (!t) return;
  await runBrain(t);
}
async function brainFromCreate() {
  const t = (el("ctext") ? el("ctext").value : "").trim(); if (!t) { toast("Введите текст"); return; }
  await runBrain(t);
}
async function runBrain(t) {
  toast("Разбираю…");
  const r = await API.brain(t);
  closeCreate();
  toast(r && r.ok ? (r.summary || "Готово ✓") : ("Не вышло" + (r && r.error ? ": " + r.error : "")));
  const a = document.querySelector("#nav button.on"); const s = a ? a.dataset.s : "home";
  if (RENDER[s]) RENDER[s]();
}

/* ---- документы → текст / финансы ---- */
function _pickFile(cb, accept) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = accept || "image/*,application/pdf";
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) cb(f); };
  inp.click();
}
function scanDoc() {
  _pickFile(async (f) => {
    el("create").innerHTML = `<div class="sheet"><h3>Распознаю документ…</h3><div class="lbl">Отправляю на сервер, это пару секунд.</div></div>`;
    el("create").classList.remove("hidden");
    const b64 = await _toB64(f);
    const r = await API.vision(b64, f.type || "image/jpeg", "text");
    if (r && r.ok && r.text) { window.__doctext = r.text; openDocText(r.text); }
    else { closeCreate(); toast("Не вышло" + (r && r.error ? ": " + r.error : "")); }
  });
}
function openDocText(t) {
  window.__doctext = t;
  el("create").innerHTML = `<div class="sheet"><h3>Документ распознан</h3>
    <div class="card" style="max-height:230px;overflow:auto;margin-bottom:10px"><div style="font-size:13px;white-space:pre-wrap">${esc(t)}</div></div>
    <button class="btn red" onclick="saveDocNote()">Сохранить в дневник</button>
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Закрыть</button></div>`;
  el("create").classList.remove("hidden");
}
async function saveDocNote() {
  const t = window.__doctext || ""; if (!t) { closeCreate(); return; }
  toast("Сохраняю…"); await API.addNote("📄 " + t);
  closeCreate(); toast("Сохранено в дневник ✓");
}
function scanFinance() {
  _pickFile(async (f) => {
    el("create").innerHTML = `<div class="sheet"><h3>Распознаю отчёт…</h3><div class="lbl">Секунду.</div></div>`;
    el("create").classList.remove("hidden");
    const b64 = await _toB64(f);
    const r = await API.vision(b64, f.type || "image/jpeg", "finance");
    closeCreate();
    if (!(r && r.ok && r.text)) { toast("Не вышло" + (r && r.error ? ": " + r.error : "")); return; }
    let p; try { p = JSON.parse(r.text.replace(/```json|```/g, "").trim()); } catch (e) { openDocText(r.text); toast("Цифры не распознались структурно — вот текст"); return; }
    openGroupForm();
    const d = window.__group || { rows: [] };
    (p.rows || []).forEach((pr) => {
      const key = (pr.name || "").toLowerCase().slice(0, 5);
      const idx = (d.rows || []).findIndex((rr) => rr.name.toLowerCase().includes(key) || (pr.name || "").toLowerCase().includes(rr.name.toLowerCase().slice(0, 5)));
      if (idx >= 0 && pr.profit != null && el("gp" + idx)) el("gp" + idx).value = pr.profit;
    });
    toast("Подставил из отчёта — проверь и сохрани");
  });
}
let pvlDays = 7;
function setPvlDays(d) { pvlDays = d; RENDER.pvl(); }
async function addAiTask(i) {
  const t = (window.__pvlTasks || [])[i]; if (!t) return;
  const r = await API.addTask(t.text, "ПВЛ", t.priority || "🟡", "");
  toast(r && r.ok !== false ? "Добавлено в задачи ✓" : "Не удалось");
}
RENDER.pvl = async function () {
  el("s-pvl").innerHTML = `<div class="link" onclick="show('home')" style="margin:8px 0;cursor:pointer">‹ На главную</div><h1 class="h">Пилот ПВЛ</h1><div class="lbl" style="padding:0 2px 8px">Загружаю данные команды…</div>`;
  const r = await API.pvlReport(profile, pvlDays).catch(() => ({ ok: false }));
  const back = `<div class="link" onclick="show('home')" style="margin:8px 0;cursor:pointer">‹ На главную</div>`;
  if (!r || r.ok === false) {
    el("s-pvl").innerHTML = `${back}<h1 class="h">Пилот ПВЛ</h1><div class="card"><div class="lbl">${esc((r && r.error) || "Не удалось загрузить")}</div></div>`;
    return;
  }
  const team = r.team || [], load = r.load || [], vol = r.volumes || {}, ai = r.ai || {};
  window.__pvlTasks = (ai && ai.tasks) || [];
  const seg = `<div class="seg"><b class="${pvlDays === 1 ? "on" : ""}" onclick="setPvlDays(1)">Сегодня</b><b class="${pvlDays === 7 ? "on" : ""}" onclick="setPvlDays(7)">7 дней</b></div>`;

  const teamCard = team.length
    ? `<div class="sec-title">Зарегистрировались (${team.length})</div><div class="card" style="padding:6px 16px">${team.map((t) => `<div class="li"><i class="ti ti-user" style="font-size:18px;color:var(--red)"></i><div class="t"><div style="font-weight:600">${esc(t.name || "")}</div><div class="m">${esc(t.label || "")}${t.since ? " · с " + esc(t.since) : ""}</div></div></div>`).join("")}</div>`
    : `<div class="card"><div class="lbl">Пока никто не зарегистрировался в боте. Как подключатся — здесь появится команда и аналитика.</div></div>`;

  const loadCard = load.length
    ? `<div class="sec-title">Загрузка (отметок / ср. балл)</div><div class="card" style="padding:6px 16px">${load.map((l) => `<div class="li"><div class="t"><div style="font-weight:500">${esc(l.name || "")}</div><div class="m">${esc(l.label || "")}</div></div><span class="lbl">${l.marks} отм. · ${l.avg == null ? "—" : "ср. " + l.avg}</span></div>`).join("")}</div>` : "";

  const quietCard = (r.quiet && r.quiet.length)
    ? `<div class="card" style="border-left:3px solid var(--amber,#E1A100)"><div class="lbl">⚠️ Мало отмечаются: <b>${r.quiet.map(esc).join(", ")}</b></div></div>` : "";

  const volCard = Object.keys(vol).length
    ? `<div class="sec-title">Объёмы за период</div><div class="card" style="padding:8px 16px">${Object.entries(vol).map(([k, v]) => `<div class="li"><div class="t"><span style="font-weight:600">${esc(k)}:</span> ${esc(v)}</div></div>`).join("")}</div>` : "";

  let aiBlock = "";
  if (ai && ai.ok === false) {
    aiBlock = `<div class="card"><div class="lbl">ИИ-аналитика недоступна${ai.error ? ": " + esc(ai.error) : ""}.</div></div>`;
  } else if (ai && ai.ok) {
    const core = ai.core || [], tasks = ai.tasks || [], instr = ai.instructions || [];
    aiBlock = `<div class="director-note"><div class="k">ИИ-АНАЛИТИКА</div><div class="v">${esc(ai.summary || "")}</div></div>`;
    if (core.length) aiBlock += `<div class="sec-title">🎯 Ядро проблем</div><div class="card" style="padding:6px 16px">${core.map((c) => `<div class="li"><span class="badge red" style="margin-right:6px">${c.count || ""}</span><div class="t"><div style="font-weight:600">${esc(c.theme || "")}</div><div class="m">${esc(c.detail || "")}</div></div></div>`).join("")}</div>`;
    if (tasks.length) aiBlock += `<div class="sec-title">✅ Предложенные задачи</div><div class="card" style="padding:6px 16px">${tasks.map((t, i) => `<div class="li"><div class="t"><div style="font-weight:500">${esc(t.priority || "")} ${esc(t.text || "")}</div></div><button onclick="addAiTask(${i})" style="border:1px solid var(--line,#eee);background:var(--card,#fff);border-radius:10px;padding:6px 9px;color:var(--red);cursor:pointer" title="Добавить в мои задачи"><i class="ti ti-plus"></i></button></div>`).join("")}</div>`;
    if (instr.length) aiBlock += `<div class="sec-title">📋 Кандидаты в инструкции</div><div class="card" style="padding:6px 16px">${instr.map((t) => `<div class="li"><i class="ti ti-file-text" style="color:var(--red)"></i><div class="t">${esc(t.text || "")}</div></div>`).join("")}</div>`;
  } else {
    aiBlock = `<div class="card"><div class="lbl">Пока мало сигналов для анализа — как накопятся ответы команды, появится «ядро» и предложения.</div></div>`;
  }

  const lists = [];
  const mk = (title, arr) => { if (arr && arr.length) lists.push(`<div class="sec-title">${title}</div><div class="card" style="padding:6px 16px">${arr.map((x) => `<div class="li"><div class="t"><div style="font-weight:500">${esc(x.text || "")}</div><div class="m">${esc(x.name || "")}</div></div></div>`).join("")}</div>`); };
  mk("🚧 Что мешало / зависло", r.blockers);
  mk("❓ Зоны «ничьё»", r.nichye);
  mk("💡 Что починить (от команды)", r.fix);
  mk("🛠 Идеи и проблемы (канал «идея»)", r.ideas);
  const marksCard = (r.marks && r.marks.length)
    ? `<div class="sec-title">🗓 Отметка руководителя${r.marks_week ? " (" + esc(r.marks_week) + ")" : ""}</div><div class="card" style="padding:6px 16px">${r.marks.map((m) => `<div class="li"><div class="t"><div style="font-weight:500">${esc(m.name || "")} — ${esc(m.status || "")}</div>${m.note ? `<div class="m">${esc(m.note)}</div>` : ""}</div></div>`).join("")}</div>` : "";

  el("s-pvl").innerHTML = `${back}<h1 class="h">Пилот ПВЛ</h1>${seg}${quietCard}${aiBlock}${loadCard}${volCard}${lists.join("")}${marksCard}${teamCard}<div class="lbl" style="padding:10px 2px 20px">Данные собираются из бота @AMUKS_bot. Чем дольше команда отмечается, тем точнее «ядро».</div>`;
};
let aggYM = null, aggMode = "month", aggDate = "";
function aggMonthLabel(ym) { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; }
function margColor(p) { p = Number(p) || 0; return p < 0 ? "#C0392B" : p < 20 ? "var(--amber,#E1A100)" : "#1F9D55"; }
function aggSetMode(m) { aggMode = m; aggDate = ""; RENDER.agg(); }
function aggShift(n) { let [y, m] = aggYM.split("-").map(Number); m += n; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } aggYM = `${y}-${String(m).padStart(2, "0")}`; RENDER.agg(); }
function aggPick(d) { aggDate = d; aggMode = "day"; RENDER.agg(); }
RENDER.agg = async function () {
  if (!aggYM) { const t = new Date(); aggYM = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`; }
  const back = `<div class="link" onclick="show('home')" style="margin:8px 0;cursor:pointer">‹ На главную</div>`;
  el("s-agg").innerHTML = `${back}<h1 class="h">Агрегатор · маржа</h1><div class="lbl" style="padding:0 2px 8px">Загружаю…</div>`;
  const r = await API.finAgg(profile, aggYM, aggMode, aggDate).catch(() => ({ ok: false }));
  if (!r || r.ok === false) { el("s-agg").innerHTML = `${back}<h1 class="h">Агрегатор · маржа</h1><div class="card"><div class="lbl">${esc((r && r.error) || "Не удалось загрузить")}</div></div>`; return; }
  const rows = r.rows || [], t = r.totals || {}, dates = r.dates || [];
  const seg = `<div class="seg"><b class="${aggMode === "month" ? "on" : ""}" onclick="aggSetMode('month')">Месяц</b><b class="${aggMode === "day" ? "on" : ""}" onclick="aggSetMode('day')">День</b></div>`;
  const nav = `<div class="row spread" style="margin:8px 0 10px"><button class="mbtn" onclick="aggShift(-1)" aria-label="Пред. месяц"><i class="ti ti-chevron-left"></i></button><div style="font-size:16px;font-weight:700">${aggMonthLabel(aggYM)}</div><button class="mbtn" onclick="aggShift(1)" aria-label="След. месяц"><i class="ti ti-chevron-right"></i></button></div>`;
  let dayChips = "";
  if (aggMode === "day") {
    dayChips = dates.length ? `<div class="lbl" style="padding:2px 2px 8px">Дни: ${dates.map((d) => `<span onclick="aggPick('${d}')" style="display:inline-block;margin:2px 4px 2px 0;padding:3px 8px;border:1px solid var(--line,#eee);border-radius:10px;cursor:pointer;${d === r.date ? "background:var(--red);color:#fff" : ""}">${d.slice(8, 10)}.${d.slice(5, 7)}</span>`).join("")}</div>` : `<div class="lbl" style="padding:2px 2px 8px">За этот месяц дней пока нет</div>`;
  }
  const totCard = `<div class="card"><div class="lbl">${aggMode === "day" ? (r.date ? "День " + r.date.slice(8, 10) + "." + r.date.slice(5, 7) : "—") : "Свод за месяц"}</div>
    <div class="big">${fmt(t.margin || 0)}</div>
    <div class="row spread"><span class="lbl">выручка ${fmt(t.revenue || 0)} · себест. ${fmt(t.cost || 0)}</span><span class="lbl" style="font-weight:700;color:${margColor(t.pct)}">маржа ${t.pct || 0}%</span></div></div>`;
  const byReg = {}; rows.forEach((x) => { (byReg[x.region] = byReg[x.region] || []).push(x); });
  let body;
  if (!rows.length) {
    body = `<div class="card"><div class="lbl">Данных пока нет. Когда агент начнёт заносить ежедневный отчёт с почты, здесь появятся выручка, себестоимость и маржа по клиникам и регионам.</div></div>`;
  } else {
    body = Object.keys(byReg).map((reg) => {
      const list = byReg[reg];
      const rr = list.reduce((s, x) => s + x.revenue, 0), cc = list.reduce((s, x) => s + x.cost, 0), mm = rr - cc, pp = rr ? Math.round(mm / rr * 1000) / 10 : 0;
      return `<div class="sec-title">${esc(reg)} · маржа <span style="color:${margColor(pp)}">${pp}%</span></div><div class="card" style="padding:6px 16px">${list.map((x) => `<div class="li"><div class="t"><div style="font-weight:600">${esc(x.clinic)}</div><div class="m">выручка ${fmt(x.revenue)} · себест. ${fmt(x.cost)}</div></div><div style="text-align:right"><div style="font-weight:700">${fmt(x.margin)}</div><div class="m" style="color:${margColor(x.pct)}">${x.pct}%</div></div></div>`).join("")}</div>`;
    }).join("");
  }
  el("s-agg").innerHTML = `${back}<h1 class="h">Агрегатор · маржа</h1>${seg}${nav}${dayChips}${totCard}${body}<div class="lbl" style="padding:10px 2px 20px">Данные заносит агент из ежедневного отчёта на почте. Маржа = выручка − себестоимость.</div>`;
};
RENDER.week = async function () {
  const w = await API.weekplan(profile);
  window.__overdue = w.overdue || [];
  const wd = ["вс","пн","вт","ср","чт","пт","сб"];
  const itemRow = (it) => `<div class="li"><span class="tcell">${it.kind === "task" ? '<i class="ti ti-circle-check" style="color:var(--red)"></i>' : (it.time || "")}</span><span class="t" style="font-weight:500">${esc(it.text)}</span></div>`;
  el("s-week").innerHTML = `
    <div class="link" onclick="show('more')" style="margin:8px 0;cursor:pointer">‹ Назад</div>
    <h1 class="h">План недели</h1>
    ${(w.overdue && w.overdue.length) ? `<div class="sec-title" style="color:#C0392B">⚠️ Просрочено (${w.overdue.length})</div>
    <div class="card" style="padding:6px 16px">${w.overdue.map((o, i) => `<div class="li"><div class="t"><div style="font-weight:600">${esc(o.text)}</div><div class="m">было ${o.date.slice(8, 10)}.${o.date.slice(5, 7)} · ${o.kind === "task" ? "задача" : o.kind === "rem" ? "напоминание" : "в сетке"}</div></div><button onclick="rescheduleOverdue(${i})" style="border:1px solid var(--line,#eee);background:#fff;border-radius:10px;padding:7px 10px;color:var(--red);font-weight:700;cursor:pointer">Перенести</button></div>`).join("")}</div>` : ""}
    ${(w.days || []).map((d) => { const dd = new Date(d.date + "T00:00:00"); const isT = d.date === TODAY_ISO(); return `<div class="sec-title" style="margin-top:12px;${isT ? "color:var(--red)" : ""}">${isT ? "● " : ""}${wd[dd.getDay()]} ${d.date.slice(8, 10)}.${d.date.slice(5, 7)}</div><div class="card" style="padding:4px 16px">${d.items.length ? d.items.map(itemRow).join("") : '<div class="lbl" style="padding:8px 0">—</div>'}</div>`; }).join("")}`;
};
function rescheduleOverdue(i) {
  const o = (window.__overdue || [])[i]; if (!o) return;
  const tom = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  el("create").innerHTML = `<div class="sheet"><h3>Перенести</h3>
    <div class="lbl" style="margin-bottom:10px">${esc(o.text)}</div>
    <input type="date" id="rsd" value="${tom}" style="width:100%">
    <button class="btn red" style="margin-top:14px" onclick="doReschedule(${i})">Перенести на выбранную дату</button>
    <div style="display:flex;gap:8px;margin-top:8px"><button class="btn ghost" style="flex:1" onclick="quickResched(${i},1)">Завтра</button><button class="btn ghost" style="flex:1" onclick="quickResched(${i},7)">+7 дней</button></div>
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button></div>`;
  el("create").classList.remove("hidden");
}
function quickResched(i, days) { const inp = el("rsd"); if (inp) inp.value = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); doReschedule(i); }
async function doReschedule(i) {
  const o = (window.__overdue || [])[i]; if (!o) return;
  const nd = el("rsd") ? el("rsd").value : ""; if (!nd) { toast("Выбери дату"); return; }
  toast("Переношу…");
  let r;
  if (o.kind === "task") r = await API.taskEdit(o.text, o.text, nd);
  else r = await API.itemMove({ kind: o.kind, date: o.date, start: o.start, text: o.text, new_date: nd, new_start: o.start, new_end: "" });
  closeCreate(); toast(r && r.ok !== false ? "Перенесено ✓" : "Не удалось"); RENDER.week();
}
RENDER.habits = async function () {
  const h = await API.habits(profile);
  window.__habits = h.habits || [];
  el("s-habits").innerHTML = `
    <div class="link" onclick="show('more')" style="margin:8px 0;cursor:pointer">‹ Назад</div>
    <h1 class="h">Привычки и шаги</h1>
    <div class="card" style="padding:6px 16px">${(h.habits || []).map((x, i) => `
      <div class="li">
        <span class="chk ${x.done_today ? "done" : ""}" onclick="markHabit(${i})" title="Отметить сегодня"><i class="ti ti-check" style="font-size:15px"></i></span>
        <div class="t"><div style="font-weight:600">${esc(x.name)} <span class="lbl" style="font-weight:400">· серия ${x.streak} дн</span></div>
        <div class="m">${esc(x.goal || "")}${x.anchor ? " · " + esc(x.anchor) : ""}</div>
        <div style="font-size:15px;letter-spacing:2px;margin-top:3px;color:var(--red)">${x.chain.map((c) => c ? "▰" : "▱").join("")} <span class="lbl" style="font-size:11px;color:var(--muted)">${x.week}/7</span></div></div>
      </div>`).join("") || '<div class="lbl" style="padding:12px 0">Привычки не заданы. Скажи боту: «новая привычка: 5 приседаний перед душем».</div>'}</div>
    <div class="lbl" style="padding:8px 2px">Отмечай галочкой каждый день — расти серию, не разрывай цепь 💪</div>`;
};
async function markHabit(i) {
  const x = (window.__habits || [])[i]; if (!x) return;
  toast("Отмечаю…");
  const r = await API.habitDone(x.name);
  toast(r && r.ok !== false ? "Отмечено ✓" : "Не удалось"); RENDER.habits();
}

/* ---- пуш-уведомления ---- */
function _b64ToU8(b64) {
  const pad = "=".repeat((4 - b64.length % 4) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    toast("Уведомления не поддерживаются. Открой как приложение с экрана «Домой»."); return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Разрешение не выдано"); return; }
    const k = await API.pushKey();
    if (!k.key) { toast("Ключ не настроен на сервере"); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64ToU8(k.key) });
    const r = await API.pushSubscribe(sub.toJSON ? sub.toJSON() : sub);
    const st = el("pushState"); if (st) st.textContent = "включены ✓";
    toast(r && r.ok !== false ? "Уведомления включены ✓" : "Не удалось подписаться");
  } catch (e) { toast("Ошибка: " + (e && e.message ? e.message : e)); }
}
async function testPush() {
  toast("Отправляю тест…");
  const r = await API.pushTest();
  toast(r && r.ok ? ("Отправлено: " + (r.sent || 0)) : ("Не вышло" + (r && r.reason ? " — " + r.reason : "")));
}
let toastT;
function toast(msg) {
  let t = el("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast";
    t.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px 18px;border-radius:20px;font-size:13px;z-index:50;opacity:0;transition:.2s;max-width:80%;text-align:center";
    document.body.appendChild(t); }
  t.textContent = msg;
  t.style.opacity = "1"; clearTimeout(toastT); toastT = setTimeout(() => t.style.opacity = "0", 1600);
}

/* role switch (demo) */
el("addBtn").onclick = () => openCreate();
el("create").onclick = (e) => { if (e.target.id === "create") closeCreate(); };
el("roleBtn").onclick = () => el("sheet").classList.remove("hidden");
el("sheet").onclick = (e) => { if (e.target.id === "sheet") el("sheet").classList.add("hidden"); };
document.querySelectorAll("#sheet .opt").forEach((o) => o.onclick = async () => {
  el("sheet").classList.add("hidden");
  const res = await API.login(o.dataset.pin);
  if (res.ok) { profile = res.profile; enterApp(); }
});

buildPad();

/* ===================== ЗДОРОВЬЕ (health-planner · localStorage) ===================== */
const HS_KEY = "ks_health";
const HS_TYPES = ["ОАК", "Биохимия крови", "Липидный профиль", "Витамин D", "Ферритин", "Глюкоза / инсулин", "ТТГ", "Кардиолог", "УЗИ", "Стоматолог", "Check-up общий"];
const HS_MARKERS = ["Витамин D", "Ферритин", "Холестерин общий", "ЛПНП", "Глюкоза", "Гликированный гемоглобин", "ТТГ", "АЛТ", "АСТ", "Креатинин"];
const HS_REF = {
  "Витамин D": { min: 30, max: 100, unit: "нг/мл" },
  "Ферритин": { min: 30, max: 300, unit: "нг/мл" },
  "Холестерин общий": { min: 0, max: 5.2, unit: "ммоль/л" },
  "ЛПНП": { min: 0, max: 3.0, unit: "ммоль/л" },
  "Глюкоза": { min: 3.9, max: 5.5, unit: "ммоль/л" },
  "Гликированный гемоглобин": { min: 0, max: 5.7, unit: "%" },
  "ТТГ": { min: 0.4, max: 4.0, unit: "мкМЕ/мл" },
  "АЛТ": { min: 0, max: 41, unit: "Ед/л" },
  "АСТ": { min: 0, max: 40, unit: "Ед/л" },
  "Креатинин": { min: 62, max: 106, unit: "мкмоль/л" }
};
function hsSave(d) { try { localStorage.setItem(HS_KEY, JSON.stringify(d)); } catch (e) {} }
function hsLoad() {
  try { const r = JSON.parse(localStorage.getItem(HS_KEY)); if (r && r.reminders) return r; } catch (e) {}
  const t = new Date(); const iso = (n) => { const x = new Date(t); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const seed = { reminders: [
      { id: "health-reminder-1", title: "Биохимия крови", type: "lab", frequencyDays: 180, nextDate: iso(12), comment: "Плановый контроль", status: "active" },
      { id: "health-reminder-2", title: "Check-up общий", type: "checkup", frequencyDays: 365, nextDate: iso(45), comment: "", status: "active" }
    ], results: [], files: [], settings: { targetCheckupFrequencyDays: 180 } };
  hsSave(seed); return seed;
}
function hsUID(p) { return p + "-" + Date.now() + "-" + Math.floor(Math.random() * 1000); }
function daysLeft(iso) { const t = new Date(); t.setHours(0, 0, 0, 0); const d = new Date(iso + "T00:00:00"); return Math.round((d - t) / 86400000); }
function hsFmtD(iso) { return iso ? iso.split("-").reverse().join(".") : "—"; }
function hsDdl(iso) { const d = daysLeft(iso); return d >= 0 ? "через " + d + " дн." : "просрочено " + (-d) + " дн."; }
function hsIdxColor(i) { return i >= 80 ? "#1F9D55" : i >= 60 ? "var(--amber,#E1A100)" : "var(--red)"; }
function hsRef(r) {
  const mn = (r.refMin !== "" && r.refMin != null) ? Number(r.refMin) : (HS_REF[r.marker] ? HS_REF[r.marker].min : null);
  const mx = (r.refMax !== "" && r.refMax != null) ? Number(r.refMax) : (HS_REF[r.marker] ? HS_REF[r.marker].max : null);
  return { mn, mx };
}
function hsRefText(r) { const { mn, mx } = hsRef(r); if (mn == null && mx == null) return "диапазон не указан"; return "норма " + (mn != null ? mn : "") + "–" + (mx != null ? mx : ""); }
function hsStatus(r) {
  const { mn, mx } = hsRef(r); const v = Number(r.value);
  if (mx != null && v > mx) return "выше";
  if (mn != null && v < mn) return "ниже";
  if (mn != null || mx != null) return "в диапазоне";
  return "нет диапазона";
}
function hsLatest(marker) { return hsLoad().results.filter((r) => r.marker === marker).sort((a, b) => a.date < b.date ? 1 : -1); }
function hsAttention() { let c = 0; HS_MARKERS.forEach((m) => { const rows = hsLatest(m); if (rows.length) { const s = hsStatus(rows[0]); if (s === "выше" || s === "ниже") c++; } }); return c; }
function hsActive() { return hsLoad().reminders.filter((r) => r.status === "active").sort((a, b) => a.nextDate < b.nextDate ? -1 : 1); }
function hsNext() { return hsActive()[0] || null; }
function hsLastUpload() { const H = hsLoad(); const a = [...H.files.map((f) => f.date), ...H.results.map((r) => r.date)].sort(); return a.length ? a[a.length - 1] : null; }
function hsIndex() {
  const H = hsLoad(); let s = 100;
  s -= hsActive().filter((r) => daysLeft(r.nextDate) < 0).length * 10;
  s -= hsAttention() * 8;
  if (!H.results.length) s -= 15;
  else { const lu = hsLastUpload(); if (lu && daysLeft(lu) < -(H.settings.targetCheckupFrequencyDays || 180)) s -= 10; }
  return Math.max(0, Math.min(100, Math.round(s)));
}
function hsSpark(rowsAsc) {
  if (rowsAsc.length < 2) return "";
  const vals = rowsAsc.map((r) => Number(r.value)); const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
  return `<div style="display:inline-flex;align-items:flex-end;gap:2px;height:18px">${vals.map((v) => { const h = 4 + Math.round((v - mn) / rng * 14); return `<span style="display:inline-block;width:4px;height:${h}px;background:var(--red);opacity:.55;border-radius:1px"></span>`; }).join("")}</div>`;
}

/* ---- карточка на главной ---- */
function hsHomeCard() {
  const nx = hsNext(), att = hsAttention(), up = hsLastUpload();
  const sub = nx ? `${esc(nx.title)} — ${hsDdl(nx.nextDate)}` : "чекап не запланирован";
  return `<div class="card" onclick="show('health')" style="cursor:pointer;margin-top:4px">
    <div class="row spread"><div class="t" style="font-weight:600"><i class="ti ti-heartbeat" style="color:var(--red);margin-right:8px"></i>Здоровье</div><span class="link">Открыть ›</span></div>
    <div class="m" style="margin-top:6px">Следующий чекап: ${sub}</div>
    <div class="m">${att} показ. требуют внимания · анализы: ${hsFmtD(up)}</div></div>`;
}

/* ---- экран «Здоровье» ---- */
RENDER.health = function () {
  const H = hsLoad();
  const idx = hsIndex(), nx = hsNext(), att = hsAttention(), active = hsActive(), lu = hsLastUpload();
  const back = `<div class="link" onclick="show('home')" style="margin:8px 0;cursor:pointer">‹ На главную</div>`;

  const summary = `<div class="card">
    <div class="lbl">Индекс контроля</div>
    <div class="big" style="color:${hsIdxColor(idx)}">${idx}<span style="font-size:18px;color:var(--muted)">/100</span></div>
    <div class="row spread"><span class="lbl">Обновлено: ${hsFmtD(lu)}</span><span class="lbl">${active.length} активных напоминаний</span></div>
    <div class="row spread" style="margin-top:4px"><span class="lbl">Ближайший чекап: ${nx ? esc(nx.title) + " · " + hsDdl(nx.nextDate) : "—"}</span><span class="lbl" style="color:${att ? "var(--red)" : "var(--muted)"}">${att} вне диапазона</span></div></div>`;

  const remCards = active.length ? active.map((r) => {
    const dl = daysLeft(r.nextDate), over = dl < 0;
    return `<div class="card" style="${over ? "border-left:3px solid var(--red)" : ""}">
      <div class="row spread"><div class="t" style="font-weight:600">${esc(r.title)}</div><span class="lbl" style="${over ? "color:var(--red)" : ""}">${over ? "просрочено " + (-dl) + " дн." : "через " + dl + " дн."}</span></div>
      <div class="m">${hsFmtD(r.nextDate)}${r.comment ? " · " + esc(r.comment) : ""}</div>
      <div class="row" style="gap:6px;margin-top:8px">
        <button class="btn red" style="flex:1;padding:7px;font-size:13px" onclick="hsReminderDone('${r.id}')">Выполнено</button>
        <button class="btn ghost" style="flex:1;padding:7px;font-size:13px" onclick="hsReminderPostpone('${r.id}')">Отложить</button>
        <button class="btn ghost" style="flex:1;padding:7px;font-size:13px" onclick="hsEditReminder('${r.id}')">Изменить</button>
      </div></div>`;
  }).join("") : `<div class="card"><div class="lbl">Напоминаний нет. Добавьте первый чекап.</div></div>`;

  const recent = H.results.slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 8);
  const resList = recent.length ? `<div class="card" style="padding:6px 16px">${recent.map((r) => {
    const s = hsStatus(r), col = (s === "выше" || s === "ниже") ? "var(--red)" : s === "в диапазоне" ? "#1F9D55" : "#9ca3af";
    return `<div class="li"><div class="t"><div style="font-weight:600">${esc(r.marker)} — ${r.value} ${esc(r.unit || "")}</div><div class="m">${hsFmtD(r.date)} · ${esc(r.testType || "—")} · ${esc(hsRefText(r))}</div></div><span class="badge" style="color:${col};border-color:${col}">${s}</span></div>`;
  }).join("")}</div>` : `<div class="lbl" style="padding:6px 2px 4px">Результатов пока нет — добавьте первый показатель.</div>`;

  const fileList = H.files.length ? `<div class="card" style="padding:6px 16px">${H.files.slice().reverse().map((f) => `<div class="li"><i class="ti ti-file-text" style="color:var(--red)"></i><div class="t"><div style="font-weight:500">${esc(f.name)}</div><div class="m">${hsFmtD(f.date)} · файл добавлен, автоматический разбор будет подключён позже</div></div></div>`).join("")}</div>` : "";

  const dyn = HS_MARKERS.map((m) => {
    const rows = hsLatest(m);
    if (!rows.length) return `<div class="li"><div class="t"><div style="font-weight:600">${m}</div><div class="m">нет данных</div></div><span class="badge" style="color:#9ca3af;border-color:#e5e7eb">—</span></div>`;
    const last = rows[0], s = hsStatus(last);
    const trend = rows.length >= 2 ? (Number(rows[0].value) > Number(rows[1].value) ? "растёт" : Number(rows[0].value) < Number(rows[1].value) ? "снижается" : "стабильно") : "—";
    const col = (s === "выше" || s === "ниже") ? "var(--red)" : s === "в диапазоне" ? "#1F9D55" : "#9ca3af";
    return `<div class="li"><div class="t"><div style="font-weight:600">${m}</div><div class="m">${last.value} ${esc(last.unit || "")} · ${hsFmtD(last.date)} · ${trend}</div></div><div style="text-align:right">${hsSpark(rows.slice(0, 6).reverse())}<div class="m" style="color:${col}">${s}</div></div></div>`;
  }).join("");

  const sig = [];
  HS_MARKERS.forEach((m) => {
    const rows = hsLatest(m); if (!rows.length) return;
    const s = hsStatus(rows[0]);
    if (s === "выше") sig.push(`${m} выше указанного диапазона (${rows[0].value} ${rows[0].unit || ""}). Рекомендовано обсудить со специалистом.`);
    else if (s === "ниже") sig.push(`${m} ниже указанного диапазона (${rows[0].value} ${rows[0].unit || ""}). Рекомендовано обсудить со специалистом.`);
    if (rows.length >= 2 && Number(rows[0].value) < Number(rows[1].value)) sig.push(`${m} снизился по сравнению с прошлым измерением — стоит отслеживать в динамике.`);
  });
  active.forEach((r) => { const dl = daysLeft(r.nextDate); if (dl < 0) sig.push(`${r.title}: дата прошла (${-dl} дн. назад). Рекомендовано записаться.`); else if (dl <= 14) sig.push(`${r.title} запланирована через ${dl} дн.`); });
  if (!H.results.length) sig.push("Пока нет внесённых результатов анализов. Добавьте первые показатели для аналитики.");
  else if (lu && daysLeft(lu) < -180) sig.push("Анализы не обновлялись более 6 месяцев.");
  const analytics = sig.length ? `<div class="card" style="padding:6px 16px">${sig.map((s) => `<div class="li"><i class="ti ti-alert-triangle" style="color:var(--red)"></i><div class="t">${esc(s)}</div></div>`).join("")}</div>` : `<div class="card"><div class="lbl">Сейчас ничего критичного не вижу. Так держать 👍</div></div>`;

  el("s-health").innerHTML = `${back}<h1 class="h">Здоровье</h1>
    ${summary}
    <div class="row spread" style="margin-top:14px"><div class="sec-title">Напоминания о чекапах</div><button onclick="hsAddReminder()" style="background:none;border:none;color:var(--red);font-weight:600;cursor:pointer">＋ добавить</button></div>
    ${remCards}
    <div class="row spread" style="margin-top:14px"><div class="sec-title">Результаты анализов</div><button onclick="hsAddResult()" style="background:none;border:none;color:var(--red);font-weight:600;cursor:pointer">＋ показатель</button></div>
    ${resList}
    <input type="file" id="hs_pdf" accept="application/pdf,image/*" style="display:none" onchange="hsUploadPdf(this)">
    <button class="btn ghost" style="margin-top:8px" onclick="el('hs_pdf').click()"><i class="ti ti-upload"></i> Загрузить PDF</button>
    ${fileList}
    <div class="sec-title" style="margin-top:16px">Динамика показателей</div>
    <div class="card" style="padding:6px 16px">${dyn}</div>
    <div class="sec-title" style="margin-top:16px">Что требует внимания</div>
    ${analytics}
    <div class="lbl" style="padding:12px 2px 22px">Это не диагностика. Раздел помогает планировать чекапы и обсуждать показатели со специалистом. Отклонение от диапазона — повод обсудить с врачом, а не диагноз.</div>`;
};

/* ---- действия с напоминаниями ---- */
function hsReminderDone(id) {
  const H = hsLoad(); const r = H.reminders.find((x) => x.id === id); if (!r) return;
  r.status = "done";
  if (Number(r.frequencyDays) > 0) { const nd = new Date(); nd.setDate(nd.getDate() + Number(r.frequencyDays)); H.reminders.push({ id: hsUID("health-reminder"), title: r.title, type: r.type || "lab", frequencyDays: Number(r.frequencyDays), nextDate: nd.toISOString().slice(0, 10), comment: r.comment || "", status: "active" }); }
  hsSave(H); toast("Выполнено ✓" + (Number(r.frequencyDays) > 0 ? " · запланирован следующий" : "")); RENDER.health();
}
function hsReminderPostpone(id) { const H = hsLoad(); const r = H.reminders.find((x) => x.id === id); if (!r) return; const d = new Date(r.nextDate + "T00:00:00"); d.setDate(d.getDate() + 14); r.nextDate = d.toISOString().slice(0, 10); r.status = "active"; hsSave(H); toast("Отложено на 2 недели"); RENDER.health(); }

/* ---- формы ---- */
function hsReminderForm(r) {
  r = r || {};
  const opts = HS_TYPES.map((t) => `<option ${r.title === t ? "selected" : ""}>${t}</option>`).join("");
  el("create").innerHTML = `<div class="sheet"><h3>${r.id ? "Изменить напоминание" : "Новое напоминание"}</h3>
    <div class="lbl" style="margin:6px 0 2px">Обследование</div>
    <select id="hr_t" style="width:100%">${opts}</select>
    <div class="lbl" style="margin:8px 0 2px">Следующая дата</div>
    <input type="date" id="hr_d" value="${r.nextDate || new Date().toISOString().slice(0, 10)}" style="width:100%">
    <div class="lbl" style="margin:8px 0 2px">Периодичность (дней)</div>
    <input type="number" id="hr_f" value="${r.frequencyDays != null ? r.frequencyDays : 180}" style="width:100%">
    <div class="lbl" style="margin:8px 0 2px">Комментарий</div>
    <input id="hr_c" value="${(r.comment || "").replace(/"/g, "&quot;")}" placeholder="необязательно" style="width:100%">
    <button class="btn red" style="margin-top:14px" onclick="hsSaveReminder('${r.id || ""}')">Сохранить</button>
    ${r.id ? `<button class="btn ghost" style="margin-top:8px" onclick="hsDeleteReminder('${r.id}')">Удалить</button>` : ""}
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button></div>`;
  el("create").classList.remove("hidden");
}
function hsAddReminder() { hsReminderForm(); }
function hsEditReminder(id) { hsReminderForm(hsLoad().reminders.find((x) => x.id === id)); }
function hsSaveReminder(id) {
  const H = hsLoad();
  const title = el("hr_t").value, nextDate = el("hr_d").value, frequencyDays = Number(el("hr_f").value) || 0, comment = el("hr_c").value.trim();
  if (id) { const r = H.reminders.find((x) => x.id === id); if (r) { r.title = title; r.nextDate = nextDate; r.frequencyDays = frequencyDays; r.comment = comment; r.status = "active"; } }
  else H.reminders.push({ id: hsUID("health-reminder"), title, type: "lab", frequencyDays, nextDate, comment, status: "active" });
  hsSave(H); closeCreate(); toast("Сохранено ✓"); RENDER.health();
}
function hsDeleteReminder(id) { const H = hsLoad(); H.reminders = H.reminders.filter((x) => x.id !== id); hsSave(H); closeCreate(); toast("Удалено ✓"); RENDER.health(); }
function hsAddResult() {
  const tOpts = HS_TYPES.map((t) => `<option value="${t}">`).join("");
  const mOpts = HS_MARKERS.map((t) => `<option value="${t}">`).join("");
  el("create").innerHTML = `<div class="sheet"><h3>Новый результат</h3>
    <div class="lbl" style="margin:6px 0 2px">Дата</div>
    <input type="date" id="hx_date" value="${new Date().toISOString().slice(0, 10)}" style="width:100%">
    <div class="lbl" style="margin:8px 0 2px">Тип исследования</div>
    <input id="hx_test" list="hx_tl" placeholder="напр. Биохимия крови" style="width:100%"><datalist id="hx_tl">${tOpts}</datalist>
    <div class="lbl" style="margin:8px 0 2px">Показатель</div>
    <input id="hx_marker" list="hx_ml" placeholder="напр. Витамин D" oninput="hsPrefillRef()" style="width:100%"><datalist id="hx_ml">${mOpts}</datalist>
    <div style="display:flex;gap:8px">
      <div style="flex:1"><div class="lbl" style="margin:8px 0 2px">Значение</div><input id="hx_val" type="number" step="any" style="width:100%"></div>
      <div style="width:104px"><div class="lbl" style="margin:8px 0 2px">Ед.</div><input id="hx_unit" style="width:100%"></div>
    </div>
    <div style="display:flex;gap:8px">
      <div style="flex:1"><div class="lbl" style="margin:8px 0 2px">Норма от</div><input id="hx_min" type="number" step="any" style="width:100%"></div>
      <div style="flex:1"><div class="lbl" style="margin:8px 0 2px">Норма до</div><input id="hx_max" type="number" step="any" style="width:100%"></div>
    </div>
    <div class="lbl" style="margin:8px 0 2px">Комментарий</div>
    <input id="hx_c" placeholder="необязательно" style="width:100%">
    <button class="btn red" style="margin-top:14px" onclick="hsSaveResult()">Сохранить</button>
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button></div>`;
  el("create").classList.remove("hidden");
}
function hsPrefillRef() { const m = el("hx_marker").value, ref = HS_REF[m]; if (!ref) return; if (!el("hx_unit").value) el("hx_unit").value = ref.unit; if (el("hx_min").value === "") el("hx_min").value = ref.min; if (el("hx_max").value === "") el("hx_max").value = ref.max; }
function hsSaveResult() {
  const marker = el("hx_marker").value.trim(), value = el("hx_val").value;
  if (!marker || value === "") { toast("Укажите показатель и значение"); return; }
  const H = hsLoad();
  H.results.push({ id: hsUID("health-result"), date: el("hx_date").value, testType: el("hx_test").value.trim(), marker, value: Number(value), unit: el("hx_unit").value.trim(), refMin: el("hx_min").value === "" ? "" : Number(el("hx_min").value), refMax: el("hx_max").value === "" ? "" : Number(el("hx_max").value), comment: el("hx_c").value.trim(), source: "manual" });
  hsSave(H); closeCreate(); toast("Показатель добавлен ✓"); RENDER.health();
}
function hsUploadPdf(input) {
  const f = input.files && input.files[0]; if (!f) return;
  const H = hsLoad(); H.files.push({ id: hsUID("health-file"), date: new Date().toISOString().slice(0, 10), name: f.name, type: "pdf", status: "uploaded" });
  hsSave(H); toast("Файл добавлен, автоматический разбор будет подключён позже"); RENDER.health();
}
