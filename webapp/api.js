/* Слой доступа к бэкенду приложения «Клиники Столицы».
   Только реальные вызовы API (FastAPI). Личность — из HttpOnly cookie-сессии;
   PIN-коды и модель доступа на клиенте НЕ хранятся. */

const API_BASE = "/api";

/* 401 → возврат на экран входа (onAuthExpired определён в app.js) */
function _authJson(r) {
  if (r.status === 401 && typeof onAuthExpired === "function") { try { onAuthExpired(); } catch (e) {} }
  return r.json().catch(() => ({ ok: false }));
}
function _g(url) { return fetch(`${API_BASE}/${url}`, { credentials: "same-origin" }).then(_authJson); }

const API = {
  login(pin) {
    return fetch(`${API_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ pin }) }).then(r => r.json()).catch(() => ({ ok: false }));
  },
  authMe() { return fetch(`${API_BASE}/auth/me`, { credentials: "same-origin" }).then(r => r.json()).catch(() => ({ ok: false })); },
  logout() { return fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "same-origin" }).then(r => r.json()).catch(() => ({})); },

  _get(path) { return _g(path); },
  async _post(path, body) {
    return fetch(`${API_BASE}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) }).then(_authJson);
  },

  today() { return _g("today"); },
  tasks() { return _g("tasks"); },
  home() { return _g("home"); },
  deals() { return _g("deals"); },
  finance() { return _g("finance"); },
  deadlines() { return _g("deadlines"); },
  goals() { return _g("goals"); },
  weekplan() { return _g("weekplan"); },
  habits() { return _g("habits"); },
  bigGoals() { return _g("biggoals"); },
  pvlTeam() { return _g("pvl/team"); },
  journal(limit) { return _g(`journal?limit=${limit || 50}`); },
  month(ym) { return _g(`month?ym=${encodeURIComponent(ym || "")}`); },
  day(date) { return _g(`day?date=${encodeURIComponent(date || "")}`); },
  group(profile, ym) { return _g(`group?ym=${encodeURIComponent(ym || "")}`); },
  pvlReport(profile, days) { return _g(`pvl/report?days=${days || 7}`); },
  finAgg(profile, ym, mode, date) { return _g(`finance/agg?ym=${ym || ""}&mode=${mode || "month"}&date=${date || ""}`); },
  aggFixedSet(amount, ym, scope) { return this._post("finance/fixed", { amount, ym: ym || "", scope: scope || "default" }); },
  financeBackfill() { return _g("finance/backfill"); },
  healthFileGet(id) { return _g(`health/file?id=${encodeURIComponent(id)}`); },
  auditLogins(ym) { return _g(`audit/logins?ym=${ym || ""}`); },
  dbStatus() { return _g("db/status"); },
  stateGet(key) { return _g(`state?key=${encodeURIComponent(key)}`); },
  stateSet(key, data) { return this._post("state", { key, data }); },
  pushKey() { return _g("push/key"); },
  notifGet() { return _g("notif/settings"); },

  taskEdit(id, oldText, newText, due) { return this._post("tasks/edit", { id: id || "", old_text: oldText || "", new_text: newText, ...(due === undefined ? {} : { due }) }); },
  taskDone(id, text) { return this._post("tasks/done", { id: id || "", text: text || "" }); },
  dealTouch(name) { return this._post("deals/touch", { name }); },
  addTask(text, company, priority, due) { return this._post("tasks/add", { text, company: company || "", priority: priority || "🟡", due: due || "" }); },
  addReminder(date, time, text) { return this._post("reminders/add", { date, time: time || "09:00", text }); },
  addBlock(date, start, end, text, repeat) { return this._post("agenda/add", { date, start, end: end || "", text, repeat: repeat || null }); },
  addNote(text) { return this._post("note/add", { text }); },
  itemMove(p) { return this._post("item/move", p); },
  itemDelete(p) { return this._post("item/delete", p); },
  itemDone(p) { return this._post("item/done", p); },
  itemUndone(p) { return this._post("item/undone", p); },
  itemEdit(p) { return this._post("item/edit", p); },
  deadlineEdit(p) { return this._post("deadlines/edit", p); },
  deadlineDone(i) { return this._post("deadlines/done", { i }); },
  deadlineAdd(p) { return this._post("deadlines/add", p); },
  habitDone(habit) { return this._post("habits/done", { habit }); },
  bigGoalAdd(p) { return this._post("biggoals/add", p); },
  bigGoalStatus(id, status) { return this._post("biggoals/status", { id, status }); },
  bigGoalDelete(id) { return this._post("biggoals/delete", { id }); },
  groupSave(ym, rows) { return this._post("group/save", { ym, rows }); },
  reportUpload(p) { return this._post("report/upload", p); },
  stt(audio_b64, mime) { return this._post("stt", { audio_b64, mime }); },
  vision(image_b64, mime, mode) { return this._post("vision", { image_b64, mime, mode: mode || "text" }); },
  healthFilePut(name, mime, data_b64) { return this._post("health/file", { name, mime, data_b64 }); },
  healthFileDelete(id) { return this._post("health/file/delete", { id }); },
  healthAdvice(summary) { return this._post("health/advice", { summary }); },
  healthCheckups(items) { return this._post("health/checkups", { items }); },
  assistant(profile, mode, question, health) { return this._post("assistant", { mode: mode || "cached", question: question || "", health: health || {} }); },
  brain(text) { return this._post("brain", { text }); },
  dedup() { return this._post("tasks/dedup", {}); },
  pushSubscribe(sub) { return this._post("push/subscribe", { subscription: sub }); },
  pushTest() { return this._post("push/test", {}); },
  notifSave(settings) { return this._post("notif/settings", { settings }); },

  contentAnalyze(url, note, text) { return this._post("content/analyze", { url: url || "", note: note || "", text: text || "" }); },
  contentIdeas() { return _g("content/ideas"); },
  contentDel(id) { return this._post("content/idea/delete", { id }); }
};
