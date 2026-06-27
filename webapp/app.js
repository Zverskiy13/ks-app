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
    const { agenda } = await API.today(profile);
    const tasks = await API.tasks(profile);
    const dls = await API.deadlines(profile);
    window.__home_agenda = agenda;
    window.__dls = dls;
    const top = tasks.find((t) => !t.done && t.priority === "🔴") || tasks.find((t) => !t.done);
    el("s-home").innerHTML = `
      <div class="sub">${dateLabelToday()}</div>
      <h1 class="h">${profile.role === "owner" ? "Доброе утро,<br>Иван" : "Привет,<br>" + profile.name.split(" ")[0]}</h1>
      ${top ? `<div class="hero">
        <div class="top"><div class="k">ГЛАВНОЕ НА СЕГОДНЯ</div><div class="v">${esc(top.text)}</div></div>
        <div class="bot"><span class="lbl"><i class="ti ti-clock"></i> ${esc(top.due ? fmtDue(top.due) : top.company)}</span><span class="link" onclick="show('tasks')">Открыть ›</span></div>
      </div>` : ""}
      <div class="qa-row">
        <div class="qa" onclick="openCreate()"><i class="ti ti-plus"></i>Добавить</div>
        <div class="qa" onclick="openCreate({type:'rem'})"><i class="ti ti-bell"></i>Напомнить</div>
        <div class="qa" onclick="show('week')"><i class="ti ti-calendar-week"></i>Неделя</div>
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
      <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button>
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
RENDER.week = async function () {
  const w = await API.weekplan(profile);
  const wd = ["вс","пн","вт","ср","чт","пт","сб"];
  el("s-week").innerHTML = `
    <div class="link" onclick="show('more')" style="margin:8px 0;cursor:pointer">‹ Назад</div>
    <h1 class="h">План недели</h1>
    ${(w.days || []).map((d) => { const dd = new Date(d.date + "T00:00:00"); const isT = d.date === TODAY_ISO(); return `<div class="sec-title" style="margin-top:12px;${isT ? "color:var(--red)" : ""}">${isT ? "● " : ""}${wd[dd.getDay()]} ${d.date.slice(8, 10)}.${d.date.slice(5, 7)}</div><div class="card" style="padding:4px 16px">${d.items.length ? d.items.map((it) => `<div class="li"><span class="tcell">${it.time}</span><span class="t" style="font-weight:500">${esc(it.text)}</span></div>`).join("") : '<div class="lbl" style="padding:8px 0">—</div>'}</div>`; }).join("")}
    ${(w.tasks && w.tasks.length) ? `<div class="sec-title" style="margin-top:14px">Задачи со сроком на неделе</div><div class="card" style="padding:4px 16px">${w.tasks.map((t) => `<div class="li"><span class="tcell" style="color:var(--red)">${fmtDue(t.due)}</span><span class="t" style="font-weight:500">${esc(t.text)}</span></div>`).join("")}</div>` : ""}`;
};
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
