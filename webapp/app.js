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
const PIN_MIN = 4, PIN_MAX = 8;
function buildPad() {
  const pad = el("pad");
  ["1","2","3","4","5","6","7","8","9","✓","0","⌫"].forEach((k) => {
    const b = document.createElement("button");
    b.className = "key" + (k === "✓" ? " ok" : "");
    b.textContent = k;
    if (k === "⌫") b.innerHTML = '<i class="ti ti-backspace"></i>';
    if (k === "✓") { b.innerHTML = '<i class="ti ti-arrow-right"></i>'; b.onclick = submitPin; }
    else b.onclick = () => press(k);
    pad.appendChild(b);
  });
  drawDots();
}
function drawDots() {
  const n = Math.min(PIN_MAX, Math.max(PIN_MIN, pin.length));
  el("dots").innerHTML = Array.from({ length: n }, (_, i) => `<span class="dot ${i < pin.length ? "f" : ""}"></span>`).join("");
}
function press(k) {
  if (k === "⌫") pin = pin.slice(0, -1);
  else if (pin.length < PIN_MAX) pin += k;
  drawDots();
  if (pin.length === PIN_MAX) setTimeout(tryLogin, 120);   // авто-вход при максимальной длине
}
function submitPin() {
  if (pin.length >= PIN_MIN) tryLogin();
  else el("dots").animate([{transform:"translateX(-6px)"},{transform:"translateX(6px)"},{transform:"translateX(0)"}],{duration:200});
}
async function tryLogin() {
  const res = await API.login(pin);
  if (res.ok) { profile = res.profile; pin = ""; enterApp(); }
  else { pin = ""; drawDots(); el("dots").animate([{transform:"translateX(-6px)"},{transform:"translateX(6px)"},{transform:"translateX(0)"}],{duration:200}); }
}

/* ---------- app shell ---------- */
/* Синхронизация здоровья/трекера с сервером (если включён CLIENT_STATE_BACKEND=db).
   localStorage остаётся рабочим кэшем: тянем с сервера в него при входе, пушим при сохранении. */
