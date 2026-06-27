/* Слой данных приложения «Клиники Столицы».
   Сейчас работает на МОК-данных (демо). Чтобы переключить на реальный бэкенд
   (FastAPI поверх бота) — поставь USE_REMOTE=true и укажи API_BASE.
   Сигнатуры методов специально совпадают с будущими эндпоинтами. */

const USE_REMOTE = true;
const API_BASE = "/api";

/* ---- Демо-пользователи (в реале — на бэкенде, вход по PIN) ---- */
const USERS = {
  "1111": { id: "ivan",  name: "Иван Кузин",        role: "owner", companies: "*",            title: "Владелец" },
  "2222": { id: "natav", name: "Наталья Мартиросян", role: "head",  companies: ["Калмыкия"],   title: "Руководитель · Калмыкия" },
  "3333": { id: "emp1",  name: "Администратор ПВЛ",  role: "staff", companies: ["ПВЛ"],        title: "Сотрудник · ПВЛ" }
};

const ROLE_SECTIONS = {
  owner: ["home", "day", "tasks", "journal", "money", "funnel", "more"],
  head:  ["home", "day", "tasks", "journal", "money", "funnel", "more"],
  staff: ["home", "day", "tasks", "journal", "more"]
};

/* ---- МОК-данные (как из состояния бота) ---- */
const DB = {
  tasks: [
    { id: "t1", text: "Оплатить МобилМед — остаток 1 млн", company: "АМУ", priority: "🔴", due: "сегодня", assignee: "ivan", done: false },
    { id: "t2", text: "Документы «Культура Здоровья» к ИФНС", company: "Группа", priority: "🔴", due: "до 5 июля", assignee: "ivan", done: false },
    { id: "t3", text: "Аудит документации Калмыкии", company: "Калмыкия", priority: "🔴", due: "эта неделя", assignee: "natav", done: false },
    { id: "t4", text: "Связаться с Мартиросян по статусу проверки", company: "Калмыкия", priority: "🟡", due: "", assignee: "natav", done: false },
    { id: "t5", text: "Рэдиссон: запустить поток", company: "АМУ", priority: "🟡", due: "", assignee: "emp1", done: false },
    { id: "t6", text: "Обзвон недобравших клиентов ПВЛ", company: "ПВЛ", priority: "🟡", due: "сегодня", assignee: "emp1", done: false },
    { id: "t7", text: "Перевести зарплату по Клиникам", company: "Группа", priority: "🔴", due: "", assignee: "ivan", done: true }
  ],
  agenda: [
    { time: "07:30", text: "Утренний ритуал", icon: "ti-sunrise", company: "*" },
    { time: "10:00", text: "Звонок юристу по Калмыкии", icon: "ti-phone", company: "Калмыкия", who: "ivan" },
    { time: "14:00", text: "Аудит документации Калмыкии", icon: "ti-clipboard-check", company: "Калмыкия", who: "natav" },
    { time: "11:00", text: "Приём пациентов — смена", icon: "ti-user-heart", company: "ПВЛ", who: "emp1" },
    { time: "18:00", text: "Остеопат", icon: "ti-stethoscope", company: "*", who: "ivan" }
  ],
  deadlines: [
    { days: 6, text: "Документы ИФНС", company: "Группа", level: "red" },
    { days: 17, text: "Прокуратура Калмыкия", company: "Калмыкия", level: "amber" },
    { days: 32, text: "Закрыть кредиты", company: "Группа", level: "amber" }
  ],
  deals: [
    { name: "Чайхона · 18 юрлиц", company: "АМУ", stage: "переговоры", step: "согласовать ЛК", silent: 10, assignee: "emp1" },
    { name: "Аппараты Газпром · 56 шт", company: "АМУ", stage: "переговоры", step: "контракт в рассрочку", silent: 2, assignee: "ivan" },
    { name: "Рэдиссон Славянская", company: "АМУ", stage: "контакт", step: "назначить встречу", silent: 12, assignee: "emp1" },
    { name: "Таксопарк №20", company: "АМУ", stage: "лид", step: "поток водителей с июля", silent: 3, assignee: "emp1" },
    { name: "Минздрав РК — профосмотры", company: "Калмыкия", stage: "переговоры", step: "согласовать объёмы", silent: 8, assignee: "natav" }
  ],
  financeGroup: {
    ownerIncome: 3580000, goal: 5000000, debt: 4200000,
    companies: [
      { name: "АМУ · Павелецкая", profit: 1260000 },
      { name: "АМУ · Агрегатор", profit: 2170000 },
      { name: "Калмыкия", profit: 300000, share: 0.5 }
    ],
    levers: [
      { name: "Закрыть кредиты", impact: 600000, progress: 50 },
      { name: "Калмыкия +1 млн", impact: 500000, progress: 14 },
      { name: "Реактивация ПВЛ", impact: 400000, progress: 6 }
    ]
  }
};

