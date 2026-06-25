/* Логика приложения «Клиники Столицы» (каркас). */
let profile = null;
let pin = "";

const fmt = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽";
const el = (id) => document.getElementById(id);
const NAV = {
  home:   { label: "Сегодня", icon: "ti-home-2" },
  tasks:  { label: "Задачи",  icon: "ti-circle-check" },
  money:  { label: "Финансы", icon: "ti-wallet" },
  funnel: { label: "Воронка", icon: "ti-target" },
  more:   { label: "Ещё",     icon: "ti-dots" }
};

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
    const { agenda, deadlines } = await API.today(profile);
    const tasks = await API.tasks(profile);
    const top = tasks.find((t) => !t.done && t.priority === "🔴") || tasks.find((t) => !t.done);
    const greet = profile.role === "owner" ? "Доброе утро, Иван" : profile.name.split(" ")[0];
    el("s-home").innerHTML = `
      <div class="sub">Понедельник, 29 июня</div>
      <h1 class="h">${profile.role === "owner" ? "Доброе утро,<br>Иван" : "Привет,<br>" + profile.name.split(" ")[0]}</h1>
      ${top ? `<div class="hero">
        <div class="top"><div class="k">ГЛАВНОЕ НА СЕГОДНЯ</div><div class="v">${top.text}</div></div>
        <div class="bot"><span class="lbl"><i class="ti ti-clock"></i> ${top.due || top.company}</span><span class="link" onclick="show('tasks')">Открыть ›</span></div>
      </div>` : ""}
      <div class="qa-row">
        <div class="qa" onclick="toast('Добавление — скоро')"><i class="ti ti-plus"></i>Добавить</div>
        <div class="qa" onclick="toast('Голосовой ввод — скоро')"><i class="ti ti-microphone"></i>Голос</div>
        <div class="qa" onclick="toast('Авто-план — скоро')"><i class="ti ti-wand"></i>Авто-план</div>
      </div>
      <div class="row spread"><div class="sec-title">Сегодня по часам</div></div>
      <div class="card" style="padding:4px 16px">
        ${agenda.map((a) => `<div class="li"><span class="tcell">${a.time}</span><i class="ti ${a.icon}" style="color:var(--muted)"></i><span class="t" style="font-weight:500">${a.text}</span></div>`).join("")}
      </div>
      ${deadlines.length ? `<div class="sec-title">Горящие дедлайны</div>
      <div class="dl-row">${deadlines.map((d) => `<div class="dl ${d.level}"><div class="n">${d.days}</div><div class="lbl" style="font-size:11px">дн · ${d.text}</div></div>`).join("")}</div>` : ""}
    `;
  },

  async tasks() {
    const tasks = await API.tasks(profile);
    el("s-tasks").innerHTML = `
      <h1 class="h">${profile.role === "staff" ? "Мои задачи" : "Задачи"}</h1>
      <div class="seg"><b class="on" data-f="all">Все</b><b data-f="hot">Срочные</b><b data-f="done">Выполнено</b></div>
      <div class="card" id="tasklist" style="padding:6px 16px"></div>
      <button class="btn red" style="margin-top:14px" onclick="toast('Подсказка дня — скоро')">Что делать сейчас?</button>`;
    window.__tasks = tasks;
    let filter = "all";
    const draw = () => {
      const list = tasks.filter((t) => filter === "all" ? true : filter === "hot" ? !t.done && t.priority === "🔴" : t.done);
      el("tasklist").innerHTML = list.length ? list.map((t) => `
        <div class="li">
          <span class="chk ${t.done ? "done" : ""}" onclick="closeTask('${t.id}')"><i class="ti ti-check" style="font-size:15px"></i></span>
          <div class="t"><div class="${t.done ? "done-txt" : ""}">${t.text}</div>${t.done ? "" : `<div class="m">${t.company}${t.due ? " · " + t.due : ""}</div>`}</div>
        </div>`).join("") : `<div class="lbl" style="padding:14px 0">Задач нет 🎉</div>`;
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
        ${admin ? `<div class="li"><i class="ti ti-users" style="font-size:20px;color:var(--red)"></i><div class="t">Роли и доступ</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>` : ""}
        <div class="li"><i class="ti ti-flame" style="font-size:20px;color:var(--red)"></i><div class="t">Привычки и шаги</div><span class="lbl">4 дня</span></div>
        <div class="li"><i class="ti ti-target-arrow" style="font-size:20px;color:var(--red)"></i><div class="t">Цели и прогресс</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
        <div class="li"><i class="ti ti-calendar-week" style="font-size:20px;color:var(--red)"></i><div class="t">План недели</div><i class="ti ti-chevron-right" style="color:#bbb"></i></div>
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
function logout() { profile = null; el("app").classList.add("hidden"); el("login").classList.remove("hidden"); }
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
el("roleBtn").onclick = () => el("sheet").classList.remove("hidden");
el("sheet").onclick = (e) => { if (e.target.id === "sheet") el("sheet").classList.add("hidden"); };
document.querySelectorAll("#sheet .opt").forEach((o) => o.onclick = async () => {
  el("sheet").classList.add("hidden");
  const res = await API.login(o.dataset.pin);
  if (res.ok) { profile = res.profile; enterApp(); }
});

buildPad();