window.HS_REMOTE = false; window.TK_REMOTE = false;
async function stateSyncIn() {
  try {
    const rh = await API.stateGet("health");
    if (rh && rh.backend === "db") {
      window.HS_REMOTE = true;
      if (rh.data && (rh.data.reminders || rh.data.results || rh.data.files)) {
        try { localStorage.setItem(HS_KEY, JSON.stringify(rh.data)); } catch (e) {}
      } else { const loc = localStorage.getItem(HS_KEY); if (loc) { try { await API.stateSet("health", JSON.parse(loc)); } catch (e) {} } }
    }
  } catch (e) {}
  try {
    const rt = await API.stateGet("tracker");
    if (rt && rt.backend === "db") {
      window.TK_REMOTE = true;
      if (rt.data && Object.keys(rt.data).length) {
        try { localStorage.setItem(TK_KEY, JSON.stringify(rt.data)); } catch (e) {}
      } else { const loc = localStorage.getItem(TK_KEY); if (loc) { try { await API.stateSet("tracker", JSON.parse(loc)); } catch (e) {} } }
    }
  } catch (e) {}
}
async function enterApp() {
  el("login").classList.add("hidden");
  el("app").classList.remove("hidden");
  el("roleName").textContent = profile.title.split("·")[0].trim();
  buildNav();
  await stateSyncIn();
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
    const AID = profile.role === "owner" ? await API.assistant(profile, "cached", "", null).catch(() => ({})) : {};
    const aiSum = (AID && AID.digest && AID.digest.summary) ? AID.digest.summary : "";
    const directorText = aiSum ? esc(aiSum) : (top ? `Фокус дня — ${esc(top.text)}. ${hotDls ? `Горящих дедлайнов: ${hotDls}.` : "Критичных дедлайнов нет."}` : (hotDls ? `Нет главной задачи, но есть ${hotDls} горящих дедлайнов.` : "Критичных рисков на сегодня не вижу."));
    el("s-home").innerHTML = `
      <div class="sub">${dateLabelToday()}</div>
      <h1 class="h">${profile.role === "owner" ? "Панель<br>управления" : "Привет,<br>" + profile.name.split(" ")[0]}</h1>
      ${profile.role === "owner" ? `<div class="director-note" onclick="show('assist')" style="cursor:pointer"><div class="k">ИИ-ПОМОЩНИК</div><div class="v">${directorText}</div><div class="link" style="margin-top:6px">Открыть помощника ›</div></div>
      <div class="board-pulse">
        <div class="pulse-card"><div class="k">Открыто задач</div><div class="n">${openCount}</div><div class="m">в работе</div></div>
        <div class="pulse-card ${hotDls ? "hot" : ""}"><div class="k">Дедлайны</div><div class="n">${hotDls}</div><div class="m">до 14 дней</div></div>
      </div>
      ${dashboardCard()}
      <div class="card" onclick="show('pvl')" style="cursor:pointer;margin-top:4px"><div class="row spread"><div class="t" style="font-weight:600"><i class="ti ti-users" style="color:var(--red);margin-right:8px"></i>Пилот ПВЛ — команда и ИИ-отчёт</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div></div>
      <div class="card" onclick="show('agg')" style="cursor:pointer;margin-top:4px"><div class="row spread"><div class="t" style="font-weight:600"><i class="ti ti-chart-bar" style="color:var(--red);margin-right:8px"></i>Агрегатор — выручка и маржа</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div></div>
      ${hsHomeCard()}
      ${tkHomeCard()}` : ""}
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
        ${agenda.length ? agenda.map((a, i) => `<div class="li"><span class="chk" onclick="agendaDone(${i})" title="Выполнено"><span style="font-size:14px;font-weight:800">✓</span></span><span class="tcell">${a.time}</span><span class="t" style="font-weight:500">${esc(a.text)}</span></div>`).join("") : `<div class="lbl" style="padding:12px 0">На сегодня по часам пусто</div>`}
      </div>
      ${dls.length ? `<div class="sec-title">Горящие дедлайны</div>
      <div class="card" style="padding:4px 16px">${dls.slice(0, 6).map((d) => `<div class="li" style="cursor:pointer" onclick="openDeadline(${d.i})"><span class="tcell" style="color:${d.days != null && d.days <= 7 ? "var(--red)" : d.days != null && d.days <= 21 ? "var(--amber)" : "var(--muted)"}">${d.days == null ? "—" : d.days + "д"}</span><span class="t" style="font-weight:500">${esc(d.text)}<div class="m">${d.date || ""} · нажми, чтобы изменить</div></span><i class="ti ti-pencil" style="color:#ccc"></i></div>`).join("")}</div>` : ""}
    `;
  },

  async day() {
    const dd = await API.day(curDay);
    window.__dayItems = dd.items || [];
    window.__dayDone = dd.done || [];
    const mk = await API.month(viewYM);
    const marks = new Set(mk.dates || []);
    const status = mk.status || {};
    const ic = (k) => k === "rem" ? "ti-bell" : "ti-clock";
    const [Y, M] = viewYM.split("-").map(Number);
    const startW = (new Date(Y, M - 1, 1).getDay() + 6) % 7;
    const dim = new Date(Y, M, 0).getDate();
    const today = new Date().toISOString().slice(0, 10);
    let cells = "";
    for (let i = 0; i < startW; i++) cells += "<div></div>";
    for (let d = 1; d <= dim; d++) {
      const iso = `${Y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const st = status[iso], past = iso < today;
      let numSty = "", dotSty = "";
      if (past && st === "done") { numSty = "color:#1F9D55!important;font-weight:800"; dotSty = "background:#1F9D55!important"; }
      else if (past && st === "pending") { numSty = "color:#C0392B!important;font-weight:800"; dotSty = "background:#C0392B!important"; }
      if (iso === curDay) { numSty = "color:#fff!important;font-weight:800"; dotSty = "background:#fff!important"; }  // выбранный день — красный фон, белые цифры
      cells += `<button class="cal-d${iso === curDay ? " sel" : ""}${iso === today ? " tod" : ""}" onclick="pickDay('${iso}')"><span style="${numSty}">${d}</span>${marks.has(iso) ? `<span class="cal-dot" style="${dotSty}"></span>` : ''}</button>`;
    }
    el("s-day").innerHTML = `
      <div class="row spread" style="margin:8px 0 10px">
        <button class="mbtn" onclick="shiftMonth(-1)" aria-label="Пред. месяц" style="font-size:22px;line-height:1">‹</button>
        <div style="font-size:17px;font-weight:700">${MONTHS[M - 1]} ${Y}</div>
        <button class="mbtn" onclick="shiftMonth(1)" aria-label="След. месяц" style="font-size:22px;line-height:1">›</button>
      </div>
      <div class="cal-h">${["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map((w) => `<div>${w}</div>`).join("")}</div>
      <div class="cal">${cells}</div>
      <div class="lbl" style="padding:6px 2px 0"><span style="color:#1F9D55">■</span> всё сделано &nbsp; <span style="color:#C0392B">■</span> остались невыполненные — нажми на день, чтобы перенести</div>
      <div class="row spread" style="margin:16px 0 8px"><div style="font-weight:600">${dayLabel(curDay)}</div><button onclick="openCreate({type:'block', date: curDay})" style="background:none;border:none;color:var(--red);font-weight:600;cursor:pointer">＋ в сетку</button></div>
      <div class="card" style="padding:6px 16px">
        ${dd.items && dd.items.length ? dd.items.map((it, i) => `<div class="li"><span class="chk" onclick="dayItemDone(${i})" title="Выполнено"><span style="font-size:14px;font-weight:800">✓</span></span><span class="tcell">${it.start}</span><span class="t" style="font-weight:500;cursor:pointer" onclick="editItem(${i})">${esc(it.text)}${it.end ? ` <span class="lbl">до ${it.end}</span>` : ""}${it.recurring ? ` <span class="lbl" style="color:var(--red)" title="Повтор">🔁 ${esc(it.repeat_label || '')}</span>` : ""}</span><span style="color:#bbb;cursor:pointer;font-size:15px" onclick="editItem(${i})">✎</span></div>`).join("") : `<div class="lbl" style="padding:16px 0">На этот день пусто</div>`}
      </div>
      ${dd.free && dd.free.length ? `<div class="lbl" style="padding:2px 4px 14px">🟢 Свободно: ${dd.free.join(", ")}</div>` : ""}
      ${dd.done && dd.done.length ? `<div class="sec-title" style="margin-top:10px">✓ Выполнено в этот день (${dd.done.length})</div>
      <div class="card" style="padding:4px 16px">${dd.done.map((it, i) => `<div class="li"><span class="chk done"><span style="font-size:14px;font-weight:800">✓</span></span><span class="tcell">${it.start}</span><span class="t done-txt">${esc(it.text)}${it.recurring ? " 🔁" : ""}</span><button onclick="itemUndone(${i})" title="Вернуть в работу" style="border:1px solid var(--line);background:var(--card);border-radius:10px;padding:6px 10px;color:var(--red);cursor:pointer;font-size:15px">↩</button></div>`).join("")}</div>
      <div class="lbl" style="padding:4px 4px 0">↩ вернуть в работу — снять отметку и снова редактировать</div>` : ""}`;
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
          <span class="chk done"><span style="font-size:14px;font-weight:800">✓</span></span>
          <div class="t"><div class="done-txt">${esc(t.text)}</div></div>
          <button onclick="reopenTask('${t.id}')" title="Повторить на дату" style="border:1px solid var(--line);background:var(--card);border-radius:10px;padding:6px 9px;color:var(--red);cursor:pointer"><i class="ti ti-rotate-clockwise"></i></button>
        </div>` : `
        <div class="li">
          <span class="chk" onclick="closeTask('${t.id}')"><span style="font-size:14px;font-weight:800">✓</span></span>
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
        <div class="li" onclick="openNotifSettings()"><i class="ti ti-settings" style="font-size:20px;color:var(--red)"></i><div class="t">Настройка уведомлений</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
        ${admin ? `<div class="li" onclick="openLoginAudit()"><i class="ti ti-shield-lock" style="font-size:20px;color:var(--red)"></i><div class="t">Журнал входов</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
        ${admin ? `<div class="li" onclick="openDbStatus()"><i class="ti ti-database" style="font-size:20px;color:var(--red)"></i><div class="t">Состояние БД</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
        <div class="li" onclick="show('journal')"><i class="ti ti-notebook" style="font-size:20px;color:var(--red)"></i><div class="t">Дневник / заметки</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
        <div class="li" onclick="testPush()"><i class="ti ti-send" style="font-size:20px;color:var(--red)"></i><div class="t">Прислать тестовый пуш</div></div>
        ${admin ? `<div class="li" onclick="dedupTasks()"><i class="ti ti-eraser" style="font-size:20px;color:var(--red)"></i><div class="t">Почистить дубли задач</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
        ${admin ? `<div class="li"><i class="ti ti-users" style="font-size:20px;color:var(--red)"></i><div class="t">Роли и доступ</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
        <div class="li" onclick="show('habits')"><i class="ti ti-flame" style="font-size:20px;color:var(--red)"></i><div class="t">Привычки и шаги</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
        <div class="li" onclick="show('goals')"><i class="ti ti-target-arrow" style="font-size:20px;color:var(--red)"></i><div class="t">Цели и прогресс</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
        <div class="li" onclick="show('week')"><i class="ti ti-calendar-week" style="font-size:20px;color:var(--red)"></i><div class="t">План недели</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
        ${admin ? `<div class="li" onclick="show('assist')"><i class="ti ti-sparkles" style="font-size:20px;color:var(--red)"></i><div class="t">ИИ-помощник</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
        ${admin ? `<div class="li" onclick="show('content')"><i class="ti ti-movie" style="font-size:20px;color:var(--red)"></i><div class="t">Контент · ИИ-редакция</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
        ${admin ? `<div class="li" onclick="show('track')"><i class="ti ti-trophy" style="font-size:20px;color:var(--red)"></i><div class="t">Трекер привычек</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
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
  const r = await API.taskDone(t.id, t.text);
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
      <div id="crepeat-wrap" style="margin-top:10px;display:none">
        <div class="lbl" style="margin-bottom:4px">🔁 Повтор (необязательно)</div>
        <input id="crepeat" placeholder="напр.: 2н · 3м · 10д · даты: 2026-07-15, 2026-10-15" value="${(pre.repeat || '').replace(/"/g, '&quot;')}">
        <div class="lbl" style="margin-top:4px">Пусто = один раз. <b>Nд / Nн / Nм</b> = каждые N дней / недель / месяцев (2н, 3м…). <b>даты:</b> список через запятую.</div>
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
  const cr = el("crepeat-wrap"); if (cr) cr.style.display = (t === "block") ? "block" : "none";
  const cd = el("cdue-wrap"); if (cd) cd.style.display = (t === "task") ? "block" : "none";
}
/* парсинг строки повтора → {every,unit} | {dates:[...]} | null */
function normDate(x) {
  x = (x || "").trim(); let m = x.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return x;
  m = x.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}
function parseRepeat(s) {
  s = (s || "").trim().toLowerCase(); if (!s) return null;
  if (s.startsWith("дат") || s.includes(":")) {
    const part = s.split(":")[1] || s.replace(/^дат\w*/, "");
    const ds = part.split(/[,;\s]+/).map(normDate).filter(Boolean);
    return ds.length ? { dates: ds } : null;
  }
  const m = s.match(/^(\d+)\s*([а-яa-z]*)/); if (!m) return null;
  const n = parseInt(m[1], 10) || 1; const u = (m[2] || "д")[0];
  const unit = (u === "н" || u === "w") ? "week" : (u === "м" || u === "m") ? "month" : "day";
  return { every: n, unit };
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
  else { const rep = parseRepeat(el("crepeat") ? el("crepeat").value : ""); r = await API.addBlock(el("cdate").value, el("ctime").value, el("cend").value, text, rep); }
  closeCreate();
  toast(r && r.ok !== false ? "Добавлено ✓" : "Не удалось");
  const a = document.querySelector("#nav button.on"); const s = a ? a.dataset.s : "home";
  if (RENDER[s]) RENDER[s]();
}
function logout() { try { API.logout(); } catch (e) {} profile = null; el("app").classList.add("hidden"); el("login").classList.remove("hidden"); }
/* сессия истекла (сервер вернул 401) → на экран входа */
function onAuthExpired() { if (!profile) return; profile = null; try { el("app").classList.add("hidden"); el("login").classList.remove("hidden"); toast("Сессия истекла — войдите заново"); } catch (e) {} }
/* авто-вход по действующей cookie-сессии */
async function bootAuth() { try { const r = await API.authMe(); if (r && r.ok && r.profile) { profile = r.profile; enterApp(); } } catch (e) {} }
bootAuth();

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
  const r = await API.taskEdit(t.id, t.text, nw, due);
  closeCreate(); toast(r && r.ok !== false ? "Изменено ✓" : "Не удалось"); RENDER.tasks();
}
function closeTask2(id) { closeCreate(); closeTask(id); }

/* ---- редактирование элемента сетки (перенос/удаление) ---- */
function editItem(idx) {
  const it = (window.__dayItems || [])[idx];
  if (!it) return;
  const rec = it.recurring;
  el("create").innerHTML = `
    <div class="sheet">
      <h3>Изменить${rec ? " · 🔁 повтор" : ""}</h3>
      ${rec ? `<div class="lbl" style="margin-bottom:6px">Повтор: ${esc(it.repeat_label || '')}. Изменения времени и текста применятся ко всей серии.</div>` : ""}
      <input id="etext" value="${esc(it.text).replace(/"/g, '&quot;')}" style="margin-bottom:8px">
      <div style="display:flex;gap:8px">
        <input type="date" id="edate" value="${curDay}" style="flex:1"${rec ? " disabled" : ""}>
        <input type="time" id="estart" value="${it.start}" style="width:108px">
        ${it.kind === "block" ? `<input type="time" id="eend" value="${it.end || ''}" style="width:108px">` : ""}
      </div>
      <button class="btn red" style="margin-top:14px" onclick="saveEdit(${idx})">Сохранить</button>
      <button class="btn ghost" style="margin-top:8px" onclick="closeCreate();dayItemDone(${idx})">Выполнено</button>
      ${rec
      ? `<button class="btn ghost" style="margin-top:8px;color:#c0392b;border-color:#e3b3b3" onclick="deleteItem(${idx},'one')">Убрать только этот день</button>
         <button class="btn ghost" style="margin-top:8px;color:#c0392b;border-color:#e3b3b3" onclick="deleteItem(${idx},'series')">Удалить всю серию</button>`
      : `<button class="btn ghost" style="margin-top:8px;color:#c0392b;border-color:#e3b3b3" onclick="deleteItem(${idx})">Удалить</button>`}
      <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button>
    </div>`;
  el("create").classList.remove("hidden");
}
async function saveEdit(idx) {
  const it = (window.__dayItems || [])[idx]; if (!it) return;
  const newText = ((el("etext") && el("etext").value) || it.text).trim() || it.text;
  const ns = el("estart").value;
  const ne = (it.kind === "block" && el("eend")) ? el("eend").value : "";
  toast("Сохраняю…");
  let r;
  if (it.recurring) {                              // повтор → правим серию на месте
    r = await API.itemEdit({ kind: it.kind, date: curDay, start: it.start, text: it.text,
      new_text: newText, new_start: ns, new_end: ne });
  } else {
    const nd = el("edate").value;
    if (newText !== it.text) {                     // текст изменился → пересоздать
      await API.itemDelete({ kind: it.kind, date: curDay, start: it.start, text: it.text });
      r = it.kind === "block" ? await API.addBlock(nd, ns, ne, newText) : await API.addReminder(nd, ns, newText);
    } else {
      r = await API.itemMove({ kind: it.kind, date: curDay, start: it.start, text: it.text,
        new_date: nd, new_start: ns, new_end: ne });
    }
  }
  closeCreate(); toast(r && r.ok !== false ? "Сохранено ✓" : "Не удалось"); RENDER.day();
}
async function deleteItem(idx, scope) {
  const it = (window.__dayItems || [])[idx]; if (!it) return;
  toast("Удаляю…");
  const r = await API.itemDelete({ kind: it.kind, date: curDay, start: it.start, text: it.text, scope: scope || "one" });
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

/* ---- Контент · ИИ-редакция (v1: агент «Аналитик») ---- */
RENDER.content = async function () {
  const back = `<div class="link" onclick="show('home')" style="margin:8px 0;cursor:pointer">‹ На главную</div>`;
  el("s-content").innerHTML = `${back}<h1 class="h">Контент · ИИ-редакция</h1>
    <div class="card">
      <div class="lbl" style="margin-bottom:8px">Вставь ссылку на ролик конкурента и/или короткое описание — аналитик разберёт вирусность, предложит перенос механики на ваши направления и проверит по ст.24.</div>
      <input id="cnt-url" placeholder="Ссылка на ролик (VK / OK / др.)" style="width:100%;margin-bottom:8px">
      <textarea id="cnt-note" placeholder="Описание: о чём ролик, что цепляет (по желанию)" style="width:100%;min-height:70px;margin-bottom:8px"></textarea>
      <button class="btn red" onclick="cntAnalyze()">Анализировать</button>
    </div>
    <div id="cnt-list"><div class="lbl" style="padding:8px 2px">Загружаю идеи…</div></div>`;
  cntLoadList();
};

async function cntLoadList() {
  const r = await API.contentIdeas().catch(() => ({}));
  const ideas = (r && r.ideas) || [];
  const box = el("cnt-list"); if (!box) return;
  box.innerHTML = ideas.length ? ideas.map(cntCard).join("")
    : `<div class="lbl" style="padding:8px 2px">Пока пусто. Разбери первый ролик выше ↑</div>`;
}

function cntCard(c) {
  const cm = c.compliance || {};
  const ok = cm.art24_ok !== false;
  const badge = ok
    ? `<span style="color:#1a9e5f;font-weight:600">✓ ст.24 ок</span>`
    : `<span style="color:var(--red);font-weight:600">⚠ ст.24: ${esc((cm.flags || []).join("; "))}</span>`;
  const erid = cm.needs_erid
    ? `<span style="color:#c47f00"> · реклама → нужен erid</span>`
    : `<span style="color:#888"> · органика</span>`;
  const app = (c.applicability || []).map(a => `<div style="margin:2px 0">• <b>${esc(a.direction)}:</b> ${esc(a.idea)}</div>`).join("");
  const src = c.source && c.source.url ? ` · <a href="${esc(c.source.url)}" target="_blank" rel="noopener">источник</a>` : "";
  return `<div class="card">
    <div style="font-weight:700;margin-bottom:2px">${esc(c.theme || "—")}</div>
    <div class="lbl" style="margin-bottom:6px">${badge}${erid} · ${esc(c.verdict || "")}</div>
    <div style="font-size:14px"><b>Хук:</b> ${esc(c.hook || "")}</div>
    <div style="font-size:14px"><b>Структура:</b> ${esc(c.structure || "")}</div>
    ${c.why_viral ? `<div style="font-size:14px"><b>Почему зашло:</b> ${esc(c.why_viral)}</div>` : ""}
    ${app ? `<div style="font-size:14px;margin-top:6px"><b>Перенос на направления:</b>${app}</div>` : ""}
    ${!ok ? `<div class="lbl" style="margin-top:6px;color:var(--red)">Дисклеймер: ${esc(cm.disclaimer || "Имеются противопоказания, необходима консультация специалиста")}</div>` : ""}
    <div class="lbl" style="margin-top:6px">${esc(c.created || "")}${src}</div>
    <div class="link" style="margin-top:6px;color:var(--red);cursor:pointer" onclick="cntDel('${esc(c.id)}')">Удалить</div>
  </div>`;
}

async function cntAnalyze() {
  const url = (el("cnt-url").value || "").trim();
  const note = (el("cnt-note").value || "").trim();
  if (!url && !note) { toast("Дай ссылку или описание"); return; }
  toast("Анализирую… (10–20 сек)");
  const r = await API.contentAnalyze(url, note, "").catch(() => ({}));
  if (!r || r.ok === false) { toast((r && r.error) || "Не удалось"); return; }
  el("cnt-url").value = ""; el("cnt-note").value = "";
  toast("Готово ✓"); cntLoadList();
}

async function cntDel(id) {
  const r = await API.contentDel(id).catch(() => ({}));
  toast(r && r.ok !== false ? "Удалено ✓" : "Не удалось"); cntLoadList();
}
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
async function itemUndone(i) {
  const it = (window.__dayDone || [])[i]; if (!it) return;
  toast("Возвращаю…");
  const r = await API.itemUndone({ kind: it.kind, date: curDay, start: it.start, text: it.text });
  toast(r && r.ok !== false ? "Возвращено в работу ✓" : "Не удалось"); RENDER.day();
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
    <div class="card"><div class="lbl">Чистая прибыль группы за месяц</div><div class="big">${nf(d.total)} ₽</div>
      <div class="lbl">Твой доход (с учётом долей): <b style="color:var(--ink)">${nf(d.owner_income)} ₽</b> из цели ${nf(d.goal || 5000000)} · ${d.goal ? Math.min(100, Math.round(d.owner_income / d.goal * 100)) : 0}%</div>
      <div class="lbl">До цели: <b style="color:var(--red)">${nf(Math.max(0, (d.goal || 5000000) - d.owner_income))} ₽</b></div></div>
    <div class="card" style="padding:6px 16px">${(d.rows || []).map((r) => `<div class="li"><div class="t"><div style="font-weight:700">${esc(r.name)}${r.share && r.share !== 1 ? ` <span class="lbl" style="font-weight:400">· доля ${Math.round(r.share * 100)}%</span>` : ""}</div><div class="m">${r.net == null ? "нет данных за месяц" : `доход ${nf(r.income)} − расход ${nf(r.expense)} ${dlt(r.net, r.prev_net)}`}</div></div><div style="font-weight:800">${r.net == null ? "—" : nf(r.net)}</div></div>`).join("") || '<div class="lbl" style="padding:10px 0">Направлений нет</div>'}</div>
    ${d.agg_total ? `<div class="lbl" style="padding:6px 2px">🧾 Маржа агрегатора за месяц (справочно): <b>${nf(d.agg_total)} ₽</b> — валовая, без офиса/ЗП. В форме можно подставить её как доход направления «Агрегатор».</div>` : ""}
    <button class="btn red" onclick="openGroupForm()">Внести доход/расход за ${ymLabel(d.ym)}</button>
    <button class="btn ghost" style="margin-top:8px" onclick="scanFinance()"><i class="ti ti-camera" style="margin-right:6px"></i>Распознать отчёт фото/PDF</button>
    <button class="btn ghost" style="margin-top:8px" onclick="uploadReport()">📥 Загрузить Excel‑отчёт (агрегатор / доход‑расход)</button>
    ${(d.trend && d.trend.length > 1) ? `<div class="sec-title" style="margin-top:16px">Динамика чистой прибыли</div><div class="card" style="padding:6px 16px">${d.trend.map((t) => `<div class="li"><span class="t">${ymLabel(t.ym)}</span><span style="font-weight:700">${nf(t.total)} ₽</span></div>`).join("")}</div>` : ""}
    <div class="lbl" style="padding:8px 2px">Прибыль = доход − ВСЕ расходы (офис, ЗП, налоги). Маржа агрегатора — валовая, идёт в доход направления «Агрегатор», из неё вычитаешь его расходы.</div>`;
};
function groupShift(n) {
  const cur = (window.__group && window.__group.ym) || new Date().toISOString().slice(0, 7);
  let y = parseInt(cur.slice(0, 4)), m = parseInt(cur.slice(5, 7)) + n;
  if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  groupYM = `${y}-${String(m).padStart(2, "0")}`; RENDER.group();
}
function openGroupForm() {
  const d = window.__group || { rows: [], ym: groupYM };
  const nf = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n || 0));
  el("create").innerHTML = `
    <div class="sheet" style="max-height:85vh;overflow:auto">
      <h3>Доход/расход за ${d.ym}</h3>
      <div class="lbl" style="margin-bottom:8px">По направлению: доход и расход (₽), доля (%). Чистая = доход − расход.</div>
      <div id="gform">${(d.rows || []).map((r, i) => `<div style="margin-bottom:10px;border-bottom:1px solid var(--line,#eee);padding-bottom:8px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${esc(r.name)}${r.agg_suggest != null ? ` <span class="link" style="font-weight:600;cursor:pointer" onclick="gpSuggest(${i},${r.agg_suggest})">маржа агрегатора ${nf(r.agg_suggest)} →</span>` : ""}</div>
        <div style="display:flex;gap:8px">
          <input id="gi${i}" type="number" inputmode="numeric" placeholder="доход" value="${r.income == null ? "" : r.income}" style="flex:1">
          <input id="ge${i}" type="number" inputmode="numeric" placeholder="расход" value="${r.expense == null ? "" : r.expense}" style="flex:1">
          <input id="gs${i}" type="number" inputmode="numeric" placeholder="%" value="${Math.round((r.share == null ? 1 : r.share) * 100)}" style="width:52px">
        </div></div>`).join("")}</div>
      <button class="btn red" style="margin-top:8px" onclick="saveGroupForm()">Сохранить</button>
      <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button>
    </div>`;
  el("create").classList.remove("hidden");
}
function gpSuggest(i, val) { const inp = el("gi" + i); if (inp) inp.value = val; }
/* ---- загрузка Excel-отчёта с пометкой типа ---- */
function uploadReport() {
  el("create").innerHTML = `<div class="sheet"><h3>Загрузить отчёт (Excel)</h3>
    <div class="lbl" style="margin-bottom:10px">Выбери тип — приложение разберёт файл и разложит куда надо.</div>
    <button class="btn red" onclick="_pickReport('agg')">🧾 Агрегатор — маржа</button>
    <div class="lbl" style="margin:4px 2px 10px">За вчерашний день; попадёт в «Агрегатор — маржа».</div>
    <button class="btn red" onclick="_pickReport('finance')">📊 Доход / расход месяца</button>
    <div class="lbl" style="margin:4px 2px 10px">ИИ распознает доход и расход по направлениям → проверишь и сохранишь.</div>
    <button class="btn ghost" onclick="closeCreate()">Отмена</button></div>`;
  el("create").classList.remove("hidden");
}
function _pickReport(kind) {
  _pickFile(async (f) => {
    el("create").innerHTML = `<div class="sheet"><h3>Разбираю отчёт…</h3><div class="lbl">Секунду.</div></div>`;
    el("create").classList.remove("hidden");
    const b64 = await _toB64(f);
    const r = await API.reportUpload({ kind, filename: f.name || "", data_b64: b64 });
    if (!(r && r.ok !== false)) { closeCreate(); toast("Не вышло" + (r && r.error ? ": " + r.error : "")); return; }
    const nf = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n || 0));
    if (kind === "agg") {
      closeCreate();
      toast(`Агрегатор за ${r.date}: маржа ${nf(r.margin)} ₽ ✓`);
      if (RENDER.agg) { aggYM = (r.date || "").slice(0, 7); aggMode = "month"; RENDER.agg(); }
    } else {
      groupYM = r.ym;
      await RENDER.group();
      openGroupForm();
      (r.rows || []).forEach((pr) => {
        const key = (pr.name || "").toLowerCase().slice(0, 5);
        const idx = ((window.__group && window.__group.rows) || []).findIndex((rr) => rr.name.toLowerCase().includes(key) || (pr.name || "").toLowerCase().includes(rr.name.toLowerCase().slice(0, 5)));
        if (idx >= 0) { if (el("gi" + idx)) el("gi" + idx).value = pr.income || 0; if (el("ge" + idx)) el("ge" + idx).value = pr.expense || 0; }
      });
      toast("Распознал — проверь доход/расход и сохрани");
    }
  }, ".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
async function saveGroupForm() {
  const d = window.__group || { rows: [] };
  const rows = (d.rows || []).map((r, i) => {
    const inc = el("gi" + i) ? el("gi" + i).value : "";
    const exp = el("ge" + i) ? el("ge" + i).value : "";
    const s = el("gs" + i) ? el("gs" + i).value : "";
    return { name: r.name, income: inc === "" ? null : Number(inc), expense: exp === "" ? null : Number(exp), share: s === "" ? 1 : Number(s) / 100 };
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
      if (idx >= 0 && pr.profit != null && el("gi" + idx)) el("gi" + idx).value = pr.profit;   // распознанное → в «доход»
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
  const be = r.breakeven || {}; window.__aggBE = be;
  const beCard = `<div class="card">
    <div class="lbl">🎯 Путь к безубыточности → прибыли (месяц)</div>
    ${be.fixed ? `
      <div class="row spread" style="margin-top:4px"><span class="lbl">Постоянные расходы</span><span style="font-weight:700">${fmt(be.fixed)} ₽</span></div>
      <div class="row spread"><span class="lbl">Маржа накоплена</span><span style="font-weight:700">${fmt(be.month_margin)} ₽</span></div>
      <div style="height:10px;background:#eee;border-radius:6px;overflow:hidden;margin:8px 0"><div style="height:100%;width:${Math.min(100, be.pct || 0)}%;background:${be.reached ? "#1F9D55" : "var(--red)"}"></div></div>
      ${be.reached
        ? `<div style="font-weight:800;color:#1F9D55">✅ Безубыточность пройдена · прибыль ${fmt(be.profit)} ₽</div>`
        : `<div style="font-weight:800;color:var(--red)">До безубыточности: ${fmt(be.to_breakeven)} ₽ (${be.pct}%)</div>`}
      <div class="lbl" style="margin-top:6px">Прогноз на конец месяца (${be.days_data}/${be.days_month} дн.): маржа ~${fmt(be.projected)} ₽ → ${be.projected_profit >= 0 ? "прибыль" : "недобор"} ${fmt(Math.abs(be.projected_profit))} ₽</div>
      <button class="btn ghost" style="margin-top:8px" onclick="aggSetFixed()">Изменить постоянные расходы</button>`
      : `<div class="lbl" style="margin-top:4px">Задай месячные постоянные расходы (аренда, ЗП, налоги) — покажу, сколько маржи осталось до безубыточности и сколько сверх — прибыль.</div><button class="btn red" style="margin-top:8px" onclick="aggSetFixed()">Задать постоянные расходы</button>`}
  </div>`;
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
  el("s-agg").innerHTML = `${back}<h1 class="h">Агрегатор · маржа</h1>${seg}${nav}${dayChips}${totCard}${beCard}${body}<div class="card"><button class="btn ghost" onclick="aggBackfill()">🔄 Перепроверить месяц</button><div class="lbl" style="margin-top:6px">Пересканирует письма с отчётами и восстановит цифры по всем дням (пропущенные добавит, изменённые обновит).</div></div><div class="lbl" style="padding:10px 2px 20px">Данные заносит агент из ежедневного отчёта на почте. Маржа = выручка − себестоимость. Постоянные расходы вычитаются только для «пути к прибыли» — сама маржа остаётся валовой.</div>`;
};
async function aggBackfill() {
  toast("Перепроверяю письма… это до минуты");
  const r = await API.financeBackfill().catch(() => ({}));
  if (!r || r.ok === false) { toast((r && r.error) || "Не удалось"); return; }
  const changed = (r.detail || []).filter((x) => x.status === "добавлено" || x.status === "обновлено");
  toast(`Проверено дат: ${r.dates_found}. Обновлено: ${r.written}`);
  RENDER.agg();
}
function aggSetFixed() {
  const cur = (window.__aggBE && window.__aggBE.fixed) || "";
  const v = prompt("Месячные постоянные расходы, ₽ (аренда, ЗП, налоги и пр.):", cur || "");
  if (v == null) return;
  const amount = Number(String(v).replace(/[^\d.]/g, ""));
  if (!(amount >= 0)) { toast("Введите число"); return; }
  toast("Сохраняю…");
  API.aggFixedSet(amount, aggYM, "default").then((r) => { toast(r && r.ok !== false ? "Сохранено ✓" : "Не удалось"); RENDER.agg(); });
}
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
        <span class="chk ${x.done_today ? "done" : ""}" onclick="markHabit(${i})" title="Отметить сегодня"><span style="font-size:14px;font-weight:800">✓</span></span>
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
/* ---- центр уведомлений: настройка каналов ---- */
const NOTIF_CH = [
  { k: "morning", label: "☀️ Утренний бриф", days: 0 },
  { k: "evening", label: "🌙 Вечерний отчёт", days: 0 },
  { k: "deadlines", label: "⏳ Дедлайны", days: "за сколько дней" },
  { k: "tasks_overdue", label: "🔴 Просроченные задачи", days: 0 },
  { k: "agenda_day", label: "🗓 План на день", days: 0 },
  { k: "health", label: "🩺 Чек-апы и анализы", days: "за сколько дней" },
  { k: "aggregator", label: "📉 Агрегатор не обновился", days: 0 },
];
async function openNotifSettings() {
  el("create").innerHTML = `<div class="sheet"><h3>Уведомления</h3><div class="lbl">Загружаю настройки…</div></div>`;
  el("create").classList.remove("hidden");
  const r = await API.notifGet();
  const st = (r && r.settings) || {};
  const row = (c) => { const cfg = st[c.k] || {}; return `<div class="card" style="padding:8px 12px;margin-bottom:6px">
      <label style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b>${c.label}</b>
        <input type="checkbox" id="nf_on_${c.k}" ${cfg.on !== false ? "checked" : ""}></label>
      <div style="display:flex;gap:8px;margin-top:6px;align-items:center">
        <span class="lbl">Время</span><input type="time" id="nf_t_${c.k}" value="${cfg.time || "09:00"}" style="width:120px">
        ${c.days ? `<span class="lbl">${c.days}</span><input type="number" id="nf_d_${c.k}" value="${cfg.days != null ? cfg.days : (c.k === "health" ? 7 : 3)}" style="width:64px">` : ""}
      </div></div>`; };
  el("create").innerHTML = `<div class="sheet" style="max-height:85vh;overflow:auto"><h3>Уведомления</h3>
    <div class="card" style="padding:8px 12px;margin-bottom:8px"><label style="display:flex;align-items:center;justify-content:space-between"><b>Все уведомления</b><input type="checkbox" id="nf_master" ${st.master !== false ? "checked" : ""}></label><div class="lbl" style="margin-top:4px">Главный выключатель. Ниже — по каждому направлению отдельно, со своим временем (МСК).</div></div>
    ${NOTIF_CH.map(row).join("")}
    <button class="btn red" style="margin-top:10px" onclick="saveNotifSettings()">Сохранить</button>
    <button class="btn ghost" style="margin-top:8px" onclick="testPush()">Прислать тестовый пуш</button>
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Закрыть</button>
    <div class="lbl" style="padding:8px 2px 0">Чтобы пуши приходили: включи «Уведомления» выше в «Ещё», и на сервере должен быть задан ключ VAPID. Здоровье и чек-апы пушатся по датам, которые ты задаёшь в разделе «Здоровье».</div></div>`;
}
async function saveNotifSettings() {
  const st = { master: el("nf_master").checked };
  NOTIF_CH.forEach((c) => {
    const o = { on: el("nf_on_" + c.k).checked, time: el("nf_t_" + c.k).value || "09:00" };
    if (c.days) o.days = Number(el("nf_d_" + c.k).value) || (c.k === "health" ? 7 : 3);
    st[c.k] = o;
  });
  toast("Сохраняю…");
  const r = await API.notifSave(st);
  closeCreate(); toast(r && r.ok !== false ? "Настройки сохранены ✓" : "Не удалось");
}
async function openLoginAudit() {
  el("create").innerHTML = `<div class="sheet"><h3>Журнал входов</h3><div class="lbl">Загружаю…</div></div>`;
  el("create").classList.remove("hidden");
  const r = await API.auditLogins("");
  if (!(r && r.ok)) { closeCreate(); toast("Не удалось загрузить"); return; }
  const rows = (r.logins || []).map((x) => `<div class="li"><div class="t"><div style="font-weight:600">${x.ok ? "✅ вход" : "⛔ отказ"}${x.uid ? " · " + esc(x.uid) : ""}</div><div class="m">${esc((x.ts || "").replace("T", " ").slice(0, 16))} · ${esc(x.ip || "")}</div></div></div>`).join("");
  el("create").innerHTML = `<div class="sheet" style="max-height:82vh;overflow:auto"><h3>Журнал входов · ${esc(r.ym || "")}</h3>
    <div class="card" style="padding:4px 16px">${rows || '<div class="lbl">Записей нет</div>'}</div>
    <div class="lbl" style="padding:8px 2px 0">Последние входы и отказы (успех / неверный PIN / блокировка), с IP и временем.</div>
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Закрыть</button></div>`;
}
async function openDbStatus() {
  el("create").innerHTML = `<div class="sheet"><h3>Состояние БД</h3><div class="lbl">Проверяю…</div></div>`;
  el("create").classList.remove("hidden");
  const r = await API.dbStatus();
  let body;
  if (!r || r.connected === false) {
    body = `<div class="card"><div class="t">Postgres не подключён</div><div class="lbl" style="margin-top:4px">${esc((r && (r.reason || r.error)) || "нет ответа")}</div><div class="lbl" style="margin-top:6px">Приложение работает на GitHub-хранилище. Чтобы включить БД — добавь сервис Postgres на Railway (он задаст DATABASE_URL) и передеплой.</div></div>`;
  } else {
    const t = r.tables || {};
    const rows = Object.keys(t).sort().map((k) => `<div class="li"><div class="t">${esc(k)}</div><span class="lbl">${t[k] == null ? "—" : t[k]}</span></div>`).join("");
    body = `<div class="card"><div class="t" style="color:#1F9D55;font-weight:700">✅ Postgres подключён</div><div class="lbl" style="margin-top:2px">Таблиц: ${r.count || 0}</div></div><div class="sec-title" style="margin-top:10px">Таблицы (строк)</div><div class="card" style="padding:4px 16px">${rows || '<div class="lbl">пусто</div>'}</div>`;
  }
  el("create").innerHTML = `<div class="sheet" style="max-height:82vh;overflow:auto"><h3>Состояние БД</h3>${body}<div class="lbl" style="padding:8px 2px 0">Фаза 0: схема создана, данные пока в GitHub — переносим по одному домену.</div><button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Закрыть</button></div>`;
}
/* ---- синк графика чекапов на сервер для пуш-напоминаний (только название+дата) ---- */
function hsSyncCheckups() {
  try {
    const H = hsLoad();
    const items = (H.reminders || []).filter((r) => r.status === "active" && r.nextDate).map((r) => ({ title: r.title, nextDate: r.nextDate }));
    API.healthCheckups(items);
  } catch (e) {}
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

el("addBtn").onclick = () => openCreate();
el("create").onclick = (e) => { if (e.target.id === "create") closeCreate(); };
{ const _lb = el("logoutBtn"); if (_lb) _lb.onclick = logout; }

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
function hsSave(d) { try { localStorage.setItem(HS_KEY, JSON.stringify(d)); } catch (e) {} if (window.HS_REMOTE) { try { API.stateSet("health", d); } catch (e) {} } }
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
/* ---- полноценный график по показателю (SVG, без внешних библиотек) ---- */
function _hsChartSVG(rowsAsc, ref) {
  const W = 320, H = 190, pl = 40, pr = 12, pt = 14, pb = 26;
  const iw = W - pl - pr, ih = H - pt - pb;
  const vals = rowsAsc.map((r) => Number(r.value));
  const times = rowsAsc.map((r) => new Date(r.date + "T00:00:00").getTime());
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (ref.mn != null) vmin = Math.min(vmin, ref.mn);
  if (ref.mx != null) vmax = Math.max(vmax, ref.mx);
  if (vmin === vmax) { vmin -= 1; vmax += 1; }
  const padv = (vmax - vmin) * 0.12; vmin -= padv; vmax += padv;
  const tmin = Math.min(...times), tmax = Math.max(...times);
  const X = (t) => pl + (tmax === tmin ? iw / 2 : (t - tmin) / (tmax - tmin) * iw);
  const Y = (v) => pt + ih - (v - vmin) / (vmax - vmin) * ih;
  let band = "";
  if (ref.mn != null || ref.mx != null) {
    const yTop = ref.mx != null ? Y(ref.mx) : pt;
    const yBot = ref.mn != null ? Y(ref.mn) : pt + ih;
    band = `<rect x="${pl}" y="${yTop}" width="${iw}" height="${Math.max(0, yBot - yTop)}" fill="#1F9D55" opacity="0.10"/>`;
    if (ref.mx != null) band += `<line x1="${pl}" y1="${Y(ref.mx)}" x2="${pl + iw}" y2="${Y(ref.mx)}" stroke="#1F9D55" stroke-dasharray="3 3" opacity="0.55"/>`;
    if (ref.mn != null) band += `<line x1="${pl}" y1="${Y(ref.mn)}" x2="${pl + iw}" y2="${Y(ref.mn)}" stroke="#1F9D55" stroke-dasharray="3 3" opacity="0.55"/>`;
  }
  let grid = "";
  for (let i = 0; i <= 2; i++) { const v = vmin + (vmax - vmin) * i / 2, yy = Y(v); grid += `<line x1="${pl}" y1="${yy}" x2="${pl + iw}" y2="${yy}" stroke="#eee"/><text x="${pl - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="#999">${+v.toFixed(2)}</text>`; }
  const line = rowsAsc.length >= 2 ? `<polyline points="${rowsAsc.map((r, i) => `${X(times[i])},${Y(vals[i])}`).join(" ")}" fill="none" stroke="var(--red)" stroke-width="2"/>` : "";
  const dots = rowsAsc.map((r, i) => { const st = hsStatus(r); const col = (st === "выше" || st === "ниже") ? "var(--red)" : "#1F9D55"; const last = i === rowsAsc.length - 1; return `<circle cx="${X(times[i])}" cy="${Y(vals[i])}" r="${last ? 4.5 : 3}" fill="${col}" stroke="#fff" stroke-width="1.5"/>`; }).join("");
  let xl = `<text x="${X(tmin)}" y="${H - 8}" text-anchor="start" font-size="9" fill="#999">${hsFmtD(rowsAsc[0].date)}</text>`;
  if (rowsAsc.length > 1) xl += `<text x="${X(tmax)}" y="${H - 8}" text-anchor="end" font-size="9" fill="#999">${hsFmtD(rowsAsc[rowsAsc.length - 1].date)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${band}${grid}${line}${dots}${xl}</svg>`;
}
function hsOpenChart(marker) {
  const rowsDesc = hsLatest(marker), rowsAsc = rowsDesc.slice().reverse();
  if (!rowsAsc.length) { toast("Нет данных по показателю"); return; }
  const ref = hsRef(rowsAsc[rowsAsc.length - 1]);
  const last = rowsDesc[0], st = hsStatus(last);
  const col = (st === "выше" || st === "ниже") ? "var(--red)" : st === "в диапазоне" ? "#1F9D55" : "#9ca3af";
  const listRows = rowsDesc.slice(0, 14).map((r) => { const s = hsStatus(r); const c = (s === "выше" || s === "ниже") ? "var(--red)" : s === "в диапазоне" ? "#1F9D55" : "#9ca3af"; return `<div class="li"><div class="t"><div style="font-weight:500">${r.value} ${esc(r.unit || "")}</div><div class="m">${hsFmtD(r.date)}${r.testType ? " · " + esc(r.testType) : ""}</div></div><span class="badge" style="color:${c};border-color:${c}">${s}</span></div>`; }).join("");
  el("create").innerHTML = `<div class="sheet" style="max-height:85vh;overflow:auto">
    <h3>${esc(marker)}</h3>
    <div class="row spread"><span class="lbl">${esc(hsRefText(rowsAsc[rowsAsc.length - 1]))}</span><span class="lbl" style="font-weight:700;color:${col}">${last.value} ${esc(last.unit || "")} · ${st}</span></div>
    <div class="card" style="padding:8px 8px 2px;margin-top:8px">${_hsChartSVG(rowsAsc, ref)}<div class="lbl" style="text-align:center;padding:0 0 2px"><span style="color:#1F9D55">▬</span> зона нормы · <span style="color:var(--red)">●</span> вне нормы</div></div>
    ${rowsAsc.length < 2 ? '<div class="lbl" style="padding:4px 2px">Пока одно измерение — линия появится после второго.</div>' : ''}
    <div class="sec-title" style="margin-top:10px">Все измерения (${rowsDesc.length})</div>
    <div class="card" style="padding:4px 16px">${listRows}</div>
    <button class="btn ghost" style="margin-top:10px" onclick="closeCreate()">Закрыть</button></div>`;
  el("create").classList.remove("hidden");
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

  const fileList = H.files.length ? `<div class="card" style="padding:6px 16px">${H.files.slice().reverse().map((f) => `<div class="li"><i class="ti ti-file-text" style="color:var(--red)"></i><div class="t" style="cursor:pointer" onclick="hsOpenFile('${f.id}')"><div style="font-weight:500">${esc(f.name)}</div><div class="m">${hsFmtD(f.date)} · нажми, чтобы открыть</div></div><button onclick="hsOpenFile('${f.id}')" title="Открыть" style="border:1px solid var(--line);background:var(--card);border-radius:10px;padding:6px 9px;color:var(--red);cursor:pointer"><i class="ti ti-eye"></i></button><button onclick="hsDeleteFile('${f.id}')" title="Удалить" style="border:1px solid var(--line);background:var(--card);border-radius:10px;padding:6px 9px;color:#c0392b;cursor:pointer;margin-left:4px"><i class="ti ti-trash"></i></button></div>`).join("")}</div>` : "";

  const dyn = HS_MARKERS.map((m) => {
    const rows = hsLatest(m);
    if (!rows.length) return `<div class="li"><div class="t"><div style="font-weight:600">${m}</div><div class="m">нет данных</div></div><span class="badge" style="color:#9ca3af;border-color:#e5e7eb">—</span></div>`;
    const last = rows[0], s = hsStatus(last);
    const trend = rows.length >= 2 ? (Number(rows[0].value) > Number(rows[1].value) ? "растёт" : Number(rows[0].value) < Number(rows[1].value) ? "снижается" : "стабильно") : "—";
    const col = (s === "выше" || s === "ниже") ? "var(--red)" : s === "в диапазоне" ? "#1F9D55" : "#9ca3af";
    return `<div class="li" onclick="hsOpenChart('${m.replace(/'/g, "\\'")}')" style="cursor:pointer"><div class="t"><div style="font-weight:600">${m} <i class="ti ti-chart-line" style="color:#ccc;font-size:13px"></i></div><div class="m">${last.value} ${esc(last.unit || "")} · ${hsFmtD(last.date)} · ${trend}</div></div><div style="text-align:right">${hsSpark(rows.slice(0, 6).reverse())}<div class="m" style="color:${col}">${s}</div></div></div>`;
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
    <div class="row spread" style="margin-top:14px"><div class="sec-title">Напоминания о чекапах</div><div><button onclick="hsImport()" style="background:none;border:none;color:var(--muted);font-weight:600;cursor:pointer;margin-right:10px">импорт</button><button onclick="hsAddReminder()" style="background:none;border:none;color:var(--red);font-weight:600;cursor:pointer">＋ добавить</button></div></div>
    ${remCards}
    <div class="row spread" style="margin-top:14px"><div class="sec-title">Результаты анализов</div><button onclick="hsAddResult()" style="background:none;border:none;color:var(--red);font-weight:600;cursor:pointer">＋ показатель</button></div>
    ${resList}
    <button class="btn red" style="margin-top:10px" onclick="hsScanResults()"><i class="ti ti-camera" style="margin-right:6px"></i>Фото/скан анализов — ИИ распознает</button>
    <div class="lbl" style="padding:4px 2px 0">Сфотографируй бланк или загрузи PDF — ИИ вытащит показатели, ты проверишь и сохранишь. Сам файл сохранится на сервере.</div>
    ${fileList}
    <div class="sec-title" style="margin-top:16px">Динамика показателей</div>
    <div class="lbl" style="padding:0 2px 4px">Нажми на показатель — откроется график с зоной нормы и всеми измерениями.</div>
    <div class="card" style="padding:6px 16px">${dyn}</div>
    <button class="btn red" style="margin-top:16px" onclick="hsAdvice()"><i class="ti ti-sparkles" style="margin-right:6px"></i>Рекомендации ИИ (образ жизни, вопросы врачу, пересдача)</button>
    <div class="sec-title" style="margin-top:16px">Что требует внимания</div>
    ${analytics}
    <div class="lbl" style="padding:12px 2px 22px">Это не диагностика. Раздел помогает планировать чекапы и обсуждать показатели со специалистом. Отклонение от диапазона — повод обсудить с врачом, а не диагноз.</div>`;
};

/* ---- действия с напоминаниями ---- */
function hsReminderDone(id) {
  const H = hsLoad(); const r = H.reminders.find((x) => x.id === id); if (!r) return;
  r.status = "done";
  if (Number(r.frequencyDays) > 0) { const nd = new Date(); nd.setDate(nd.getDate() + Number(r.frequencyDays)); H.reminders.push({ id: hsUID("health-reminder"), title: r.title, type: r.type || "lab", frequencyDays: Number(r.frequencyDays), nextDate: nd.toISOString().slice(0, 10), comment: r.comment || "", status: "active" }); }
  hsSave(H); hsSyncCheckups(); toast("Выполнено ✓" + (Number(r.frequencyDays) > 0 ? " · запланирован следующий" : "")); RENDER.health();
}
function hsReminderPostpone(id) { const H = hsLoad(); const r = H.reminders.find((x) => x.id === id); if (!r) return; const d = new Date(r.nextDate + "T00:00:00"); d.setDate(d.getDate() + 14); r.nextDate = d.toISOString().slice(0, 10); r.status = "active"; hsSave(H); hsSyncCheckups(); toast("Отложено на 2 недели"); RENDER.health(); }

/* ---- формы ---- */
function hsReminderForm(r) {
  r = r || {};
  const opts = HS_TYPES.map((t) => `<option value="${t}">`).join("");
  el("create").innerHTML = `<div class="sheet"><h3>${r.id ? "Изменить напоминание" : "Новое напоминание"}</h3>
    <div class="lbl" style="margin:6px 0 2px">Название проверки (можно своё)</div>
    <input id="hr_t" list="hr_tl" value="${(r.title || "").replace(/"/g, "&quot;")}" placeholder="напр. МРТ позвоночника или своё название" style="width:100%"><datalist id="hr_tl">${opts}</datalist>
    <div class="lbl" style="margin:8px 0 2px">Следующая дата</div>
    <input type="date" id="hr_d" value="${r.nextDate || new Date().toISOString().slice(0, 10)}" style="width:100%">
    <div class="lbl" style="margin:8px 0 2px">Периодичность в днях (180 = полгода, 365 = год)</div>
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
  hsSave(H); hsSyncCheckups(); closeCreate(); toast("Сохранено ✓"); RENDER.health();
}
function hsDeleteReminder(id) { const H = hsLoad(); H.reminders = H.reminders.filter((x) => x.id !== id); hsSave(H); hsSyncCheckups(); closeCreate(); toast("Удалено ✓"); RENDER.health(); }
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
/* ---- Здоровье: фото/скан анализов → ИИ распознаёт → подтверждение → сохранение ---- */
function _downscaleFile(file, maxSide, q) {
  return new Promise((res) => {
    const r = new FileReader();
    if (!/^image\//.test(file.type || "")) { r.onloadend = () => res(r.result); r.readAsDataURL(file); return; }
    r.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height; const m = Math.max(w, h);
        if (m > maxSide) { const k = maxSide / m; w = Math.round(w * k); h = Math.round(h * k); }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        try { res(c.toDataURL("image/jpeg", q || 0.82)); } catch (e) { res(r.result); }
      };
      img.onerror = () => res(r.result); img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
function hsScanResults() {
  _pickFile(async (f) => {
    el("create").innerHTML = `<div class="sheet"><h3>Распознаю анализы…</h3><div class="lbl">ИИ читает бланк — пара секунд.</div></div>`;
    el("create").classList.remove("hidden");
    const isImg = /^image\//.test(f.type || "");
    const b64 = await _downscaleFile(f, 1800, 0.82);
    const mime = isImg ? "image/jpeg" : (f.type || "application/pdf");
    const fname = f.name || ("Анализ " + new Date().toLocaleDateString("ru"));
    let fileMeta = null;
    try { const up = await API.healthFilePut(fname, mime, b64); if (up && up.ok) fileMeta = { id: up.id, name: up.name, date: up.date, mime: up.mime }; } catch (e) {}
    const r = await API.vision(b64, mime, "labs");
    if (!(r && r.ok && r.text)) {
      closeCreate();
      if (fileMeta) { const H = hsLoad(); H.files.push(fileMeta); hsSave(H); RENDER.health(); }
      toast("Не удалось распознать" + (r && r.error ? ": " + r.error : "") + (fileMeta ? " (файл сохранён)" : ""));
      return;
    }
    let p; try { p = JSON.parse(r.text.replace(/```json|```/g, "").trim()); } catch (e) {
      closeCreate(); if (fileMeta) { const H = hsLoad(); H.files.push(fileMeta); hsSave(H); }
      openDocText(r.text); toast("Структурно не разобралось — вот текст, файл сохранён"); return;
    }
    window.__hsExtract = { date: p.date || new Date().toISOString().slice(0, 10), tests: (p.tests || []), file: fileMeta };
    hsConfirmExtract();
  });
}
function hsConfirmExtract() {
  const E = window.__hsExtract || { tests: [] };
  const rows = (E.tests || []).map((t, i) => `
    <div class="card" style="padding:8px 12px;margin-bottom:6px">
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><input type="checkbox" id="he_ck${i}" checked> <b>${esc(String(t.marker || "показатель"))}</b></label>
      <div style="display:flex;gap:6px">
        <input id="he_m${i}" value="${esc(String(t.marker || "")).replace(/"/g, "&quot;")}" placeholder="показатель" style="flex:2">
        <input id="he_v${i}" type="number" step="any" value="${t.value != null ? t.value : ""}" placeholder="знач." style="flex:1">
        <input id="he_u${i}" value="${esc(String(t.unit || ""))}" placeholder="ед." style="width:72px">
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input id="he_lo${i}" type="number" step="any" value="${t.ref_min != null ? t.ref_min : ""}" placeholder="норма от" style="flex:1">
        <input id="he_hi${i}" type="number" step="any" value="${t.ref_max != null ? t.ref_max : ""}" placeholder="норма до" style="flex:1">
      </div>
    </div>`).join("");
  el("create").innerHTML = `<div class="sheet" style="max-height:82vh;overflow:auto"><h3>Проверь распознанное</h3>
    <div class="lbl" style="margin-bottom:4px">Дата исследования</div>
    <input type="date" id="he_date" value="${E.date || new Date().toISOString().slice(0, 10)}" style="width:100%;margin-bottom:10px">
    ${rows || '<div class="lbl">ИИ не нашёл показателей на бланке. Можно закрыть и ввести вручную «＋ показатель».</div>'}
    <button class="btn red" style="margin-top:12px" onclick="hsSaveExtract(${(E.tests || []).length})">Сохранить выбранные</button>
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate();RENDER.health()">Отмена</button></div>`;
  el("create").classList.remove("hidden");
}
function hsSaveExtract(n) {
  const E = window.__hsExtract || {}; const H = hsLoad(); const date = el("he_date").value; let added = 0;
  for (let i = 0; i < n; i++) {
    const ck = el("he_ck" + i); if (!ck || !ck.checked) continue;
    const marker = (el("he_m" + i).value || "").trim(); const val = el("he_v" + i).value;
    if (!marker || val === "") continue;
    H.results.push({ id: hsUID("health-result"), date, testType: "", marker, value: Number(val),
      unit: (el("he_u" + i).value || "").trim(),
      refMin: el("he_lo" + i).value === "" ? "" : Number(el("he_lo" + i).value),
      refMax: el("he_hi" + i).value === "" ? "" : Number(el("he_hi" + i).value),
      comment: "", source: "photo", fileId: (E.file && E.file.id) || "" });
    added++;
  }
  if (E.file && !(H.files || []).some((f) => f.id === E.file.id)) H.files.push(E.file);
  hsSave(H); closeCreate(); toast(added ? ("Добавлено показателей: " + added) : "Ничего не выбрано"); RENDER.health();
}
async function hsOpenFile(id) {
  toast("Открываю…");
  const r = await API.healthFileGet(id);
  if (!(r && r.ok && r.data)) { toast("Файл недоступен"); return; }
  const w = window.open("", "_blank");
  if (!w) { toast("Разреши всплывающие окна"); return; }
  if (/^image\//.test(r.mime || "")) w.document.write(`<title>${esc(r.name || "")}</title><img src="${r.data}" style="max-width:100%">`);
  else w.document.write(`<title>${esc(r.name || "")}</title><iframe src="${r.data}" style="border:0;width:100%;height:100vh"></iframe>`);
}
async function hsDeleteFile(id) {
  const H = hsLoad(); H.files = (H.files || []).filter((f) => f.id !== id); hsSave(H); RENDER.health();
  try { await API.healthFileDelete(id); } catch (e) {}
  toast("Файл удалён");
}
async function hsAdvice() {
  const H = hsLoad(); const lines = [];
  HS_MARKERS.forEach((m) => { const rows = hsLatest(m); if (rows.length) lines.push(`${m}: ${rows[0].value} ${rows[0].unit || ""} (${hsStatus(rows[0])}${rows.length >= 2 ? ", прошлое " + rows[1].value : ""})`); });
  H.results.slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 20).forEach((r) => { if (!HS_MARKERS.includes(r.marker)) lines.push(`${r.marker}: ${r.value} ${r.unit || ""} (${hsStatus(r)}) от ${r.date}`); });
  hsActive().forEach((r) => { const dl = daysLeft(r.nextDate); lines.push(`Чекап «${r.title}»: ${dl < 0 ? "просрочен " + (-dl) + "д" : "через " + dl + "д"}`); });
  const summary = lines.join("\n") || "Данных пока мало.";
  el("create").innerHTML = `<div class="sheet"><h3>ИИ анализирует…</h3><div class="lbl">Готовлю рекомендации — пара секунд.</div></div>`;
  el("create").classList.remove("hidden");
  const r = await API.healthAdvice(summary);
  if (!(r && r.ok !== false)) { closeCreate(); toast("Не вышло" + (r && r.error ? ": " + r.error : "")); return; }
  const sect = (title, arr, icon) => (arr && arr.length) ? `<div class="sec-title" style="margin-top:12px">${icon} ${esc(title)}</div><div class="card" style="padding:6px 16px">${arr.map((x) => `<div class="li"><div class="t">${esc(String(x))}</div></div>`).join("")}</div>` : "";
  el("create").innerHTML = `<div class="sheet" style="max-height:82vh;overflow:auto"><h3>Рекомендации ИИ</h3>
    ${r.overview ? `<div class="card"><div class="t">${esc(String(r.overview))}</div></div>` : ""}
    ${sect("Образ жизни", r.lifestyle, "🌿")}
    ${sect("Что уточнить у врача", r.ask_doctor, "🩺")}
    ${sect("Когда пересдать", r.retest, "🔁")}
    <div class="lbl" style="padding:10px 2px 4px">Это не диагноз и не назначение лечения. Обсуди с врачом.</div>
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Закрыть</button></div>`;
}

/* ---- массовый импорт графика чекапов ---- */
function hsParsePeriod(s) {
  s = (s || "").trim().toLowerCase().replace(",", ".");
  const n = parseFloat(s); if (!n || n <= 0) return 180;
  if (s.includes("г") || s.includes("y")) return Math.round(n * 365);
  if (s.includes("м")) return Math.round(n * 30);
  if (s.includes("н") || s.includes("w")) return Math.round(n * 7);
  return Math.round(n);
}
function hsParseDate(s) {
  s = (s || "").trim(); if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
  if (m) { let y = m[3]; if (y.length === 2) y = "20" + y; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return "";
}
function hsImport() {
  el("create").innerHTML = `<div class="sheet"><h3>Импорт списка чекапов</h3>
    <div class="lbl" style="margin:6px 0 8px">Одна проверка в строке через «;»:<br><b>Название; периодичность; дата</b><br>Период: <b>180</b> (дней), <b>6м</b> (мес.), <b>1г</b> (год), <b>2н</b> (нед.). Дата необязательна: 2026-07-15 или 15.07.2026.<br><br>Пример:<br>Биохимия крови; 6м; 15.07.2026<br>МРТ позвоночника; 1г<br>Мой массаж; 30</div>
    <textarea id="hi_t" style="width:100%;min-height:150px" placeholder="Биохимия крови; 6м; 15.07.2026
Кардиолог; 1г
Витамин D; 4м"></textarea>
    <button class="btn red" style="margin-top:12px" onclick="hsRunImport()">Добавить все</button>
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button></div>`;
  el("create").classList.remove("hidden");
}
function hsRunImport() {
  const lines = (el("hi_t").value || "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (!lines.length) { toast("Список пуст"); return; }
  const H = hsLoad(); let added = 0; const today = new Date().toISOString().slice(0, 10);
  lines.forEach((line) => {
    const p = line.split(/[;|\t]/).map((x) => x.trim());
    const name = p[0]; if (!name) return;
    H.reminders.push({ id: hsUID("health-reminder"), title: name, type: "custom",
      frequencyDays: hsParsePeriod(p[1]), nextDate: hsParseDate(p[2]) || today, comment: "", status: "active" });
    added++;
  });
  hsSave(H); hsSyncCheckups(); closeCreate(); toast("Добавлено чекапов: " + added); RENDER.health();
}

/* ===================== ИИ-ПОМОЩНИК ===================== */
function hsAiSummary() {
  try {
    const att = []; HS_MARKERS.forEach((m) => { const rows = hsLatest(m); if (rows.length) { const s = hsStatus(rows[0]); if (s === "выше" || s === "ниже") att.push(m + " " + s); } });
    const nx = hsNext();
    return { index: hsIndex(), nextCheckup: nx ? (nx.title + " " + hsDdl(nx.nextDate)) : "—", attention: att, overdue: hsActive().filter((r) => daysLeft(r.nextDate) < 0).length };
  } catch (e) { return {}; }
}
let aiAnswer = "";
RENDER.assist = async function () {
  const back = `<div class="link" onclick="show('home')" style="margin:8px 0;cursor:pointer">‹ На главную</div>`;
  el("s-assist").innerHTML = `${back}<h1 class="h">ИИ-помощник</h1><div class="lbl" style="padding:0 2px 8px">Загружаю сводку…</div>`;
  const r = await API.assistant(profile, "cached", "", null).catch(() => ({ ok: false }));
  const dg = r && r.digest;
  const head = `<div class="row spread"><div class="sec-title">Сводка дня</div><button onclick="aiRefresh()" style="background:none;border:none;color:var(--red);font-weight:600;cursor:pointer">⟳ обновить</button></div>`;
  let digestHtml;
  if (dg) {
    digestHtml = `<div class="director-note"><div class="k">ГЛАВНОЕ СЕГОДНЯ</div><div class="v">${esc(dg.summary || "")}</div></div>`;
    if (dg.priorities && dg.priorities.length) digestHtml += `<div class="sec-title">Приоритеты</div><div class="card" style="padding:6px 16px">${dg.priorities.map((p) => `<div class="li"><i class="ti ti-flag" style="color:var(--red)"></i><div class="t">${esc(p.text || "")}</div></div>`).join("")}</div>`;
    if (dg.comments && dg.comments.length) digestHtml += `<div class="sec-title">По направлениям</div><div class="card" style="padding:6px 16px">${dg.comments.map((c) => `<div class="li"><div class="t"><div style="font-weight:600">${esc(c.area || "")}</div><div class="m">${esc(c.text || "")}</div></div></div>`).join("")}</div>`;
    digestHtml += `<div class="lbl" style="padding:6px 2px">Обновлено: ${esc(dg.date || "сегодня")}</div>`;
  } else {
    digestHtml = `<div class="card"><div class="lbl">${(r && r.ok) ? "Сводка ещё не сформирована — нажмите «обновить»." : ((r && r.error) || "Не удалось загрузить.")}</div></div>`;
  }
  const askBox = `<div class="sec-title" style="margin-top:14px">Спросить ИИ о своих делах</div>
    <div class="card"><textarea id="ai_q" placeholder="Напр.: на чём сфокусироваться сегодня? какие сделки рискуют? где проседает маржа?" style="width:100%;min-height:64px"></textarea>
    <button class="btn red" style="margin-top:8px" onclick="aiAsk()">Спросить</button>
    <div id="ai_a" style="margin-top:10px">${aiAnswer ? `<div class="director-note"><div class="k">ОТВЕТ ИИ</div><div class="v">${esc(aiAnswer)}</div></div>` : ""}</div></div>`;
  el("s-assist").innerHTML = `${back}<h1 class="h">ИИ-помощник</h1>${head}${digestHtml}${askBox}<div class="lbl" style="padding:10px 2px 22px">ИИ опирается на ваши данные в приложении. Не заменяет врача или юриста; по здоровью — только «обсудить со специалистом».</div>`;
};
async function aiRefresh() {
  toast("ИИ анализирует…");
  const r = await API.assistant(profile, "digest", "", personalSummary()).catch(() => ({ ok: false }));
  if (!r || r.ok === false) { toast((r && r.error) || "Не удалось"); return; }
  toast("Готово ✓"); RENDER.assist();
}
async function aiAsk() {
  const q = (el("ai_q").value || "").trim(); if (!q) { toast("Введите вопрос"); return; }
  toast("ИИ думает…");
  const r = await API.assistant(profile, "ask", q, personalSummary()).catch(() => ({ ok: false }));
  if (r && r.ok && r.answer) { aiAnswer = r.answer; RENDER.assist(); }
  else toast((r && r.error) || "Не удалось");
}

/* ===================== ТРЕКЕР ПРИВЫЧЕК (полезные + вредные + геймификация) ===================== */
const TK_KEY = "ks_track";
const TK_BADGES = [3, 7, 14, 30, 60, 90, 180];
function tkSave(d) { try { localStorage.setItem(TK_KEY, JSON.stringify(d)); } catch (e) {} if (window.TK_REMOTE) { try { API.stateSet("tracker", d); } catch (e) {} } }
function tkNorm(d) {
  d.weight = d.weight || { goal: null, start: null, log: {} };
  (d.bad || []).forEach((b) => { if (b.price == null) b.price = 0; if (b.norm == null) b.norm = 0; });
  return d;
}
function tkLoad() {
  try { const r = JSON.parse(localStorage.getItem(TK_KEY)); if (r && r.good) return tkNorm(r); } catch (e) {}
  const seed = {
    good: [{ id: "g-water", title: "Вода 2 л" }, { id: "g-move", title: "Зарядка / растяжка" }, { id: "g-walk", title: "Прогулка 8000 шагов" }, { id: "g-sleep", title: "Сон до 24:00" }, { id: "g-read", title: "Чтение 20 минут" }],
    bad: [{ id: "b-alco", title: "Алкоголь", unit: "порций", price: 0, norm: 0 }, { id: "b-smoke", title: "Сигареты", unit: "шт", price: 0, norm: 0 }],
    log: {}, weight: { goal: null, start: null, log: {} }
  };
  tkSave(seed); return seed;
}
function tkSpent(id, ym) { const d = tkLoad(); const b = d.bad.find((x) => x.id === id); let s = 0; Object.keys(d.log).forEach((k) => { if (ym && k.slice(0, 7) !== ym) return; const v = d.log[k].bad ? d.log[k].bad[id] : undefined; if (v > 0 && b) s += v * (b.price || 0); }); return Math.round(s); }
function tkSaved(id, ym) { const d = tkLoad(); const b = d.bad.find((x) => x.id === id); if (!b || !b.norm || !b.price) return 0; let s = 0; Object.keys(d.log).forEach((k) => { if (ym && k.slice(0, 7) !== ym) return; const v = d.log[k].bad ? d.log[k].bad[id] : undefined; if (v != null) s += Math.max(0, (b.norm - v)) * b.price; }); return Math.round(s); }
function tkSpark(vals) { if (!vals || vals.length < 2) return ""; const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1; return `<div style="display:flex;align-items:flex-end;gap:3px;height:42px;margin-top:8px">${vals.map((v) => { const h = 6 + Math.round((v - mn) / rng * 34); return `<span style="flex:1;max-width:16px;height:${h}px;background:var(--red);opacity:.5;border-radius:2px"></span>`; }).join("")}</div>`; }
function tkBadForm(id) {
  const d = tkLoad(); const b = id ? d.bad.find((x) => x.id === id) : {};
  el("create").innerHTML = `<div class="sheet"><h3>${id ? "Изменить привычку" : "Новая вредная привычка"}</h3>
    <div class="lbl" style="margin:6px 0 2px">Название</div><input id="tb_t" value="${(b.title || "").replace(/"/g, "&quot;")}" placeholder="напр. Алкоголь" style="width:100%">
    <div class="lbl" style="margin:8px 0 2px">Единица</div><input id="tb_u" value="${b.unit || ""}" placeholder="порций / шт" style="width:100%">
    <div class="lbl" style="margin:8px 0 2px">Цена за единицу, ₽</div><input id="tb_p" type="number" value="${b.price || 0}" style="width:100%">
    <div class="lbl" style="margin:8px 0 2px">Обычно в день (для расчёта экономии)</div><input id="tb_n" type="number" value="${b.norm || 0}" style="width:100%">
    <button class="btn red" style="margin-top:12px" onclick="tkSaveBad('${id || ""}')">Сохранить</button>
    ${id ? `<button class="btn ghost" style="margin-top:8px" onclick="tkDelBad('${id}')">Удалить</button>` : ""}
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button></div>`;
  el("create").classList.remove("hidden");
}
function tkSaveBad(id) { const d = tkLoad(); const o = { title: el("tb_t").value.trim() || "Привычка", unit: el("tb_u").value.trim(), price: Number(el("tb_p").value) || 0, norm: Number(el("tb_n").value) || 0 }; if (id) { Object.assign(d.bad.find((x) => x.id === id), o); } else { d.bad.push({ id: "b-" + Date.now(), ...o }); } tkSave(d); closeCreate(); toast("Сохранено ✓"); RENDER.track(); }
function tkDelBad(id) { const d = tkLoad(); d.bad = d.bad.filter((x) => x.id !== id); tkSave(d); closeCreate(); toast("Удалено"); RENDER.track(); }
function tkAddWeight() { const d = tkLoad(); const cur = d.weight.log[tkToday()] || ""; const v = prompt("Вес сегодня, кг:", cur || ""); if (v === null) return; const n = parseFloat((v + "").replace(",", ".")); if (!n) { toast("Введите число"); return; } d.weight.log[tkToday()] = Math.round(n * 10) / 10; if (d.weight.start == null) d.weight.start = d.weight.log[tkToday()]; tkSave(d); toast("Вес записан ✓"); RENDER.track(); }
function tkWeightGoal() { const d = tkLoad(); const v = prompt("Цель по весу, кг:", d.weight.goal || ""); if (v === null) return; const n = parseFloat((v + "").replace(",", ".")); if (!n) { toast("Введите число"); return; } d.weight.goal = Math.round(n * 10) / 10; const s = prompt("Стартовый вес, кг (для шкалы прогресса):", d.weight.start || ""); if (s !== null) { const sn = parseFloat((s + "").replace(",", ".")); if (sn) d.weight.start = Math.round(sn * 10) / 10; } tkSave(d); toast("Цель сохранена ✓"); RENDER.track(); }
function tkToday() { return new Date().toISOString().slice(0, 10); }
function tkDay(d, iso) { iso = iso || tkToday(); d.log[iso] = d.log[iso] || { good: {}, bad: {}, report: null }; return d.log[iso]; }
function tkToggleGood(id) { const d = tkLoad(); const day = tkDay(d); day.good[id] = !day.good[id]; tkSave(d); RENDER.track(); }
function tkClean(id) { const d = tkLoad(); tkDay(d).bad[id] = 0; tkSave(d); RENDER.track(); }
function tkAmount(id) { const d = tkLoad(); const b = d.bad.find((x) => x.id === id); const v = prompt(`${b.title}: сколько сегодня (${b.unit || "шт"})? 0 — чисто`, "0"); if (v === null) return; tkDay(d).bad[id] = Math.max(0, parseInt(v) || 0); tkSave(d); RENDER.track(); }
function tkStreak(id) {
  const d = tkLoad(); let s = 0; const t0 = new Date(tkToday() + "T00:00:00");
  for (let i = 0; i < 800; i++) { const iso = new Date(t0.getTime() - i * 86400000).toISOString().slice(0, 10); const day = d.log[iso]; if (day && day.bad && day.bad[id] === 0) s++; else break; }
  return s;
}
function tkBest(id) {
  const d = tkLoad(); const days = Object.keys(d.log).sort(); let best = 0, cur = 0, prev = null;
  days.forEach((iso) => { const v = d.log[iso].bad ? d.log[iso].bad[id] : undefined; if (v === 0) { cur = (prev && (new Date(iso + "T00:00:00") - new Date(prev + "T00:00:00")) === 86400000) ? cur + 1 : 1; best = Math.max(best, cur); prev = iso; } else { cur = 0; prev = null; } });
  return best;
}
function tkXP() { const d = tkLoad(); let xp = 0; Object.keys(d.log).forEach((iso) => { const day = d.log[iso]; xp += Object.values(day.good || {}).filter(Boolean).length * 5; (d.bad || []).forEach((b) => { if (day.bad && day.bad[b.id] === 0) xp += 10; }); }); return xp; }
function tkLevel() { return Math.floor(tkXP() / 100) + 1; }
let trackYM = null, trackBad = null;
function tkShiftMonth(n) { let [y, m] = trackYM.split("-").map(Number); m += n; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } trackYM = `${y}-${String(m).padStart(2, "0")}`; RENDER.track(); }
function tkPickBad(id) { trackBad = id; RENDER.track(); }
function tkHomeCard() {
  const d = tkLoad(); const day = d.log[tkToday()] || { good: {}, bad: {} };
  const goodDone = Object.values(day.good || {}).filter(Boolean).length;
  const streaks = d.bad.map((b) => `${b.title.split(" ")[0]} ${tkStreak(b.id)}д`).join(" · ");
  return `<div class="card" onclick="show('track')" style="cursor:pointer;margin-top:4px"><div class="row spread"><div class="t" style="font-weight:600"><i class="ti ti-trophy" style="color:var(--red);margin-right:8px"></i>Трекер дня · ур. ${tkLevel()}</div><span class="link">Открыть ›</span></div><div class="m" style="margin-top:6px">Полезные сегодня: ${goodDone}/${d.good.length} · Чисто: ${streaks}</div></div>`;
}
RENDER.track = function () {
  const d = tkLoad(); const day = tkDay(d); if (!trackYM) trackYM = tkToday().slice(0, 7); if (!trackBad) trackBad = (d.bad[0] || {}).id;
  const back = `<div class="link" onclick="show('home')" style="margin:8px 0;cursor:pointer">‹ На главную</div>`;

  const goodChips = d.good.map((g) => `<div onclick="tkToggleGood('${g.id}')" style="display:inline-flex;align-items:center;gap:6px;margin:3px 6px 3px 0;padding:7px 12px;border-radius:14px;cursor:pointer;border:1px solid ${day.good[g.id] ? "var(--red)" : "var(--line,#eee)"};background:${day.good[g.id] ? "var(--red)" : "#fff"};color:${day.good[g.id] ? "#fff" : "var(--ink,#222)"};font-size:13px;font-weight:600"><i class="ti ti-${day.good[g.id] ? "check" : "plus"}"></i>${esc(g.title)}</div>`).join("");

  const badToday = d.bad.map((b) => { const v = day.bad[b.id]; const set = v != null; return `<div class="li"><div class="t"><div style="font-weight:600">${esc(b.title)}</div><div class="m">${set ? (v === 0 ? "сегодня чисто 👍" : "сегодня: " + v + " " + (b.unit || "")) : "не отмечено"}</div></div><div><button class="btn ghost" style="padding:6px 10px" onclick="tkClean('${b.id}')">Чисто</button> <button class="btn ghost" style="padding:6px 10px" onclick="tkAmount('${b.id}')">Указать</button></div></div>`; }).join("");

  const game = d.bad.map((b) => {
    const st = tkStreak(b.id), best = tkBest(b.id), reached = Math.max(st, best);
    const badges = TK_BADGES.map((m) => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;${reached >= m ? "background:#1F9D55;color:#fff" : "background:#f0f0f0;color:#bbb"}">${m}д</span>`).join("");
    const money = b.price ? `<div class="m" style="margin-top:4px">за месяц: сэкономлено <b style="color:#1F9D55">${tkSaved(b.id, trackYM)} ₽</b>${tkSpent(b.id, trackYM) ? ` · потрачено ${tkSpent(b.id, trackYM)} ₽` : ""}</div>` : `<div class="m" style="margin-top:4px;color:#bbb">цена не задана — нажми ✎ для подсчёта денег</div>`;
    return `<div style="padding:8px 0;border-top:1px solid var(--line,#f0f0f0)"><div class="row spread"><div style="font-weight:600">${esc(b.title)} <i class="ti ti-pencil" style="color:#ccc;cursor:pointer;font-size:15px" onclick="tkBadForm('${b.id}')"></i></div><div class="lbl">серия <b style="color:#1F9D55">${st}</b> дн · рекорд ${best}</div></div>${money}<div style="margin-top:6px">${badges}</div></div>`;
  }).join("");

  // календарь выбранной вредной привычки
  const [Y, M] = trackYM.split("-").map(Number);
  const startW = (new Date(Y, M - 1, 1).getDay() + 6) % 7, dim = new Date(Y, M, 0).getDate();
  let cells = ""; for (let i = 0; i < startW; i++) cells += "<div></div>";
  for (let dd = 1; dd <= dim; dd++) {
    const iso = `${Y}-${String(M).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const v = d.log[iso] && d.log[iso].bad ? d.log[iso].bad[trackBad] : undefined;
    const bg = v === 0 ? "#1F9D55" : (v > 0 ? "var(--red)" : "#eee"), col = (v == null) ? "#999" : "#fff";
    cells += `<div title="${iso}" style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:8px;background:${bg};color:${col};font-size:12px;font-weight:600">${dd}</div>`;
  }
  const badTabs = d.bad.map((b) => `<b class="${trackBad === b.id ? "on" : ""}" onclick="tkPickBad('${b.id}')">${esc(b.title)}</b>`).join("");
  const calendar = `<div class="seg">${badTabs}</div>
    <div class="row spread" style="margin:8px 0"><button class="mbtn" onclick="tkShiftMonth(-1)"><i class="ti ti-chevron-left"></i></button><div style="font-weight:700">${MONTHS[M - 1]} ${Y}</div><button class="mbtn" onclick="tkShiftMonth(1)"><i class="ti ti-chevron-right"></i></button></div>
    <div class="cal-h">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((w) => `<div>${w}</div>`).join("")}</div>
    <div class="cal" style="gap:4px">${cells}</div>
    <div class="lbl" style="padding:6px 2px"><span style="color:#1F9D55">●</span> чисто · <span style="color:var(--red)">●</span> был срыв · ○ нет отметки</div>`;

  const W = d.weight; const wdates = Object.keys(W.log).sort(); const wcur = wdates.length ? W.log[wdates[wdates.length - 1]] : null;
  let weightCard;
  if (wcur == null) {
    weightCard = `<div class="lbl">Вес ещё не вносился. Задай цель и добавь первый замер кнопками справа ↑</div>`;
  } else {
    const goal = W.goal, start = (W.start != null ? W.start : wcur);
    let bar;
    if (goal != null) {
      const total = Math.abs(start - goal) || 1, done = Math.abs(start - wcur), prog = Math.max(0, Math.min(100, Math.round(done / total * 100)));
      const remain = Math.round((wcur - goal) * 10) / 10;
      const remTxt = remain > 0 ? ("осталось " + remain + " кг") : remain < 0 ? ("ниже цели на " + (-remain) + " кг") : "цель достигнута 🎉";
      bar = `<div class="row spread"><span class="lbl">старт ${start} · цель ${goal}</span><span class="lbl" style="font-weight:700">${remTxt}</span></div><div class="bar"><span style="width:${prog}%"></span></div>`;
    } else { bar = `<div class="lbl">Цель не задана — нажми «цель».</div>`; }
    const trend = wdates.length >= 2 ? (wcur < W.log[wdates[wdates.length - 2]] ? "снижается ↓" : wcur > W.log[wdates[wdates.length - 2]] ? "растёт ↑" : "стабильно") : "";
    weightCard = `<div class="big">${wcur} кг ${trend ? `<span style="font-size:13px;color:var(--muted)">${trend}</span>` : ""}</div>${bar}${tkSpark(wdates.slice(-14).map((k) => W.log[k]))}`;
  }
  const rep = day.report;
  const repCard = rep ? `<div class="card"><div class="lbl">Отчёт за сегодня</div><div style="font-weight:600;margin-top:4px">Сделал: ${esc(rep.done || "—")}</div><div class="m">Не успел: ${esc(rep.notDone || "—")} · настроение ${rep.mood || "-"}/5</div></div>` : "";

  el("s-track").innerHTML = `${back}<h1 class="h">Трекер дня</h1>
    <div class="card"><div class="row spread"><div class="lbl">Уровень и опыт</div><div class="lbl">${tkXP()} XP</div></div><div class="big">Уровень ${tkLevel()}</div><div class="bar"><span style="width:${tkXP() % 100}%"></span></div><div class="lbl">до следующего уровня ${100 - (tkXP() % 100)} XP</div></div>
    <div class="sec-title" style="margin-top:14px">Полезные привычки сегодня</div>
    <div class="card"><div>${goodChips}</div></div>
    <div class="row spread" style="margin-top:14px"><div class="sec-title">Вредные привычки — отметка дня</div><button onclick="tkBadForm('')" style="background:none;border:none;color:var(--red);font-weight:600;cursor:pointer">＋ привычка</button></div>
    <div class="card" style="padding:6px 16px">${badToday}</div>
    <div class="sec-title" style="margin-top:14px">Прогресс отказа и деньги</div>
    <div class="card">${game}</div>
    <div class="row spread" style="margin-top:14px"><div class="sec-title">Вес и цель</div><div><button onclick="tkWeightGoal()" style="background:none;border:none;color:var(--muted);font-weight:600;cursor:pointer;margin-right:10px">цель</button><button onclick="tkAddWeight()" style="background:none;border:none;color:var(--red);font-weight:600;cursor:pointer">＋ вес</button></div></div>
    <div class="card">${weightCard}</div>
    <div class="sec-title" style="margin-top:14px">Календарь</div>
    <div class="card">${calendar}</div>
    <div class="row spread" style="margin-top:14px"><div class="sec-title">Вечерний отчёт</div><button onclick="tkReportForm()" style="background:none;border:none;color:var(--red);font-weight:600;cursor:pointer">отметиться</button></div>
    ${repCard}
    <div class="lbl" style="padding:12px 2px 22px">Серия растёт за каждый чистый день. Срыв обнуляет серию, но не прогресс — рекорд и опыт остаются. Двигаемся дальше 💪</div>`;
};
function tkReportForm() {
  const d = tkLoad(); const day = tkDay(d); const rep = day.report || {};
  el("create").innerHTML = `<div class="sheet"><h3>Отчёт по дню</h3>
    <div class="lbl" style="margin:6px 0 2px">Что сделал сегодня</div>
    <textarea id="tr_done" style="width:100%;min-height:54px">${(rep.done || "").replace(/</g, "&lt;")}</textarea>
    <div class="lbl" style="margin:8px 0 2px">Что не успел</div>
    <textarea id="tr_not" style="width:100%;min-height:44px">${(rep.notDone || "").replace(/</g, "&lt;")}</textarea>
    <div class="lbl" style="margin:8px 0 2px">Настроение / энергия (1–5)</div>
    <input id="tr_mood" type="number" min="1" max="5" value="${rep.mood || 3}" style="width:100%">
    <div class="lbl" style="margin:10px 0 4px">Вредные привычки сегодня</div>
    ${d.bad.map((b) => { const v = day.bad[b.id]; return `<div class="row spread" style="margin:4px 0"><span>${esc(b.title)}</span><span><button class="btn ghost" style="padding:5px 10px" onclick="tkRepClean('${b.id}')">Чисто</button> <button class="btn ghost" style="padding:5px 10px" onclick="tkRepAmount('${b.id}')">Указать</button> <b style="margin-left:6px">${v == null ? "—" : (v === 0 ? "чисто" : v)}</b></span></div>`; }).join("")}
    <button class="btn red" style="margin-top:12px" onclick="tkSaveReport()">Сохранить отчёт</button>
    <button class="btn ghost" style="margin-top:8px" onclick="closeCreate()">Отмена</button></div>`;
  el("create").classList.remove("hidden");
}
function tkRepClean(id) { const d = tkLoad(); tkDay(d).bad[id] = 0; tkSave(d); tkReportForm(); }
function tkRepAmount(id) { const d = tkLoad(); const b = d.bad.find((x) => x.id === id); const v = prompt(`${b.title}: сколько сегодня (${b.unit || "шт"})? 0 — чисто`, "0"); if (v === null) return; tkDay(d).bad[id] = Math.max(0, parseInt(v) || 0); tkSave(d); tkReportForm(); }
function tkSaveReport() { const d = tkLoad(); const day = tkDay(d); day.report = { done: el("tr_done").value.trim(), notDone: el("tr_not").value.trim(), mood: Number(el("tr_mood").value) || 3, ts: new Date().toISOString() }; tkSave(d); closeCreate(); toast("Отчёт сохранён ✓"); RENDER.track(); }
function personalSummary() {
  const h = hsAiSummary();
  try {
    const d = tkLoad(); const day = d.log[tkToday()] || { good: {}, bad: {} };
    const goodDone = Object.values(day.good || {}).filter(Boolean).length;
    const streaks = d.bad.map((b) => `${b.title}: серия чистых ${tkStreak(b.id)}д, сегодня ${day.bad && day.bad[b.id] != null ? (day.bad[b.id] === 0 ? "чисто" : day.bad[b.id]) : "—"}`).join("; ");
    h.habits = `полезных сегодня ${goodDone}/${d.good.length}; ${streaks}; уровень ${tkLevel()}`;
    const ym = tkToday().slice(0, 7);
    const money = d.bad.filter((b) => b.price).map((b) => `${b.title}: сэкономлено за месяц ~${tkSaved(b.id, ym)}₽`).join("; ");
    if (money) h.habits += `; ${money}`;
    const W = d.weight || {}; const wk = Object.keys(W.log || {}).sort(); if (wk.length) { const c = W.log[wk[wk.length - 1]]; h.weight = `текущий ${c}кг${W.goal != null ? `, цель ${W.goal}кг` : ""}`; }
    const rep = day.report; if (rep) h.dayReport = `сделал: ${rep.done || "—"}; не успел: ${rep.notDone || "—"}; настроение ${rep.mood || "-"}/5`;
  } catch (e) {}
  return h;
}

/* ---- рабочий стол на главной: быстрые действия (мутируют + обновляют главную) ---- */
function hmGood(id) { tkToggleGood(id); RENDER.home(); }
function hmAddTask() { const i = el("hm_task"); const t = (i && i.value || "").trim(); if (!t) return; toast("Добавляю…"); API.addTask(t, "", "🟡", "").then(() => { toast("Задача добавлена ✓"); RENDER.home(); }).catch(() => toast("Не удалось")); }
function hmClean(id) { tkClean(id); RENDER.home(); }
function hmAmount(id) { tkAmount(id); RENDER.home(); }
function hmWeight() { tkAddWeight(); RENDER.home(); }
function dashboardCard() {
  const d = tkLoad(); const day = (d.log[tkToday()] || { good: {}, bad: {} });
  const goodDone = Object.values(day.good || {}).filter(Boolean).length;
  const chips = d.good.map((g) => `<span onclick="hmGood('${g.id}')" style="display:inline-flex;align-items:center;gap:4px;margin:3px 5px 3px 0;padding:6px 10px;border-radius:13px;cursor:pointer;border:1px solid ${day.good[g.id] ? "var(--red)" : "var(--line,#eee)"};background:${day.good[g.id] ? "var(--red)" : "#fff"};color:${day.good[g.id] ? "#fff" : "var(--ink,#222)"};font-size:12px;font-weight:600"><i class="ti ti-${day.good[g.id] ? "check" : "plus"}"></i>${esc(g.title)}</span>`).join("");
  const bad = d.bad.map((b) => { const v = day.bad[b.id]; return `<div class="row spread" style="margin:5px 0"><span style="font-weight:600">${esc(b.title)} ${v == null ? "" : v === 0 ? '<b style="color:#1F9D55">чисто</b>' : '<b style="color:var(--red)">' + v + "</b>"}</span><span><button class="btn ghost" style="padding:4px 9px;font-size:12px" onclick="hmClean('${b.id}')">Чисто</button> <button class="btn ghost" style="padding:4px 9px;font-size:12px" onclick="hmAmount('${b.id}')">＋</button></span></div>`; }).join("");
  const W = d.weight || { log: {} }; const wk = Object.keys(W.log || {}).sort(); const wcur = wk.length ? W.log[wk[wk.length - 1]] : null;
  const wline = `<div class="row spread" style="margin-top:8px"><span class="lbl">Вес: <b>${wcur != null ? wcur + " кг" : "—"}</b>${W.goal != null ? " · цель " + W.goal : ""}</span><button class="btn ghost" style="padding:4px 10px;font-size:12px" onclick="hmWeight()">＋ вес</button></div>`;
  const nx = (typeof hsNext === "function") ? hsNext() : null;
  const savedMonth = d.bad.reduce((s, b) => s + (b.price ? tkSaved(b.id, tkToday().slice(0, 7)) : 0), 0);
  return `<div class="card" style="margin-top:4px">
    <div class="row spread"><div class="t" style="font-weight:700"><i class="ti ti-layout-grid" style="color:var(--red);margin-right:6px"></i>Рабочий стол · ур. ${tkLevel()}</div><span class="lbl">${goodDone}/${d.good.length} привычек</span></div>
    <div style="display:flex;gap:6px;margin-top:8px"><input id="hm_task" placeholder="Быстрая задача…" style="flex:1" onkeydown="if(event.key==='Enter')hmAddTask()"><button class="btn red" style="padding:8px 12px" onclick="hmAddTask()">＋</button></div>
    <div style="margin-top:10px">${chips}</div>
    <div style="margin-top:8px">${bad}</div>
    ${wline}
    ${savedMonth > 0 ? `<div class="lbl" style="margin-top:8px">Сэкономлено в этом месяце: <b style="color:#1F9D55">${savedMonth} ₽</b></div>` : ""}
    ${nx ? `<div class="lbl" style="margin-top:8px">Чекап: ${esc(nx.title)} · ${hsDdl(nx.nextDate)}</div>` : ""}
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn red" style="flex:1;padding:8px" onclick="tkReportForm()">Вечерний отчёт</button><button class="btn ghost" style="flex:1;padding:8px" onclick="show('track')">Трекер</button></div>
  </div>`;
}
