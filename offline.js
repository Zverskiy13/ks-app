/* Офлайн-слой для раздела «День».
   Хранит день/месяц/профиль в памяти телефона (localStorage), копит изменения
   в очереди (outbox) и отправляет их на сервер, когда появляется интернет.
   Не зависит от остального кода — подключается ПЕРЕД api.js. */
window.OFFLINE = (function () {
  const LS = window.localStorage;
  const kDay = (d) => "off_day_" + d;
  const kMon = (m) => "off_mon_" + m;
  const K_OUT = "off_outbox";
  const K_PROF = "off_profile";

  function jget(k) { try { return JSON.parse(LS.getItem(k)); } catch (e) { return null; } }
  function jset(k, v) { try { LS.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // какие действия можно копить офлайн (правки «Дня»)
  const QUEUEABLE = new Set([
    "item/done", "item/undone", "item/delete", "item/edit", "item/move",
    "agenda/add", "reminders/add", "tasks/done", "tasks/add", "note/add"
  ]);

  function cacheDay(d, data) { if (d && data) jset(kDay(d), data); }
  function getDay(d) { return jget(kDay(d)); }
  function cacheMonth(m, data) { if (m && data) jset(kMon(m), data); }
  function getMonth(m) { return jget(kMon(m)); }
  function setProfile(p) { if (p) jset(K_PROF, p); }
  function getProfile() { return jget(K_PROF); }

  function outbox() { return jget(K_OUT) || []; }
  function saveOutbox(a) { jset(K_OUT, a); }
  function pending() { return outbox().length; }
  function queueable(path) { return QUEUEABLE.has(path); }

  /* Положить изменение в очередь и сразу оптимистично поправить кэш дня,
     чтобы интерфейс показал результат без интернета. */
  function enqueue(path, body) {
    const a = outbox();
    a.push({ id: Date.now() + "_" + Math.random().toString(16).slice(2, 6), path: path, body: body || {}, ts: Date.now() });
    saveOutbox(a);
    try { patchDay(path, body || {}); } catch (e) {}
  }

  function patchDay(path, body) {
    const date = body.date || body.new_date;
    if (!date) return;
    const d = getDay(body.date || date);
    if (!d) return;
    d.items = d.items || []; d.done = d.done || [];
    const findItem = (arr) => arr.findIndex((x) =>
      x.start === body.start && x.text === body.text && (body.kind ? (x.kind === body.kind) : true));

    if (path === "item/done" || path === "tasks/done") {
      const i = findItem(d.items); if (i >= 0) d.done.push(d.items.splice(i, 1)[0]);
    } else if (path === "item/undone") {
      const i = d.done.findIndex((x) => x.start === body.start && x.text === body.text);
      if (i >= 0) d.items.push(d.done.splice(i, 1)[0]);
    } else if (path === "item/delete") {
      const i = findItem(d.items); if (i >= 0) d.items.splice(i, 1);
    } else if (path === "agenda/add") {
      d.items.push({ start: body.start, end: body.end || "", text: body.text, kind: "block" });
    } else if (path === "reminders/add") {
      d.items.push({ start: body.time || body.start, text: body.text, kind: "rem" });
    } else if (path === "item/edit") {
      const i = findItem(d.items);
      if (i >= 0) { if (body.new_text) d.items[i].text = body.new_text; if (body.new_start) d.items[i].start = body.new_start; }
    } else if (path === "item/move") {
      const i = findItem(d.items);
      if (i >= 0) {
        if (body.new_date && body.new_date !== body.date) d.items.splice(i, 1);
        else if (body.new_start) d.items[i].start = body.new_start;
      }
    }
    d.items.sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
    cacheDay(body.date || date, d);
  }

  /* Отправка очереди на сервер по одному, по порядку. Останавливаемся, если
     упала сеть или сервер вернул ошибку/401 — несделанное остаётся в очереди. */
  let flushing = false;
  async function flush() {
    if (flushing || !navigator.onLine) return pending();
    const a = outbox();
    if (!a.length) return 0;
    flushing = true;
    try {
      while (a.length) {
        const job = a[0];
        let ok = false;
        try {
          const r = await fetch("/api/" + job.path, {
            method: "POST", headers: { "Content-Type": "application/json" },
            credentials: "same-origin", body: JSON.stringify(job.body)
          });
          if (r.status === 401) break;           // нужна повторная авторизация
          ok = r.ok;
        } catch (e) { break; }                    // сеть снова пропала
        if (!ok) break;                           // ошибка сервера — не теряем изменение
        a.shift(); saveOutbox(a);
      }
    } finally { flushing = false; }
    return pending();
  }

  return {
    cacheDay: cacheDay, getDay: getDay, cacheMonth: cacheMonth, getMonth: getMonth,
    setProfile: setProfile, getProfile: getProfile,
    enqueue: enqueue, flush: flush, pending: pending, queueable: queueable
  };
})();