/* ---- helpers ---- */
function inScope(company, profile) {
  if (profile.role === "owner" || profile.companies === "*") return true;
  if (company === "*" || company === "Группа") return profile.role === "head" ? false : false;
  return profile.companies.includes(company);
}
function mine(assignee, profile) { return assignee === profile.id; }

/* ---- API ---- */
const API = {
  async login(pin) {
    if (USE_REMOTE) return fetch(`${API_BASE}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) }).then(r => r.json());
    const u = USERS[pin];
    return u ? { ok: true, profile: { ...u, sections: ROLE_SECTIONS[u.role] } } : { ok: false };
  },

  async today(profile) {
    if (USE_REMOTE) return this._get("today", profile);
    let agenda = DB.agenda.filter(a => profile.role === "owner" ? (a.who ? a.who === "ivan" || a.company === "*" : true)
      : a.company === "*" || (a.who ? mine(a.who, profile) : profile.companies.includes(a.company)));
    agenda = agenda.sort((x, y) => x.time.localeCompare(y.time));
    const dls = DB.deadlines.filter(d => profile.role === "owner" || profile.companies.includes(d.company) || d.company === "Группа" && profile.role !== "staff");
    return { agenda, deadlines: dls };
  },

  async tasks(profile) {
    if (USE_REMOTE) return this._get("tasks", profile);
    return DB.tasks.filter(t =>
      profile.role === "owner" ? true :
      profile.role === "head" ? profile.companies.includes(t.company) || t.assignee === profile.id :
      t.assignee === profile.id
    );
  },

  async toggleTask(id) {
    const t = DB.tasks.find(x => x.id === id); if (t) t.done = !t.done;
    return { ok: true };
  },

  taskEdit(oldText, newText, due) { return this._post("tasks/edit", { old_text: oldText, new_text: newText, ...(due === undefined ? {} : { due }) }); },
  async taskDone(text) {
    if (USE_REMOTE) return fetch(`${API_BASE}/tasks/done`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).then(r => r.json());
    const t = DB.tasks.find(x => x.text === text); if (t) t.done = true;
    return { ok: true };
  },

  async dealTouch(name) {
    if (USE_REMOTE) return fetch(`${API_BASE}/deals/touch`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(r => r.json());
    const d = DB.deals.find(x => x.name === name); if (d) d.silent = 0;
    return { ok: true };
  },

  async day(date) {
    if (USE_REMOTE) return fetch(`${API_BASE}/day?date=${encodeURIComponent(date || "")}`).then(r => r.json());
    const items = DB.agenda.filter(a => a.who ? a.who === "ivan" || a.company === "*" : true)
      .map(a => ({ start: a.time, end: null, text: a.text, kind: "block" })).sort((x, y) => x.start.localeCompare(y.start));
    return { date: date || "", items, free: ["08:30–10:00", "11:00–14:00", "после 16:00"] };
  },

  async _post(path, body) {
    if (USE_REMOTE) return fetch(`${API_BASE}/${path}`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
    return { ok: true };
  },
  addTask(text, company, priority, due) { return this._post("tasks/add", { text, company: company || "", priority: priority || "🟡", due: due || "" }); },
  addReminder(date, time, text) { return this._post("reminders/add", { date, time: time || "09:00", text }); },
  addBlock(date, start, end, text) { return this._post("agenda/add", { date, start, end: end || "", text }); },
  addNote(text) { return this._post("note/add", { text }); },
  itemMove(p) { return this._post("item/move", p); },
  itemDelete(p) { return this._post("item/delete", p); },
  itemDone(p) { return this._post("item/done", p); },
  deadlines(profile) { return USE_REMOTE ? this._get("deadlines", profile) : Promise.resolve([]); },
  deadlineEdit(p) { return this._post("deadlines/edit", p); },
  deadlineDone(i) { return this._post("deadlines/done", { i }); },
  deadlineAdd(p) { return this._post("deadlines/add", p); },
  goals(profile) { return USE_REMOTE ? this._get("goals", profile) : Promise.resolve({ goals: [], levers: [] }); },
  weekplan(profile) { return USE_REMOTE ? this._get("weekplan", profile) : Promise.resolve({ days: [], tasks: [] }); },
  habits(profile) { return USE_REMOTE ? this._get("habits", profile) : Promise.resolve({ habits: [] }); },
  habitDone(habit) { return this._post("habits/done", { habit }); },
  bigGoals(profile) { return USE_REMOTE ? this._get("biggoals", profile) : Promise.resolve([]); },
  bigGoalAdd(p) { return this._post("biggoals/add", p); },
  bigGoalStatus(id, status) { return this._post("biggoals/status", { id, status }); },
  bigGoalDelete(id) { return this._post("biggoals/delete", { id }); },
  group(profile, ym) { return USE_REMOTE ? fetch(`${API_BASE}/group?user=${encodeURIComponent(profile.id)}&ym=${ym || ""}`).then(r => r.json()) : Promise.resolve({ rows: [], total: 0, months: [] }); },
  groupSave(ym, rows) { return this._post("group/save", { ym, rows }); },
  async journal(limit) {
    if (USE_REMOTE) return fetch(`${API_BASE}/journal?limit=${limit || 50}`).then(r => r.json());
    return { entries: [] };
  },
  async month(ym) {
    if (USE_REMOTE) return fetch(`${API_BASE}/month?ym=${encodeURIComponent(ym || "")}`).then(r => r.json());
    return { dates: [] };
  },
  dedup() { return this._post("tasks/dedup", {}); },
  pushKey() { return USE_REMOTE ? fetch(`${API_BASE}/push/key`).then(r => r.json()) : Promise.resolve({ key: "", ready: false }); },
  pushSubscribe(sub) { return this._post("push/subscribe", { subscription: sub }); },
  pushTest() { return this._post("push/test", {}); },

  async deals(profile) {
    if (USE_REMOTE) return this._get("deals", profile);
    return DB.deals.filter(d =>
      profile.role === "owner" ? true :
      profile.role === "head" ? profile.companies.includes(d.company) :
      d.assignee === profile.id
    );
  },

  async finance(profile) {
    if (USE_REMOTE) return this._get("finance", profile);
    if (profile.role === "owner") return { scope: "group", data: DB.financeGroup };
    if (profile.role === "head") {
      const cos = DB.financeGroup.companies.filter(c => profile.companies.some(p => c.name.includes(p)));
      return { scope: "company", data: { companies: cos } };
    }
    return { scope: "none", data: null };
  },

  _get(path, profile) {
    return fetch(`${API_BASE}/${path}?user=${encodeURIComponent(profile.id)}`).then(r => r.json());
  }
};

window.API = API;
